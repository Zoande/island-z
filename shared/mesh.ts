import type { WorldGenerator, Prop } from './world';
import { waterGeometry, type WaterGeometry } from './water-mesh';
export const GRID = 32;
export const BASE_CHUNK = 64;
export const VERTEX_FLOATS = 16;
export interface ChunkRequest { key: string; x: number; z: number; level: number }
export interface ChunkData extends ChunkRequest { vertices: Float32Array; indices: Uint32Array; props: Prop[]; minHeight: number; maxHeight: number; water: WaterGeometry; timings?:Record<string,number> }
export function generateChunk(world: WorldGenerator, request: ChunkRequest,profile=false): ChunkData {
  const started=profile?performance.now():0;
  const extent = BASE_CHUNK * 2 ** request.level, step = extent / GRID;
  const surfaceVertexCount=(GRID+1)**2, skirtVertexCount=4*(GRID+1);
  const vertices = new Float32Array((surfaceVertexCount+skirtVertexCount)*VERTEX_FLOATS);
  const exactHeights=new Float64Array(surfaceVertexCount);
  const indices = new Uint32Array(GRID*GRID*6+4*GRID*6);
  let vertexOffset=0,indexOffset=0;
  let minHeight = Infinity, maxHeight = -Infinity;
  const vertex = (x: number, z: number) => {
    const sample = world.sample(request.x + x, request.z + z), h = sample.height;
    exactHeights[vertexOffset/VERTEX_FLOATS]=h;
    minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
    vertices[vertexOffset++]=x;vertices[vertexOffset++]=h;vertices[vertexOffset++]=z;
    vertices[vertexOffset++]=sample.normal[0];vertices[vertexOffset++]=sample.normal[1];vertices[vertexOffset++]=sample.normal[2];
    vertices[vertexOffset++]=x;vertices[vertexOffset++]=z;
    for(const weight of sample.weights)vertices[vertexOffset++]=weight;
  };
  for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) vertex(x * step, z * step);
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const a = z * (GRID + 1) + x, b = a + 1, c = a + GRID + 1, d = c + 1;
    indices[indexOffset++]=a;indices[indexOffset++]=c;indices[indexOffset++]=b;
    indices[indexOffset++]=b;indices[indexOffset++]=c;indices[indexOffset++]=d;
  }
  // Edge skirts hide mismatched tessellation without moving shared surface samples.
  // Stitching handles LOD gaps; shallow skirts only cover transient roundoff cracks.
  const skirtDepth = Math.max(1.5, Math.min(8, step * .15));
  const edges = [
    Array.from({ length: GRID + 1 }, (_, i) => i),
    Array.from({ length: GRID + 1 }, (_, i) => i * (GRID + 1) + GRID),
    Array.from({ length: GRID + 1 }, (_, i) => GRID * (GRID + 1) + GRID - i),
    Array.from({ length: GRID + 1 }, (_, i) => (GRID - i) * (GRID + 1)),
  ];
  for (const edge of edges) {
    const bottoms:number[]=[];
    for(const i of edge) {
      const source=i*VERTEX_FLOATS,bottom=vertexOffset/ VERTEX_FLOATS;
      for(let k=0;k<VERTEX_FLOATS;k++)vertices[vertexOffset++]=vertices[source+k];
      const bottomHeight=exactHeights[i]-skirtDepth;
      vertices[bottom*VERTEX_FLOATS+1]=bottomHeight;
      minHeight=Math.min(minHeight,bottomHeight);
      bottoms.push(bottom);
    }
    for (let i = 0; i < GRID; i++) {
      indices[indexOffset++]=edge[i];indices[indexOffset++]=bottoms[i];indices[indexOffset++]=edge[i+1];
      indices[indexOffset++]=edge[i+1];indices[indexOffset++]=bottoms[i];indices[indexOffset++]=bottoms[i+1];
    }
  }
  const meshTime=profile?performance.now():0;
  const props=request.level<=2?world.props(request.x,request.z,extent,request.level===0):request.level<=4?world.treeProps(request.x,request.z,extent):[];
  const propTime=profile?performance.now():0,water=waterGeometry(world.water,request);
  const result:ChunkData={...request,vertices,indices,props,minHeight,maxHeight,water};
  if(profile)result.timings={terrain:meshTime-started,props:propTime-meshTime,water:performance.now()-propTime,total:performance.now()-started};
  return result;
}
