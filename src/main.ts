import './style.css';
import { CockpitDisplay } from './cockpit-display';
import { measureCockpitMotion, type CockpitMotion, type CockpitTarget, type CockpitView, type CockpitWarnings } from './cockpit';
import { SCRIPT, createGame, parseGameOptions, restartGame, stepGame, type GameInput, type GameState } from './game';
import type { Segment } from './camera';
import type { Flight } from './flight';
import { createTranslator, initialLanguage, saveLanguage, type Language, type MessageKey } from './i18n';
import { bakeSprites } from './models';
import { drawEntities, drawShots, type EntityLabels } from './render';
import { ShipSprite, type ShipPose } from './ship';
import { World } from './world';
import { cockpitLayout, desktopLayout, guideLayout, phoneLayout as calculatePhoneLayout, type CockpitLayout, type HudLayout, type Insets, type PhoneLayout, type Rect } from './layout';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#screen'), ctx = canvas.getContext('2d', { alpha: false })!;
const glowCanvas = $<HTMLCanvasElement>('#glow'), glow = glowCanvas.getContext('2d');
const world = new World(), shipSprite = new ShipSprite(), sprites = bakeSprites();
const ground = (x: number, z: number) => world.height(x, z);
const options = parseGameOptions(location.search), legacy = new URLSearchParams(location.search);
const languageStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
let language = initialLanguage(location.search, navigator.language, languageStorage);
let t = createTranslator(language);
const gameFont = getComputedStyle(document.documentElement).getPropertyValue('--game-font').trim();
const canvasFont = `8px ${gameFont}`;
const cockpitDisplay = new CockpitDisplay($<HTMLCanvasElement>('#cockpit-overlay'), gameFont);
let entityLabels: EntityLabels, radarLabel: string;
let cockpit: CockpitLayout | null = null;
let cockpitReadout: { target: CockpitTarget | null; warnings: CockpitWarnings } | null = null;
let cockpitMotion: CockpitMotion = { speed: 0, climb: 0, bank: 0, turn: 0 };
let game = createGame(options, ground);
const cameraScratch = { ...game.camera };
const cockpitView: CockpitView = { camera: cameraScratch, buffer: canvas, screen: { width: innerWidth, height: innerHeight } };
if (legacy.get('roll') === '1') { game.roll = 0.5; game.player.bank = 0.45; }
const neutral: GameInput = { moveX: 0, moveY: 0, fire: false, aspect: innerWidth / Math.max(1, innerHeight) };
const stepTime = 1 / 60;
function advanceGame(input: GameInput): void {
  const previous = game;
  world.setBiome(previous.biome, previous.arena.x);
  game = stepGame(previous, input, stepTime, ground);
  cockpitMotion = measureCockpitMotion(previous, game, cockpitMotion, stepTime);
}
for (let i = 0; i < Math.round(options.time * 60) && game.phase !== 'win' && game.phase !== 'game_over'; i++) advanceGame(neutral);
let frame: ImageData, other: ImageData;
let lastTime=performance.now(), accumulator=0, fps=60;
let pointerX=0,pointerY=0,pointerActive=false,pointerDown=false;
const coarsePointer=matchMedia('(pointer: coarse)'),portraitOrientation=matchMedia('(orientation: portrait)');
const detectTouch=()=>options.touch||coarsePointer.matches||(navigator.maxTouchPoints>0&&Math.min(innerWidth,innerHeight)<=600);
let touchMode=detectTouch();
let phone: PhoneLayout | null = null, layoutView: Segment | null = null;
let viewportSafe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
let stickX=0,stickY=0,stickActive=false,touchFire=false,touchBoost=false;
let pendingStart=false,pendingPause=false,pendingView=false,pendingBomb=false;
let lastHelp='',helpTimer=0,lastMenu='',lastSpeaker='';
let guideMode: 'launch' | 'help' | null = null;
let guideOpener: HTMLElement | null = null;
const keys=new Set<string>();
const help=$<HTMLElement>('#help'),banner=$<HTMLElement>('#phase-banner'),overlay=$<HTMLElement>('#game-overlay');
const primary=$<HTMLButtonElement>('#primary-action'),restart=$<HTMLButtonElement>('#restart-action');
const languageButtons = document.querySelectorAll<HTMLButtonElement>('[data-lang]');
const gameCard = $<HTMLElement>('.game-card'), guideCard = $<HTMLElement>('#guide-card');
const guideBody = $<HTMLElement>('.guide-body'), guidePrimary = $<HTMLButtonElement>('#guide-primary');
const guideSkip = $<HTMLButtonElement>('#guide-skip'), guideHelp = $<HTMLButtonElement>('#help-action');
const experience=$<HTMLElement>('.experience'),safeProbe=$<HTMLElement>('#safe-area-probe'),touchPause=$<HTMLButtonElement>('#touch-pause');
const touchControls=$<HTMLElement>('#touch-controls'),stick=$<HTMLElement>('#stick'),knob=$<HTMLElement>('#stick-knob');
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(n:number)=>{n=clamp(n,0,1);return n*n*(3-2*n);};
const textNodes=new Map<string,HTMLElement>();
const setText=(selector:string,text:string)=>{let el=textNodes.get(selector);if(!el){el=$(selector);textNodes.set(selector,el);}if(el.textContent!==text)el.textContent=text;};
const viewName = (view: Segment) => t(`view.${view}`);
const scoreText = () => String(game.score).padStart(6, '0');

