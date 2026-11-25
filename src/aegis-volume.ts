type AegisPoint = { x: number; z: number; alt: number };
type AegisSupport = { from: AegisPoint; to: AegisPoint };
type AegisBoundaryRing = { radius: number; alt: number };

export function aegisVolumeOutline(radius: number, halfWidth: number): {
  rings: AegisBoundaryRing[];
  supports: AegisSupport[];
} {
  const innerRadius = radius - halfWidth, outerRadius = radius + halfWidth;
  const radii = [innerRadius, outerRadius], altitudes = [-halfWidth, halfWidth];
  const rings = altitudes.flatMap(alt => radii.map(ringRadius => ({ radius: ringRadius, alt })));
  const supports: AegisSupport[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, x = Math.cos(angle), z = Math.sin(angle);
    const point = (r: number, alt: number): AegisPoint => ({ x: x * r, z: z * r, alt });
    for (const ringRadius of radii) {
      supports.push({ from: point(ringRadius, -halfWidth), to: point(ringRadius, halfWidth) });
    }
    for (const alt of altitudes) {
      supports.push({ from: point(innerRadius, alt), to: point(outerRadius, alt) });
    }
  }
  return { rings, supports };
}
