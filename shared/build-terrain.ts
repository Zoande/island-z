import type {BuildScene} from './build-scene';
import type {WorldGenerator} from './world';
import {BASE_CHUNK,VERTEX_FLOATS,type ChunkData} from './mesh';
import {stitchedVertices} from './stitch';
/** Grade before stitching. Fine boundary vertices interpolate the exact same
 * graded coarse samples, including floors that straddle a chunk boundary. */
export function gradedChunk(scene:BuildScene|undefined,world:WorldGenerator,data:ChunkData,neighbours:number[]):Float32Array {
  if(!scene?.gradingSignature(data.x,data.z,BASE_CHUNK*2**data.level))return stitchedVertices(world,data,neighbours);
  const source=data.vertices.slice();
  for(let i=0;i<source.length;i+=VERTEX_FLOATS){const x=data.x+source[i],z=data.z+source[i+2],raw=world.height(x,z),delta=scene.grade(x,z,raw)-raw;if(delta){source[i+1]+=delta;source.set(scene.terrain(x,z).normal,i+3);}}
  const sampling={sample:(x:number,z:number)=>{const a=world.sample(x,z);return {...a,height:scene.grade(x,z,a.height),normal:scene.terrain(x,z).normal};}};
  return stitchedVertices(sampling,data,neighbours,source);
}
