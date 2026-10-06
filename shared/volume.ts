import {simplifyPlanar} from './planar-mesh';
import type {Point3} from './rocks';

export const VOLUME_VERSION=1, VOXEL_SIZE=.025, BRICK_SIZE=8, DISTANCE_UNIT=.0001;
export type SolidPrimitive={type:'box';center:Point3;half:Point3;material:string}|{type:'capsule'|'cylinder';a:Point3;b:Point3;r0:number;r1:number;material:string;branch?:number}|{type:'planes';planes:number[][];bounds:[Point3,Point3];material:string}|{type:'heightfield';heights:number[];grid:number;spacing:number;bounds:[Point3,Point3];material:string};
export interface SolidSource {version:1;primitives:SolidPrimitive[];bounds:[Point3,Point3]}
export interface VolumeState {version:1;bricks:Record<string,number[]>;clips?:{normal:Point3;offset:number}[];mask?:Record<string,number[]>}
export interface EditBrush {center:Point3;axis:Point3;radius:number;depth:number;seed:number;box?:Point3}
export interface VolumeMesh {vertices:Float32Array;indices:Uint32Array;material:string;prepared?:VolumeMesh[]}
export const emptyVolume=():VolumeState=>({version:1,bricks:{}});
const dot=(a:Point3,b:Point3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function primitiveDistance(p:Point3,s:SolidPrimitive):number {
  if(s.type==='box'){const x=Math.abs(p[0]-s.center[0])-s.half[0],y=Math.abs(p[1]-s.center[1])-s.half[1],z=Math.abs(p[2]-s.center[2])-s.half[2];return Math.hypot(Math.max(0,x),Math.max(0,y),Math.max(0,z))+Math.min(0,Math.max(x,y,z));}
  if(s.type==='planes'){let d=-Infinity;for(const v of s.planes)d=Math.max(d,v[0]*p[0]+v[1]*p[1]+v[2]*p[2]-v[3]);return d;}
  if(s.type==='heightfield'){const u=Math.max(0,Math.min(s.grid-1e-8,(p[0]-s.bounds[0][0])/s.spacing)),v=Math.max(0,Math.min(s.grid-1e-8,(p[2]-s.bounds[0][2])/s.spacing)),x=Math.floor(u),z=Math.floor(v),f=u-x,g=v-z,n=s.grid+1,a=s.heights[z*n+x],b=s.heights[z*n+x+1],c=s.heights[(z+1)*n+x],d=s.heights[(z+1)*n+x+1],h=f+g<=1?a+(b-a)*f+(c-a)*g:b*(1-g)+d*(f+g-1)+c*(1-f),dx=(f+g<=1?b-a:d-c)/s.spacing,dz=(f+g<=1?c-a:d-b)/s.spacing;return Math.max((p[1]-h)/Math.hypot(dx,1,dz),s.bounds[0][1]-p[1],s.bounds[0][0]-p[0],p[0]-s.bounds[1][0],s.bounds[0][2]-p[2],p[2]-s.bounds[1][2]);}
  const x=s.b[0]-s.a[0],y=s.b[1]-s.a[1],z=s.b[2]-s.a[2],px=p[0]-s.a[0],py=p[1]-s.a[1],pz=p[2]-s.a[2],length=Math.hypot(x,y,z),raw=(px*x+py*y+pz*z)/Math.max(1e-12,length*length),t=Math.max(0,Math.min(1,raw));if(s.type==='cylinder'){const radial=Math.hypot(px-x*raw,py-y*raw,pz-z*raw)-(s.r0+(s.r1-s.r0)*t),cap=Math.max(-raw,raw-1)*length;return Math.hypot(Math.max(0,radial),Math.max(0,cap))+Math.min(0,Math.max(radial,cap));}return Math.hypot(px-x*t,py-y*t,pz-z*t)-(s.r0+(s.r1-s.r0)*t);
}
const sourceIndices=new WeakMap<SolidSource,Map<string,SolidPrimitive[]>>();
const localBounds=new WeakMap<SolidSource,[Point3,Point3][]>();
function localSourceDistance(source:SolidSource,p:Point3){
  let bounds=localBounds.get(source);if(!bounds){bounds=source.primitives.map(primitiveBounds);localBounds.set(source,bounds);}
  let d=Infinity;for(let i=0;i<source.primitives.length;i++){const s=source.primitives[i],b=bounds[i];
    // Bounds cull distant closed branches without indexing the entire tree.
    // Plane/heightfield distance functions are conservative rather than exact
    // Euclidean distances, so retain their original evaluation.
    if(s.type!=='planes'&&s.type!=='heightfield'&&Math.max(b[0][0]-p[0],p[0]-b[1][0],b[0][1]-p[1],p[1]-b[1][1],b[0][2]-p[2],p[2]-b[1][2])>Math.max(0,d))continue;
    d=Math.min(d,primitiveDistance(p,s));
  }return d;
}
function sourceIndex(source:SolidSource){let index=sourceIndices.get(source);if(index)return index;index=new Map();for(const primitive of source.primitives){const [a,b]=primitiveBounds(primitive);for(let z=Math.floor((a[2]-.6)/.5);z<=Math.floor((b[2]+.6)/.5);z++)for(let y=Math.floor((a[1]-.6)/.5);y<=Math.floor((b[1]+.6)/.5);y++)for(let x=Math.floor((a[0]-.6)/.5);x<=Math.floor((b[0]+.6)/.5);x++)if(primitiveDistance([(x+.5)*.5,(y+.5)*.5,(z+.5)*.5],primitive)<=1){const k=`${x}:${y}:${z}`,list=index.get(k)??[];list.push(primitive);index.set(k,list);}}sourceIndices.set(source,index);return index;}
export function sourceDistance(source:SolidSource,p:Point3):number {const candidates=source.primitives.length>6?sourceIndex(source).get(`${Math.floor(p[0]/.5)}:${Math.floor(p[1]/.5)}:${Math.floor(p[2]/.5)}`):undefined;let d=Infinity;for(const s of candidates??source.primitives)d=Math.min(d,primitiveDistance(p,s));if(candidates&&d>.5)for(const s of source.primitives)d=Math.min(d,primitiveDistance(p,s));return d;}
export function primitiveBounds(s:SolidPrimitive):[Point3,Point3]{
  if(s.type==='planes'||s.type==='heightfield')return s.bounds;if(s.type==='box')return [s.center.map((v,i)=>v-s.half[i])as Point3,s.center.map((v,i)=>v+s.half[i])as Point3];
  const r=Math.max(s.r0,s.r1);return [s.a.map((v,i)=>Math.min(v,s.b[i])-r)as Point3,s.a.map((v,i)=>Math.max(v,s.b[i])+r)as Point3];
}
export function solidSource(primitives:SolidPrimitive[]):SolidSource {const bounds=primitives.map(primitiveBounds);return {version:1,primitives,bounds:[([0,1,2].map(i=>Math.min(...bounds.map(b=>b[0][i]))))as Point3,([0,1,2].map(i=>Math.max(...bounds.map(b=>b[1][i]))))as Point3]};}
function coordinates(x:number,y:number,z:number){const bx=Math.floor(x/BRICK_SIZE),by=Math.floor(y/BRICK_SIZE),bz=Math.floor(z/BRICK_SIZE);return {key:`${bx}:${by}:${bz}`,index:(z-bz*BRICK_SIZE)*64+(y-by*BRICK_SIZE)*8+x-bx*BRICK_SIZE};}
function quantize(v:number){return Math.max(-32767,Math.min(32767,Math.round(v/DISTANCE_UNIT)));}
function integerHash(x:number,y:number,z:number,seed:number){let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^seed;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;}
export function brushDistance(p:Point3,b:EditBrush):number {
  if(b.box)return primitiveDistance(p,{type:'box',center:b.center,half:b.box,material:''});
  const x=p[0]-b.center[0],y=p[1]-b.center[1],z=p[2]-b.center[2],t=x*b.axis[0]+y*b.axis[1]+z*b.axis[2],radial=Math.hypot(x-b.axis[0]*t,y-b.axis[1]*t,z-b.axis[2]*t);
  // Coherent, integer-seeded chips; identical in workers and Node.
  const jitter=(integerHash(Math.floor(p[0]*32),Math.floor(p[1]*32),Math.floor(p[2]*32),b.seed)-.5)*b.radius*.06;
  const radialDistance=radial-b.radius-jitter,axialDistance=Math.abs(t-b.depth*.45)-b.depth*.55;return Math.hypot(Math.max(0,radialDistance),Math.max(0,axialDistance))+Math.min(0,Math.max(radialDistance,axialDistance));
}
/** Sparse samples are object-local; the source is evaluated only when a sample
 * has not been edited. Bricks have unique ownership, including negative axes. */
export class SparseVolume {
  readonly state:VolumeState;
  constructor(readonly source:SolidSource,state:VolumeState=emptyVolume(),readonly local=false){this.state={version:1,bricks:{...state.bricks},mask:state.mask&&{...state.mask},clips:state.clips?.map(p=>({normal:[...p.normal],offset:p.offset}))};}
  base(p:Point3){let d=this.local?localSourceDistance(this.source,p):sourceDistance(this.source,p);for(const c of this.state.clips??[])d=Math.max(d,dot(p,c.normal)-c.offset);return d;}
  sample(x:number,y:number,z:number){const c=coordinates(x,y,z),brick=this.state.bricks[c.key];let value=brick?brick[c.index]*DISTANCE_UNIT:quantize(this.base([x*VOXEL_SIZE,y*VOXEL_SIZE,z*VOXEL_SIZE]))*DISTANCE_UNIT;for(const plane of this.state.clips??[])value=Math.max(value,quantize(dot([x*VOXEL_SIZE,y*VOXEL_SIZE,z*VOXEL_SIZE],plane.normal)-plane.offset)*DISTANCE_UNIT);if(value<0&&this.state.mask&&!(this.state.mask[c.key]?.[c.index>>>5]&(1<<(c.index&31))))return VOXEL_SIZE*.5;return value;}
  distance(p:Point3):number {
    const q=p.map(v=>v/VOXEL_SIZE),i=q.map(Math.floor),f=q.map((v,k)=>v-i[k]);let value=0;
    for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)value+=this.sample(i[0]+x,i[1]+y,i[2]+z)*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);return value;
  }
  normal(p:Point3):Point3 {const h=VOXEL_SIZE*.5,v=[0,1,2].map(i=>{const a=[...p]as Point3,b=[...p]as Point3;a[i]+=h;b[i]-=h;return this.distance(a)-this.distance(b);}),length=Math.hypot(...v)||1;return v.map(n=>n/length)as Point3;}
  private brick(key:string):number[]{const old=this.state.bricks[key];if(old)return old;const [x,y,z]=key.split(':').map(Number),values=new Array<number>(512);for(let k=0;k<8;k++)for(let j=0;j<8;j++)for(let i=0;i<8;i++)values[k*64+j*8+i]=quantize(this.base([(x*8+i)*VOXEL_SIZE,(y*8+j)*VOXEL_SIZE,(z*8+k)*VOXEL_SIZE]));this.state.bricks[key]=values;return values;}
  edit(brush:EditBrush,repair=false,allowed?:(p:Point3)=>boolean):boolean {
    const extent=brush.box??brush.axis.map(v=>Math.abs(v)*brush.depth+brush.radius+VOXEL_SIZE)as Point3;
    const lo=brush.center.map((v,i)=>Math.floor((v-extent[i]-VOXEL_SIZE)/VOXEL_SIZE)),hi=brush.center.map((v,i)=>Math.ceil((v+extent[i]+VOXEL_SIZE)/VOXEL_SIZE));
    const copied=new Set<string>();let changed=false;
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
      const p:[number,number,number]=[x*VOXEL_SIZE,y*VOXEL_SIZE,z*VOXEL_SIZE],d=brushDistance(p,brush);if(d>VOXEL_SIZE*2||allowed&&!allowed(p))continue;
      const before=this.sample(x,y,z),after=repair?Math.max(this.base(p),Math.min(before,d)):Math.max(before,-d),value=quantize(after);if(value===quantize(before))continue;
      const c=coordinates(x,y,z);if(!copied.has(c.key)){this.state.bricks[c.key]=this.brick(c.key).slice();copied.add(c.key);}this.state.bricks[c.key][c.index]=value;changed=true;
      if(repair&&this.state.mask){if(!copied.has('mask:'+c.key)){this.state.mask[c.key]=(this.state.mask[c.key]??new Array(16).fill(0)).slice();copied.add('mask:'+c.key);}this.state.mask[c.key][c.index>>>5]|=1<<(c.index&31);}
    }
    // A fully repaired brick returns to the implicit source, keeping saves small.
    if(repair)for(const key of copied){if(key.startsWith('mask:'))continue;const old=this.state.bricks[key];delete this.state.bricks[key];const base=this.brick(key);if(base.every((v,i)=>v===old[i]))delete this.state.bricks[key];else this.state.bricks[key]=old;}
    return changed;
  }
  ray(origin:Point3,direction:Point3,limit:number):{distance:number;point:Point3;normal:Point3}|null {
    let t=0,previous=0;
    for(let n=0;n<1200&&t<=limit;n++) {const p=origin.map((v,i)=>v+direction[i]*t)as Point3,d=this.distance(p);if(d<=.001){let low=previous,high=t;for(let i=0;i<10;i++){const m=(low+high)/2;if(this.distance(origin.map((v,k)=>v+direction[k]*m)as Point3)>0)low=m;else high=m;}const distance=(low+high)/2,point=origin.map((v,i)=>v+direction[i]*distance)as Point3;return {distance,point,normal:this.normal(point)};}previous=t;t+=Math.max(.005,Math.min(.15,d*.75));}return null;
  }
}

