import {objectDefinition,objectRegistry,type BuildObject} from './object-registry';
import {orientation,rotate} from './placement';
import {ROCK_RINGS,ROCK_SEGMENTS,type Point3} from './rocks';
import type {Prop} from './world';
import {solidSource,SparseVolume,emptyVolume,type SolidPrimitive,type SolidSource,type VolumeState,type EditBrush} from './volume';
import {OPENINGS} from './build-parts';

export const DESTRUCTION={reach:4,intervalMs:250,playerPower:1,repairRadius:.16,repairDepth:.12,version:1};
export interface SolidRecord {id:string;prop:Prop;source:SolidSource;volume:VolumeState;revision:number;removed?:boolean;object?:BuildObject;opening?:'door'|'window';fragmentOf?:string;fragmentBounds?:[Point3,Point3];pose?:{position:Point3;rotation:[number,number,number,number]};fall?:{velocity:Point3;angular:Point3;started:number;settled?:number;persistent:boolean;split?:boolean;impactSpeed?:number};}
export interface WorldAction {action:'cut'|'repair'|'dismantle';requestId:string;worldKey:string;sessionId:string;targetId:string;targetRevision:number;eye:Point3;direction:Point3;feet:Point3;prediction?:string}
export interface WorldPatch {revision:number;actionId?:string;solids:SolidRecord[];removedBuilds:string[];leveling:BuildObject[];openings:{id:string;kind:'door'|'window'|null}[]}
export type ActionResult={ok:true;patch:WorldPatch;requestId:string}|{ok:false;code:string;error:string};
export type ActionAcknowledgement={ok:true;requestId:string;ack:{revision:number;targetId:string;targetRevision:number;prediction:string}};
export type ActionReply=ActionResult|ActionAcknowledgement;
/** A comparison hint only: authority still derives and validates the edit.
 * Canonical brick order makes the digest independent of generation order. */
