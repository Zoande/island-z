import { hash, noise, seedHash } from './noise';
export const ROCK_RINGS = 10, ROCK_SEGMENTS = 16;
export type Point3 = [number, number, number];
export function rockPoints(seed: string, variant: number): Point3[] {
  const s = seedHash(seed) + variant * 7919, mode = variant % 6;
  const sx = (.95 + hash(0, 0, s) * .55) * (mode === 3 ? 1.65 : mode === 1 ? 1.35 : 1);
  const sy = (.72 + hash(1, 0, s) * .48) * (mode === 1 ? .55 : mode === 3 ? 1.15 : 1);
  const sz = .85 + hash(2, 0, s) * .50;
  // Intersections of fracture planes produce blocks, slabs, wedges, and outcrops.
  // The underside is a broad plane, not the pole of a displaced sphere.
  const planes: [number, number, number, number][] = [
    [1, .10, .05, .95], [-1, -.06, .09, .83], [.08, .04, 1, .90], [-.04, .12, -1, 1.0],
    [.16, 1, -.12, .95], [0, -1, 0, .48],
  ];
  if (mode === 2) planes.push([.65, 1, .15, .98], [-.18, .65, -.7, .90]);
  if (mode === 3) planes.push([.35, 1, -.22, .89], [-.75, .55, .15, .95]);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4 + (hash(i, 5, s) - .5) * .22;
    planes.push([Math.cos(angle), .25 + hash(i, 6, s) * .65, Math.sin(angle), 1.12 + hash(i, 7, s) * .22]);
  }
  const positions: Point3[] = [];
  for (let r = 0; r <= ROCK_RINGS; r++) for (let j = 0; j <= ROCK_SEGMENTS; j++) {
    const theta = r / ROCK_RINGS * Math.PI, phi = j / ROCK_SEGMENTS * Math.PI * 2;
    const dx = Math.sin(theta) * Math.cos(phi), dy = Math.cos(theta), dz = Math.sin(theta) * Math.sin(phi);
    let radius = Infinity;
    for (const [nx, ny, nz, distance] of planes) {
      const facing = nx * dx + ny * dy + nz * dz;
      if (facing > 0) radius = Math.min(radius, distance / facing);
    }
    if (mode === 5) {
      // A minority of weathered boulders keep softer corners, while retaining a flat base.
      const softRadius = 1 / (Math.abs(dx) ** 3.2 + Math.abs(dy) ** 3.2 + Math.abs(dz) ** 3.2) ** (1 / 3.2);
      radius = Math.min(radius * .30 + softRadius * .70, dy < 0 ? -.48 / dy : Infinity);
    }
    const weathering = (noise(dx * 3.8 + 7, dz * 3.8 + dy * 2.7, s) - .5) * .045;
    const y = dy * radius < -.475 ? -.48 : Math.max(-.48, dy * (radius + weathering));
    positions.push([dx * (radius + weathering) * sx, (y + .25) * sy, dz * (radius + weathering) * sz]);
  }
  return positions;
}
export function rockFootprintRadius(points: Point3[]): number { return Math.max(...points.map(p => Math.hypot(p[0], p[2]))); }
export function rockBurialDepth(points: Point3[], scale: number): number {
  const height = Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));
  return scale * Math.max(.22, Math.min(.55, height * .24));
}
