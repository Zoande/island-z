import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateChunk } from '../shared/mesh';
import { WorldGenerator } from '../shared/world';

const digest = (value: ArrayBufferView) => createHash('sha256')
  .update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest('hex');

describe('terrain chunk generation', () => {
  it('preserves canonical mesh, scenery, and height output for fixed world positions', () => {
    const world = new WorldGenerator({ seed: 'island-z', islandSizeMeters: 10240 });
    const fixtures = [
      { request: { key: '0:0:0', x: 0, z: 0, level: 0 }, vertices: '1b1bc785c638d3d2c0e2e220c88b8c2b05ed493374c6098246684ad5f3b567a9', props: '6e8637c15fa4aa194259c61c88b1d7f3b90b3ccb88b037ae354060ec28a23d8e', min: 388.24166159558155, max: 453.1902618482806, propCount: 32 },
      { request: { key: '0:0:4', x: 0, z: 0, level: 4 }, vertices: '0328018cdde59a4602dd7a4382466a4381600b706fbafe34a85efddbea5219e2', props: '9c7205d157d2c32a6411682e756170503dcb9970b80536b9eff7de0f0e82a552', min: 184.98858767151492, max: 773.8500898692528, propCount: 1090 },
    ];
    for (const fixture of fixtures) {
      const chunk = generateChunk(world, fixture.request);
      expect(digest(chunk.vertices)).toBe(fixture.vertices);
      expect(digest(chunk.indices)).toBe('0017d89cd25be592b3b0cc69f2f81e7487545daabddf4f624a5e8bdca4ebde51');
      expect(createHash('sha256').update(JSON.stringify(chunk.props)).digest('hex')).toBe(fixture.props);
      expect(chunk.minHeight).toBe(fixture.min);
      expect(chunk.maxHeight).toBe(fixture.max);
      expect(chunk.props).toHaveLength(fixture.propCount);
    }
  });
});