function objectiveText(): string {
  if (game.objective === 'objective.pylons') return t(game.objective, { down: game.pylonsDown });
  if (game.objective === 'objective.doors') {
    return t(game.objective, { cleared: game.doorsCleared, total: SCRIPT[game.scriptIndex].doorCount ?? 3 });
  }
  return t(game.objective);
}

function applyLanguage(): void {
  t = createTranslator(language);
  document.documentElement.lang = language;
  document.title = t('app.title');
  $('meta[name="description"]').setAttribute('content', t('app.description'));
  for (const [attribute, target] of [['data-i18n', 'text'], ['data-label', 'aria-label'], ['data-tooltip', 'title']]) {
    for (const node of document.querySelectorAll(`[${attribute}]`)) {
      const copy = t(node.getAttribute(attribute) as MessageKey);
      if (target === 'text') node.textContent = copy;
      else node.setAttribute(target, copy);
    }
  }
  for (const button of languageButtons) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
  entityLabels = { font: canvasFont, exit: t('canvas.exit'), warden: t('speaker.warden'), weakPoint: t('canvas.weakPoint') };
  radarLabel = t('hud.nav');
  lastHelp = lastMenu = '';
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    language = button.dataset.lang as Language;
    saveLanguage(language, languageStorage);
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      history.replaceState(history.state, '', url);
    }
    applyLanguage();
    updateHud();
  });
}

