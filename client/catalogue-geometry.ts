import type {GeometryData} from './geometry';
import {objectDefinition} from '../shared/object-registry';
import {torchGeometry} from './torch-geometry';
/** Merge static GLB pieces by their shared material before instancing. */
export function mergeGeometry(parts:GeometryData[]):GeometryData[]{
  const groups=new Map<string,GeometryData[]>();for(const p of parts){let g=groups.get(p.material);if(!g){g=[];groups.set(p.material,g);}g.push(p);}
  return [...groups].map(([material,group])=>{const vertices=new Float32Array(group.reduce((n,p)=>n+p.vertices.length,0)),indices=new Uint32Array(group.reduce((n,p)=>n+p.indices.length,0));let v=0,i=0;for(const p of group){vertices.set(p.vertices,v);for(const index of p.indices)indices[i++]=index+v/16;v+=p.vertices.length;}return {material,vertices,indices};});
}
export function slabGeometry(id:string):GeometryData[]{
  const d=objectDefinition(id),slab=d.slab!,wood=d.material==='wall-wood';
  const parts:GeometryData[]=[];
  // Separate planks/flagstones add small joints without increasing material count.
  const cols=wood?12:4,rows=wood?1:4;
  for(let ix=0;ix<cols;ix++)for(let iz=0;iz<rows;iz++)parts.push(boxGeometry([(ix+.5)*slab.width/cols-slab.width/2,slab.height/2,(iz+.5)*slab.depth/rows-slab.depth/2],[slab.width/cols-.002,slab.height,slab.depth/rows-.002],d.material!));
  return mergeGeometry(parts);
}
/** Distinct workbench geometry built from shared, lit surface materials. */
export function craftingDeskGeometry():GeometryData[]{
  const parts:GeometryData[]=[];
  // Three broad boards make a visibly worked top with narrow seams.
  for(let i=0;i<3;i++)parts.push(boxGeometry([0,.92,(i-1)*.30],[1.65,.14,.298],'wall-wood'));
  for(const x of [-.70,.70])for(const z of [-.34,.34])parts.push(boxGeometry([x,.45,z],[.14,.9,.14],'wall-wood'));
  parts.push(boxGeometry([0,.27,-.34],[1.28,.10,.10],'wall-wood'),boxGeometry([0,.27,.34],[1.28,.10,.10],'wall-wood'));
  parts.push(boxGeometry([-.64,.27,0],[.10,.10,.58],'wall-wood'),boxGeometry([.64,.27,0],[.10,.10,.58],'wall-wood'));
  // Rear tool board and a narrow shelf hold small hand tools above the bench.
  parts.push(boxGeometry([0,1.20,-.38],[1.38,.50,.08],'wall-wood'),boxGeometry([0,1.04,-.25],[1.28,.07,.20],'wall-wood'));
  for(const x of [-.48,-.24,0,.24,.48]){
    parts.push(boxGeometry([x,1.20,-.326],[.045,.23,.025],'iron'));
    parts.push(boxGeometry([x,1.34,-.326],[.13,.045,.035],'iron'));
  }
  // A front vise gives the desk a distinct silhouette and practical detail.
  parts.push(boxGeometry([.48,.91,.49],[.34,.16,.16],'wall-wood'),boxGeometry([.48,.79,.53],[.035,.07,.08],'iron'));
  return mergeGeometry(parts);
}
export function boxGeometry(center:number[],size:number[],material:string):GeometryData {
  const vertices:number[]=[],indices:number[]=[];
  const faces=[[[0,0,1],[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],[[0,0,-1],[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],[[1,0,0],[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],[[-1,0,0],[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]],[[0,1,0],[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],[[0,-1,0],[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]]];
  for(const [normal,points]of faces){const at=vertices.length/16,n=normal as number[],u=n[0]?size[2]:size[0],v=n[1]?size[2]:size[1];for(let i=0;i<4;i++){const p=points[i] as number[];vertices.push(...p.map((v,j)=>center[j]+v*size[j]/2),...n,i===1||i===2?u:0,i>1?0:v,0,0,0,0,0,0,0,0);}indices.push(at,at+1,at+2,at,at+2,at+3);}
  return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material};
}
export function wallTorchGeometry():GeometryData[]{return mergeGeometry([...torchGeometry().map(p=>{const vertices=p.vertices.slice();for(let i=0;i<vertices.length;i+=16){vertices[i+1]=(vertices[i+1]+.14)*.45;vertices[i+2]+=.12;vertices[i+4]/=.45;const length=Math.hypot(vertices[i+3],vertices[i+4],vertices[i+5]);for(let j=3;j<6;j++)vertices[i+j]/=length;}return {...p,vertices};}),boxGeometry([0,.3,.02],[.18,.5,.05],'torch-head')]);}
export function campfireFlames():GeometryData[] {return torchGeometry().filter(p=>p.material==='torch-flame').map(p=>{const vertices=p.vertices.slice();for(let i=0;i<vertices.length;i+=16){vertices[i]*=1.8;vertices[i+1]=(vertices[i+1]-1.6)*1.6+.20;vertices[i+2]*=1.8;}return {...p,vertices};});}
