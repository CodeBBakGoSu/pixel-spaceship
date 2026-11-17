import './style.css';
import { SCRIPT, createGame, parseGameOptions, restartGame, stepGame, type GameInput, type GameState } from './game';
import type { Segment } from './camera';
import type { Flight } from './flight';
import { bakeSprites } from './models';
import { drawEntities, drawShots } from './render';
import { drawCockpit, ShipSprite, type ShipPose } from './ship';
import { World } from './world';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#screen'), ctx = canvas.getContext('2d', { alpha: false })!;
const glowCanvas = $<HTMLCanvasElement>('#glow'), glow = glowCanvas.getContext('2d');
const world = new World(), shipSprite = new ShipSprite(), sprites = bakeSprites();
const ground = (x: number, z: number) => world.height(x, z);
const options = parseGameOptions(location.search), legacy = new URLSearchParams(location.search);
let game = createGame(options, ground);
if (legacy.get('roll') === '1') { game.roll = 0.5; game.player.bank = 0.45; }
const neutral: GameInput = { moveX: 0, moveY: 0, fire: false, aspect: innerWidth / Math.max(1, innerHeight) };
for (let i=0;i<Math.round(options.time*60) && game.phase!=='win' && game.phase!=='game_over';i++) { world.setBiome(game.biome,game.arena.x); game=stepGame(game,neutral,1/60,ground); }
let frame: ImageData, other: ImageData;
let lastTime=performance.now(), accumulator=0, fps=60;
let pointerX=0,pointerY=0,pointerActive=false,pointerDown=false;
const touchMode=options.touch || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints>0;
let stickX=0,stickY=0,stickActive=false,touchFire=false,touchBoost=false;
let pendingStart=false,pendingPause=false,pendingView=false,pendingBomb=false;
let lastHelp='',helpTimer=0,lastMenu='',lastSpeaker='';
const keys=new Set<string>();
const help=$<HTMLElement>('#help'),banner=$<HTMLElement>('#phase-banner'),overlay=$<HTMLElement>('#game-overlay');
const primary=$<HTMLButtonElement>('#primary-action'),restart=$<HTMLButtonElement>('#restart-action');
const touchControls=$<HTMLElement>('#touch-controls'),stick=$<HTMLElement>('#stick'),knob=$<HTMLElement>('#stick-knob');
touchControls.hidden=!touchMode;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(n:number)=>{n=clamp(n,0,1);return n*n*(3-2*n);};
const textNodes=new Map<string,HTMLElement>();
const setText=(selector:string,text:string)=>{let el=textNodes.get(selector);if(!el){el=$(selector);textNodes.set(selector,el);}if(el.textContent!==text)el.textContent=text;};
const viewName=(v:Segment)=>v==='overhead'?'TOP':v.toUpperCase();