Object.defineProperty(window,'__game',{get:()=>Object.freeze({
  phase:game.phase,segment:game.segment,view:game.camera.mode,objective:objectiveText(),score:game.score,lives:game.lives,hull:game.hull,
  weaponLv:game.weaponLv,peakWeaponLv:game.peakWeaponLv,bst:game.bst,bombs:game.bombs,rank:game.rank,salvage:game.salvage,fps:Math.round(fps),loop:game.loop,loopSpeed:game.loopSpeed,
  phaseTime:game.phaseTime,transitionT:game.transitionT,wipeT:game.wipeT,paused:game.paused,boosting:game.boosting,pylonsDown:game.pylonsDown,doorsCleared:game.doorsCleared,
  boundaryWarning:game.boundaryWarning,arena:Object.freeze({...game.arena}),bossHp:game.boss.active?game.boss.hp:null,bossPods:Object.freeze([...game.boss.pods]),entities:game.entities.length,bullets:game.bullets.length,
  player:Object.freeze({...game.player}),aimX:game.aimX,aimY:game.aimY,
  cockpit: cockpitReadout ? Object.freeze({
    target: cockpitReadout.target ? Object.freeze({ ...cockpitReadout.target, point: Object.freeze({ ...cockpitReadout.target.point }) }) : null,
    warnings: Object.freeze({ ...cockpitReadout.warnings }),
    motion: Object.freeze({ ...cockpitMotion }),
  }) : null,
  layout:phone?Object.freeze({orientation:phone.orientation,buffer:Object.freeze({...phone.buffer}),playfield:Object.freeze({...phone.playfield}),controls:Object.freeze({...phone.controls}),dashboard:phone.dashboard?Object.freeze({...phone.dashboard}):null}):null,
})});
function safeInsets():Insets {
  const style=getComputedStyle(safeProbe),px=(value:string)=>Math.max(0,parseFloat(value)||0);
  return{top:px(style.paddingTop),right:px(style.paddingRight),bottom:px(style.paddingBottom),left:px(style.paddingLeft)};
}
function intendedView():Segment {
  const next=SCRIPT.find(d=>d.id===game.nextSegment)!.defaultView;
  return game.camera.mode==='cockpit'||game.phase==='transition'&&next==='cockpit'?'cockpit':game.camera.mode;
}
function setRect(name:string,r:Rect):void {
  const style=experience.style;style.setProperty(`--${name}-x`,`${r.x}px`);style.setProperty(`--${name}-y`,`${r.y}px`);
  style.setProperty(`--${name}-w`,`${r.width}px`);style.setProperty(`--${name}-h`,`${r.height}px`);
}
function setHudLayout(layout: HudLayout): void {
  for (const name of ['hud', 'boss', 'radio', 'objective', 'radar', 'alt'] as const) setRect(name, layout[name]);
}
function updateFlightLayout(): void {
  layoutView = intendedView();
  phone = touchMode ? calculatePhoneLayout(innerWidth, innerHeight, viewportSafe, layoutView) : null;
  const hud = phone ?? desktopLayout(innerWidth, innerHeight, viewportSafe);
  setHudLayout(hud);
  if (phone) {
    const parts: Record<string, Rect> = { field: phone.playfield, controls: phone.controls, pause: phone.pause, stick: phone.stick,
      fire: phone.fire, boost: phone.boost, bomb: phone.bomb, view: phone.view };
    for (const [name, r] of Object.entries(parts)) setRect(name, r);
  }
  cockpit = layoutView === 'cockpit'
    ? phone?.cockpit ?? cockpitLayout(innerWidth, innerHeight, viewportSafe, hud.objective)
    : null;
  cockpitDisplay.resize(cockpit, innerWidth, innerHeight, language, t);
  if (cockpit) {
    setRect('cockpit-message', cockpit.message);
    if (cockpit.help) setRect('cockpit-help', cockpit.help);
  }
  experience.classList.toggle('cockpit-view', !!cockpit);
  experience.classList.toggle('phone-portrait', phone?.orientation === 'portrait');
  experience.classList.toggle('phone-landscape', phone?.orientation === 'landscape');
}
function resize():void{
  touchMode=detectTouch();
  viewportSafe = safeInsets();
  experience.classList.toggle('phone-layout',touchMode);
  updateFlightLayout();
  const guide = guideLayout(innerWidth, innerHeight, viewportSafe);
  setRect('guide', guide.card);
  guideCard.style.setProperty('--guide-heading-h', `${guide.heading.height}px`);
  guideCard.style.setProperty('--guide-body-h', `${guide.body.height}px`);
  guideCard.style.setProperty('--guide-actions-h', `${guide.actions.height}px`);
  guideCard.classList.toggle('guide-wide', guide.columns === 2);
  $<HTMLElement>('#guide-keyboard').hidden = touchMode;
  $<HTMLElement>('#guide-touch').hidden = !touchMode;
  const aspect=innerWidth/Math.max(1,innerHeight);
  if(phone){canvas.width=phone.buffer.width;canvas.height=phone.buffer.height;}
  else{canvas.width=clamp(Math.round(180*aspect),160,480);canvas.height=Math.round(canvas.width/aspect);}
  cockpitView.screen.width = innerWidth;
  cockpitView.screen.height = innerHeight;
  ctx.imageSmoothingEnabled = false;
  glowCanvas.width=canvas.width;glowCanvas.height=canvas.height;frame=ctx.createImageData(canvas.width,canvas.height);other=ctx.createImageData(canvas.width,canvas.height);
  lastHelp='';
}
function showHelp():void{
  help.textContent = touchMode ? t('help.touch') : `${t(`help.${game.segment}`)} · ${t('help.keys')}`;
  help.classList.remove('fade');clearTimeout(helpTimer);helpTimer=window.setTimeout(()=>help.classList.add('fade'),6000);
}
function portrait(speaker:string):void{
  const c=$<HTMLCanvasElement>('#portrait'),p=c.getContext('2d')!;p.clearRect(0,0,32,32);
  const fill=(color:string,x:number,y:number,w:number,h:number)=>{p.fillStyle=color;p.fillRect(x,y,w,h);};
  const warden=speaker==='warden';fill(warden?'#41262d':'#163d45',0,0,32,32);
  fill(warden?'#813e3d':'#3d8974',2,3,8,2);fill(warden?'#813e3d':'#3d8974',22,5,8,2);
  fill(warden?'#606b70':speaker==='gale'?'#41845f':'#8a745f',7,10,18,16);fill('#222d35',9,7,14,5);fill('#17212b',8,26,18,6);
  fill(warden?'#b25b59':'#d7c3a0',11,13,11,8);fill('#f0e8d0',17,14,5,5);fill('#161d27',19,15,2,3);
  fill(warden?'#bd5c4b':'#f4a34d',20,19,10,4);fill('#17212b',23,23,7,2);fill(warden?'#db6661':'#6e9b9b',10,27,12,5);
}
function updateHud():void{
  const key=`${game.segment}/${game.camera.mode}/${game.phase}`;if(key!==lastHelp){lastHelp=key;showHelp();}
  setText('#hull-bars','▮'.repeat(game.hull)+'▯'.repeat(game.maxHull-game.hull));setText('#lives',`×${game.lives}`);
  $<HTMLElement>('#boost-bar').style.width=`${game.bst*100}%`;setText('#bombs','◆'.repeat(game.bombs)||'—');
  setText('#view-label', viewName(game.camera.mode));
  setText('#weapon-label', t('hud.weapon', { level: game.weaponLv }));
  const seconds=game.phase==='transition'?0:Math.floor(game.phaseTime+0.00001);
  setText('#segment-timer',`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`);
  $<HTMLElement>('#boundary-warning').hidden=!game.boundaryWarning;
  setText('#score',scoreText());setText('#salvage',`◆ ${String(game.salvage).padStart(3,'0')}`);
  setText('#objective',objectiveText());setText('#alt-number',String(Math.round(game.player.altitude)));
  $<HTMLElement>('#alt-marker').style.top=`${clamp(85-(game.player.altitude-55)/110*70,10,85)}%`;
  $<HTMLElement>('#radio').hidden = !game.dialogue;
  if (game.dialogue) {
    setText('#radio-speaker', t(`speaker.${game.dialogue.speaker}`));
    setText('#radio-text', t(game.dialogue.key));
    if (lastSpeaker !== game.dialogue.speaker) {
      lastSpeaker = game.dialogue.speaker;
      portrait(lastSpeaker);
    }
  }
  const boss=$<HTMLElement>('#boss-hud');boss.hidden=!game.boss.active;if(game.boss.active)$<HTMLElement>('#boss-health').style.width=`${game.boss.hp/game.boss.maxHp*100}%`;
  const showPhase = game.phase === 'transition' || game.phase === 'playing' && game.phaseTime < 2;
  banner.hidden = !showPhase || (!!cockpit && game.boundaryWarning);
  setText('#phase-banner', t(`segment.${game.phase === 'transition' ? game.nextSegment : game.segment}`));
  const tag = $<HTMLElement>('#view-tag');
  tag.hidden = game.viewTagT <= 0 || (!!cockpit && (game.boundaryWarning || !banner.hidden));
  setText('#view-tag', t('view.tag', { view: viewName(game.camera.mode) }));
  updateMenu();
}

