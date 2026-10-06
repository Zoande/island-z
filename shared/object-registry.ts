import type {Prop} from './world';
import type {Point3} from './rocks';

export const OBJECT_SCHEMA_VERSION=1;
export type BuiltKind='wall-wood'|'wall-stone'|'wall-log'|'wall-brick'|'floor-wood'|'floor-stone'|'roof-wood'|'roof-stone'|'torch'|'torch-wall'|'campfire'|'bed'|'table'|'chair'|'door-wood'|'door-reinforced'|'window';
export interface ObjectBox {center:Point3;size:Point3}
export interface ObjectVariant {kind:Prop['kind'];model:number;scale:number}
export interface ObjectDefinition {
  readonly id:string;readonly label:string;readonly family:'rock'|'tree'|'wall'|'fixture'|'floor'|'roof'|'furniture'|'attachment';
  readonly icon:string;readonly variants:readonly ObjectVariant[];
  readonly wall?:{width:number;height:number;depth:number};
  readonly fixture?:{radius:number;height:number};
  readonly light?:{height:number;radius:number;color:readonly[number,number,number];power:number;offset?:readonly[number,number,number]};
  readonly slab?:{width:number;depth:number;height:number};
  readonly boxes?:readonly ObjectBox[];
  readonly asset?:'blender';readonly material?:string;
  readonly attachment?:'door'|'window'|'mount';
  readonly supportSamples?:readonly Point3[];
  readonly destruction?:{mode:'voxel'|'whole';hardness:number;repairable:boolean;tree?:boolean};
}
const definitions:ObjectDefinition[]=[
  {id:'rock',label:'Rock',family:'rock',icon:'rock',variants:[1.25,2.7].flatMap(scale=>Array.from({length:12},(_,model)=>({kind:'rock',model,scale})))},
  {id:'tree',label:'Tree',family:'tree',icon:'tree',variants:[...(['oak','birch']as const).flatMap(kind=>Array.from({length:6},(_,model)=>({kind,model,scale:1}))),...Array.from({length:3},(_,model)=>({kind:'palm' as const,model,scale:1}))]},
  {id:'wall-wood',label:'Wood wall',family:'wall',icon:'wood',variants:[{kind:'wall-wood',model:0,scale:1}],wall:{width:3,height:2.5,depth:.22}},
  {id:'wall-stone',label:'Stone wall',family:'wall',icon:'stone',variants:[{kind:'wall-stone',model:0,scale:1}],wall:{width:3,height:2.5,depth:.32}},
  {id:'torch',label:'Torch',family:'fixture',icon:'torch',variants:[{kind:'torch',model:0,scale:1}],fixture:{radius:.14,height:1.65},light:{height:1.83,radius:18,color:[1,.42,.10],power:70}},
];
const one=(kind:BuiltKind):ObjectVariant[]=>[{kind,model:0,scale:1}];
definitions.push(
  {id:'wall-log',label:'Log wall',family:'wall',icon:'wood',variants:one('wall-log'),wall:{width:3,height:2.5,depth:.34},asset:'blender',material:'oak-bark'},
  {id:'wall-brick',label:'Brick wall',family:'wall',icon:'stone',variants:one('wall-brick'),wall:{width:3,height:2.5,depth:.26},material:'brick'},
  ...(['floor','roof']as const).flatMap(family=>(['wood','stone']as const).map(material=>({id:`${family}-${material}`,label:`${material==='wood'?'Timber':'Stone'} ${family}`,family,icon:family,variants:one(`${family}-${material}`),slab:{width:3,depth:3,height:.20},material:`wall-${material}`}))),
  {id:'torch-wall',label:'Wall torch',family:'attachment',icon:'torch',variants:one('torch-wall'),attachment:'mount',supportSamples:[[-.12,.15,-.02],[.12,.15,-.02],[-.12,.70,-.02],[.12,.70,-.02]],boxes:[{center:[0,.42,.12],size:[.30,.84,.28]}],light:{height:.90,radius:18,color:[1,.42,.10],power:70,offset:[0,0,.12]}},
  {id:'campfire',label:'Campfire',family:'fixture',icon:'fire',variants:one('campfire'),fixture:{radius:.68,height:.35},asset:'blender',light:{height:.55,radius:15,color:[1,.37,.08],power:90}},
  {id:'bed',label:'Bed',family:'furniture',icon:'bed',variants:one('bed'),boxes:[{center:[0,.37,0],size:[1.3,.74,2.1]},{center:[0,.68,-1],size:[1.35,1.36,.13]}],asset:'blender'},
  {id:'table',label:'Table',family:'furniture',icon:'table',variants:one('table'),boxes:[{center:[0,.76,0],size:[1.6,.12,.85]},...[-.65,.65].flatMap(x=>[-.30,.30].map(z=>({center:[x,.36,z]as Point3,size:[.13,.72,.13]as Point3})))],asset:'blender'},
  {id:'chair',label:'Chair',family:'furniture',icon:'chair',variants:one('chair'),boxes:[{center:[0,.23,0],size:[.54,.46,.54]},{center:[0,.68,-.24],size:[.56,.5,.10]}],asset:'blender'},
  ...(['door-wood','door-reinforced']as const).map(id=>({id,label:id==='door-wood'?'Timber door':'Braced door',family:'attachment' as const,icon:'door',variants:one(id),attachment:'door' as const,boxes:[{center:[0,1.14,0]as Point3,size:[1.10,2.28,.08]as Point3}],asset:'blender' as const})),
  {id:'window',label:'Window',family:'attachment',icon:'window',variants:one('window'),attachment:'window',supportSamples:[[-.65,.2,0],[-.65,.8,0],[.65,.2,0],[.65,.8,0],[0,0,0],[0,1.05,0]],boxes:[{center:[-.60,.525,0],size:[.10,1.05,.14]},{center:[.60,.525,0],size:[.10,1.05,.14]},{center:[0,.05,0],size:[1.3,.10,.14]},{center:[0,1,0],size:[1.3,.10,.14]},{center:[0,.525,0],size:[.045,.95,.07]}],asset:'blender'},
);
for(const d of definitions){const voxel=['rock','tree','wall','floor','roof'].includes(d.family);Object.assign(d,{destruction:{mode:voxel?'voxel':'whole',hardness:d.family==='rock'||d.id.includes('stone')?2.5:d.id.includes('brick')?2:1,repairable:['wall','floor','roof'].includes(d.family),tree:d.family==='tree'}});}
/** Stable save/network IDs. New object types register dimensions, assets and rules here. */
export const objectRegistry:ReadonlyMap<string,ObjectDefinition>=new Map(definitions.map(definition=>[definition.id,Object.freeze({...definition,variants:Object.freeze(definition.variants.map(v=>Object.freeze(v))),wall:definition.wall&&Object.freeze(definition.wall),slab:definition.slab&&Object.freeze(definition.slab),boxes:definition.boxes&&Object.freeze(definition.boxes.map(b=>Object.freeze({center:Object.freeze(b.center)as unknown as Point3,size:Object.freeze(b.size)as unknown as Point3}))),fixture:definition.fixture&&Object.freeze(definition.fixture),light:definition.light&&Object.freeze({...definition.light,color:Object.freeze(definition.light.color),offset:definition.light.offset&&Object.freeze(definition.light.offset)})})]));
export const hotbarSlots:readonly(readonly string[]|null)[]=Object.freeze([
  ['rock'],['tree'],['wall-wood','wall-stone','wall-log','wall-brick'],['floor-wood','floor-stone'],['roof-wood','roof-stone'],['torch','torch-wall','campfire'],['bed','table','chair'],['door-wood','door-reinforced','window'],null,
].map(group=>group&&Object.freeze(group)));
export function catalogueChoices(slot:number):{definitionId:string;variant:number}[]{return (hotbarSlots[slot]??[]).flatMap(definitionId=>objectDefinition(definitionId).variants.map((_,variant)=>({definitionId,variant})));}
export function objectDefinition(id:string):ObjectDefinition {const definition=objectRegistry.get(id);if(!definition)throw new Error(`Unknown object type: ${id}`);return definition;}
export type SnapSocket='left'|'right'|'top'|'front'|'back'|'opening'|'mount';
export type BuildSupport={kind:'terrain'}|{kind:'rock';id:string}|{kind:'wall'|'floor'|'roof';id:string;socket:SnapSocket};
export interface BuildObject {
  id:string;definitionId:string;variant:number;position:Point3;rotation:number;normal:Point3;support:BuildSupport;
  state?:{open:boolean};
}
export interface BuildRequest {
  worldKey?:string;
  requestId:string;definitionId:string;variant:number;rotation:number;
  eye:Point3;direction:Point3;feet:Point3;standing:boolean;
  expected?:{position:Point3;rotation:number;support:BuildSupport};
}
export type BuildResult={ok:true;object:BuildObject;revision:number}|{ok:false;error:string;code:string};
export const BUILD_REACH=10,BUILD_CELL=512,SNAP_DISTANCE=.8;
export function buildProp(object:BuildObject):Prop {
  const v=objectDefinition(object.definitionId).variants[object.variant];
  if(!v)throw new Error('Unknown object variant');
  let [x,y,z]=object.position,rotation=object.rotation;
  if(objectDefinition(object.definitionId).attachment==='door'&&object.state?.open){x+=-.55*Math.cos(rotation)+.55*Math.sin(rotation);z+=.55*Math.sin(rotation)+.55*Math.cos(rotation);rotation+=Math.PI/2;}
  return {kind:v.kind,x,y,z,rotation,normal:object.normal,scale:v.scale,variant:v.model};
}
export function buildCell(x:number,z:number):string {return `${Math.floor(x/BUILD_CELL)}:${Math.floor(z/BUILD_CELL)}`;}
export function validBuildObject(value:unknown):value is BuildObject {
  const o=value as BuildObject;if(!o||typeof o.id!=='string'||o.id.length>100||typeof o.definitionId!=='string')return false;
  const definition=objectRegistry.get(o.definitionId);
  const vector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e9);
  return !!definition&&Number.isInteger(o.variant)&&!!definition.variants[o.variant]&&vector(o.position)&&vector(o.normal)
    &&Math.abs(Math.hypot(...o.normal)-1)<.001&&Number.isFinite(o.rotation)&&!!o.support
    &&(o.state===undefined||!!o.state&&typeof o.state.open==='boolean'&&definition.attachment==='door')
    &&(o.support.kind==='terrain'||o.support.kind==='rock'&&typeof o.support.id==='string'||['wall','floor','roof'].includes(o.support.kind)&&'id'in o.support&&typeof o.support.id==='string'&&'socket'in o.support&&['left','right','top','front','back','opening','mount'].includes(o.support.socket));
}
export interface DoorRequest {action:'door';requestId:string;worldKey?:string;objectId:string;open:boolean;eye:Point3;direction:Point3}
