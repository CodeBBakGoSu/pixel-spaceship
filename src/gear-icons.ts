import { EVOLUTIONS, WEAPON_IDS, WEAPONS, type DraftChoiceId, type EvolutionId, type FamilyId } from './data/items.ts';

type BadgeId = 'chest' | 'bill' | 'locked' | `set-${FamilyId}`;
export type GearIconId = DraftChoiceId | EvolutionId | BadgeId;

const SIZE = 32;
const ART_SIZE = 24;
const PAD = (SIZE - ART_SIZE) / 2;
const INK = 0x0b1020;
const STEEL_LIGHT = 0xdfe8f7;
const STEEL = 0x9fb2d0;
const STEEL_DARK = 0x5a6c92;
const STEEL_SHADE = 0x36456b;
const CYAN_LIGHT = 0xb8f6ff;
const CYAN = 0x3de0ff;
const CYAN_DARK = 0x1b8fb5;
const ORANGE_LIGHT = 0xffd08a;
const ORANGE = 0xff9a2e;
const ORANGE_DARK = 0xc25a12;
const YELLOW = 0xffe14d;
const RED = 0xff4a5a;
const RED_DARK = 0xa82a3a;
const GREEN = 0x5be37d;
const GREEN_DARK = 0x2b9a4f;
const VIOLET = 0xa77bff;
const GOLD = 0xffcc33;
const WHITE = 0xffffff;

type Point = readonly [x: number, y: number];

class PixelGrid {
  readonly side: number;
  readonly pixels: Uint32Array;

  constructor(side: number) {
    this.side = side;
    this.pixels = new Uint32Array(side * side);
  }

  pixel(x: number, y: number, color: number) {
    if (x >= 0 && x < this.side && y >= 0 && y < this.side) this.pixels[y * this.side + x] = color;
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: number) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) this.pixel(x, y, color);
    }
  }

  line(x: number, y: number, endX: number, endY: number, color: number) {
    const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
    const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
    let error = dx + dy;
    while (true) {
      this.pixel(x, y, color);
      if (x === endX && y === endY) break;
      const next = error * 2;
      if (next >= dy) { error += dy; x += sx; }
      if (next <= dx) { error += dx; y += sy; }
    }
  }

  circle(cx: number, cy: number, radius: number, color: number, thickness = radius) {
    const inner = (radius - thickness) ** 2, outer = radius ** 2;
    for (let y = Math.ceil(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.ceil(cx - radius); x <= cx + radius; x++) {
        const distance = (x - cx) ** 2 + (y - cy) ** 2;
        if (distance >= inner && distance <= outer) this.pixel(x, y, color);
      }
    }
  }

  shape(points: readonly Point[], color: number) {
    for (let y = 0; y < this.side; y++) {
      for (let x = 0; x < this.side; x++) {
        let inside = false;
        // Fill by counting crossings on a ray to the right of the pixel.
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [x0, y0] = points[j], [x1, y1] = points[i];
          if ((y0 > y) !== (y1 > y) && x < x0 + (x1 - x0) * (y - y0) / (y1 - y0)) inside = !inside;
        }
        if (inside) this.pixel(x, y, color);
      }
    }
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      this.line(...points[j], ...points[i], color);
    }
  }

  rgba() {
    const result = new Uint8ClampedArray(this.pixels.length * 4);
    for (let i = 0; i < this.pixels.length; i++) {
      const color = this.pixels[i];
      if (!color) continue;
      const offset = i * 4;
      result[offset] = color >>> 16;
      result[offset + 1] = (color >>> 8) & 255;
      result[offset + 2] = color & 255;
      result[offset + 3] = 255;
    }
    return result;
  }
}