function updateMenu(): void {
  const menu = game.paused ? 'paused' : game.phase;
  const screen = guideMode ?? menu;
  const show = menu !== 'playing' && menu !== 'transition';
  if(touchMode&&show&&screen!==lastMenu){
    stickActive=false;stickX=stickY=0;touchFire=false;touchBoost=false;pointerDown=false;pointerActive=false;knob.style.transform='';
    for(const button of touchControls.querySelectorAll('.held'))button.classList.remove('held');
  }
  touchControls.hidden=!touchMode||show;touchPause.hidden=!touchMode||show;experience.classList.toggle('menu-open',show);
  if (screen === lastMenu) return;
  lastMenu = screen;
  overlay.hidden = !show;
  guideCard.hidden = !guideMode;
  gameCard.hidden = !!guideMode;
  experience.classList.toggle('guide-open', !!guideMode);
  if (guideMode) {
    guideSkip.hidden = guideMode !== 'launch';
    setText('#guide-primary', t(guideMode === 'launch' ? 'guide.launch' : 'guide.back'));
  } else if (show) {
    $<HTMLElement>('#card-options').hidden = menu !== 'title' && menu !== 'paused';
    $<HTMLElement>('#rank-display').hidden = menu !== 'win';
    restart.hidden = menu !== 'win';
    setText('#card-kicker', t(`menu.${menu}.kicker`));
    setText('#card-title', t(`menu.${menu}.title`));
    setText('#card-copy', t(`menu.${menu}.copy`, { score: scoreText(), hits: game.hitsTaken, salvage: game.salvage }));
    setText('#primary-action', t(menu === 'game_over' ? 'menu.restart' : `menu.${menu}.action`));
    setText('#card-hint', t(`menu.${menu}.hint`));
    setText('#help-action-label', t(menu === 'title' ? 'guide.title' : 'menu.help'));
    if (game.rank) setText('#rank-display', t('menu.win.rank', { rank: game.rank }));
  }
}

