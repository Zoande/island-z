import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WorldGenerator } from '../shared/world';
import { generateChunk, VERTEX_FLOATS } from '../shared/mesh';
import { selectTiles, type TileNode } from '../client/streaming';
const requestedSizes = process.argv.slice(2).map(Number);
if (requestedSizes.some(size => !Number.isFinite(size) || size < 128)) throw new Error('Pass island sizes in meters.');
const sizes = requestedSizes.length ? requestedSizes : [10240, 30720, 61440];
const nodes = (roots: TileNode[]): TileNode[] => roots.flatMap(n => [n, ...nodes(n.children)]);
const reports = [];
for (const size of sizes) {
  const world = new WorldGenerator({ seed: 'island-z', islandSizeMeters: size });
  const sampleStart = performance.now();
  let highest = 0;
  for (let z = -size * .4; z < size * .4; z += size / 96) for (let x = -size * .4; x < size * .4; x += size / 96) highest = Math.max(highest, world.height(x, z));
  const sampleMilliseconds = performance.now() - sampleStart;
  // Actual CPU mesh/scenery generation for every resident request, including fallback parents.
  // Sequential execution is a conservative measurement; the browser uses three workers.
  const tiles = nodes(selectTiles(0, 0, size, 6500));
  const start = performance.now(); let vertices = 0, props = 0;
  for (const node of tiles) {
    const data = generateChunk(world, node.request); vertices += data.vertices.length / VERTEX_FLOATS; props += data.props.length;
  }
  const generationSeconds = (performance.now() - start) / 1000;
  const report = { islandSizeMeters: size, chunks: tiles.length, vertices, props, highestMeters: Math.round(highest), sampleMilliseconds: Math.round(sampleMilliseconds), sequentialGenerationSeconds: Number(generationSeconds.toFixed(2)) };
  reports.push(report); console.log(JSON.stringify(report));
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/terrain-benchmark.json', JSON.stringify(reports, null, 2));
