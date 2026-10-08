import type {Point3} from './rocks';
import type {MeshSurface} from './placement';
import type {SolidRecord} from './destruction';
import {emptyVolume,meshVolumeRegion,primitiveDistance,type SolidSource,type SolidPrimitive,type VolumeMesh,type EditBrush,brushRegion} from './volume';

/** One metre ownership cells, allocated only after a cut. The distance field
 * continues through cell faces; bounds restrict meshing/collision, not density. */
export const TERRAIN_CELL=1;
export const terrainId=(p:Point3)=>`terrain:${p.map(v=>Math.floor(v/TERRAIN_CELL)).join(':')}`;
export const isTerrainSource=(source:SolidSource)=>source.primitives.some(p=>p.type==='heightfield'&&p.terrain);
export function terrainRecord(point:Point3,surface:(x:number,z:number)=>MeshSurface,weights:(x:number,z:number)=>number[]):SolidRecord {
  const origin=point.map(v=>Math.floor(v/TERRAIN_CELL)*TERRAIN_CELL)as Point3;
  // Align samples with the existing global two metre terrain triangles, with a
  // halo for contour gradients and mirrored edits on neighbouring cell faces.
  const x=Math.floor(origin[0]/2)*2-2,z=Math.floor(origin[2]/2)*2-2,heights:number[]=[],layers:number[][]=[];
  for(let iz=0;iz<=3;iz++)for(let ix=0;ix<=3;ix++){heights.push(surface(x+ix*2,z+iz*2).height-origin[1]);layers.push(weights(x+ix*2,z+iz*2));}
  const field:SolidPrimitive={type:'heightfield',terrain:true,heights,weights:layers,grid:3,spacing:2,bounds:[[x-origin[0],-2,z-origin[2]],[x-origin[0]+6,Math.max(3,...heights),z-origin[2]+6]],material:'terrain'};
  return {id:terrainId(point),prop:{kind:'terrain',x:origin[0],y:origin[1],z:origin[2],scale:1,rotation:0,variant:0},source:{version:1,primitives:[field],bounds:[[0,0,0],[TERRAIN_CELL,TERRAIN_CELL,TERRAIN_CELL]]},volume:emptyVolume(),revision:0};
}
/** Include the contour/sample halo, so both sides of every seam see the same
 * cuts. Seeded roughness is evaluated in world coordinates, also across seams. */
export function terrainCutCells(record:SolidRecord,brush:EditBrush):Point3[]{
  const bounds=brushRegion(brush),origin=[record.prop.x,record.prop.y,record.prop.z],lo=bounds[0].map((v,k)=>Math.floor((v+origin[k]-.1)/TERRAIN_CELL)),hi=bounds[1].map((v,k)=>Math.floor((v+origin[k]+.1)/TERRAIN_CELL)),cells:Point3[]=[];
  for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)cells.push([x*TERRAIN_CELL,y*TERRAIN_CELL,z*TERRAIN_CELL]);
  return cells;
}
export function terrainMeshes(source:SolidSource,state:SolidRecord['volume']):VolumeMesh[]{
  return shadeTerrainMeshes(source,meshVolumeRegion(source,state,source.bounds));
}
export function shadeTerrainMeshes(source:SolidSource,meshes:VolumeMesh[]):VolumeMesh[]{
  const field=source.primitives[0];if(field.type!=='heightfield'||!field.terrain)return meshes;
  for(const mesh of meshes)for(let i=0;i<mesh.vertices.length;i+=16){
    const p:Point3=[mesh.vertices[i],mesh.vertices[i+1],mesh.vertices[i+2]],depth=-primitiveDistance(p,field);
    // A thin local surface skin; mountain interiors are stone at every altitude.
    const rock=Math.max(0,Math.min(1,(depth-.12)/.12));
    const u=Math.max(0,Math.min(field.grid-1e-8,(p[0]-field.bounds[0][0])/field.spacing)),v=Math.max(0,Math.min(field.grid-1e-8,(p[2]-field.bounds[0][2])/field.spacing)),x=Math.floor(u),z=Math.floor(v),f=u-x,g=v-z,n=field.grid+1;
    const ids=f+g<=1?[z*n+x,z*n+x+1,(z+1)*n+x]:[z*n+x+1,(z+1)*n+x+1,(z+1)*n+x],blend=f+g<=1?[1-f-g,f,g]:[1-g,f+g-1,1-f];
    for(let k=0;k<8;k++)mesh.vertices[i+8+k]=(1-rock)*ids.reduce((sum,id,j)=>sum+(field.weights?.[id]?.[k]??(k===1?1:0))*blend[j],0)+(k===3?rock:0);
  }
  return meshes;
}
