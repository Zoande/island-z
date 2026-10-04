import type {Prop} from './world';
import type {Point3} from './rocks';

export const OBJECT_SCHEMA_VERSION=1;
export interface ObjectVariant {kind:Prop['kind'];model:number;scale:number}
export interface ObjectDefinition {
  readonly id:string;readonly label:string;readonly family:'rock'|'tree'|'wall';
  readonly icon:'rock'|'tree'|'wood'|'stone';readonly variants:readonly ObjectVariant[];
  readonly wall?:{width:number;height:number;depth:number};
}
const definitions:ObjectDefinition[]=[
  {id:'rock',label:'Rock',family:'rock',icon:'rock',variants:[1.25,2.7].flatMap(scale=>Array.from({length:12},(_,model)=>({kind:'rock',model,scale})))},
  {id:'tree',label:'Tree',family:'tree',icon:'tree',variants:[...(['oak','birch']as const).flatMap(kind=>Array.from({length:6},(_,model)=>({kind,model,scale:1}))),...Array.from({length:3},(_,model)=>({kind:'palm' as const,model,scale:1}))]},
  {id:'wall-wood',label:'Wood wall',family:'wall',icon:'wood',variants:[{kind:'wall-wood',model:0,scale:1}],wall:{width:3,height:2.5,depth:.22}},
  {id:'wall-stone',label:'Stone wall',family:'wall',icon:'stone',variants:[{kind:'wall-stone',model:0,scale:1}],wall:{width:3,height:2.5,depth:.32}},
];
/** Stable save/network IDs. New object types register dimensions, assets and rules here. */
export const objectRegistry:ReadonlyMap<string,ObjectDefinition>=new Map(definitions.map(definition=>[definition.id,Object.freeze({...definition,variants:Object.freeze(definition.variants.map(v=>Object.freeze(v))),wall:definition.wall&&Object.freeze(definition.wall)})]));
export const hotbarSlots:readonly(string|null)[]=Object.freeze(['rock','tree','wall-wood','wall-stone',null,null,null,null,null]);
export function objectDefinition(id:string):ObjectDefinition {const definition=objectRegistry.get(id);if(!definition)throw new Error(`Unknown object type: ${id}`);return definition;}
export type SnapSocket='left'|'right'|'top';
export type BuildSupport={kind:'terrain'}|{kind:'rock';id:string}|{kind:'wall';id:string;socket:SnapSocket};
export interface BuildObject {
  id:string;definitionId:string;variant:number;position:Point3;rotation:number;normal:Point3;support:BuildSupport;
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
  return {kind:v.kind,x:object.position[0],y:object.position[1],z:object.position[2],rotation:object.rotation,normal:object.normal,scale:v.scale,variant:v.model};
}
export function buildCell(x:number,z:number):string {return `${Math.floor(x/BUILD_CELL)}:${Math.floor(z/BUILD_CELL)}`;}
export function validBuildObject(value:unknown):value is BuildObject {
  const o=value as BuildObject;if(!o||typeof o.id!=='string'||o.id.length>100||typeof o.definitionId!=='string')return false;
  const definition=objectRegistry.get(o.definitionId);
  const vector=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e9);
  return !!definition&&Number.isInteger(o.variant)&&!!definition.variants[o.variant]&&vector(o.position)&&vector(o.normal)
    &&Math.abs(Math.hypot(...o.normal)-1)<.001&&Number.isFinite(o.rotation)&&!!o.support
    &&(o.support.kind==='terrain'||o.support.kind==='rock'&&typeof o.support.id==='string'||o.support.kind==='wall'&&typeof o.support.id==='string'&&['left','right','top'].includes(o.support.socket));
}
