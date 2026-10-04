export function seedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(a: number, b: number, x: number): number { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); }
export function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), tx = x - ix, tz = z - iz;
  const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10), v = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  return lerp(lerp(hash(ix, iz, seed), hash(ix + 1, iz, seed), u), lerp(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) { sum += amplitude * noise(x, z, seed + i * 971); total += amplitude; amplitude *= 0.5; x *= 2.03; z *= 2.03; }
  return sum / total;
}