const CORNERS:Point3[]=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const EDGES=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
/** Solve a regularized Hermite QEF in cell-local coordinates. Pivoted Gaussian
 * elimination and cell constraints prevent ill-conditioned planar explosions. */
function qef(points:Point3[],normals:Point3[]):Point3 {
  const mean=[0,1,2].map(k=>points.reduce((n,p)=>n+p[k],0)/points.length),a=Array.from({length:3},()=>[0,0,0,0]);
  for(let j=0;j<points.length;j++){const n=normals[j],d=dot(n,points[j]);for(let r=0;r<3;r++){for(let c=0;c<3;c++)a[r][c]+=n[r]*n[c];a[r][3]+=n[r]*d;}}
  for(let r=0;r<3;r++){a[r][r]+=.001;a[r][3]+=.001*mean[r];}
  for(let r=0;r<3;r++){let pivot=r;for(let j=r+1;j<3;j++)if(Math.abs(a[j][r])>Math.abs(a[pivot][r]))pivot=j;[a[r],a[pivot]]=[a[pivot],a[r]];const d=a[r][r];if(Math.abs(d)<1e-10)return mean as Point3;for(let c=r;c<4;c++)a[r][c]/=d;for(let j=0;j<3;j++)if(j!==r){const f=a[j][r];for(let c=r;c<4;c++)a[j][c]-=f*a[r][c];}}
  return a.map(r=>Math.max(0,Math.min(1,r[3])))as Point3;
}
type ContourCell={point:Point3;normal:Point3;material:string};
const contourCache=new Map<string,{cells:Map<string,ContourCell>;samples:Map<string,Float32Array>;meshes?:Map<string,VolumeMesh>;cellTiles?:Map<string,string[]>}>();
export function contourCacheStats(){return {templates:contourCache.size,bytes:[...contourCache.values()].reduce((n,v)=>n+v.cells.size*160+v.samples.size*(512*4+80)+[...v.meshes?.values()??[]].reduce((n,m)=>n+[m,...m.prepared??[]].reduce((v,l)=>v+l.vertices.byteLength+l.indices.byteLength,0),0),0)};}
function trimContourCache(){while(contourCache.size>4||contourCache.size>1&&contourCacheStats().bytes>96*1024*1024)contourCache.delete(contourCache.keys().next().value!);}
export const hasContourTemplate=(source:SolidSource)=>contourCache.has(JSON.stringify(source));
/** Prepared immutable Hermite cells and samples. Float64 cell data preserves the
 * exact source surface; Float32 samples match the runtime cache bit for bit. */
