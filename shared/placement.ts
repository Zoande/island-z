import type { ChunkData } from './mesh';
import { GRID, BASE_CHUNK, VERTEX_FLOATS } from './mesh';
import { rockBurialDepth, type Point3 } from './rocks';
export type Quaternion = [number, number, number, number];
export interface MeshSurface { height: number; normal: Point3 }
export interface SurfaceTile { data: ChunkData; vertices: Float32Array }
export function surfaceFromTiles(tiles: SurfaceTile[], x: number, z: number): MeshSurface | null {
  for (const tile of tiles) {
    const extent = BASE_CHUNK * 2 ** tile.data.level;
    if (x >= tile.data.x && z >= tile.data.z && x <= tile.data.x + extent && z <= tile.data.z + extent)
      return surfaceOnMesh(tile.data, tile.vertices, x, z);
  }
  return null;
}
export function surfaceOnMesh(data: ChunkData, vertices: Float32Array, x: number, z: number): MeshSurface {
  const extent = BASE_CHUNK * 2 ** data.level, step = extent / GRID;
  const gx = Math.max(0, Math.min(GRID - 1e-7, (x - data.x) / step)), gz = Math.max(0, Math.min(GRID - 1e-7, (z - data.z) / step));
  const cx = Math.floor(gx), cz = Math.floor(gz), u = gx - cx, v = gz - cz;
  const a = cz * (GRID + 1) + cx, b = a + 1, c = a + GRID + 1, d = c + 1;
  const ids = u + v <= 1 ? [a, b, c] : [b, d, c];
  const weights = u + v <= 1 ? [1 - u - v, u, v] : [1 - v, u + v - 1, 1 - u];
  const height = ids.reduce((total, id, i) => total + vertices[id * VERTEX_FLOATS + 1] * weights[i], 0);
  // The face normal matches the actual support plane, not the analytic height field.
  const p = ids.map(id => [vertices[id * VERTEX_FLOATS], vertices[id * VERTEX_FLOATS + 1], vertices[id * VERTEX_FLOATS + 2]]);
  const edgeA = p[1].map((n, i) => n - p[0][i]), edgeB = p[2].map((n, i) => n - p[0][i]);
  let nx = edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1], ny = edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2], nz = edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0];
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const length = Math.hypot(nx, ny, nz);
  return { height, normal: [nx / length, ny / length, nz / length] };
}
export function orientation(normal: Point3, yaw: number): Quaternion {
  const length = Math.hypot(normal[2], -normal[0], 1 + normal[1]);
  const x = normal[2] / length, z = -normal[0] / length, w = (1 + normal[1]) / length;
  const s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
  return [x * c - z * s, w * s, z * c + x * s, w * c];
}
export function rotate(point: Point3, q: Quaternion): Point3 {
  const [x, y, z] = point, [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}
/** Support the entire footprint, then bury it a little so there is no visible air gap. */
export function embeddedRockHeight(points: Point3[], x: number, z: number, scale: number, rotation: Quaternion, surface: (x: number, z: number) => number): number {
  let support = -Infinity;
  for (const point of points) {
    const p = rotate([point[0] * scale, point[1] * scale, point[2] * scale], rotation);
    support = Math.max(support, surface(x + p[0], z + p[2]) - p[1]);
  }
  return support - rockBurialDepth(points, scale);
}
