import {SparseVolume,primitiveBounds,primitiveDistance,VOXEL_SIZE,type SolidSource,type VolumeState} from './volume';
import type {Point3} from './rocks';
export interface CollisionBox {center:Point3;half:Point3;rotation?:[number,number,number,number]}
/** Greedy row/column coalescing preserves voids. These convex parts are used for
 * dynamic solids; static solids use the extracted surface triangle mesh. */
export function collisionBoxes(source:SolidSource,state:VolumeState,step=.05):CollisionBox[]{
  const volume=new SparseVolume(source,state),rows=new Map<string,Set<number>>();
  for(const primitive of source.primitives){const terrain=primitive.type==='heightfield'&&primitive.terrain,[a,b]=terrain?source.bounds:primitiveBounds(primitive),lo=a.map(v=>Math.floor(v/step)),hi=b.map(v=>Math.ceil(v/step)-(terrain?1:0));for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
    const p:Point3=[(x+.5)*step,(y+.5)*step,(z+.5)*step];if(primitiveDistance(p,primitive)>0)continue;const q=p.map(v=>Math.round(v/VOXEL_SIZE));if(volume.sample(q[0],q[1],q[2])>=0)continue;const key=`${y}:${z}`,row=rows.get(key)??new Set<number>();row.add(x);rows.set(key,row);
  }}
  const runs=new Map<string,{x:number;y:number;z:number;nx:number;ny:number;nz:number}[]>();
  for(const [key,row]of rows){const [y,z]=key.split(':').map(Number),sorted=[...row].sort((a,b)=>a-b);for(let i=0;i<sorted.length;){const x=sorted[i];let j=i+1;while(j<sorted.length&&sorted[j]===sorted[j-1]+1)j++;const nx=j-i,k=`${x}:${nx}:${z}`,r=runs.get(k)??[];r.push({x,y,z,nx,ny:1,nz:1});runs.set(k,r);i=j;}}
  const columns:ReturnType<typeof runs.get>[]=[];for(const row of runs.values()){row.sort((a,b)=>a.y-b.y);const merged:typeof row=[];for(const r of row){const last=merged.at(-1);if(last&&last.y+last.ny===r.y)last.ny++;else merged.push({...r});}columns.push(merged);}
  const spans=new Map<string,NonNullable<ReturnType<typeof runs.get>>>();for(const row of columns)for(const r of row??[]){const key=`${r.x}:${r.nx}:${r.y}:${r.ny}`,list=spans.get(key)??[];list.push(r);spans.set(key,list);}
  const result:CollisionBox[]=[];for(const list of spans.values()){list.sort((a,b)=>a.z-b.z);let current:typeof list[number]|undefined;const emit=()=>{if(current)result.push({center:[(current.x+current.nx/2)*step,(current.y+current.ny/2)*step,(current.z+current.nz/2)*step],half:[current.nx*step/2,current.ny*step/2,current.nz*step/2]});};for(const r of list){if(current&&current.z+current.nz===r.z)current.nz++;else{emit();current={...r};}}emit();}return result;
}
