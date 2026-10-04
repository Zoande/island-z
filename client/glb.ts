import { mat4, vec3 } from 'gl-matrix';
import type { GeometryData } from './geometry';
// Deliberately constrained to the static, uncompressed Blender exports in this project.
// No scene engine, runtime animation, Draco decoder, or separate material instances.
export async function loadGLB(url: string): Promise<GeometryData[]> {
  const response = await fetch(url); if (!response.ok) throw new Error(`Cannot load model ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer(), view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error(`Invalid GLB: ${url}`);
  let json: any, binary: ArrayBuffer | undefined;
  for (let cursor = 12; cursor < buffer.byteLength;) {
    const size = view.getUint32(cursor, true), type = view.getUint32(cursor + 4, true); cursor += 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buffer.slice(cursor, cursor + size)));
    if (type === 0x004e4942) binary = buffer.slice(cursor, cursor + size);
    cursor += size;
  }
  if (!binary || !json) throw new Error(`Missing GLB data: ${url}`);
  const bin = new DataView(binary);
  const read = (id: number): number[][] => {
    const a = json.accessors[id], b = json.bufferViews[a.bufferView];
    if (a.sparse) throw new Error('Sparse GLB accessors are not supported.');
    const widths: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const sizes: Record<number, number> = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
    const width = widths[a.type], bytes = sizes[a.componentType];
    if (!width || !bytes) throw new Error('Unsupported GLB accessor.');
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, j) => {
      const offset = (b.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (b.byteStride ?? width * bytes) + j * bytes;
      return a.componentType === 5126 ? bin.getFloat32(offset, true) : a.componentType === 5125 ? bin.getUint32(offset, true) : a.componentType === 5123 ? bin.getUint16(offset, true) : bin.getUint8(offset);
    }));
  };
  const parts: GeometryData[] = [];
  const walk = (id: number, parent: mat4) => {
    const node = json.nodes[id], local = node.matrix ? mat4.clone(node.matrix) : mat4.fromRotationTranslationScale(mat4.create(), node.rotation ?? [0, 0, 0, 1], node.translation ?? [0, 0, 0], node.scale ?? [1, 1, 1]);
    const transform = mat4.multiply(mat4.create(), parent, local), normalMatrix = mat4.transpose(mat4.create(), mat4.invert(mat4.create(), transform)!);
    if (node.mesh !== undefined) for (const p of json.meshes[node.mesh].primitives) {
      if (p.mode !== undefined && p.mode !== 4) throw new Error('Only triangle GLB primitives are supported.');
      const positions = read(p.attributes.POSITION), normals = read(p.attributes.NORMAL), uv = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : positions.map(() => [0, 0]);
      const vertices: number[] = [];
      for (let i = 0; i < positions.length; i++) {
        const position = vec3.transformMat4(vec3.create(), positions[i] as [number, number, number], transform);
        const n = normals[i], normal = vec3.normalize(vec3.create(), [normalMatrix[0] * n[0] + normalMatrix[4] * n[1] + normalMatrix[8] * n[2], normalMatrix[1] * n[0] + normalMatrix[5] * n[1] + normalMatrix[9] * n[2], normalMatrix[2] * n[0] + normalMatrix[6] * n[1] + normalMatrix[10] * n[2]]);
        vertices.push(...position, ...normal, ...uv[i], 0, 0, 0, 0, 0, 0, 0, 0);
      }
      const indices = p.indices !== undefined ? new Uint32Array(read(p.indices).flat()) : Uint32Array.from({ length: positions.length }, (_, i) => i);
      parts.push({ vertices: new Float32Array(vertices), indices, material: json.materials?.[p.material]?.name ?? 'oak-bark' });
    }
    for (const child of node.children ?? []) walk(child, transform);
  };
  for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, mat4.create());
  return parts;
}
