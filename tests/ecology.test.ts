import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../shared/world';
import { grassMesh, rockMesh, oceanMesh } from '../client/geometry';
import { VERTEX_FLOATS } from '../shared/mesh';
const world = new WorldGenerator({ seed: 'island-z', islandSizeMeters: 30720 });
describe('ecology', () => {
  it('uses every ground material in finite, normalized environmental blends', () => {
    const maximum = Array(8).fill(0);
    for (let z = -11000; z <= 11000; z += 170) for (let x = -11000; x <= 11000; x += 170) {
      const s = world.sample(x, z);
      expect(s.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
      s.weights.forEach((w, i) => { expect(w).toBeGreaterThanOrEqual(0); maximum[i] = Math.max(maximum[i], w); });
      if (!world.water.sample(x,z) && (s.normal[1] < .8 || s.height > 300)) expect(s.weights[4]).toBe(0);
      if (s.forest === 0) expect(s.weights[6]).toBe(0);
    }
    maximum.forEach(w => expect(w).toBeGreaterThan(.12));
  });
  it('keeps shrubs, grass variants, trees and pebble patches stable across chunk partitions', () => {
    const kinds = new Set<string>(), trees = new Set<string>();
    const key = (p: ReturnType<WorldGenerator['props']>[number]) => `${p.kind}/${p.x}/${p.z}/${p.variant}/${p.scale}`;
    for (let z = -4000; z < 4000; z += 1500) for (let x = -4000; x < 4000; x += 1500) {
      const full = world.props(x, z, 128);
      const split = [[x,z],[x+64,z],[x,z+64],[x+64,z+64]].flatMap(([a,b]) => world.props(a,b,64));
      expect(split.map(key).sort()).toEqual(full.map(key).sort());
      for (const p of full) {
        kinds.add(p.kind);
        if (p.kind === 'oak' || p.kind === 'birch') trees.add(`${p.kind}/${p.variant}`);
        if (p.kind === 'bush') expect(world.sample(p.x,p.z).normal[1]).toBeGreaterThanOrEqual(.90);
        if (p.kind === 'pebble') { expect(p.scale).toBeLessThan(.27); expect(p.y).toBeGreaterThan(.7); }
      }
    }
    expect([...kinds]).toEqual(expect.arrayContaining(['oak','birch','grass','bush','pebble']));
    expect(trees.size).toBe(12);
  },15000); // Whole/split comparisons regenerate scenery for 36 regions.
  it('uses the same vertex layout for all procedural GPU geometry', () => {
    for (const mesh of [...Array.from({length:4},(_,i)=>grassMesh(i)),rockMesh('island-z',0),oceanMesh()]) {
      expect(mesh.vertices.length % VERTEX_FLOATS).toBe(0);
      expect(mesh.indices.every(index=>index<mesh.vertices.length/VERTEX_FLOATS)).toBe(true);
      expect(mesh.vertices.every(Number.isFinite)).toBe(true);
    }
  });
});