function openGuide(mode: NonNullable<typeof guideMode>): void {
  guideOpener = document.activeElement instanceof HTMLButtonElement ? document.activeElement : primary;
  guideMode = mode;
  updateMenu();
  guideBody.scrollTop = 0;
  guidePrimary.focus({ preventScroll: true });
}

function closeGuide(launch: boolean): void {
  const startMission = launch && guideMode === 'launch';
  guideMode = null;
  if (startMission) {
    pendingStart = true;
  } else {
    updateMenu();
    guideOpener?.focus({ preventScroll: true });
  }
  guideOpener = null;
}

function action(): void {
  if (guideMode) closeGuide(true);
  else if (game.paused) pendingPause = true;
  else if (game.phase === 'title' && !pendingStart) openGuide('launch');
  else if (game.phase === 'game_over' || game.phase === 'win') pendingStart = true;
}

primary.addEventListener('click',action);restart.addEventListener('click',()=>{game=restartGame(game,ground);});
guideHelp.addEventListener('click', () => openGuide('help'));
guidePrimary.addEventListener('click', () => closeGuide(true));
guideSkip.addEventListener('click', () => closeGuide(true));
touchPause.addEventListener('pointerdown',event=>{event.preventDefault();pendingPause=true;});
touchPause.addEventListener('click',event=>{if(event.detail===0)pendingPause=true;});
overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)action();});
window.addEventListener('resize',resize);window.addEventListener('orientationchange',resize);
coarsePointer.addEventListener('change',resize);portraitOrientation.addEventListener('change',resize);
experience.addEventListener('touchmove', event => {
  if (event.target instanceof Node && (guideBody.contains(event.target) || gameCard.contains(event.target))) return;
  event.preventDefault();
}, { passive: false });
experience.addEventListener('contextmenu',event=>event.preventDefault());experience.addEventListener('dblclick',event=>event.preventDefault());
document.addEventListener('gesturestart',event=>event.preventDefault());
window.addEventListener('keydown',event=>{
  if (!event.repeat && event.key === '?' && (guideMode || game.phase === 'title' || game.paused)) {
    event.preventDefault();
    if (guideMode) closeGuide(false);
    else openGuide('help');
    return;
  }
  if ((event.code === 'Enter' || event.code === 'Space') && event.target instanceof HTMLButtonElement) {
    if (event.repeat) event.preventDefault();
    return;
  }
  if (guideMode) {
    if (event.repeat) return;
    if (event.code === 'Escape' || event.code === 'KeyP' && game.paused) {
      event.preventDefault();
      closeGuide(false);
    } else if (event.code === 'Enter') {
      event.preventDefault();
      closeGuide(true);
    }
    return;
  }
  if (event.code === 'Enter') {
    event.preventDefault();
    if (!event.repeat) action();
    return;
  }
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(event.code))pointerActive=false;
  if(!event.repeat){if(event.code==='KeyP')pendingPause=true;if(event.code==='KeyV')pendingView=true;if(event.code==='KeyX'||event.code==='KeyK')pendingBomb=true;if(event.code==='KeyR'&&(game.phase==='win'||game.phase==='game_over'))game=restartGame(game,ground);}
  keys.add(event.code);
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',()=>{keys.clear();pointerDown=false;pointerActive=false;touchFire=touchBoost=stickActive=false;stickX=stickY=0;});
function steer(event:PointerEvent):void{const r=canvas.getBoundingClientRect();pointerX=clamp((event.clientX-r.left)/r.width*2-1,-1,1);pointerY=clamp((event.clientY-r.top)/r.height*2-1,-1,1);pointerActive=true;}
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(game.phase!=='playing'&&game.phase!=='transition'){action();return;}pointerDown=true;canvas.setPointerCapture(event.pointerId);steer(event);});
canvas.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'||pointerDown)steer(event);});
canvas.addEventListener('pointerup',event=>{pointerDown=false;if(event.pointerType==='touch')pointerActive=false;});
canvas.addEventListener('pointercancel',()=>{pointerDown=false;pointerActive=false;});canvas.addEventListener('pointerleave',()=>{if(!pointerDown)pointerActive=false;});
function moveStick(event:PointerEvent):void{const r=stick.getBoundingClientRect();stickX=clamp((event.clientX-(r.left+r.width/2))/(r.width/2),-1,1);stickY=clamp((event.clientY-(r.top+r.height/2))/(r.height/2),-1,1);const travel=Math.max(0,(r.width-32)/2-3);knob.style.transform=`translate(${stickX*travel}px,${stickY*travel}px)`;}
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
  c.fillStyle='#a5d5ce';c.font=canvasFont;c.fillText(radarLabel,4,9);
}