export function encodeContourTemplate(source:SolidSource):Uint8Array {
  if(!hasContourTemplate(source))meshVolume(source,emptyVolume());
  const cached=contourCache.get(JSON.stringify(source))!,materials=[...new Set([...cached.cells.values()].map(c=>c.material))];
  const header=new TextEncoder().encode(JSON.stringify({version:2,spacing:VOXEL_SIZE,source,materials,cells:cached.cells.size,samples:cached.samples.size,meshes:[...cached.meshes??[]].map(([key,m])=>({key,material:m.material,levels:[m,...m.prepared??[]].map(l=>({vertices:l.vertices.length,indices:l.indices.length}))}))}));
  let offset=Math.ceil((4+header.length)/8)*8;const bytes=new Uint8Array(offset+cached.cells.size*64+cached.samples.size*2060+[...cached.meshes?.values()??[]].reduce((n,m)=>n+[m,...m.prepared??[]].reduce((v,l)=>v+l.vertices.byteLength+l.indices.byteLength,0),0)),view=new DataView(bytes.buffer);
  view.setUint32(0,header.length,true);bytes.set(header,4);
  for(const [key,cell]of cached.cells){const p=key.split(':').map(Number);for(let k=0;k<3;k++)view.setInt32(offset+k*4,p[k],true);view.setUint32(offset+12,materials.indexOf(cell.material),true);for(let k=0;k<6;k++)view.setFloat64(offset+16+k*8,k<3?cell.point[k]:cell.normal[k-3],true);offset+=64;}
  for(const [key,values]of cached.samples){const p=key.split(':').map(Number);for(let k=0;k<3;k++)view.setInt32(offset+k*4,p[k],true);new Float32Array(bytes.buffer,offset+12,512).set(values);offset+=2060;}
  for(const m of cached.meshes?.values()??[])for(const level of [m,...m.prepared??[]]){bytes.set(new Uint8Array(level.vertices.buffer,level.vertices.byteOffset,level.vertices.byteLength),offset);offset+=level.vertices.byteLength;bytes.set(new Uint8Array(level.indices.buffer,level.indices.byteOffset,level.indices.byteLength),offset);offset+=level.indices.byteLength;}
  return bytes;
}
export function installContourTemplate(source:SolidSource,bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(0,true),header=JSON.parse(new TextDecoder().decode(bytes.subarray(4,4+length)));
  if(header.version!==2||header.spacing!==VOXEL_SIZE||JSON.stringify(header.source)!==JSON.stringify(source))throw new Error('Outdated solid contour template');
  let offset=Math.ceil((4+length)/8)*8;if(offset+header.cells*64+header.samples*2060+header.meshes.reduce((n:number,m:any)=>n+m.levels.reduce((s:number,l:any)=>s+(l.vertices+l.indices)*4,0),0)!==bytes.length)throw new Error('Truncated solid contour template');
  const cells=new Map<string,ContourCell>(),samples=new Map<string,Float32Array>();
  for(let i=0;i<header.cells;i++){const p=[0,1,2].map(k=>view.getInt32(offset+k*4,true)),material=header.materials[view.getUint32(offset+12,true)];cells.set(p.join(':'),{point:[0,1,2].map(k=>view.getFloat64(offset+16+k*8,true))as Point3,normal:[0,1,2].map(k=>view.getFloat64(offset+40+k*8,true))as Point3,material});offset+=64;}
  for(let i=0;i<header.samples;i++){const p=[0,1,2].map(k=>view.getInt32(offset+k*4,true)),values=new Float32Array(512);for(let k=0;k<512;k++)values[k]=view.getFloat32(offset+12+k*4,true);samples.set(p.join(':'),values);offset+=2060;}
  const meshes=new Map<string,VolumeMesh>();for(const m of header.meshes){const levels:VolumeMesh[]=[];for(const l of m.levels){const vertices=new Float32Array(l.vertices),indices=new Uint32Array(l.indices);for(let k=0;k<vertices.length;k++)vertices[k]=view.getFloat32(offset+k*4,true);offset+=vertices.byteLength;for(let k=0;k<indices.length;k++)indices[k]=view.getUint32(offset+k*4,true);offset+=indices.byteLength;levels.push({material:m.material,vertices,indices});}const first=levels.shift()!;if(levels.length)first.prepared=levels;meshes.set(m.key,first);}
  contourCache.set(JSON.stringify(source),{cells,samples,meshes:meshes.size?meshes:undefined});trimContourCache();
}
export function meshVolume(source:SolidSource,state:VolumeState):VolumeMesh[] {
  const cacheKey=JSON.stringify(source),pristine=!Object.keys(state.bricks).length&&!state.mask&&!state.clips?.length;
  if(!pristine&&!contourCache.has(cacheKey))meshVolume(source,emptyVolume());
  const cached=contourCache.get(cacheKey);if(cached&&!cached.cellTiles&&source.primitives.some(p=>p.type==='capsule')){cached.cellTiles=new Map();for(const key of cached.cells.keys()){const tile=key.split(':').map(v=>Math.floor(Number(v)/80)).join(':'),keys=cached.cellTiles.get(tile)??[];keys.push(key);cached.cellTiles.set(tile,keys);}}if(cached){contourCache.delete(cacheKey);contourCache.set(cacheKey,cached);}
  const volume=new SparseVolume(source,state),samples=new Map<string,Float32Array>(),cells=new Map<string,ContourCell>(cached?.cells),surfaceBricks=new Set<string>(),updatedCells=new Set<string>();
  const sample=(x:number,y:number,z:number)=>{const c=coordinates(x,y,z);let brick=samples.get(c.key);if(!brick){brick=new Float32Array(512).fill(NaN);samples.set(c.key,brick);}let d=brick[c.index];if(Number.isNaN(d)){const cachedValue=cached?.samples.get(c.key)?.[c.index];if(!state.bricks[c.key]&&cachedValue!==undefined&&!Number.isNaN(cachedValue)){d=cachedValue;for(const plane of state.clips??[])d=Math.max(d,quantize(dot([x*VOXEL_SIZE,y*VOXEL_SIZE,z*VOXEL_SIZE],plane.normal)-plane.offset)*DISTANCE_UNIT);if(d<0&&state.mask&&!(state.mask[c.key]?.[c.index>>>5]&(1<<(c.index&31))))d=VOXEL_SIZE*.5;}else d=volume.sample(x,y,z);brick[c.index]=d;d=brick[c.index];}return d;};
  const edge=BRICK_SIZE*VOXEL_SIZE;
  if(!cached)for(const primitive of source.primitives){const [a,b]=primitiveBounds(primitive);for(let z=Math.floor(a[2]/edge)-1;z<=Math.floor(b[2]/edge)+1;z++)for(let y=Math.floor(a[1]/edge)-1;y<=Math.floor(b[1]/edge)+1;y++)for(let x=Math.floor(a[0]/edge)-1;x<=Math.floor(b[0]/edge)+1;x++){
    const center:[number,number,number]=[(x+.5)*edge,(y+.5)*edge,(z+.5)*edge];if(Math.abs(primitiveDistance(center,primitive))<=edge*.9)surfaceBricks.add(`${x}:${y}:${z}`);
  }}
  for(const key of Object.keys(state.bricks)){const b=key.split(':').map(Number);for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)surfaceBricks.add(`${b[0]+x}:${b[1]+y}:${b[2]+z}`);}
  if(state.mask)for(const key of cells.keys()){const p=key.split(':').map(Number),current=CORNERS.map(c=>sample(p[0]+c[0],p[1]+c[1],p[2]+c[2]));if(current.every(d=>d>=0)){cells.delete(key);continue;}if(CORNERS.some((corner,i)=>{const c=coordinates(p[0]+corner[0],p[1]+corner[1],p[2]+corner[2]);return (cached?.samples.get(c.key)?.[c.index]??0)<0&&current[i]>=0;}))surfaceBricks.add(p.map(v=>Math.floor(v/8)).join(':'));}

  // Clip planes create new cross-sections, including through a source interior.
  if(state.clips?.length){const [a,b]=source.bounds;for(let z=Math.floor(a[2]/edge)-1;z<=Math.floor(b[2]/edge)+1;z++)for(let y=Math.floor(a[1]/edge)-1;y<=Math.floor(b[1]/edge)+1;y++)for(let x=Math.floor(a[0]/edge)-1;x<=Math.floor(b[0]/edge)+1;x++){const p:[number,number,number]=[(x+.5)*edge,(y+.5)*edge,(z+.5)*edge];if(state.clips.some(c=>Math.abs(dot(p,c.normal)-c.offset)<=edge*.9)&&sourceDistance(source,p)<edge)surfaceBricks.add(`${x}:${y}:${z}`);}}
  for(const key of surfaceBricks){const [bx,by,bz]=key.split(':').map(v=>Number(v)*8);for(let z=bz;z<bz+8;z++)for(let y=by;y<by+8;y++)for(let x=bx;x<bx+8;x++){
    cells.delete(`${x}:${y}:${z}`);const d=CORNERS.map(c=>sample(x+c[0],y+c[1],z+c[2]));if(d.every(v=>v>=0)||d.every(v=>v<0))continue;
    const gradient=(p:Point3):Point3=>{const [u,v,w]=p,n=[(d[1]-d[0])*(1-v)*(1-w)+(d[3]-d[2])*v*(1-w)+(d[5]-d[4])*(1-v)*w+(d[7]-d[6])*v*w,(d[2]-d[0])*(1-u)*(1-w)+(d[3]-d[1])*u*(1-w)+(d[6]-d[4])*(1-u)*w+(d[7]-d[5])*u*w,(d[4]-d[0])*(1-u)*(1-v)+(d[5]-d[1])*u*(1-v)+(d[6]-d[2])*(1-u)*v+(d[7]-d[3])*u*v],l=Math.hypot(...n)||1;return n.map(v=>v/l)as Point3;};
    const points:Point3[]=[],normals:Point3[]=[];for(const [i,j]of EDGES)if((d[i]<0)!==(d[j]<0)){const t=d[i]/(d[i]-d[j]),p=CORNERS[i].map((v,k)=>v+(CORNERS[j][k]-v)*t)as Point3;points.push(p);normals.push(gradient(p));}
    const q=qef(points,normals),point=q.map((v,k)=>(v+[x,y,z][k])*VOXEL_SIZE)as Point3;let closest=source.primitives[0],distance=Infinity;for(const primitive of (source.primitives.length>6?sourceIndex(source).get(`${Math.floor(point[0]/.5)}:${Math.floor(point[1]/.5)}:${Math.floor(point[2]/.5)}`):undefined)??source.primitives){const n=Math.abs(primitiveDistance(point,primitive));if(n<distance){distance=n;closest=primitive;}}
    const normal=gradient(q);updatedCells.add(`${x}:${y}:${z}`);cells.set(`${x}:${y}:${z}`,{point,normal,material:closest.material.endsWith("-bark")&&sourceDistance(source,point)<-.02?"wood-interior":closest.material});
  }}
  if(state.clips?.length)for(const [key,c]of cells)if(state.clips.some(p=>dot(c.point,p.normal)>p.offset+.025))cells.delete(key);
  if(pristine&&!cached){contourCache.set(cacheKey,{cells:new Map(cells),samples:new Map(samples)});trimContourCache();}
  const tiled=source.primitives.some(p=>p.type==='capsule'),reusable=tiled&&cached?.meshes&&!state.mask&&!state.clips?.length,dirtyTiles=new Set<string>();
  if(reusable)for(const key of surfaceBricks){const b=key.split(':').map(Number);dirtyTiles.add(b.map(v=>Math.floor(v/10)).join(':'));}
  const groups=new Map<string,{material:string;vertices:number[];indices:number[];map:Map<string,number>}>();let tile='';
  const quad=(keys:string[],inside:boolean)=>{const c=keys.map(k=>cells.get(k));if(c.some(v=>!v))return;const material=c[0]!.material,groupKey=tiled?tile+'/'+material:material;let g=groups.get(groupKey);if(!g){g={material,vertices:[],indices:[],map:new Map()};groups.set(groupKey,g);}const ids=keys.map((k,i)=>{let id=g!.map.get(k);if(id===undefined){id=g!.vertices.length/16;g!.map.set(k,id);const v=c[i]!;const n=v.normal,axis=Math.abs(n[1])>=Math.max(Math.abs(n[0]),Math.abs(n[2]))?1:Math.abs(n[0])>Math.abs(n[2])?0:2;const uv=axis===1?[v.point[0],v.point[2]]:axis===0?[v.point[2],v.point[1]]:[v.point[0],v.point[1]];g!.vertices.push(...v.point,...n,...uv,0,0,0,0,0,0,0,0);}return id;});if(inside)g.indices.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);else g.indices.push(ids[0],ids[2],ids[1],ids[0],ids[3],ids[2]);};
  const assemblyKeys=reusable?new Set([...dirtyTiles].flatMap(tile=>cached!.cellTiles?.get(tile)??[]).concat([...updatedCells])):cells.keys();
  for(const key of assemblyKeys){if(!cells.has(key))continue;const [x,y,z]=key.split(':').map(Number);tile=[x,y,z].map(v=>Math.floor(v/80)).join(':');if(reusable&&!dirtyTiles.has(tile))continue;const d=sample(x,y,z);
    if((d<0)!==(sample(x+1,y,z)<0))quad([`${x}:${y-1}:${z-1}`,`${x}:${y}:${z-1}`,key,`${x}:${y-1}:${z}`],d<0);
    if((d<0)!==(sample(x,y+1,z)<0))quad([`${x-1}:${y}:${z-1}`,`${x-1}:${y}:${z}`,key,`${x}:${y}:${z-1}`],d<0);
    if((d<0)!==(sample(x,y,z+1)<0))quad([`${x-1}:${y-1}:${z}`,`${x}:${y-1}:${z}`,key,`${x-1}:${y}:${z}`],d<0);
  }
  const output=new Map<string,VolumeMesh>(reusable?cached!.meshes:undefined);if(reusable)for(const key of output.keys())if(dirtyTiles.has(key.split('/')[0]))output.delete(key);
  for(const [key,g]of groups){const material=g.material;const indices=simplifyPlanar(g.vertices,g.indices),remap=new Map<number,number>(),vertices:number[]=[];for(let i=0;i<indices.length;i++){const old=indices[i];let id=remap.get(old);if(id===undefined){id=vertices.length/16;remap.set(old,id);for(let k=0;k<16;k++)vertices.push(g.vertices[old*16+k]);}indices[i]=id;}output.set(key,{material,vertices:new Float32Array(vertices),indices:new Uint32Array(indices)});}
  if(pristine&&tiled){contourCache.get(cacheKey)!.meshes=output;}return [...output.values()];
}