Object.defineProperty(window,'__game',{get:()=>Object.freeze({
  phase:game.phase,segment:game.segment,view:game.camera.mode,objective:game.objective,score:game.score,lives:game.lives,hull:game.hull,
  weaponLv:game.weaponLv,peakWeaponLv:game.peakWeaponLv,bst:game.bst,bombs:game.bombs,rank:game.rank,salvage:game.salvage,fps:Math.round(fps),loop:game.loop,loopSpeed:game.loopSpeed,
  phaseTime:game.phaseTime,transitionT:game.transitionT,wipeT:game.wipeT,paused:game.paused,boosting:game.boosting,pylonsDown:game.pylonsDown,doorsCleared:game.doorsCleared,
  boundaryWarning:game.boundaryWarning,arena:Object.freeze({...game.arena}),bossHp:game.boss.active?game.boss.hp:null,bossPods:Object.freeze([...game.boss.pods]),entities:game.entities.length,bullets:game.bullets.length,
  player:Object.freeze({...game.player}),aimX:game.aimX,aimY:game.aimY,
})});
function resize():void{
  const aspect=innerWidth/Math.max(1,innerHeight);canvas.width=clamp(Math.round(180*aspect),160,480);canvas.height=Math.round(canvas.width/aspect);
  ctx.imageSmoothingEnabled=false;document.documentElement.style.setProperty('--cockpit-panel',`${34/canvas.height*innerHeight}px`);glowCanvas.width=canvas.width;glowCanvas.height=canvas.height;frame=ctx.createImageData(canvas.width,canvas.height);other=ctx.createImageData(canvas.width,canvas.height);
}
function showHelp():void{
  const movement=game.segment==='atoll'?'SHOOT PYLONS / FIND EXIT':game.segment==='canyon'?'SHOOT BOTH LOCKS':game.segment==='orbit'?'DESTROY PODS / CORE':'CLEAR WAVES / MATCH ALTITUDE';
  help.textContent=touchMode?`DRAG TO TURN / CLIMB · FIRE · BOOST · BOMB · VIEW`:`${movement} · WASD / ARROWS · SPACE FIRE · SHIFT BOOST · X BOMB · V VIEW · P PAUSE`;
  help.classList.remove('fade');clearTimeout(helpTimer);helpTimer=window.setTimeout(()=>help.classList.add('fade'),6000);
}
function portrait(speaker:string):void{
  const c=$<HTMLCanvasElement>('#portrait'),p=c.getContext('2d')!;p.clearRect(0,0,32,32);
  const fill=(color:string,x:number,y:number,w:number,h:number)=>{p.fillStyle=color;p.fillRect(x,y,w,h);};
  const warden=speaker==='WARDEN';fill(warden?'#41262d':'#163d45',0,0,32,32);
  fill(warden?'#813e3d':'#3d8974',2,3,8,2);fill(warden?'#813e3d':'#3d8974',22,5,8,2);
  fill(warden?'#606b70':speaker==='GALE'?'#41845f':'#8a745f',7,10,18,16);fill('#222d35',9,7,14,5);fill('#17212b',8,26,18,6);
  fill(warden?'#b25b59':'#d7c3a0',11,13,11,8);fill('#f0e8d0',17,14,5,5);fill('#161d27',19,15,2,3);
  fill(warden?'#bd5c4b':'#f4a34d',20,19,10,4);fill('#17212b',23,23,7,2);fill(warden?'#db6661':'#6e9b9b',10,27,12,5);
}
function updateHud():void{
  const key=`${game.segment}/${game.camera.mode}/${game.phase}`;if(key!==lastHelp){lastHelp=key;showHelp();}
  setText('#hull-bars','▮'.repeat(game.hull)+'▯'.repeat(game.maxHull-game.hull));setText('#lives',`×${game.lives}`);
  $<HTMLElement>('#boost-bar').style.width=`${game.bst*100}%`;setText('#bombs','◆'.repeat(game.bombs)||'—');
  setText('#view-label',viewName(game.camera.mode));setText('#weapon-label',`TWIN ${game.weaponLv}`);
  const seconds=game.phase==='transition'?0:Math.floor(game.phaseTime+0.00001);
  setText('#segment-timer',`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`);
  help.classList.toggle('cockpit-help',game.camera.mode==='cockpit');
  $<HTMLElement>('#boundary-warning').hidden=!game.boundaryWarning;
  setText('#score',String(game.score).padStart(6,'0'));setText('#salvage',`◆ ${String(game.salvage).padStart(3,'0')}`);
  setText('#objective',game.objective);setText('#alt-number',String(Math.round(game.player.altitude)));
  $<HTMLElement>('#alt-marker').style.top=`${clamp(85-(game.player.altitude-55)/110*70,10,85)}%`;
  const radio=$<HTMLElement>('#radio');radio.hidden=!game.dialogue;radio.classList.toggle('boss-radio',game.boss.active);
  if(game.dialogue){setText('#radio-speaker',game.dialogue.speaker);setText('#radio-text',game.dialogue.text);if(lastSpeaker!==game.dialogue.speaker){lastSpeaker=game.dialogue.speaker;portrait(lastSpeaker);}}
  const boss=$<HTMLElement>('#boss-hud');boss.hidden=!game.boss.active;if(game.boss.active)$<HTMLElement>('#boss-health').style.width=`${game.boss.hp/game.boss.maxHp*100}%`;
  banner.hidden=!(game.phase==='transition'||game.phase==='playing'&&game.phaseTime<2);
  setText('#phase-banner',game.phase==='transition'?SCRIPT.find(d=>d.id===game.nextSegment)!.name:SCRIPT[game.scriptIndex].name);
  const tag=$<HTMLElement>('#view-tag');tag.hidden=game.viewTagT<=0;setText('#view-tag',`VIEW ${viewName(game.camera.mode)}`);
  const menu=game.paused?'paused':game.phase;
  if(menu!==lastMenu){lastMenu=menu;const show=['title','win','game_over','paused'].includes(menu);overlay.hidden=!show;
    if(show){const rank=$<HTMLElement>('#rank-display');rank.hidden=menu!=='win';restart.hidden=menu!=='win';
      if(menu==='title'){setText('#card-kicker','COURIER FLIGHT SYSTEMS / MISSION 01');setText('#card-title','ASTER WING');setText('#card-copy','Clear the reach, open the gates, and deliver the signal through orbit.');setText('#primary-action','LAUNCH MISSION');setText('#card-hint','ENTER OR TAP TO LAUNCH');}
      else if(menu==='win'){setText('#card-kicker','KESTREL ORBIT CLEAR');setText('#card-title','ROUTE COMPLETE');setText('#card-copy',`SCORE ${String(game.score).padStart(6,'0')}  ·  ${game.hitsTaken} HITS  ·  ◆ ${game.salvage}`);setText('#rank-display',`RANK ${game.rank}`);setText('#primary-action','NEXT LOOP');setText('#card-hint','ENTER FOR NEXT LOOP · R TO RESTART');}
      else if(menu==='game_over'){setText('#card-kicker','SIGNAL LOST');setText('#card-title','MISSION ENDED');setText('#card-copy',`FINAL SCORE ${String(game.score).padStart(6,'0')}`);setText('#primary-action','RESTART');setText('#card-hint','ENTER TO RESTART');}
      else{setText('#card-kicker','FLIGHT SYSTEMS / STANDBY');setText('#card-title','PAUSED');setText('#card-copy','Mission clock and flight systems are on hold.');setText('#primary-action','RESUME');setText('#card-hint','P TO RESUME');}
    }
  }
}
function action():void{if(game.paused)pendingPause=true;else if(['title','game_over','win'].includes(game.phase))pendingStart=true;}
primary.addEventListener('click',action);restart.addEventListener('click',()=>{game=restartGame(game,ground);});
overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)action();});
window.addEventListener('resize',resize);
window.addEventListener('keydown',event=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(event.code))pointerActive=false;
  if(!event.repeat){if(event.code==='Enter')action();if(event.code==='KeyP')pendingPause=true;if(event.code==='KeyV')pendingView=true;if(event.code==='KeyX'||event.code==='KeyK')pendingBomb=true;if(event.code==='KeyR'&&(game.phase==='win'||game.phase==='game_over'))game=restartGame(game,ground);}
  keys.add(event.code);
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{keys.clear();pointerDown=false;pointerActive=false;touchFire=touchBoost=stickActive=false;stickX=stickY=0;});
function steer(event:PointerEvent):void{const r=canvas.getBoundingClientRect();pointerX=clamp((event.clientX-r.left)/r.width*2-1,-1,1);pointerY=clamp((event.clientY-r.top)/r.height*2-1,-1,1);pointerActive=true;}
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(game.phase!=='playing'&&game.phase!=='transition'){action();return;}pointerDown=true;canvas.setPointerCapture(event.pointerId);steer(event);});
canvas.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'||pointerDown)steer(event);});
canvas.addEventListener('pointerup',event=>{pointerDown=false;if(event.pointerType==='touch')pointerActive=false;});
canvas.addEventListener('pointercancel',()=>{pointerDown=false;pointerActive=false;});canvas.addEventListener('pointerleave',()=>{if(!pointerDown)pointerActive=false;});
function moveStick(event:PointerEvent):void{const r=stick.getBoundingClientRect();stickX=clamp((event.clientX-(r.left+r.width/2))/(r.width/2),-1,1);stickY=clamp((event.clientY-(r.top+r.height/2))/(r.height/2),-1,1);knob.style.transform=`translate(${stickX*28}px,${stickY*28}px)`;}
stick.addEventListener('pointerdown',event=>{event.preventDefault();stickActive=true;stick.setPointerCapture(event.pointerId);moveStick(event);});
stick.addEventListener('pointermove',event=>{if(stickActive)moveStick(event);});
const releaseStick=()=>{stickActive=false;stickX=stickY=0;knob.style.transform='';};stick.addEventListener('pointerup',releaseStick);stick.addEventListener('pointercancel',releaseStick);
function touchButton(id:string,down:()=>void,up:()=>void=()=>{}):void{const el=$<HTMLButtonElement>(id);el.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);el.classList.add('held');down();});const end=()=>{el.classList.remove('held');up();};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);}
touchButton('#touch-fire',()=>{touchFire=true;},()=>{touchFire=false;});touchButton('#touch-boost',()=>{touchBoost=true;},()=>{touchBoost=false;});touchButton('#touch-bomb',()=>{pendingBomb=true;});touchButton('#touch-view',()=>{pendingView=true;});
function controls():GameInput{
  let x=Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA'))+stickX;
  let y=Number(keys.has('ArrowDown')||keys.has('KeyS'))-Number(keys.has('ArrowUp')||keys.has('KeyW'))+stickY;
  if(pointerActive){x+=Math.abs(pointerX)<0.08?0:pointerX;y+=Math.abs(pointerY)<0.08?0:pointerY;}
  let fire=touchFire||stickActive||pointerDown||keys.has('Space')||keys.has('KeyJ')||keys.has('KeyZ');
  const pad=navigator.getGamepads?.()[0];if(pad){x+=Math.abs(pad.axes[0]||0)>0.15?pad.axes[0]:0;y+=Math.abs(pad.axes[1]||0)>0.15?pad.axes[1]:0;fire||=!!pad.buttons[0]?.pressed;}
  return{moveX:clamp(x,-1,1),moveY:clamp(y,-1,1),fire,aspect:canvas.width/canvas.height,boost:touchBoost||keys.has('ShiftLeft')||keys.has('ShiftRight')||legacy.get('boost')==='1',bomb:pendingBomb,toggleView:pendingView,start:pendingStart,pause:pendingPause,
    aimX:game.camera.mode==='cockpit'&&pointerActive?pointerX:undefined,aimY:game.camera.mode==='cockpit'&&pointerActive?pointerY:undefined};
}
function visualFlight(s:GameState):Flight{return{x:s.player.x,z:s.player.z,yaw:s.player.yaw,altitude:s.player.altitude,speed:34*s.loopSpeed*(s.boosting?1.55:1),boost:s.boosting?1:0,pitch:0,roll:s.roll};}
const radar=$<HTMLCanvasElement>('#nav-radar'),radarCtx=radar.getContext('2d')!;
let radarFrame=0;
function drawRadar():void {
  if (++radarFrame % 4 !== 0) return;
  const c=radarCtx,p=game.player;c.clearRect(0,0,72,72);
  c.fillStyle='rgba(7,21,28,.8)';c.fillRect(0,0,72,72);c.strokeStyle='#619898';c.strokeRect(1,1,70,70);
  c.strokeStyle='#31585b';c.beginPath();c.arc(36,38,27,0,Math.PI*2);c.moveTo(9,38);c.lineTo(63,38);c.moveTo(36,11);c.lineTo(36,65);c.stroke();
  const dot=(x:number,z:number,color:string)=>{let dx=(x-p.x)*.13,dz=-(z-p.z)*.13;const d=Math.hypot(dx,dz);if(d>26){dx*=26/d;dz*=26/d;}c.fillStyle=color;c.fillRect(Math.round(35+dx),Math.round(37+dz),3,3);};
  for(const e of game.entities){if(e.kind==='pylon'||e.kind==='lock')dot(e.x,e.z,'#ffd16b');else if(e.kind==='exit')dot(e.x,e.z,'#6affbd');else if(e.kind==='supply'||e.kind==='capsule')dot(e.x,e.z,'#71f2ff');else if(e.kind==='drone')dot(e.x,e.z,'#ff8c8c');}
  if(game.boss.active)dot(game.boss.x,game.boss.z,'#f588af');
  const x=36+Math.sin(p.yaw)*6,y=38-Math.cos(p.yaw)*6;c.strokeStyle='#e5fff0';c.beginPath();c.moveTo(36,38);c.lineTo(x,y);c.stroke();c.fillStyle='#e5fff0';c.fillRect(35,37,3,3);
  c.fillStyle='#a5d5ce';c.font='bold 6px monospace';c.fillText('NAV',4,8);
}
function render():void{
  const w=canvas.width,h=canvas.height,mode=game.camera.mode,transition=game.phase==='transition',t=transition?smooth(game.transitionT):0;
  const nextView=SCRIPT.find(d=>d.id===game.nextSegment)!.defaultView;
  world.setBiome(game.biome,game.arena.x);
  if(transition && (mode==='overhead') !== (nextView==='overhead')){
    world.render(frame,game.camera,mode==='overhead'?'overhead':'chase');world.render(other,game.camera,nextView==='overhead'?'overhead':'chase');
    const from=frame.data,to=other.data;for(let i=0;i<from.length;i+=4){from[i]=mix(from[i],to[i],t);from[i+1]=mix(from[i+1],to[i+1],t);from[i+2]=mix(from[i+2],to[i+2],t);}
  }else world.render(frame,game.camera,mode==='overhead'?'overhead':'chase');
  ctx.putImageData(frame,0,0);if(glow){glow.setTransform(1,0,0,1,0,0);glow.clearRect(0,0,w,h);}
  if(mode==='overhead')world.drawDust(ctx,game.camera,'overhead',game.elapsed);
  ctx.save();if(transition)ctx.globalAlpha=1-t;drawEntities(ctx,glow,sprites,game,mode,ground);ctx.restore();
  if((mode!=='cockpit'||transition&&nextView!=='cockpit') && !(game.invulnTimer>0&&Math.floor(game.elapsed*10)%2===0&&!transition)){
    const overhead=mode==='overhead',blend=transition&&overhead&&nextView!=='overhead'?t:overhead?0:1;
    const clearance=Math.max(0,game.player.altitude-ground(game.player.x,game.player.z));
    const overheadX=w/2+(game.player.x-game.camera.x)/1.4*Math.min(1,w/240),overheadY=h/2-game.player.y/1.4;
    const alpha=transition&&nextView==='cockpit'?1-t:transition&&mode==='cockpit'?t:1;
    const pose:ShipPose={x:mix(overheadX,w/2,blend),y:mix(overheadY,h*.59,blend),scale:mix(.72,1,blend)*(w<240?1.22:1),pitch:mix(65,36,blend),lift:mix(1.4,1,blend),bank:game.player.bank,alpha,perspective:blend,shadowSquash:mix(.82,.28,blend),shadowY:mix(clearance*.48,23+clearance*.24,blend)};
    shipSprite.draw(ctx,glow,visualFlight(game),blend<.5?'overhead':'chase',game.biome==='space'?-1000:ground(game.player.x,game.player.z),false,pose);
  }
  ctx.save();if(transition)ctx.globalAlpha=1-t;drawShots(ctx,glow,game,mode);ctx.restore();
  if(mode==='cockpit'||transition&&nextView==='cockpit')drawCockpit(ctx,game.camera.pitch,game.aimX,game.aimY,transition?(mode==='cockpit'?t:1-t):0,game.player.altitude,game.boosting?190:120);
  if(game.wipeT>0){const progress=1-game.wipeT/.35,y=Math.round(progress*h);ctx.fillStyle='rgba(14,22,35,.75)';ctx.fillRect(0,y-7,w,14);ctx.fillStyle='rgba(189,246,244,.7)';for(let i=-8;i<=8;i+=3)ctx.fillRect(0,y+i,w,1);}
  updateHud();drawRadar();
}
function animate(now:number):void{
  const elapsed=Math.max(0,(now-lastTime)/1000);lastTime=now;if(elapsed>0&&elapsed<.25)fps+=(1/elapsed-fps)*.05;accumulator+=Math.min(.05,elapsed);
  while(accumulator>=1/60){world.setBiome(game.biome,game.arena.x);game=stepGame(game,controls(),1/60,ground);pendingStart=pendingPause=pendingView=pendingBomb=false;if(!game.paused)shipSprite.update(1/60,visualFlight(game),game.player.bank/.65);accumulator-=1/60;}
  render();requestAnimationFrame(animate);
}
resize();requestAnimationFrame(animate);