function barrels(g: PixelGrid, positions: readonly number[], evolved = false) {
  for (const x of positions) {
    g.rect(x, 8, x + 2, 19, STEEL);
    g.rect(x, 9, x, 19, STEEL_LIGHT);
    g.rect(x + 2, 9, x + 2, 19, STEEL_DARK);
    g.rect(x - 1, 5, x + 3, 8, STEEL_DARK);
    g.rect(x, 5, x + 2, 6, ORANGE_LIGHT);
    g.pixel(x + 1, 3, YELLOW);
    if (evolved) g.rect(x + 1, 10, x + 1, 14, CYAN);
  }
  g.rect(3, 18, 20, 21, STEEL_DARK);
  g.rect(3, 18, 20, 18, STEEL);
  g.rect(9, 19, 14, 20, evolved ? GOLD : ORANGE);
}

function interceptor(g: PixelGrid) {
  g.shape([[3, 11], [10, 8], [13, 8], [20, 11], [19, 17], [12, 15], [4, 17]], STEEL_DARK);
  g.line(4, 11, 10, 9, STEEL);
  g.shape([[11, 3], [12, 3], [14, 15], [13, 19], [10, 19], [9, 15]], STEEL);
  g.line(11, 5, 11, 16, STEEL_LIGHT);
  g.rect(11, 8, 12, 11, CYAN_DARK);
}

function missile(g: PixelGrid, x: number, y: number) {
  g.shape([[x, y], [x + 1, y + 4], [x - 7, y + 12], [x - 10, y + 12], [x - 10, y + 9]], STEEL);
  g.shape([[x, y], [x + 1, y + 4], [x - 2, y + 7], [x - 5, y + 4]], RED);
  g.line(x - 10, y + 9, x - 1, y + 1, STEEL_LIGHT);
  g.line(x - 10, y + 13, x - 13, y + 16, ORANGE);
  g.pixel(x - 10, y + 12, YELLOW);
}

function launchBeam(g: PixelGrid) {
  for (const x of [5, 16]) {
    g.rect(x, 13, x + 2, 21, STEEL_DARK);
    g.rect(x, 13, x, 21, STEEL);
  }
  g.rect(8, 19, 15, 22, STEEL_DARK);
  g.rect(8, 19, 15, 19, STEEL);
  g.rect(10, 0, 13, 20, CYAN_DARK);
  g.rect(11, 0, 12, 19, CYAN);
  g.rect(11, 1, 11, 18, WHITE);
  for (const y of [5, 9, 13]) {
    g.pixel(8, y, CYAN_LIGHT);
    g.pixel(15, y, CYAN_LIGHT);
  }
}

function burst(g: PixelGrid, cx: number, cy: number, reach: number) {
  const diagonal = Math.round(reach * .7);
  g.line(cx - reach, cy, cx + reach, cy, ORANGE);
  g.line(cx, cy - reach, cx, cy + reach, ORANGE);
  g.line(cx - diagonal, cy - diagonal, cx + diagonal, cy + diagonal, ORANGE);
  g.line(cx + diagonal, cy - diagonal, cx - diagonal, cy + diagonal, ORANGE);
  g.circle(cx, cy, reach * .53, ORANGE);
  g.circle(cx, cy, reach * .35, YELLOW);
  g.circle(cx - 1, cy - 1, reach * .19, WHITE);
}

function drone(g: PixelGrid, x: number, y: number) {
  g.rect(x - 3, y, x + 3, y + 1, STEEL_DARK);
  g.rect(x - 2, y - 2, x + 2, y + 2, STEEL);
  g.rect(x - 2, y - 2, x + 2, y - 2, STEEL_LIGHT);
  g.pixel(x, y, ORANGE);
}

function flame(g: PixelGrid) {
  g.shape([[12, 1], [16, 9], [19, 15], [16, 20], [12, 22], [7, 19], [5, 14], [8, 9]], RED_DARK);
  g.shape([[12, 3], [15, 10], [17, 15], [14, 20], [10, 20], [7, 15], [9, 10]], ORANGE);
  g.shape([[12, 9], [14, 14], [14, 17], [12, 19], [10, 17], [10, 14]], YELLOW);
  g.line(12, 14, 12, 17, WHITE);
}

