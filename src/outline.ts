export function outlineShip(pixels: Uint32Array, w: number, h: number, left: number, top: number, right: number, bottom: number): void {
  const ink = 0xff1f1510 >>> 0;
  for (let y = Math.max(1, top); y < Math.min(h - 1, bottom); y++) for (let x = Math.max(1, left); x < Math.min(w - 1, right); x++) {
    const i = y * w + x;
    if (!pixels[i] || pixels[i] === ink) continue;
    if (!pixels[i - 1]) pixels[i - 1] = ink;
    if (!pixels[i + 1]) pixels[i + 1] = ink;
    if (!pixels[i - w]) pixels[i - w] = ink;
    if (!pixels[i + w]) pixels[i + w] = ink;
  }
}
