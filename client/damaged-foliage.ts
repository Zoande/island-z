import type {GeometryData} from './geometry';
import {SparseVolume,type SolidPrimitive} from '../shared/volume';
import {treeSolidAssets,type SolidRecord} from '../shared/destruction';
import type {Point3} from '../shared/rocks';
const owners=new WeakMap<GeometryData,(Point3|null)[]>();
function nearest(p:Point3,primitives:SolidPrimitive[]){let owner:Point3=[0,0,0],best=Infinity,radius=0;for(const s of primitives)if(s.type==='capsule'){const ab=s.b.map((v,k)=>v-s.a[k]),l=ab.reduce((n,v)=>n+v*v,0),t=Math.max(0,Math.min(1,p.reduce((n,v,k)=>n+(v-s.a[k])*ab[k],0)/Math.max(1e-8,l))),q=s.a.map((v,k)=>v+ab[k]*t)as Point3,d=Math.hypot(...p.map((v,k)=>v-q[k])),r=s.r0+(s.r1-s.r0)*t;if(d-r<best){best=d-r;owner=q;radius=r;}}return {owner,radius};}
/** Foliage and visual twigs belong to substantial wood. They follow its
 * component mask/impact clip instead of becoming tiny independent debris. */
export function survivingFoliage(record:SolidRecord,models:GeometryData[]):GeometryData[]{
  const asset=treeSolidAssets.get(`${record.prop.kind}-${record.prop.variant}`);if(!asset)return [];const volume=new SparseVolume(record.source,record.volume),parts:GeometryData[]=[];
  for(const mesh of models.filter(m=>m.material.includes('foliage')||m.material==='coconut'||m.material.endsWith('-bark'))){
    let anchors=owners.get(mesh);if(!anchors){anchors=[];for(let i=0;i<mesh.indices.length;i+=3){const p:Point3=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)p[k]+=mesh.vertices[mesh.indices[i+j]*16+k]/3;const twig=mesh.material.endsWith('-bark');if(twig&&(!asset.visualPrimitives||nearest(p,asset.visualPrimitives).radius>=.06)){anchors.push(null);continue;}anchors.push(nearest(p,asset.primitives).owner);}owners.set(mesh,anchors);}
    const indices:number[]=[];for(let i=0;i<anchors.length;i++)if(anchors[i]&&volume.distance(anchors[i]!)<0)indices.push(mesh.indices[i*3],mesh.indices[i*3+1],mesh.indices[i*3+2]);if(indices.length)parts.push({...mesh,indices:new Uint32Array(indices)});
  }return parts;
}