function bomb(g: PixelGrid, x: number, y: number, radius: number) {
  g.shape([[x - 4, y - radius - 5], [x, y - radius - 2], [x + 4, y - radius - 5],
    [x + 3, y - radius], [x - 3, y - radius]], RED);
  g.circle(x, y, radius, STEEL_SHADE);
  g.circle(x - 1, y - 1, radius - 1, STEEL_DARK);
  g.rect(x - 2, y - 2, x - 1, y - 1, STEEL);
  g.pixel(x - 2, y - 3, STEEL_LIGHT);
  g.line(x, y + radius, x, y + radius + 3, ORANGE);
  g.pixel(x, y + radius + 1, YELLOW);
}

function lightning(g: PixelGrid, color: number) {
  g.shape([[14, 1], [6, 13], [11, 13], [8, 22], [19, 9], [13, 9], [17, 1]], color);
  g.shape([[14, 3], [9, 11], [12, 11], [11, 16], [15, 11], [12, 11]], WHITE);
}

function plus(g: PixelGrid, color: number, highlight: number) {
  g.rect(10, 6, 13, 17, color);
  g.rect(6, 10, 17, 13, color);
  g.line(11, 7, 11, 16, highlight);
  g.line(7, 11, 16, 11, highlight);
}

type IconArt = (grid: PixelGrid) => void;

