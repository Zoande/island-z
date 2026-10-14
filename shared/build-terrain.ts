import type {BuildScene} from './build-scene';
import type {WorldGenerator} from './world';
import {BASE_CHUNK,VERTEX_FLOATS,type ChunkData} from './mesh';
import {stitchedVertices} from './stitch';
import type {Point3} from './rocks';
import {orientation,rotate} from './placement';
/** Maximum terrain lowering allowed beneath a build floor. */
export const FLOOR_MAX_GRADE_DEPTH=1.25;
export function floorPlaneHeight(position:Point3,normal:Point3,x:number,z:number):number {
  const ny=Math.sign(normal[1]||1)*Math.max(.1,Math.abs(normal[1]));
  return position[1]-(normal[0]*(x-position[0])+normal[2]*(z-position[2]))/ny;
}
export function floorFootprintContains(position:Point3,normal:Point3,rotation:number,width:number,depth:number,x:number,z:number):boolean {
  const q=orientation(normal,rotation),corners=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]].map(([u,v])=>{const p=rotate([u,0,v],q);return [position[0]+p[0],position[2]+p[2]] as [number,number];});
  let inside=false;for(let i=0,j=corners.length-1;i<corners.length;j=i++){const [xi,zi]=corners[i],[xj,zj]=corners[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;}
  return inside;
}
/** Grade before stitching. Fine boundary vertices interpolate the exact same
 * graded coarse samples, including floors that straddle a chunk boundary. */
export function gradedChunk(scene:BuildScene|undefined,world:WorldGenerator,data:ChunkData,neighbours:number[]):Float32Array {
  if(!scene?.gradingSignature(data.x,data.z,BASE_CHUNK*2**data.level))return stitchedVertices(world,data,neighbours);
  const source=data.vertices.slice();
  for(let i=0;i<source.length;i+=VERTEX_FLOATS){const x=data.x+source[i],z=data.z+source[i+2],raw=world.height(x,z),delta=scene.grade(x,z,raw)-raw;if(delta){source[i+1]+=delta;source.set(scene.terrain(x,z).normal,i+3);}}
  const sampling={sample:(x:number,z:number)=>{const a=world.sample(x,z);return {...a,height:scene.grade(x,z,a.height),normal:scene.terrain(x,z).normal};}};
  return stitchedVertices(sampling,data,neighbours,source);
}
