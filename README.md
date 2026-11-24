# ASTER WING

**[한국어 위키](docs/wiki/README.md)** · [무기·버프·격납고·해금 퀘스트](docs/wiki/CATALOG.md) · [개발판과 공개판의 차이](docs/wiki/README.md#versions). 아래 실행·조작 안내는 `renderer-proto` 개발판 기준입니다.

> Bots working on this repo log what they did in [docs/WORKLOG.md](docs/WORKLOG.md). Read it before starting, add an entry after finishing.

Fly a ten-minute survival sortie over Kestrel Reach. Match altitude to shoot and collect salvage, draft weapons and buffs, and defeat the enemy Ace that arrives at 8:00. The game uses TypeScript, Vite, and Three.js instanced voxels drawn through a nearest-filtered low-resolution buffer.

## Run

```sh
npm install
npm run dev
```

The development and preview servers default to port 5180. To use a different port, run `npm run dev -- --port 5182`. Run `npm run build` to type-check and build the game and `npm test` with Node.js 22 or later.

## Controls

- **Enter** opens the preflight guide from the title. Press **Enter** again, choose **Start Sortie**, or skip the guide to fly. **P** pauses and resumes. **Enter** or **R** retries the same seed from the result card.
- The ship cruises automatically at 104 m/s. Use **A/D** or **←/→** to bank and turn, and **W/S** or **↑/↓** to change altitude. Move the mouse to steer. Twin Cannon and Wing Pods auto-fire at matching altitude. Twin also fires a slow amber bolt at aircraft one band below. Match the Ace's altitude to maintain a lock.
- Hold **Shift** for 182 m/s boost with a brief 202 m/s ignition kick. Use **Space** or **W/↑ + Space** to climb and reverse (Immelmann). Use **S/↓ + Space** to dive and reverse (Split-S), or **A/D or ←/→ + Space** to snap and slide around (J-turn). A reversal opens a 1.5-second Twin follow-up window against former pursuers. The J-turn spends 40% of your boost and starts a 7-second cooldown at the snap.
- Press **C** for a barrel roll: steer left or right, or use your last steering direction (right by default). **Shift + Space** still rolls. Holding **Shift** when you press **Space** or pressing **Shift** within 80 ms after **Space** triggers a roll. Steer sideways for a barrel roll or center the stick for an aileron roll. Time the roll as an incoming bolt or Ace missile reaches you to parry it.
- Draft **Phoenix Flares** to burn pursuers at or below your altitude, or **Bomb Bay** to bomb lower targets and clear nearby hostile shots. Both fire automatically while equipped.
- **V** cycles TOP, CHASE and COCKPIT. TOP shows coarse altitude on the nose-up radar with △ above, ■ level and ▽ below. CHASE shows the three bands and a correction cue. COCKPIT shows signed altitude error and Ace lock progress. Watch the rear feed for a fighter lining up on your tail.
- On touchscreens, tap **LOOP** with the stick neutral or up for Immelmann, down for Split-S, or sideways for J-turn. Tap **ROLL** to dodge. The other controls are **BOOST**, **VIEW** and pause.
- Match the salvage height to collect XP. At each level, press **1–3** or select a card to draft an upgrade. The sortie pauses during the draft.

### Ace duel

Four corners converge when your forward aim and altitude match the boss.
The small reference circle stays fixed as the larger circle shrinks toward it (on the glass in COCKPIT).
Dodge when the two rings nearly overlap: roll, or press **W + Space** or **S + Space** to break the lock. This stops that salvo, not shots already in flight.
Try `?fixture=ace&cue=duel&view=chase&live=1` for a head-on approach.

## Language

Choose **EN** or **한국어** from the title or pause menu. The game saves the choice as `aster.lang`. Korean browser locales default to Korean. Use `?lang=ko` or `?lang=en` to override the initial language.

The local WOFF2 subset uses Galmuri11 from `galmuri@2.40.3` under the [SIL Open Font License 1.1](public/fonts/OFL-Galmuri.txt). To regenerate it, use FontTools with WOFF2 support and the package’s `dist/Galmuri11.ttf`.

```sh
node --experimental-strip-types --input-type=module -e 'import { strings } from "./src/i18n.ts"; process.stdout.write(Object.values(strings.ko).join(""));' > glyphs.txt
pyftsubset Galmuri11.ttf --text-file=glyphs.txt --flavor=woff2 \
  --unicodes=U+0020-007E,U+00B0,U+00B7,U+2014,U+2019,U+2160-2162,U+2190-2193,U+2212,U+25A0,U+25AE-25AF,U+25B3,U+25BC-25BD,U+25C2,U+25C6-25C7,U+2605 \
  --name-IDs=0,1,2,3,4,5,6,13,14 --output-file=src/fonts/galmuri11-subset.woff2
```

## Verification hooks

- `?fixture=stack` starts at 0:30 with three vertically stacked patrols.
- `?fixture=draft` opens the first draft at 0:45.
- `?fixture=ace&phase=1` shows the Ace's gun run. Set `phase=2` for missile lock or `phase=3` for the roll warning and afterburner. Add `cue=tail` to open the rear feed, `cue=rolling` to see the active roll, or `cue=down` to see the defeat spiral. The short legacy Ace fixture is still available as `?fixture=boss`.
- `?fixture=roster` shows the enemy lineup and tells. Use `cue=spotter`, `cue=flak`, `cue=aegis` or another enemy name to isolate it. Use `cue=carrier` for an elite's Gnat launch warning. Ace and roster fixtures hold a fixed pose by default. Add `live=1` to resume the simulation.
- `?fixture=roster-sheet&kind=hound` frames a single enemy at an 88 m distance in CHASE. Set `kind` to any enemy name, `carrier` or `ace`.
- `?fixture=roster-sheet&kind=gnat-variants` compares Armored (broad slate hull), standard and Sting (narrow red dart), left to right.
- `?fixture=bullets&stress=1&flight=boost` keeps the Ace, 24 regular enemies, a capped Gnat swarm, and capped projectile pools active while crossing tiles at 182 m/s. Use `?fixture=boost` for a fixed boost pose.
- Vite dev only: `?fixture=p1-cache&seed=1|6|18` stages a real 1/3/5-reward roll. Use `cache=evolution` or `cache=fallback` to stage the evolution cache with or without an eligible weapon. Add `fx=0` to compare the immediate reveal.
- Vite dev only: `?fixture=p1-combat&view=chase` starts paused with Twin Lv7 and Swarm Rack; use `build=starter` for Twin Lv1 on the same course. Resume to fire on the incoming targets, or use `view=cockpit` / `touch=1` to check the other layouts.
- `?fixture=pursuit` starts in CHASE at 0:30 with four pursuers behind at three heights.
- `?fixture=reversal` puts a high-band pack behind you for **W + Space**. `?fixture=flyby` stages two overtakes on a straight course. `?fixture=rear-threat` demonstrates a closing bolt. `?fixture=strafe` puts targets one and two bands below you.
- `?fixture=flare` lines up pursuers behind the player. Phoenix Flares are equipped and fire automatically; watch the fan and impacts in the rear view.
- Review the new enemies with `?fixture=skimmer|spotter|hound|flanker|harrier|diver|bomber|turret`. Each fixture puts its featured enemy ahead for inspection.
- Review the opening landmarks with `?fixture=ridge|strait|stacks|atoll`. The north-up NAV map covers 1,536 m and tracks nearby world sites and the Ace signal. Use `?fixture=world&seed=19&x=4350&z=1250&alt=skim&live=1` to fly low over remote water or change the coordinates to `x=2450&z=1100` for land.
- Use `?seed=1`, `?view=overhead|chase|cockpit`, `?touch=1`, and `?autoplay=1` for replay checks. `?t=SECONDS` seeks to an absolute sortie time and returns control to the player unless autoplay is active.
- Survivors swarm events run on the sortie clock: rings at 1:50/5:15, single-band V crossings at 3:35/6:45. The first two last 15 s, the last two 10 s. Each ends with one global orb pull and 15 s without ordinary spawns. Only orbs already in play are swept; chests still require a same-altitude pickup. For a playable approach, use `?mode=survivors&seed=1&t=109&view=overhead` (ring) or `t=214` (crossing).

`window.__game` exposes a read-only snapshot with tick, altitude, enemy contacts, mine count, draft choices, Ace health and phase, and lock progress.

## Credits

- Sound effects generated with ElevenLabs Sound Effects (`eleven_text_to_sound_v3`) on 2026-11-21. [Audio processing and licensing details](docs/AUDIO_CREDITS.md).