export function predictionDigest(record:SolidRecord):string{
  const state=record.volume,text=JSON.stringify([record.revision,record.opening??null,!!record.removed,Object.keys(state.bricks).sort().map(k=>[k,state.bricks[k]]),state.clips??[],state.mask?Object.keys(state.mask).sort().map(k=>[k,state.mask![k]]):null]);
  let a=2166136261,b=2246822519;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489917);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export function predictionReply(result:ActionResult,hint?:string):ActionReply{
  if(!result.ok||!hint)return result;const p=result.patch,r=p.solids[0];
  if(p.solids.length!==1||p.removedBuilds.length||p.leveling.length||p.openings.length||r.removed||r.fall||predictionDigest(r)!==hint)return result;
  return {ok:true,requestId:result.requestId,ack:{revision:p.revision,targetId:r.id,targetRevision:r.revision,prediction:hint}};
}
export interface TreeSolidAsset {version:1;primitives:SolidPrimitive[];visualPrimitives?:SolidPrimitive[];foliageAnchors:Point3[]}
export const treeSolidAssets=new Map<string,TreeSolidAsset>();
const naturalIds=new WeakMap<Prop,{kind:Prop['kind'];x:number;z:number;id:string}>();
export function naturalId(p:Prop){const cached=naturalIds.get(p);if(cached&&cached.kind===p.kind&&cached.x===p.x&&cached.z===p.z)return cached.id;const id=`natural:${p.kind}:${p.x.toFixed(8)}:${p.z.toFixed(8)}`;naturalIds.set(p,{kind:p.kind,x:p.x,z:p.z,id});return id;}
export const isTree=(p:Prop)=>p.kind==='oak'||p.kind==='birch'||p.kind==='palm';
export function destructionRule(p:Prop){return isTree(p)?objectDefinition('tree').destruction!:objectRegistry.get(p.kind)?.destruction;}
export function quaternion(r:Pick<SolidRecord,'prop'|'pose'>):[number,number,number,number]{return r.pose?.rotation??orientation(r.prop.normal??[0,1,0],r.prop.rotation);}
export function localPoint(r:Pick<SolidRecord,'prop'|'pose'>,p:Point3):Point3{const q=quaternion(r),o=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z],v=rotate(p.map((n,i)=>(n-o[i])/r.prop.scale)as Point3,[-q[0],-q[1],-q[2],q[3]]);return v;}
export function worldPoint(r:Pick<SolidRecord,'prop'|'pose'>,p:Point3):Point3{const v=rotate(p.map(n=>n*r.prop.scale)as Point3,quaternion(r)),o=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z];return v.map((n,i)=>n+o[i])as Point3;}
export function localDirection(r:Pick<SolidRecord,'prop'|'pose'>,p:Point3):Point3{const q=quaternion(r);return rotate(p,[-q[0],-q[1],-q[2],q[3]]);}
export function sourceFor(prop:Prop,rocks:Point3[][]):SolidSource {
  const d=objectRegistry.get(prop.kind),w=d?.wall,s=d?.slab;
  if(w){if(prop.kind==='wall-log'){const primitives:SolidPrimitive[]=[{type:'box',center:[0,w.height/2,0],half:[w.width/2,w.height/2,.02],material:'oak-bark'}];for(let y=.12;y<w.height;y+=.24)primitives.push({type:'cylinder',a:[-1.5,y,0],b:[1.5,y,0],r0:.15,r1:.15,material:'oak-bark'});return solidSource(primitives);}return solidSource([{type:'box',center:[0,w.height/2,0],half:[w.width/2,w.height/2,w.depth/2],material:d.material??prop.kind}]);}
  if(s)return solidSource([{type:'box',center:[0,s.height/2,0],half:[s.width/2,s.height/2,s.depth/2],material:d!.material!}]);
  if(isTree(prop)){const asset=treeSolidAssets.get(`${prop.kind}-${prop.variant}`);if(!asset)throw new Error(`Missing solid asset ${prop.kind}-${prop.variant}`);return solidSource(asset.primitives);}
  if(prop.kind==='rock'){
    const points=rocks[prop.variant],planes:number[][]=[];
    for(let r=0;r<ROCK_RINGS;r++)for(let j=0;j<ROCK_SEGMENTS;j++){const a=r*(ROCK_SEGMENTS+1)+j,b=a+1,c=a+ROCK_SEGMENTS+1;for(const ids of [[a,b,c],[b,c+1,c]]){const p=points[ids[0]],u=points[ids[1]].map((v,k)=>v-p[k]),v=points[ids[2]].map((v,k)=>v-p[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);if(l<1e-8)continue;let normal=n.map(v=>v/l);if(normal.reduce((s,v,i)=>s+v*p[i],0)<0)normal=normal.map(v=>-v);const offset=Math.max(...points.map(p=>normal.reduce((s,v,i)=>s+v*p[i],0)));if(!planes.some(v=>normal.reduce((s,n,i)=>s+n*v[i],0)>.9999))planes.push([...normal,offset]);}}
    return solidSource([{type:'planes',planes,bounds:[[0,1,2].map(i=>Math.min(...points.map(p=>p[i])))as Point3,[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))as Point3],material:'rock'}]);
  }
  if(d?.boxes)return solidSource(d.boxes.map(b=>({type:'box',center:b.center,half:b.size.map(v=>v/2)as Point3,material:d.material??'wall-wood'})));
  const f=d?.fixture;if(f)return solidSource([{type:'box',center:[0,f.height/2,0],half:[f.radius,f.height/2,f.radius],material:'wall-wood'}]);
  throw new Error('Object is not destructible');
}
export function recordFor(id:string,prop:Prop,rocks:Point3[][],object?:BuildObject):SolidRecord{const r:SolidRecord={id,prop:{...prop},source:sourceFor(prop,rocks),volume:emptyVolume(),revision:0,object,opening:prop.aperture};if(r.opening){const v=new SparseVolume(r.source);v.edit(openingBrush(r,r.opening));r.volume=v.state;}return r;}
export function openingBrush(record:SolidRecord,kind:'door'|'window'):EditBrush{const o=OPENINGS[kind],w=objectDefinition(record.prop.kind).wall!;return {center:[0,o.bottom+o.height/2,0],axis:[0,0,1],radius:0,depth:0,seed:0,box:[o.width/2,o.height/2,w.depth]};}
export function actionBrush(record:SolidRecord,point:Point3,direction:Point3,repair:boolean,seed:number):EditBrush{
  const rule=destructionRule(record.prop)!,power=Math.cbrt(DESTRUCTION.playerPower),hardness=rule.hardness,scale=record.prop.scale;
  const axis=localDirection(record,direction);let center=localPoint(record,point);
  if(repair){const volume=new SparseVolume(record.source,record.volume);for(let i=0;i<240;i++){const p=center.map((v,k)=>v+axis[k]*i*.0125/scale)as Point3;if(volume.base(p)<=.002&&volume.distance(p)>volume.base(p)+.003){center=p.map((v,k)=>v-axis[k]*.0125/scale)as Point3;break;}}}
  return {center,axis,radius:(repair?DESTRUCTION.repairRadius:.12*power/Math.sqrt(hardness))/scale,depth:(repair?DESTRUCTION.repairDepth:.1*power/hardness)/scale,seed};
}
export function volumeRay(record:SolidRecord,eye:Point3,direction:Point3,limit:number,original=false){if(record.removed)return null;const volume=new SparseVolume(record.source,original?emptyVolume():record.volume,true),hit=volume.ray(localPoint(record,eye),localDirection(record,direction),limit/record.prop.scale);return hit?{point:worldPoint(record,hit.point),normal:rotate(hit.normal,quaternion(record)),distance:hit.distance*record.prop.scale}:null;}
export function validAction(value:unknown):value is WorldAction {const a=value as WorldAction,v=(p:unknown):p is Point3=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e8);return !!a&&['cut','repair','dismantle'].includes(a.action)&&typeof a.requestId==='string'&&a.requestId.length>=8&&a.requestId.length<=100&&typeof a.sessionId==='string'&&a.sessionId.length<=100&&typeof a.worldKey==='string'&&(a.prediction===undefined||typeof a.prediction==='string'&&/^[0-9a-f]{16}$/.test(a.prediction))&&typeof a.targetId==='string'&&a.targetId.length<=150&&Number.isInteger(a.targetRevision)&&a.targetRevision>=0&&v(a.eye)&&v(a.feet)&&v(a.direction)&&Math.abs(Math.hypot(...a.direction)-1)<.001&&Math.hypot(...a.eye.map((n,i)=>n-a.feet[i]))<2.5;}

export function brushSeed(id:string){let n=2166136261;for(let i=0;i<id.length;i++)n=Math.imul(n^id.charCodeAt(i),16777619);return n>>>0;}
