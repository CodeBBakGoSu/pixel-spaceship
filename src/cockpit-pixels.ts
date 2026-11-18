import type { Rect } from './layout';

type Context = CanvasRenderingContext2D;
type Surface = { canvas: HTMLCanvasElement; context: Context };
export type CockpitLabel = {
  canvas: HTMLCanvasElement;
  x: number; y: number; width: number; height: number;
  anchorX: number; anchorY: number; advance: number;
};

export function cockpitSurface(width: number, height: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.textBaseline = 'middle';
  context.imageSmoothingEnabled = false;
  return { canvas, context };
}

export class CockpitLabelAtlas {
  private page = cockpitSurface(1024, 512);
  private x = 0;
  private y = 0;
  private rowHeight = 0;

  constructor(private readonly font: string) {}

  add(label: string, color: string, align: CanvasTextAlign = 'left', stroke?: string): CockpitLabel {
    let { context, canvas } = this.page;
    context.font = this.font;
    context.textAlign = align;
    const m = context.measureText(label);
    const anchorX = Math.max(0, Math.ceil(m.actualBoundingBoxLeft)) + 3;
    const anchorY = Math.max(0, Math.ceil(m.actualBoundingBoxAscent)) + 3;
    const width = anchorX + Math.max(0, Math.ceil(m.actualBoundingBoxRight)) + 3;
    const height = anchorY + Math.max(0, Math.ceil(m.actualBoundingBoxDescent)) + 3;
    if (this.x + width > canvas.width) {
      this.x = 0;
      this.y += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.y + height > canvas.height) {
      this.page = cockpitSurface(canvas.width, canvas.height);
      ({ context, canvas } = this.page);
      context.font = this.font;
      context.textAlign = align;
      this.x = this.y = this.rowHeight = 0;
    }
    const { x, y } = this;
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 2;
      context.strokeText(label, x + anchorX, y + anchorY);
    }
    context.fillStyle = color;
    context.fillText(label, x + anchorX, y + anchorY);
    this.x += width;
    this.rowHeight = Math.max(this.rowHeight, height);
    return { canvas, x, y, width, height, anchorX, anchorY, advance: m.width };
  }
}

export function drawCockpitLabel(c: Context, label: CockpitLabel, x: number, y: number): void {
  c.drawImage(label.canvas, label.x, label.y, label.width, label.height,
    Math.round(x) - label.anchorX, Math.round(y) - label.anchorY, label.width, label.height);
}

export function cockpitPixel(rgb: number): number {
  return 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 0xff);
}

// Software raster for the pitch ladder. One upload replaces the overlapping
// rectangle paths that dominated SwiftShader's raster time.
export class CockpitLineRaster {
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;

  constructor(private readonly bounds: Rect) {
    this.image = new ImageData(bounds.width, bounds.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
  }

  clear(): void { this.pixels.fill(0); }

  line(color: number, x1: number, y1: number, x2: number, y2: number, weight: number): void {
    const dx = x2 - x1, dy = y2 - y1;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const { x, y, width, height } = this.bounds;
    for (let i = 0; i <= steps; i++) {
      const left = Math.round(x1 + dx * i / steps) - x, top = Math.round(y1 + dy * i / steps) - y;
      const start = Math.max(0, left), end = Math.min(width, left + weight);
      if (end <= start) continue;
      for (let row = Math.max(0, top); row < Math.min(height, top + weight); row++) {
        this.pixels.fill(color, row * width + start, row * width + end);
      }
    }
  }

  draw(c: Context, origin: Rect): void {
    c.putImageData(this.image, this.bounds.x - origin.x, this.bounds.y - origin.y);
  }
}
