import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../shared/world';
import { generateChunk, GRID, BASE_CHUNK, VERTEX_FLOATS } from '../shared/mesh';
import { stitchedVertices } from '../shared/stitch';
import { surfaceOnMesh, surfaceFromTiles, orientation, rotate, embeddedRockHeight } from '../shared/placement';
import { rockPoints, rockBurialDepth } from '../shared/rocks';
import { selectTiles, type TileNode } from '../client/streaming';
import { parseWorldConfig } from '../shared/config';

const config = { seed: 'island-z', islandSizeMeters: 30720 };
const world = new WorldGenerator(config);
describe('terrain generation', () => {
  it('is deterministic, finite, and has both lowlands and substantial mountains', () => {
    const second = new WorldGenerator(config);
    let maximum = 0, lowlands = 0;
    for (let z = -12000; z <= 12000; z += 500) for (let x = -12000; x <= 12000; x += 500) {
      const sample = world.sample(x, z);
      expect(sample.height).toBe(second.height(x, z));
      expect(Number.isFinite(sample.height)).toBe(true);
      expect(Math.hypot(...sample.normal)).toBeCloseTo(1, 7);
      expect(sample.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 7);
      expect(sample.weights.every(w => w >= -1e-10 && w <= 1)).toBe(true);
      if (world.coastDistance(x, z) > 300) expect(sample.height).toBeGreaterThan(0);
      maximum = Math.max(maximum, sample.height);
      if (sample.height > 5 && sample.height < 100) lowlands++;
    }
    expect(maximum).toBeGreaterThan(700);
    expect(maximum).toBeLessThan(2500);
    expect(lowlands).toBeGreaterThan(500);
    expect(world.height(config.islandSizeMeters / 2, config.islandSizeMeters / 2)).toBeLessThan(0);
  });
  it('keeps beaches and the first inland rise gentle for multiple seeds', () => {
    for (const seed of ['island-z', 'coast-test', 'other-island']) {
      const w = new WorldGenerator({ ...config, seed });
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        let inner = 0, outer = config.islandSizeMeters / 2;
        for (let n = 0; n < 30; n++) {
          const r = (inner + outer) / 2;
          if (w.coastDistance(Math.cos(angle) * r, Math.sin(angle) * r) > 0) inner = r; else outer = r;
        }
        const coastline = (inner + outer) / 2;
        for (let inland = 0; inland <= 450; inland += 25) {
          const x = Math.cos(angle) * (coastline - inland), z = Math.sin(angle) * (coastline - inland);
          const sample = w.sample(x, z);
          expect(sample.normal[1]).toBeGreaterThan(Math.cos(15 * Math.PI / 180));
          if (inland < 100) expect(sample.height).toBeLessThan(6);
        }
      }
    }
  },15000);
  it('has continuous mountain heights without vertical needles', () => {
    let steepSamples = 0;
    for (let z = -7000; z <= 7000; z += 110) for (let x = -7000; x <= 7000; x += 110) {
      const s = world.sample(x, z);
      const angle = Math.acos(Math.max(-1, Math.min(1, s.normal[1]))) * 180 / Math.PI;
      expect(angle).toBeLessThan(78);
      expect(Math.abs(world.height(x + .01, z) - s.height)).toBeLessThan(.05);
      if (angle > 25) steepSamples++;
    }
    expect(steepSamples).toBeGreaterThan(100);
  });
  it('rejects invalid configurations and retains numeric sizes', () => {
    for (const size of [NaN, Infinity, -100, 0]) expect(() => parseWorldConfig({ seed: 'x', islandSizeMeters: size })).toThrow();
    expect(parseWorldConfig({ seed: 'custom', islandSizeMeters: 24567 }).islandSizeMeters).toBe(24567);
  });
  it('gives inland lowland patches noticeable rolling relief', () => {
    let patches = 0, rollingPatches = 0;
    for (let z = -10000; z <= 10000; z += 650) for (let x = -10000; x <= 10000; x += 650) {
      if (world.coastDistance(x, z) < 1600 || world.height(x, z) > 220) continue;
      const heights: number[] = [];
      for (let dz = -160; dz <= 160; dz += 80) for (let dx = -160; dx <= 160; dx += 80) heights.push(world.height(x + dx, z + dz));
      patches++;
      if (Math.max(...heights) - Math.min(...heights) > 5) rollingPatches++;
    }
    expect(patches).toBeGreaterThan(100);
    expect(rollingPatches / patches).toBeGreaterThan(.65);
  });
});
describe('terrain mesh and placement', () => {
  it('has identical heights along adjacent chunk boundaries', () => {
    const a = generateChunk(world, { key: 'a', x: 0, z: 0, level: 0 });
    const b = generateChunk(world, { key: 'b', x: 64, z: 0, level: 0 });
    for (let i = 0; i <= GRID; i++) expect(a.vertices[(i * (GRID + 1) + GRID) * VERTEX_FLOATS + 1]).toBe(b.vertices[i * (GRID + 1) * VERTEX_FLOATS + 1]);
  });
  it('stitches the fine edge to the coarser triangle edge without tall skirt walls', () => {
    const chunk = generateChunk(world, { key: 'edge', x: 0, z: 0, level: 0 });
    const vertices = stitchedVertices(world, chunk, [0, 2, 0, 0]);
    for (let i = 0; i <= GRID; i++) {
      const z = i * 2, lower = Math.floor(z / 8) * 8, t = (z - lower) / 8;
      expect(vertices[(i * (GRID + 1) + GRID) * VERTEX_FLOATS + 1]).toBeCloseTo(world.height(64, lower) * (1 - t) + world.height(64, lower + 8) * t, 3);
    }
    const high = generateChunk(world, { key: 'coarse', x: 0, z: 0, level: 7 });
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= GRID; i++) {
      const offset = ((GRID + 1) ** 2 + edge * (GRID + 1) + i) * VERTEX_FLOATS;
      const height = world.height(high.x + high.vertices[offset], high.z + high.vertices[offset + 2]);
      expect(height - high.vertices[offset + 1]).toBeCloseTo(8, 2);
    }
  });
  it('anchors to the rendered triangle rather than the analytic surface', () => {
    const chunk = generateChunk(world, { key: 'mountain', x: 0, z: 0, level: 2 });
    const x = 13.4, z = 11.7, actual = surfaceOnMesh(chunk, chunk.vertices, x, z);
    const u = (x - 8) / 8, v = (z - 8) / 8;
    const hA = chunk.vertices[((GRID + 1) + 1) * VERTEX_FLOATS + 1];
    const hB = chunk.vertices[((GRID + 1) + 2) * VERTEX_FLOATS + 1];
    const hC = chunk.vertices[(2 * (GRID + 1) + 1) * VERTEX_FLOATS + 1];
    const hD = chunk.vertices[(2 * (GRID + 1) + 2) * VERTEX_FLOATS + 1];
    const expected = u + v <= 1 ? hA * (1 - u - v) + hB * u + hC * v : hB * (1 - v) + hD * (u + v - 1) + hC * (1 - u);
    expect(actual.height).toBeCloseTo(expected, 7);
    expect(actual.normal[1]).toBeGreaterThan(0);
  });
  it('embeds every rock variant into flat ground and a steep support plane', () => {
    for (const gradient of [0, .8, 1.6]) for (let variant = 0; variant < 12; variant++) {
      const points = rockPoints(config.seed, variant), len = Math.hypot(gradient, 1);
      const normal: [number, number, number] = [-gradient / len, 1 / len, 0];
      const q = orientation(normal, 1.2), up = rotate([0, 1, 0], q);
      up.forEach((v, i) => expect(v).toBeCloseTo(normal[i], 7));
      const surface = (x: number, _z: number) => 200 + gradient * x, scale = 2.3;
      const y = embeddedRockHeight(points, 10, -4, scale, q, surface);
      const clearances = points.map(p => {
        const v = rotate([p[0] * scale, p[1] * scale, p[2] * scale], q);
        return y + v[1] - surface(10 + v[0], -4 + v[2]);
      });
      expect(Math.min(...clearances)).toBeCloseTo(-rockBurialDepth(points, scale), 7);
      expect(Math.max(...clearances)).toBeGreaterThan(.5);
    }
  });
  it('fits a large rock footprint across chunk boundaries using both support meshes', () => {
    const left = generateChunk(world, { key: 'left', x: 0, z: 0, level: 0 });
    const right = generateChunk(world, { key: 'right', x: 64, z: 0, level: 0 });
    const tiles = [{ data: left, vertices: left.vertices }, { data: right, vertices: right.vertices }];
    const points = rockPoints(config.seed, 3), center = surfaceOnMesh(left, left.vertices, 63, 32), q = orientation(center.normal, .3);
    const support = (x: number, z: number) => surfaceFromTiles(tiles, x, z)!.height;
    const scale = 5, y = embeddedRockHeight(points, 63, 32, scale, q, support);
    let crosses = false;
    const clearances = points.map(point => {
      const p = rotate([point[0] * scale, point[1] * scale, point[2] * scale], q);
      if (63 + p[0] > 64) crosses = true;
      return y + p[1] - support(63 + p[0], 32 + p[2]);
    });
    expect(crosses).toBe(true);
    expect(Math.min(...clearances)).toBeCloseTo(-rockBurialDepth(points, scale), 7);
    expect(surfaceFromTiles(tiles, -100, -100)).toBeNull();
  });
  it('keeps placement independent of chunk ownership and load order', () => {
    const full = world.props(0, 0, 128, false);
    const divided = [[0, 0], [64, 0], [0, 64], [64, 64]].flatMap(([x, z]) => world.props(x, z, 64, false));
    const sorted = (v: typeof full) => v.sort((a, b) => a.x - b.x || a.z - b.z || a.kind.localeCompare(b.kind));
    expect(sorted(divided)).toEqual(sorted(full));
  });
  it('gives every rock a broad flat underside and most variants fracture facets', () => {
    for (let variant = 0; variant < 12; variant++) {
      const points = rockPoints(config.seed, variant), bottom = Math.min(...points.map(p => p[1]));
      const base = points.filter(p => Math.abs(p[1] - bottom) < 1e-7);
      expect(base.length).toBeGreaterThan(20);
      expect(Math.max(...base.map(p => Math.hypot(p[0], p[2])))).toBeGreaterThan(.30);
      expect(points).toEqual(rockPoints(config.seed, variant));
    }
  });
  it('places sparse rocks and permits occasional substantial outcrops', () => {
    let rocks = 0, large = 0, area = 0;
    for (let z = -9000; z <= 9000; z += 1000) for (let x = -9000; x <= 9000; x += 1000) {
      if (world.coastDistance(x, z) < 500) continue;
      const props = world.props(x, z, 128, false).filter(p => p.kind === 'rock');
      rocks += props.length; large += props.filter(p => p.scale > 3.5).length; area += 128 ** 2;
    }
    expect(rocks / (area / 1_000_000)).toBeLessThan(550);
    expect(rocks).toBeGreaterThan(100);
    expect(large).toBeGreaterThan(0);
  },15000);
});
describe('large-world streaming', () => {
  const nodes = (roots: TileNode[]): TileNode[] => roots.flatMap(n => [n, ...nodes(n.children)]);
  it('bounds requested terrain by draw distance instead of island area', () => {
    for (const distance of [3000, 6500, 11000]) {
      const a = nodes(selectTiles(1200, -2300, 30720, distance));
      const b = nodes(selectTiles(1200, -2300, 100_000_000, distance));
      expect(a.length).toBe(b.length);
      expect(b.length).toBeLessThan(640);
      expect(b.every(n => n.request.level <= 7 && BASE_CHUNK * 2 ** n.request.level > 0)).toBe(true);
    }
  });
});