// Silhouettes and the top-left three-tone shading follow docs/make_icons_reference.py.
const ART: Record<GearIconId, IconArt> = {
  twin: (g) => barrels(g, [6, 15]),
  pods(g) {
    interceptor(g);
    for (const x of [2, 19]) {
      g.rect(x, 12, x + 2, 18, ORANGE_DARK);
      g.rect(x, 12, x + 2, 13, ORANGE_LIGHT);
      g.line(x + 1, 7, x + 1, 9, YELLOW);
    }
  },
  seeker(g) {
    missile(g, 20, 3);
    g.circle(6, 19, 1, STEEL_LIGHT);
    g.pixel(3, 21, STEEL);
  },
  rail: launchBeam,
  flak(g) {
    burst(g, 12, 10, 10);
    g.rect(9, 19, 14, 22, STEEL_DARK);
    g.rect(10, 19, 12, 20, STEEL);
  },
  ion(g) {
    g.shape([[11, 0], [13, 0], [16, 7], [12, 9], [8, 7]], STEEL);
    g.rect(11, 3, 12, 6, CYAN_LIGHT);
    g.shape([[10, 9], [6, 13], [7, 17], [13, 20], [16, 23], [11, 22], [4, 18], [4, 13]], CYAN_DARK);
    g.shape([[13, 9], [17, 12], [18, 16], [14, 19], [8, 21], [6, 23], [9, 19], [15, 15], [15, 12]], CYAN);
    g.line(16, 13, 16, 15, CYAN_LIGHT);
    g.pixel(13, 18, WHITE);
  },
  drones(g) {
    g.circle(12, 12, 9, CYAN_DARK, 1);
    g.circle(12, 12, 3, STEEL_DARK);
    g.circle(12, 12, 2, CYAN);
    g.pixel(11, 11, WHITE);
    drone(g, 19, 6);
    drone(g, 5, 18);
  },
  phoenix(g) {
    flame(g);
    g.line(3, 5, 5, 7, ORANGE_LIGHT);
    g.line(20, 6, 19, 8, YELLOW);
    g.pixel(2, 12, YELLOW);
    g.pixel(21, 12, ORANGE);
  },
  'bomb-bay'(g) { bomb(g, 12, 13, 7); },
  arc(g) {
    g.line(3, 5, 8, 9, CYAN);
    g.line(20, 7, 16, 10, CYAN);
    g.line(4, 18, 9, 16, CYAN);
    g.line(21, 15, 15, 16, CYAN);
    lightning(g, YELLOW);
    for (const [x, y] of [[3, 5], [20, 7], [4, 18], [21, 15]]) g.circle(x, y, 1, CYAN_LIGHT);
  },
  'overdrive-coil'(g) {
    for (let y = 5; y <= 20; y += 3) {
      g.rect(3, y, 20, y + 1, ORANGE_DARK);
      g.rect(4, y, 19, y, ORANGE_LIGHT);
    }
    g.rect(3, 3, 4, 20, STEEL_DARK);
    g.rect(19, 3, 20, 20, STEEL_DARK);
    g.shape([[14, 1], [9, 10], [12, 10], [10, 19], [17, 7], [13, 7], [16, 1]], YELLOW);
  },
  'hull-plating'(g) {
    g.shape([[3, 3], [20, 3], [20, 13], [12, 22], [3, 13]], STEEL_SHADE);
    g.shape([[4, 4], [19, 4], [19, 12], [12, 20], [4, 12]], STEEL);
    g.shape([[12, 5], [19, 5], [19, 12], [12, 19]], STEEL_DARK);
    g.line(5, 5, 11, 5, STEEL_LIGHT);
    g.shape([[7, 9], [12, 12], [17, 9], [17, 12], [12, 16], [7, 12]], ORANGE);
    g.line(8, 10, 12, 13, ORANGE_LIGHT);
  },
  'magnet-core'(g) {
    g.circle(12, 11, 9, RED, 5);
    g.rect(8, 12, 16, 23, 0);
    g.rect(3, 11, 7, 19, RED_DARK);
    g.rect(17, 11, 21, 19, RED_DARK);
    for (const x of [3, 17]) {
      g.rect(x, 17, x + 4, 20, STEEL);
      g.rect(x, 17, x + 4, 17, STEEL_LIGHT);
    }
    g.line(9, 3, 12, 3, ORANGE_LIGHT);
    for (const [x, y] of [[2, 22], [21, 22], [12, 19], [12, 23]]) g.pixel(x, y, GREEN);
  },
  'band-lens'(g) {
    for (const y of [4, 11, 18]) g.rect(2, y, 21, y + 1, y === 11 ? CYAN : STEEL_DARK);
    g.line(3, 11, 20, 11, CYAN_LIGHT);
    g.line(7, 8, 3, 8, YELLOW);
    g.line(3, 8, 3, 15, YELLOW);
    g.line(3, 15, 7, 15, YELLOW);
    g.line(16, 8, 20, 8, YELLOW);
    g.line(20, 8, 20, 15, YELLOW);
    g.line(20, 15, 16, 15, YELLOW);
    g.shape([[12, 5], [14, 8], [10, 8]], GREEN);
    g.shape([[12, 18], [14, 15], [10, 15]], GREEN);
  },
  'vector-thrusters'(g) {
    for (const y of [1, 6]) {
      g.shape([[12, y], [18, y + 5], [15, y + 5], [12, y + 2], [9, y + 5], [6, y + 5]], CYAN);
      g.pixel(12, y, CYAN_LIGHT);
    }
    g.rect(8, 13, 15, 16, STEEL);
    g.rect(8, 13, 9, 16, STEEL_LIGHT);
    g.rect(6, 16, 17, 18, STEEL_DARK);
    g.shape([[8, 19], [15, 19], [12, 23]], ORANGE);
    g.line(11, 19, 12, 21, YELLOW);
  },
  'flare-bay'(g) {
    g.rect(2, 12, 21, 21, STEEL_SHADE);
    g.rect(2, 12, 21, 12, STEEL);
    g.rect(3, 13, 20, 19, STEEL_DARK);
    g.rect(4, 14, 19, 18, INK);
    for (const x of [7, 12, 17]) {
      g.circle(x, 16, 2, ORANGE);
      g.pixel(x, 15, YELLOW);
    }
    g.line(12, 11, 12, 8, ORANGE);
    g.shape([[12, 1], [15, 6], [12, 8], [9, 6]], RED);
    g.shape([[12, 3], [14, 6], [12, 7], [10, 6]], YELLOW);
  },
  'ordnance-rack'(g) {
    g.rect(2, 3, 21, 5, STEEL);
    g.rect(2, 3, 21, 3, STEEL_LIGHT);
    g.rect(2, 5, 21, 5, STEEL_DARK);
    bomb(g, 6, 14, 4);
    bomb(g, 17, 14, 4);
  },
  'fire-control'(g) {
    g.circle(12, 12, 8, GREEN, 1);
    g.circle(12, 12, 4, GREEN_DARK, 1);
    g.line(12, 1, 12, 7, GREEN);
    g.line(12, 17, 12, 23, GREEN);
    g.line(1, 12, 7, 12, GREEN);
    g.line(17, 12, 23, 12, GREEN);
    g.rect(11, 11, 12, 12, RED);
    for (const x of [3, 20]) for (const y of [3, 20]) g.pixel(x, y, YELLOW);
  },
  capacitor(g) {
    g.rect(6, 5, 17, 20, STEEL_DARK);
    g.rect(6, 5, 7, 20, STEEL);
    g.rect(16, 7, 17, 20, STEEL_SHADE);
    g.rect(6, 5, 17, 7, ORANGE);
    g.rect(6, 5, 17, 5, ORANGE_LIGHT);
    g.rect(8, 3, 9, 4, STEEL_LIGHT);
    g.rect(14, 3, 15, 4, STEEL_LIGHT);
    g.shape([[13, 8], [9, 14], [12, 14], [10, 19], [15, 12], [12, 12]], YELLOW);
    g.rect(4, 22, 19, 23, STEEL_DARK);
  },
  'salvage-beacon'(g) {
    g.rect(11, 12, 12, 21, STEEL);
    g.rect(8, 21, 15, 22, STEEL_DARK);
    g.shape([[12, 2], [17, 7], [12, 12], [7, 7]], GREEN_DARK);
    g.shape([[12, 2], [17, 7], [12, 7]], GREEN);
    g.shape([[12, 2], [9, 5], [12, 5]], WHITE);
    g.line(4, 5, 2, 11, CYAN_DARK);
    g.line(20, 5, 22, 11, CYAN_DARK);
    g.line(4, 5, 3, 8, CYAN);
    g.line(20, 5, 21, 8, CYAN);
  },
  'aurora-gatling': (g) => barrels(g, [3, 8, 13, 18], true),
  'aegis-halo'(g) {
    g.circle(12, 12, 11, ORANGE_DARK, 2);
    g.circle(12, 12, 10, YELLOW, 1);
    interceptor(g);
    g.shape([[8, 12], [12, 10], [16, 12], [15, 16], [12, 19], [9, 16]], STEEL_LIGHT);
    g.shape([[12, 12], [15, 13], [14, 16], [12, 17]], CYAN_DARK);
    for (const [x, y] of [[12, 1], [1, 12], [23, 12], [12, 23]]) g.pixel(x, y, WHITE);
  },
  'swarm-rack'(g) {
    missile(g, 13, 1);
    missile(g, 18, 4);
    missile(g, 22, 9);
    g.line(3, 16, 7, 20, ORANGE_DARK);
    g.line(8, 20, 12, 22, RED_DARK);
  },
  'prism-lance'(g) {
    g.shape([[12, 11], [1, 2], [3, 1], [13, 8]], VIOLET);
    g.shape([[12, 11], [20, 1], [22, 2], [14, 11]], GREEN);
    launchBeam(g);
    g.shape([[12, 6], [17, 10], [12, 15], [7, 10]], CYAN_LIGHT);
    g.shape([[12, 7], [16, 10], [12, 13]], VIOLET);
    g.line(10, 10, 12, 8, WHITE);
  },
  skybreaker(g) {
    g.line(4, 22, 20, 22, CYAN);
    burst(g, 8, 13, 7);
    burst(g, 16, 9, 7);
    g.shape([[12, 20], [10, 15], [15, 16], [20, 10], [16, 19]], YELLOW);
    g.pixel(12, 20, WHITE);
  },
  'plasma-ribbon'(g) {
    g.shape([[12, 0], [15, 2], [13, 6], [6, 12], [7, 15], [20, 18], [22, 23], [16, 21],
      [4, 17], [2, 13], [4, 8], [10, 4]], CYAN_DARK);
    g.shape([[14, 1], [21, 5], [21, 9], [12, 15], [14, 18], [23, 21], [17, 22], [9, 19],
      [8, 15], [15, 9], [17, 6]], VIOLET);
    g.line(14, 2, 19, 6, CYAN_LIGHT);
    g.line(19, 6, 19, 8, WHITE);
    g.line(19, 8, 10, 15, CYAN_LIGHT);
    g.line(10, 16, 14, 19, CYAN);
  },
  'collector-swarm'(g) {
    g.circle(12, 12, 9, GREEN_DARK, 1);
    g.shape([[12, 8], [16, 12], [12, 16], [8, 12]], GREEN);
    g.line(9, 12, 12, 9, WHITE);
    for (const [x, y] of [[12, 3], [4, 17], [20, 17]]) drone(g, x, y);
    g.line(6, 15, 8, 14, CYAN);
    g.line(15, 14, 18, 15, CYAN);
    g.line(12, 6, 12, 7, CYAN);
  },
  'phoenix-rising'(g) {
    g.shape([[0, 3], [7, 8], [12, 13], [16, 8], [23, 3], [21, 12], [16, 17], [12, 20],
      [7, 17], [2, 12]], RED);
    g.shape([[1, 5], [7, 10], [12, 16], [16, 10], [22, 5], [20, 12], [15, 18], [12, 20],
      [8, 18], [3, 11]], ORANGE);
    g.line(4, 9, 9, 15, YELLOW);
    g.line(19, 9, 14, 15, YELLOW);
    g.shape([[12, 1], [15, 7], [12, 18], [9, 7]], YELLOW);
    g.line(12, 4, 12, 13, WHITE);
    g.shape([[9, 22], [12, 18], [15, 22]], RED_DARK);
  },
  'carpet-annihilator'(g) {
    g.rect(2, 3, 21, 5, STEEL_DARK);
    g.rect(3, 3, 20, 3, GOLD);
    bomb(g, 4, 12, 3);
    bomb(g, 19, 12, 3);
    bomb(g, 11, 16, 4);
  },
  'storm-crown'(g) {
    g.shape([[2, 6], [8, 11], [12, 3], [16, 11], [21, 6], [18, 18], [5, 18]], CYAN_DARK);
    g.shape([[3, 7], [8, 13], [12, 3], [15, 13], [20, 7], [17, 17], [6, 17]], YELLOW);
    g.shape([[12, 5], [10, 13], [13, 12], [11, 17], [16, 11], [13, 11]], WHITE);
    g.rect(5, 19, 18, 21, CYAN);
    g.rect(5, 19, 18, 19, CYAN_LIGHT);
    for (const x of [2, 12, 21]) g.pixel(x, x === 12 ? 1 : 4, WHITE);
  },
  repair(g) {
    g.shape([[4, 3], [19, 3], [21, 5], [21, 18], [18, 20], [5, 20], [2, 18], [2, 5]], GREEN_DARK);
    g.rect(4, 5, 19, 18, STEEL_LIGHT);
    g.rect(4, 17, 19, 18, STEEL);
    plus(g, GREEN_DARK, GREEN);
  },
  damage(g) {
    g.shape([[4, 13], [11, 6], [19, 11], [20, 13], [12, 19]], ORANGE_DARK);
    g.shape([[3, 11], [11, 4], [20, 9], [12, 15]], ORANGE);
    g.line(4, 11, 11, 5, YELLOW);
    g.line(11, 5, 17, 9, ORANGE_LIGHT);
    g.shape([[11, 0], [22, 6], [22, 17], [12, 23], [22, 19], [23, 5]], RED);
  },
  credits(g) {
    g.circle(12, 12, 10, 0x94621a);
    g.circle(11, 11, 9, GOLD);
    g.circle(11, 11, 6, 0xd9a521);
    g.line(6, 5, 10, 3, YELLOW);
    g.line(11, 6, 11, 16, YELLOW);
    g.rect(8, 8, 14, 9, ORANGE_LIGHT);
    g.rect(8, 13, 14, 14, ORANGE_LIGHT);
  },
  chest(g) {
    g.shape([[2, 8], [5, 4], [18, 4], [21, 8], [21, 19], [2, 19]], STEEL_SHADE);
    g.rect(3, 8, 20, 12, STEEL);
    g.rect(4, 6, 19, 8, STEEL_LIGHT);
    g.rect(4, 13, 19, 18, ORANGE_DARK);
    for (const x of [5, 17]) g.rect(x, 6, x + 1, 18, GOLD);
    g.rect(9, 11, 14, 16, GOLD);
    g.rect(10, 11, 13, 11, YELLOW);
    g.rect(11, 13, 12, 14, INK);
  },
  bill(g) {
    g.shape([[5, 2], [15, 2], [19, 6], [19, 20], [5, 20]], STEEL_LIGHT);
    g.shape([[15, 2], [19, 6], [15, 6]], STEEL);
    g.rect(7, 7, 14, 8, STEEL_DARK);
    g.rect(7, 11, 17, 12, STEEL_DARK);
    g.rect(7, 15, 12, 16, STEEL_DARK);
    g.circle(17, 17, 5, RED_DARK);
    g.line(17, 14, 17, 17, WHITE);
    g.pixel(17, 19, WHITE);
  },
  locked(g) {
    g.circle(12, 9, 6, STEEL_DARK, 2);
    g.rect(5, 9, 18, 20, STEEL_SHADE);
    g.rect(5, 9, 18, 10, STEEL_DARK);
    g.rect(6, 10, 7, 19, STEEL_DARK);
    g.circle(12, 14, 2, INK);
    g.rect(11, 15, 12, 18, INK);
  },
  'set-ballistic'(g) {
    for (const [x, y] of [[4, 10], [10, 4], [16, 10]]) {
      g.shape([[x, y + 5], [x + 2, y], [x + 4, y + 5], [x + 4, y + 12], [x, y + 12]], ORANGE);
      g.rect(x, y + 10, x + 4, y + 12, STEEL);
      g.line(x + 1, y + 5, x + 1, y + 9, ORANGE_LIGHT);
    }
  },
  'set-ordnance'(g) {
    g.shape([[12, 1], [22, 7], [22, 16], [12, 22], [2, 16], [2, 7]], RED_DARK);
    g.shape([[12, 3], [19, 7], [19, 15], [12, 19], [5, 15], [5, 7]], RED);
    g.shape([[12, 6], [16, 12], [12, 16], [8, 12]], GOLD);
    g.line(10, 11, 12, 7, ORANGE_LIGHT);
  },
  'set-energy'(g) {
    g.circle(12, 12, 10, CYAN_DARK, 2);
    g.circle(12, 12, 8, CYAN, 1);
    lightning(g, CYAN_LIGHT);
    g.pixel(4, 4, WHITE);
    g.pixel(20, 19, WHITE);
  },
};