export type VolumeRegion=[Point3,Point3];
function localGradient(d:Float32Array,u:number,v:number,w:number):Point3{
  const x=(d[1]-d[0])*(1-v)*(1-w)+(d[3]-d[2])*v*(1-w)+(d[5]-d[4])*(1-v)*w+(d[7]-d[6])*v*w,
    y=(d[2]-d[0])*(1-u)*(1-w)+(d[3]-d[1])*u*(1-w)+(d[6]-d[4])*(1-u)*w+(d[7]-d[5])*u*w,
    z=(d[4]-d[0])*(1-u)*(1-v)+(d[5]-d[1])*u*(1-v)+(d[6]-d[2])*(1-u)*v+(d[7]-d[3])*u*v,l=Math.hypot(x,y,z)||1;return [x/l,y/l,z/l];
}
/** The same regularized QEF as the full mesher, accumulated without per-edge
 * point lists or nested matrices on the input event's critical path. */
function localQef(d:Float32Array):Point3{
  let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0,bx=0,by=0,bz=0,mx=0,my=0,mz=0,count=0;
  for(let i=0;i<12;i++){const [a,b]=EDGES[i];if((d[a]<0)===(d[b]<0))continue;const t=d[a]/(d[a]-d[b]),ca=CORNERS[a],cb=CORNERS[b],u=ca[0]+(cb[0]-ca[0])*t,v=ca[1]+(cb[1]-ca[1])*t,w=ca[2]+(cb[2]-ca[2])*t,n=localGradient(d,u,v,w),h=n[0]*u+n[1]*v+n[2]*w;
    xx+=n[0]*n[0];xy+=n[0]*n[1];xz+=n[0]*n[2];yy+=n[1]*n[1];yz+=n[1]*n[2];zz+=n[2]*n[2];bx+=n[0]*h;by+=n[1]*h;bz+=n[2]*h;mx+=u;my+=v;mz+=w;count++;
  }
  xx+=.001;yy+=.001;zz+=.001;bx+=.001*mx/count;by+=.001*my/count;bz+=.001*mz/count;
  const a=yy*zz-yz*yz,b=xz*yz-xy*zz,c=xy*yz-xz*yy,e=xx*zz-xz*xz,f=xy*xz-xx*yz,g=xx*yy-xy*xy,det=xx*a+xy*b+xz*c;
  if(Math.abs(det)<1e-12)return [mx/count,my/count,mz/count];
  return [Math.max(0,Math.min(1,(a*bx+b*by+c*bz)/det)),Math.max(0,Math.min(1,(b*bx+e*by+f*bz)/det)),Math.max(0,Math.min(1,(c*bx+f*by+g*bz)/det))];
}
/** Native-spacing local surface extraction for interactive predictions. This
 * never builds, copies, or waits for an entire object's contour template. */
