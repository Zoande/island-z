import { rockPoints, ROCK_RINGS, ROCK_SEGMENTS } from '../shared/rocks';
import { VERTEX_FLOATS } from '../shared/mesh';
export interface GeometryData { vertices: Float32Array; indices: Uint32Array; material: string }
/** Index widths change storage only; large ocean meshes retain 32-bit addressing. */
export function compactIndices(indices:Uint32Array):Uint16Array|Uint32Array {
  for(const index of indices)if(index>65535)return indices;
  return new Uint16Array(indices);
}
/** Scenery has no terrain blend weights. Preserve its eight used floats exactly. */
export function compactVertices(vertices:Float32Array):Float32Array {
  const result=new Float32Array(vertices.length/VERTEX_FLOATS*8);
  for(let i=0,j=0;i<vertices.length;i+=VERTEX_FLOATS,j+=8)result.set(vertices.subarray(i,i+8),j);
  return result;
}
export function rockMesh(seed: string, variant: number,lod=0): GeometryData {
  const mode = variant % 6, rings = lod===0?ROCK_RINGS:5, segments = lod===0?ROCK_SEGMENTS:lod===1?8:4;
  const full=rockPoints(seed,variant),positions=[];
  for(let r=0;r<=rings;r++)for(let j=0;j<=segments;j++)positions.push(full[Math.round(r/rings*ROCK_RINGS)*(ROCK_SEGMENTS+1)+Math.round(j/segments*ROCK_SEGMENTS)]);
  const vertices: number[] = [], indices: number[] = [];
  for (let r = 0; r < rings; r++) for (let j = 0; j < segments; j++) {
    const a = r * (segments + 1) + j, b = a + 1, c = a + segments + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const normals = positions.map(() => [0, 0, 0]);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]], p = positions[a], q = positions[b], t = positions[c];
    const u = q.map((v, k) => v - p[k]), v = t.map((v, k) => v - p[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const idx of [a, b, c]) for (let k = 0; k < 3; k++) normals[idx][k] += n[k];
  }
  for (let i = 0; i < positions.length; i++) {
    const n = normals[i], length = Math.hypot(...n) || 1;
    const r = Math.floor(i / (segments + 1)), j = i % (segments + 1);
    vertices.push(...positions[i], ...n.map(v => v / length), j / segments * 2, r / rings, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  // Angular variants use split triangle normals instead of a smooth blob silhouette.
  if (mode !== 5) {
    const split: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const ids = indices.slice(i, i + 3), p = positions[ids[0]], q = positions[ids[1]], t = positions[ids[2]];
      const u = q.map((v, k) => v - p[k]), v = t.map((v, k) => v - p[k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n) || 1;
      for (const id of ids) split.push(...positions[id], ...n.map(v => v / length), vertices[id * VERTEX_FLOATS + 6], vertices[id * VERTEX_FLOATS + 7], 0, 0, 0, 0, 0, 0, 0, 0);
    }
    return { vertices: new Float32Array(split), indices: Uint32Array.from({ length: split.length / VERTEX_FLOATS }, (_, i) => i), material: 'rock' };
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), material: 'rock' };
}
export function grassMesh(variant: number,lod=0): GeometryData {
  const v: number[] = [], ix: number[] = [];
  const segments=lod===0?3:lod===1?2:1;
  const height = [.85, 1.45, 1.1, .38][variant], width = [.65, .52, .60, .68][variant];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 4 + .15, dx = Math.cos(a) * width, dz = Math.sin(a) * width;
    const ox = Math.sin(i * 3.7) * .19, oz = Math.cos(i * 2.1) * .19, start = v.length / VERTEX_FLOATS;
    // Three connected segments bend the cards without folding their alpha silhouettes.
    for (let row = 0; row <= segments; row++) {
      const t = row / segments, bend = t * t * .20;
      for (const side of [-1, 1]) v.push(ox + dx * side + Math.cos(a + 1) * bend, height * t, oz + dz * side + Math.sin(a + 1) * bend,
        0, 1, 0, (side + 1) / 2, 1 - t, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    for (let row = 0; row < segments; row++) { const j = start + row * 2; ix.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(ix), material: `grass-${variant}` };
}
export function oceanMesh(): GeometryData {
  const v: number[] = [], ix: number[] = [], n = 256;
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    // Dense near the camera, coarser toward the horizon.
    const spread = (i: number) => { const a = (i / n * 2 - 1); return Math.sign(a) * Math.abs(a) ** 2 * 16000; };
    v.push(spread(x), 0, spread(z), 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const a = z * (n + 1) + x; ix.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
  return { vertices: new Float32Array(v), indices: new Uint32Array(ix), material: 'ocean' };
}