export const GEAR_ICON_IDS: readonly GearIconId[] = Object.keys(ART) as GearIconId[];

type IconStyle = { family: FamilyId; category?: 'weapon' | 'buff' | 'evolution' };
const STYLES: Partial<Record<GearIconId, IconStyle>> = {
  'set-ballistic': { family: 'ballistic' }, 'set-ordnance': { family: 'ordnance' }, 'set-energy': { family: 'energy' },
};
for (const weapon of WEAPON_IDS) {
  const { family } = WEAPONS[weapon];
  const { id, buff } = EVOLUTIONS[weapon];
  STYLES[weapon] = { family, category: 'weapon' };
  STYLES[buff] = { family, category: 'buff' };
  STYLES[id] = { family, category: 'evolution' };
}

const FAMILY_COLOR: Record<FamilyId, number> = { ballistic: ORANGE, ordnance: RED, energy: CYAN };
const FAMILY_FIELD: Record<FamilyId, number> = { ballistic: 0x29232a, ordnance: 0x2d1d2b, energy: 0x132b3e };

export function gearIconPixels(id: GearIconId): Uint8ClampedArray {
  const tile = new PixelGrid(SIZE);
  const style = STYLES[id];
  const evolved = style?.category === 'evolution';
  const glint = evolved ? GOLD : id === 'locked' ? STEEL_SHADE : 0x8096b8;
  tile.rect(1, 0, 30, 31, evolved ? 0x865b17 : 0x354665);
  tile.rect(0, 1, 31, 30, evolved ? 0x865b17 : 0x354665);
  tile.rect(1, 1, 30, 30, glint);
  tile.rect(2, 2, 29, 29, INK);
  const field = style ? FAMILY_FIELD[style.family] : 0x20283c;
  for (let y = 3; y < 16; y++) {
    for (let x = 3 + (y % 2); x < 29; x += 2) tile.pixel(x, y, field);
  }

  const art = new PixelGrid(ART_SIZE);
  ART[id](art);
  art.pixels.forEach((pixel, index) => {
    if (!pixel) return;
    const x = index % ART_SIZE + PAD, y = Math.floor(index / ART_SIZE) + PAD;
    tile.line(x - 1, y, x + 1, y, INK);
    tile.line(x, y - 1, x, y + 1, INK);
  });
  art.pixels.forEach((pixel, index) => {
    if (pixel) tile.pixel(index % ART_SIZE + PAD, Math.floor(index / ART_SIZE) + PAD, pixel);
  });

  if (style) {
    const accent = FAMILY_COLOR[style.family];
    tile.line(24, 30, 30, 30, accent);
    tile.line(30, 27, 30, 30, accent);
  }
  if (style?.category === 'buff') tile.circle(3, 3, 2, CYAN);
  if (style?.category === 'weapon') tile.shape([[1, 1], [5, 1], [1, 5]], ORANGE);
  if (evolved) {
    for (const position of [3, 9, 22, 28]) {
      tile.pixel(position, 0, YELLOW);
      tile.pixel(0, position, YELLOW);
      tile.pixel(31, 31 - position, GOLD);
    }
    tile.rect(2, 2, 4, 4, GOLD);
    tile.pixel(2, 2, WHITE);
    tile.pixel(29, 29, YELLOW);
  }
  return tile.rgba();
}

const sources = new Map<GearIconId, string>();

export function createGearIcon(id: GearIconId, size = SIZE): HTMLImageElement {
  let source = sources.get(id);
  if (source === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (context) {
      const pixels = context.createImageData(SIZE, SIZE);
      pixels.data.set(gearIconPixels(id));
      context.putImageData(pixels, 0, 0);
      source = canvas.toDataURL();
      sources.set(id, source);
    }
  }
  const image = document.createElement('img');
  image.className = 'gear-icon';
  image.width = image.height = size;
  image.alt = '';
  image.draggable = false;
  image.style.imageRendering = 'pixelated';
  if (source) image.src = source;
  return image;
}
