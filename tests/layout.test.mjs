import test from 'node:test';
import assert from 'node:assert/strict';
import { cockpitLayout, desktopLayout, guideLayout, phoneLayout } from '../src/layout.ts';

const views = ['overhead', 'chase', 'cockpit'];
const sizes = [[390,844], [360,780], [430,932]];
const insets = [{ top:0, right:0, bottom:0, left:0 }, { top:32, right:5, bottom:20, left:5 }];
const intersects = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const contains = (outer,inner) => inner.x>=outer.x && inner.y>=outer.y && inner.x+inner.width<=outer.x+outer.width && inner.y+inner.height<=outer.y+outer.height;

for (const [width,height] of sizes) for (const safe of insets) for (const view of views) {
  test(`portrait ${width}x${height} ${view}, safe ${safe.top}`, () => {
    const l=phoneLayout(width,height,safe,view);
    assert.equal(l.orientation,'portrait');assert.ok(l.buffer.height>l.buffer.width);
    const zones=[l.hud,l.boss,l.radio,l.objective,l.playfield,...(l.dashboard?[l.dashboard]:[]),l.controls];
    for(let i=0;i<zones.length;i++)for(let j=i+1;j<zones.length;j++)assert.equal(intersects(zones[i],zones[j]),false,`zone ${i} overlaps ${j}`);
    assert.ok(l.playfield.height>l.playfield.width,'content playfield is tall');
    assert.ok(contains(l.playfield,l.radar));assert.ok(contains(l.playfield,l.alt));assert.equal(intersects(l.radar,l.alt),false);
    const buttons=[l.stick,l.loop,l.boost,l.bomb,l.view];
    for(const b of buttons){assert.ok(contains(l.controls,b));assert.ok(b.width>=44 && b.height>=44);}
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++)assert.equal(intersects(buttons[i],buttons[j]),false,`control ${i} overlaps ${j}`);
    assert.ok(contains(l.controls,l.stickLabel));assert.equal(intersects(l.stick,l.stickLabel),false);
    assert.ok(contains(l.hud,l.pause));assert.ok(l.pause.width>=44 && l.pause.height>=44);
    if(view==='cockpit')assert.ok(l.dashboard);else assert.equal(l.dashboard,null);
  });
}

test('landscape phone has usable, separated zones and controls', () => {
  const l=phoneLayout(844,390,{top:0,right:24,bottom:12,left:24},'cockpit');
  assert.equal(l.orientation,'landscape');assert.ok(l.buffer.width>l.buffer.height);
  const chase=phoneLayout(844,390,{top:0,right:24,bottom:12,left:24},'chase');
  assert.ok(chase.shipY+55<=chase.controls.y,'landscape ship clears the control area');
  assert.equal(intersects(l.hud,l.radio),false);assert.equal(intersects(l.radio,l.objective),false);
  assert.equal(intersects(l.playfield,l.dashboard),false);assert.equal(intersects(l.dashboard,l.controls),false);
  for(const b of [l.stick,l.loop,l.boost,l.bomb,l.view,l.pause])assert.ok(b.width>=44&&b.height>=44);
  const buttons=[l.stick,l.loop,l.boost,l.bomb,l.view];
  for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++)assert.equal(intersects(buttons[i],buttons[j]),false);
});

test('the desktop cockpit has a larger instrument rack with room for the canopy', () => {
  const hud = desktopLayout(1280, 800, insets[0]);
  const cockpit = cockpitLayout(1280, 800, insets[0], hud.objective);
  assert.ok(cockpit.dashboard.height >= 229 && cockpit.dashboard.height <= 264);
  assert.ok(cockpit.radar.height >= 161 && cockpit.radar.height <= 186);
  assert.ok(cockpit.aiming.height >= 200);
  assert.ok(contains(cockpit.dashboard, cockpit.gauges));
});

test('phone scene buffers use finer pixels while the cockpit clears the controls', () => {
  const portrait = phoneLayout(390, 844, insets[1], 'cockpit');
  const landscape = phoneLayout(844, 390, insets[1], 'cockpit');
  assert.deepEqual(portrait.buffer, { width: 288, height: 623 });
  assert.deepEqual(landscape.buffer, { width: 623, height: 288 });
  for (const layout of [portrait, landscape]) {
    assert.equal(layout.dashboard.y + layout.dashboard.height, layout.controls.y);
    assert.ok(contains(layout.dashboard, layout.cockpit.gauges));
  }
});

for (const [width, height] of [[1280, 720], ...sizes]) {
  test(`desktop HUD keeps status, radio, objective and instruments apart at ${width}x${height}`, () => {
    const l = desktopLayout(width, height, insets[0]);
    const viewport = { x: 0, y: 0, width, height };
    const zones = Object.entries(l);
    for (const [i, [name, zone]] of zones.entries()) {
      assert.ok(contains(viewport, zone), `${name} outside viewport`);
      for (const [other, rect] of zones.slice(i + 1)) {
        assert.equal(intersects(zone, rect), false, `${name} overlaps ${other}`);
      }
    }
  });
}

for (const [width, height] of [[1280, 720], ...sizes, [844, 390]]) for (const safe of insets) {
  test(`guide reserves separate heading, content and action areas at ${width}x${height}, safe ${safe.top}`, () => {
    const guide = guideLayout(width, height, safe);
    const safeArea = { x: safe.left, y: safe.top, width: width - safe.left - safe.right, height: height - safe.top - safe.bottom };
    assert.ok(contains(safeArea, guide.card));
    assert.equal(guide.columns, width >= 844 ? 2 : 1);
    assert.ok(guide.actions.height >= 44);
    assert.ok(guide.body.height >= (height > width ? 460 : 180));
    const zones = [guide.heading, guide.body, guide.actions];
    for (const [i, zone] of zones.entries()) {
      assert.ok(contains(guide.card, zone));
      for (const other of zones.slice(i + 1)) assert.equal(intersects(zone, other), false);
    }
  });
}

for (const [width, height] of [[1280, 720], ...sizes, [844, 390]]) for (const safe of insets) {
  test(`cockpit zones stay separate at ${width}x${height}, safe ${safe.top}`, () => {
    const phone = width < 1280 ? phoneLayout(width, height, safe, 'cockpit') : null;
    const hud = phone ?? desktopLayout(width, height, safe);
    const cockpit = cockpitLayout(width, height, safe, hud.objective, phone?.controls);
    if (phone) assert.deepEqual(phone.dashboard, cockpit.dashboard);
    else assert.ok(cockpit.help);
    if (height >= 720) assert.ok(cockpit.stores);

    const zones = [hud.hud, hud.boss, hud.radio, hud.objective, cockpit.glass,
      cockpit.message, ...(cockpit.help ? [cockpit.help] : []), cockpit.dashboard,
      ...(phone ? [phone.controls] : [])];
    for (const [i, zone] of zones.entries()) {
      for (const other of zones.slice(i + 1)) assert.equal(intersects(zone, other), false);
    }

    for (const [outer, children] of [
      [cockpit.glass, [cockpit.heading, cockpit.speed, cockpit.altitude, cockpit.aiming, ...(cockpit.stores ? [cockpit.stores] : [])]],
      [cockpit.dashboard, [cockpit.warnings, cockpit.radar, cockpit.damage, cockpit.weapons, cockpit.gauges]],
    ]) {
      for (const [i, child] of children.entries()) {
        assert.ok(contains(outer, child));
        assert.ok(child.width > 0 && child.height > 0);
        for (const other of children.slice(i + 1)) assert.equal(intersects(child, other), false);
      }
    }
  });
}