export function meshVolumeRegion(source:SolidSource,state:VolumeState,bounds:VolumeRegion,timing?:number[]):VolumeMesh[]{
  const start=performance.now(),lo=bounds[0].map(v=>Math.floor(v/VOXEL_SIZE)-2),hi=bounds[1].map(v=>Math.ceil(v/VOXEL_SIZE)+2),nx=hi[0]-lo[0]+2,ny=hi[1]-lo[1]+2,nz=hi[2]-lo[2]+2,samples=new Float32Array(nx*ny*nz),cells=new Array<ContourCell|undefined>(samples.length);
  // Only primitives within the local surface halo can own a zero crossing.
  // Distant branches need no spatial-index construction on a first hit.
  const primitives=source.primitives.filter(s=>{const b=primitiveBounds(s);return [0,1,2].every(k=>b[0][k]<=hi[k]*VOXEL_SIZE+.1&&b[1][k]>=lo[k]*VOXEL_SIZE-.1);});
  const sampleIndex=(x:number,y:number,z:number)=>(z-lo[2])*ny*nx+(y-lo[1])*nx+x-lo[0];
  // Read each edited brick once rather than allocating a coordinate/key per
  // sample. Unedited samples retain the same quantization as SparseVolume.
  const point:Point3=[0,0,0];
  for(let bz=Math.floor(lo[2]/8);bz<=Math.floor((hi[2]+1)/8);bz++)for(let by=Math.floor(lo[1]/8);by<=Math.floor((hi[1]+1)/8);by++)for(let bx=Math.floor(lo[0]/8);bx<=Math.floor((hi[0]+1)/8);bx++){
    const key=`${bx}:${by}:${bz}`,brick=state.bricks[key],mask=state.mask?.[key];
    for(let z=Math.max(lo[2],bz*8);z<=Math.min(hi[2]+1,bz*8+7);z++)for(let y=Math.max(lo[1],by*8);y<=Math.min(hi[1]+1,by*8+7);y++)for(let x=Math.max(lo[0],bx*8);x<=Math.min(hi[0]+1,bx*8+7);x++){
      const index=(z-bz*8)*64+(y-by*8)*8+x-bx*8;point[0]=x*VOXEL_SIZE;point[1]=y*VOXEL_SIZE;point[2]=z*VOXEL_SIZE;
      let d=Infinity;if(brick)d=brick[index]*DISTANCE_UNIT;else{for(const s of primitives)d=Math.min(d,primitiveDistance(point,s));d=quantize(d)*DISTANCE_UNIT;}
      for(const c of state.clips??[])d=Math.max(d,quantize(dot(point,c.normal)-c.offset)*DISTANCE_UNIT);
      if(d<0&&state.mask&&!((mask?.[index>>>5]??0)&(1<<(index&31))))d=VOXEL_SIZE*.5;
      samples[sampleIndex(x,y,z)]=d;
    }
  }
  const sampled=performance.now();
  const d=new Float32Array(8),offsets=[0,1,nx,nx+1,nx*ny,nx*ny+1,nx*ny+nx,nx*ny+nx+1];
  for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
    const id=sampleIndex(x,y,z);let signs=0;for(let i=0;i<8;i++){d[i]=samples[id+offsets[i]];if(d[i]<0)signs|=1<<i;}if(!signs||signs===255)continue;
    const q=localQef(d),point:Point3=[(q[0]+x)*VOXEL_SIZE,(q[1]+y)*VOXEL_SIZE,(q[2]+z)*VOXEL_SIZE];let closest=primitives[0],distance=Infinity,base=Infinity;for(const primitive of primitives){const signed=primitiveDistance(point,primitive);base=Math.min(base,signed);if(Math.abs(signed)<distance){closest=primitive;distance=Math.abs(signed);}}
    cells[id]={point,normal:localGradient(d,q[0],q[1],q[2]),material:closest.material.endsWith('-bark')&&base<-.02?'wood-interior':closest.material};
  }
  const extracted=performance.now();
  const groups=new Map<string,{vertices:number[];indices:number[]}>();
  const packed=new WeakMap<ContourCell,number[]>(),ids=new Map<string,Map<ContourCell,number>>();
  const pack=(c:ContourCell)=>{let p=packed.get(c);if(p)return p;const n=c.normal,axis=Math.abs(n[1])>=Math.max(Math.abs(n[0]),Math.abs(n[2]))?1:Math.abs(n[0])>Math.abs(n[2])?0:2,uv=axis===1?[c.point[0],c.point[2]]:axis===0?[c.point[2],c.point[1]]:[c.point[0],c.point[1]];p=[...c.point,...n,...uv,0,0,0,0,0,0,0,0];packed.set(c,p);return p;};
  const triangle=(corners:ContourCell[])=>{
    let contained=true;for(let k=0;k<3;k++){const a=corners[0].point[k],b=corners[1].point[k],c=corners[2].point[k];if(Math.max(a,b,c)<bounds[0][k]||Math.min(a,b,c)>bounds[1][k])return;if(Math.min(a,b,c)<bounds[0][k]||Math.max(a,b,c)>bounds[1][k])contained=false;}
    const material=corners[0].material;let group=groups.get(material);if(!group){group={vertices:[],indices:[]};groups.set(material,group);}
    if(contained){let index=ids.get(material);if(!index){index=new Map();ids.set(material,index);}for(const c of corners){let id=index.get(c);if(id===undefined){id=group.vertices.length/16;group.vertices.push(...pack(c));index.set(c,id);}group.indices.push(id);}return;}
    let polygon=corners.map(pack);
    // Clip at the same bounds used to suppress the old skin in the GPU. No
    // duplicate surfaces or holes at overlapping prediction-region edges.
    if(!contained)for(let axis=0;axis<3;axis++)for(const side of [0,1]){const edge=bounds[side][axis],output:number[][]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=(p:number[])=>side?p[axis]<=edge:p[axis]>=edge,ai=inside(a),bi=inside(b);if(ai)output.push(a);if(ai!==bi){const t=(edge-a[axis])/(b[axis]-a[axis]),p=a.map((v,k)=>v+(b[k]-v)*t);p[axis]=edge;output.push(p);}}polygon=output;}
    if(polygon.length<3)return;const first=group.vertices.length/16;for(const p of polygon)group.vertices.push(...p);for(let i=1;i<polygon.length-1;i++)group.indices.push(first,first+i,first+i+1);
  };
  const quad=(ids:number[],inside:boolean)=>{const c=ids.map(k=>cells[k]);if(c.some(v=>!v))return;const order=inside?[0,1,2,0,2,3]:[0,2,1,0,3,2];triangle(order.slice(0,3).map(i=>c[i]!));triangle(order.slice(3).map(i=>c[i]!));};
  for(let z=lo[2]+1;z<hi[2];z++)for(let y=lo[1]+1;y<hi[1];y++)for(let x=lo[0]+1;x<hi[0];x++){const id=sampleIndex(x,y,z),d=samples[id];
    if((d<0)!==(samples[id+1]<0))quad([id-nx-nx*ny,id-nx*ny,id,id-nx],d<0);
    if((d<0)!==(samples[id+nx]<0))quad([id-1-nx*ny,id-1,id,id-nx*ny],d<0);
    if((d<0)!==(samples[id+nx*ny]<0))quad([id-1-nx,id-nx,id,id-1],d<0);
  }
  if(timing)timing.push(sampled-start,extracted-sampled,performance.now()-extracted);
  return [...groups].map(([material,g])=>({material,vertices:new Float32Array(g.vertices),indices:new Uint32Array(g.indices)}));
}
export function brushRegion(brush:EditBrush):VolumeRegion{const extent=brush.box??brush.axis.map(v=>Math.abs(v)*brush.depth*.55+Math.sqrt(Math.max(0,1-v*v))*brush.radius*1.03)as Point3,center=brush.box?brush.center:brush.center.map((v,k)=>v+brush.axis[k]*brush.depth*.45);return [center.map((v,k)=>Math.floor((v-extent[k])/VOXEL_SIZE)*VOXEL_SIZE-VOXEL_SIZE*2)as Point3,center.map((v,k)=>Math.ceil((v+extent[k])/VOXEL_SIZE)*VOXEL_SIZE+VOXEL_SIZE*2)as Point3];}
export function mergeVolumeRegions(regions:VolumeRegion[]):VolumeRegion[]{const output:VolumeRegion[]=[];for(const region of regions){let current:VolumeRegion=region.map(p=>[...p])as VolumeRegion;for(let i=0;i<output.length;){const other=output[i];if([0,1,2].every(k=>current[0][k]<=other[1][k]&&current[1][k]>=other[0][k])){current=[[0,1,2].map(k=>Math.min(current[0][k],other[0][k]))as Point3,[0,1,2].map(k=>Math.max(current[1][k],other[1][k]))as Point3];output.splice(i,1);i=0;}else i++;}output.push(current);}return output;}
