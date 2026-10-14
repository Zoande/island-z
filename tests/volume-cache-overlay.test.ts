import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyVolume, encodeContourTemplate, installContourTemplate, meshVolume, solidSource, SparseVolume, type EditBrush, type SolidPrimitive } from '../shared/volume';

const digest = (value: ArrayBufferView) => createHash('sha256')
  .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex');

describe('cached tree contour edits', () => {
  it('preserves pristine regions, dirty tile seams, repeated cuts, and repair output', () => {
    const asset = JSON.parse(readFileSync('public/models/oak-0-solid.json', 'utf8')) as { primitives: SolidPrimitive[] };
    const source = solidSource(asset.primitives);
    const initial = emptyVolume();
    meshVolume(source, initial);
    installContourTemplate(source, encodeContourTemplate(source));

    const volume = new SparseVolume(source, initial);
    const brushes: EditBrush[] = [
      { center: [.25, 1.1, .02], axis: [-1, 0, 0], radius: .13, depth: .20, seed: 31 },
      { center: [-.18, 6.2, .1], axis: [1, 0, 0], radius: .11, depth: .22, seed: 47 },
      { center: [-.06, 10.47, .76], axis: [0, 0, -1], radius: .10, depth: .18, seed: 59 },
    ];
    const results: { name: string; meshes: number; geometry: string }[] = [];
    const record = (name: string) => {
      const meshes = meshVolume(source, volume.state).map(mesh => ({
        material: mesh.material,
        vertices: digest(mesh.vertices),
        indices: digest(mesh.indices),
        vertexCount: mesh.vertices.length / 16,
        indexCount: mesh.indices.length,
      }));
      meshes.sort((a, b) => a.material.localeCompare(b.material) || a.vertices.localeCompare(b.vertices) || a.indices.localeCompare(b.indices));
      results.push({ name, meshes: meshes.length, geometry: createHash('sha256').update(JSON.stringify(meshes)).digest('hex') });
    };

    record('base');
    for (let i = 0; i < brushes.length; i++) {
      expect(volume.edit(brushes[i])).toBe(true);
      record(`cut-${i + 1}`);
    }
    expect(volume.edit(brushes[1], true)).toBe(true);
    record('repair-2');
    expect(volume.edit(brushes[0], true)).toBe(true);
    record('repair-1');

    expect(results).toEqual([
      { name: 'base', meshes: 40, geometry: '3f3fc247ec1bc61f126306f21481e03a40c94cf015642a82241f0c9d946f86f0' },
      { name: 'cut-1', meshes: 42, geometry: '7597cd6185d8071119946a4496139b0eaeaa33fbdc9615b87704a823c33c3b86' },
      { name: 'cut-2', meshes: 46, geometry: '0df217f3348354d6759ff979ae0b34fdd04c097d1bb6e7e7e69b421e1aae1f57' },
      { name: 'cut-3', meshes: 48, geometry: 'a5ca9a4aa9da9f358d0c05dfa1273653aed87824fc9226e941bdf9d630f34269' },
      { name: 'repair-2', meshes: 46, geometry: '469452553f7e46ece48b0e1a785608882e1dc7614ac64e06766f38f37bcf3bd7' },
      { name: 'repair-1', meshes: 46, geometry: '0287ceb93fd8831310d4c839658365dcbf972a26ed39316ef65be29199641f88' },
    ]);
  }, 30000);
});
