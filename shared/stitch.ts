import { GRID, VERTEX_FLOATS, BASE_CHUNK, type ChunkData } from './mesh';
import type { WorldGenerator } from './world';
// North/east/south/west boundary heights follow the adjacent coarser grid exactly.
// Samples on the common grid remain untouched; intermediate vertices interpolate.
export function stitchedVertices(world: WorldGenerator, data: ChunkData, neighbors: number[]): Float32Array {
  const vertices = data.vertices.slice(), extent = BASE_CHUNK * 2 ** data.level;
  const step = extent / GRID;
  const edges = [
    Array.from({ length: GRID + 1 }, (_, i) => i),
    Array.from({ length: GRID + 1 }, (_, i) => i * (GRID + 1) + GRID),
    Array.from({ length: GRID + 1 }, (_, i) => GRID * (GRID + 1) + GRID - i),
    Array.from({ length: GRID + 1 }, (_, i) => (GRID - i) * (GRID + 1)),
  ];
  for (let edge = 0; edge < 4; edge++) {
    if (neighbors[edge] <= data.level) continue;
    const coarseStep = BASE_CHUNK * 2 ** neighbors[edge] / GRID;
    for (let i = 0; i <= GRID; i++) {
      const id = edges[edge][i], offset = id * VERTEX_FLOATS;
      const x = data.x + vertices[offset], z = data.z + vertices[offset + 2];
      const along = edge % 2 === 0 ? x : z;
      const lower = Math.floor(along / coarseStep) * coarseStep, t = (along - lower) / coarseStep;
      const a = edge % 2 === 0 ? world.sample(lower, z) : world.sample(x, lower);
      const b = edge % 2 === 0 ? world.sample(lower + coarseStep, z) : world.sample(x, lower + coarseStep);
      const height = a.height * (1 - t) + b.height * t;
      vertices[offset + 1] = height;
      for (let k = 0; k < 3; k++) vertices[offset + 3 + k] = a.normal[k] * (1 - t) + b.normal[k] * t;
      const bottom = ((GRID + 1) ** 2 + edge * (GRID + 1) + i) * VERTEX_FLOATS;
      vertices[bottom + 1] = height - Math.max(1.5, Math.min(8, step * .15));
      for (let k = 0; k < 8; k++) {
        const weight = a.weights[k] * (1 - t) + b.weights[k] * t;
        vertices[offset + 8 + k] = weight; vertices[bottom + 8 + k] = weight;
      }
    }
  }
  return vertices;
}