function cockpitCamera(layout: CockpitLayout, blend: number, impact: number): GameState['camera'] {
  const camera = game.camera, clock = game.elapsed;
  const shake = (game.boosting ? 1.8 : 0) + impact * 4.5;
  const crosswind = Math.sin(clock * 89) * shake * 0.16 * blend;
  const horizon = layout.aiming.y + Math.min(32, layout.aiming.height * 0.22);
  const framing = Math.max(0, horizon - innerHeight * 0.3);
  const screenShift = framing + clamp(cockpitMotion.climb * 0.62, -18, 18) + Math.sin(clock * 72) * shake;
  Object.assign(cameraScratch, camera);
  cameraScratch.x = camera.x + Math.cos(camera.yaw) * crosswind;
  cameraScratch.z = camera.z - Math.sin(camera.yaw) * crosswind;
  cameraScratch.pitch = camera.pitch + screenShift * blend / (15 * innerHeight / canvas.height);
  return cameraScratch;
}

function render():void{
  const w=canvas.width,h=canvas.height,mode=game.camera.mode,transition=game.phase==='transition';
  const transitionProgress = transition ? smooth(game.transitionT) : 0;
  const nextView=SCRIPT.find(d=>d.id===game.nextSegment)!.defaultView;
  if (layoutView !== intendedView()) updateFlightLayout();
  const cockpitBlend = mode === 'cockpit' ? (transition && nextView !== 'cockpit' ? 1 - transitionProgress : 1) : transitionProgress;
  let impact = 0;
  if (cockpit) for (const fx of game.effects) if (fx.kind === 'hit') impact = Math.max(impact, fx.life * 2);
  let camera = game.camera;
  if (cockpit && mode !== 'overhead') camera = cockpitCamera(cockpit, cockpitBlend, impact);
  if(phone&&mode==='overhead'){
    const desired=phone.shipY*h/innerHeight,current=h/2-(game.player.z-game.camera.z)/1.4;
    const shift=(desired-current)*1.4*(1-transitionProgress);
    Object.assign(cameraScratch, game.camera);
    cameraScratch.z += shift;
    camera = cameraScratch;
  }
  world.setBiome(game.biome,game.arena.x);
  if(transition && (mode==='overhead') !== (nextView==='overhead')){
    world.render(frame,camera,mode==='overhead'?'overhead':'chase');world.render(other,camera,nextView==='overhead'?'overhead':'chase');
    const from=frame.data,to=other.data;for(let i=0;i<from.length;i+=4){from[i]=mix(from[i],to[i],transitionProgress);from[i+1]=mix(from[i+1],to[i+1],transitionProgress);from[i+2]=mix(from[i+2],to[i+2],transitionProgress);}
  }else world.render(frame,camera,mode==='overhead'?'overhead':'chase');
  ctx.putImageData(frame,0,0);if(glow){glow.setTransform(1,0,0,1,0,0);glow.clearRect(0,0,w,h);}
  if(mode==='overhead')world.drawDust(ctx,camera,'overhead',game.elapsed);
  ctx.save();if(transition)ctx.globalAlpha=1-transitionProgress;drawEntities(ctx,glow,sprites,game,mode,ground,entityLabels,camera);ctx.restore();
  if((mode!=='cockpit'||transition&&nextView!=='cockpit') && !(game.invulnTimer>0&&Math.floor(game.elapsed*10)%2===0&&!transition)){
    const overhead=mode==='overhead',blend=transition&&overhead&&nextView!=='overhead'?transitionProgress:overhead?0:1;
    const clearance=Math.max(0,game.player.altitude-ground(game.player.x,game.player.z));
    const overheadX=w/2+(game.player.x-camera.x)/1.4*Math.min(1,w/240),overheadY=phone?h/2-(game.player.z-camera.z)/1.4:h/2-game.player.y/1.4;
    const chaseY=phone?phone.shipY*h/innerHeight:h*.59;
    const alpha=transition&&nextView==='cockpit'?1-transitionProgress:transition&&mode==='cockpit'?transitionProgress:1;
    const pose:ShipPose={x:mix(overheadX,w/2,blend),y:mix(overheadY,chaseY,blend),scale:mix(.72,1,blend)*(w<240?1.22:1),pitch:mix(65,36,blend),lift:mix(1.4,1,blend),bank:game.player.bank,alpha,perspective:blend,shadowSquash:mix(.82,.28,blend),shadowY:mix(clearance*.48,23+clearance*.24,blend)};
    shipSprite.draw(ctx,glow,visualFlight(game),blend<.5?'overhead':'chase',game.biome==='space'?-1000:ground(game.player.x,game.player.z),false,pose);
  }
  ctx.save();if(transition)ctx.globalAlpha=1-transitionProgress;drawShots(ctx,glow,game,mode,camera);ctx.restore();
  if(game.wipeT>0){const progress=1-game.wipeT/.35,y=Math.round(progress*h);ctx.fillStyle='rgba(14,22,35,.75)';ctx.fillRect(0,y-7,w,14);ctx.fillStyle='rgba(189,246,244,.7)';for(let i=-8;i<=8;i+=3)ctx.fillRect(0,y+i,w,1);}
  if (cockpit) {
    const { x, z, altitude, yaw } = game.player;
    const clearance = altitude - Math.max(ground(x, z), ground(x + Math.sin(yaw) * 24, z + Math.cos(yaw) * 24));
    cockpitView.camera = camera;
    cockpitReadout = cockpitDisplay.draw(game, cockpitView, cockpitMotion, clearance, impact, cockpitBlend * (1 - game.wipeT / 0.35), language, t);
  } else {
    cockpitReadout = null;
    drawRadar();
  }
  updateHud();
}
function animate(now:number):void{
  const elapsed=Math.max(0,(now-lastTime)/1000);lastTime=now;if(elapsed>0&&elapsed<.25)fps+=(1/elapsed-fps)*.05;accumulator+=Math.min(.05,elapsed);
  while(accumulator>=stepTime){advanceGame(controls());pendingStart=pendingPause=pendingView=pendingBomb=false;if(!game.paused)shipSprite.update(stepTime,visualFlight(game),game.player.bank/.65);accumulator-=stepTime;}
  render();requestAnimationFrame(animate);
}
async function start(): Promise<void> {
  try {
    await document.fonts.load('12px "Galmuri11"', '한국어');
  } catch {
    // The CSS font stack provides a fallback if the local font fails to load.
  }
  applyLanguage();
  resize();
  lastTime = performance.now();
  requestAnimationFrame(animate);
}

void start();
