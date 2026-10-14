import {inventoryItem,objectRegistry} from './object-registry';
import {primitiveDistance} from './volume';
import type {SolidPrimitive,SolidSource} from './volume';

export type Resource='wood'|'dirt'|'sand'|'stone';
export interface ItemStack {item:string;count:number}
export interface InventoryState {revision:number;slots:(ItemStack|null)[];offhand?:ItemStack|null}
export const INVENTORY_SLOTS=29, HOTBAR_SLOTS=9, INVENTORY_STACK=100;
export type Recipe={id:string;label:string;output:ItemStack;cost:Partial<Record<Resource,number>>;station:'hand'|'desk'};

const recipeDefs:Recipe[]=[
 {id:'wall-wood',label:'Wood wall',output:{item:'wall-wood',count:1},cost:{wood:8},station:'hand'},
 {id:'wall-stone',label:'Stone wall',output:{item:'wall-stone',count:1},cost:{stone:10},station:'hand'},
 {id:'torch',label:'Torch',output:{item:'torch',count:2},cost:{wood:2},station:'hand'},
 {id:'floor-wood',label:'Wood floor',output:{item:'floor-wood',count:1},cost:{wood:6},station:'hand'},
 {id:'floor-stone',label:'Stone floor',output:{item:'floor-stone',count:1},cost:{stone:8},station:'hand'},
 {id:'crafting-desk',label:'Crafting desk',output:{item:'crafting-desk',count:1},cost:{wood:10},station:'hand'},
 {id:'crutches',label:'Crutches',output:{item:'crutches',count:1},cost:{wood:6},station:'hand'},
 {id:'bandage',label:'Bandage',output:{item:'bandage',count:1},cost:{sand:2,dirt:2},station:'hand'},
 {id:'wall-log',label:'Log wall',output:{item:'wall-log',count:1},cost:{wood:12},station:'desk'},
 {id:'wall-brick',label:'Brick wall',output:{item:'wall-brick',count:1},cost:{stone:8,dirt:6},station:'desk'},
 {id:'roof-wood',label:'Wood roof',output:{item:'roof-wood',count:1},cost:{wood:8},station:'desk'},
 {id:'roof-stone',label:'Stone roof',output:{item:'roof-stone',count:1},cost:{stone:12},station:'desk'},
 {id:'torch-wall',label:'Wall torch',output:{item:'torch-wall',count:1},cost:{wood:3,stone:1},station:'desk'},
 {id:'campfire',label:'Campfire',output:{item:'campfire',count:1},cost:{wood:5,stone:4},station:'desk'},
 {id:'bed',label:'Bed',output:{item:'bed',count:1},cost:{wood:8},station:'desk'},
 {id:'table',label:'Table',output:{item:'table',count:1},cost:{wood:6},station:'desk'},
 {id:'chair',label:'Chair',output:{item:'chair',count:1},cost:{wood:3},station:'desk'},
 {id:'door-wood',label:'Wood door',output:{item:'door-wood',count:1},cost:{wood:6},station:'desk'},
 {id:'door-reinforced',label:'Reinforced door',output:{item:'door-reinforced',count:1},cost:{wood:4,stone:6},station:'desk'},
 {id:'window',label:'Window',output:{item:'window',count:1},cost:{wood:4,stone:2,sand:3},station:'desk'},
];
export const recipesList:readonly Recipe[]=Object.freeze(recipeDefs.map(r=>Object.freeze({...r,output:Object.freeze({...r.output}),cost:Object.freeze({...r.cost})})));
export const recipes=recipesList;
export function emptyInventory():InventoryState{return {revision:0,slots:Array.from({length:INVENTORY_SLOTS},()=>null),offhand:null};}
export function validateInventory(value:unknown):value is InventoryState {
 const v=value as InventoryState;return !!v&&typeof v==='object'&&Number.isSafeInteger(v.revision)&&v.revision>=0&&Array.isArray(v.slots)&&v.slots.length===INVENTORY_SLOTS&&v.slots.every(validStack)&&
  (v.offhand===undefined||v.offhand===null||validStack(v.offhand)&&canEquipOffhand(v.offhand.item));
}
const validStack=(s:ItemStack|null):boolean=>s===null||!!s&&typeof s.item==='string'&&s.item.length<=64&&Number.isSafeInteger(s.count)&&s.count>0&&s.count<=stackLimit(s.item)&&(Object.hasOwn(resourceItems,s.item)||objectRegistry.has(s.item)||inventoryItem(s.item)!==undefined);
const stackLimit=(item:string)=>inventoryItem(item)?.stackLimit??INVENTORY_STACK;
export function canEquipOffhand(item:string):boolean{return inventoryItem(item)?.offhand===true||recipeDefs.some(recipe=>recipe.output.item===item);}
/** Normalize older journal snapshots that predate the dedicated offhand slot. */
export function normalizeInventory(value:InventoryState):InventoryState{return {...value,slots:value.slots.map(s=>s&&({...s})),offhand:value.offhand?{...value.offhand}:null};}
const resourceItems:Record<Resource,true>={wood:true,dirt:true,sand:true,stone:true};
export function countItem(inv:InventoryState,item:string){return inv.slots.reduce((n,s)=>n+(s?.item===item?s.count:0),0)+(inv.offhand?.item===item?inv.offhand.count:0);}
export function addItems(inv:InventoryState,item:string,count:number):InventoryState|null {
 if(!validItem(item)||!Number.isSafeInteger(count)||count<=0)return null;const slots=inv.slots.map(s=>s&&({...s}));let left=count;
 const limit=stackLimit(item);
 for(let i=0;i<slots.length&&left;i++)if(slots[i]?.item===item&&slots[i]!.count<limit){const n=Math.min(left,limit-slots[i]!.count);slots[i]!.count+=n;left-=n;}
 for(let i=0;i<slots.length&&left;i++)if(slots[i]===null){const n=Math.min(left,limit);slots[i]={item,count:n};left-=n;}
 return left?null:{revision:inv.revision+1,slots,offhand:inv.offhand?{...inv.offhand}:null};
}
/** Harvesting fills the remaining room; crafting still requires the whole output to fit. */
export function collectResource(inv:InventoryState,item:Resource,count:number):InventoryState|null {
 const room=inv.slots.reduce((n,s)=>n+(s===null?INVENTORY_STACK:s.item===item?INVENTORY_STACK-s.count:0),0);
 return room>0?addItems(inv,item,Math.min(room,count)):null;
}
export function consumeItem(inv:InventoryState,item:string,count:number):InventoryState|null {
 if(!Number.isSafeInteger(count)||count<=0||countItem(inv,item)<count)return null;const slots=inv.slots.map(s=>s&&({...s}));let offhand=inv.offhand&&({...inv.offhand}),left=count;
 for(let i=0;i<slots.length&&left;i++)if(slots[i]?.item===item){const n=Math.min(left,slots[i]!.count);slots[i]!.count-=n;left-=n;if(!slots[i]!.count)slots[i]=null;}
 if(left&&offhand?.item===item){const n=Math.min(left,offhand.count);offhand.count-=n;left-=n;if(!offhand.count)offhand=null;}
 return left?null:{revision:inv.revision+1,slots,offhand};
}
/** Consume from one user-selected pack slot or virtual offhand slot (29). */
export function consumeInventorySlot(inv:InventoryState,index:number,item:string,count:number):InventoryState|null {
 if(!Number.isInteger(index)||index<0||index>INVENTORY_SLOTS||!Number.isSafeInteger(count)||count<=0)return null;
 const source=index===INVENTORY_SLOTS?inv.offhand:inv.slots[index];if(!source||source.item!==item||source.count<count)return null;
 const slots=inv.slots.map(s=>s&&({...s}));let offhand=inv.offhand&&({...inv.offhand});
 if(index===INVENTORY_SLOTS){offhand!.count-=count;if(!offhand!.count)offhand=null;}else{slots[index]!.count-=count;if(!slots[index]!.count)slots[index]=null;}
 return {revision:inv.revision+1,slots,offhand};
}
export function consumeFromSlot(inv:InventoryState,index:number,item:string,count=1):InventoryState|null{return consumeInventorySlot(inv,index,item,count);}
export function craftRecipe(inv:InventoryState,recipeId:string):InventoryState|null {
 const recipe=recipesList.find(r=>r.id===recipeId);if(!recipe)return null;let next=inv;
 for(const [item,count]of Object.entries(recipe.cost)) {const updated=consumeItem(next,item,count!);if(!updated)return null;next=updated;}
 const output=addItems(next,recipe.output.item,recipe.output.count);return output?{...output,revision:inv.revision+1}:null;
}
export function moveInventory(inv:InventoryState,from:number,to:number,count?:number):InventoryState|null {
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>INVENTORY_SLOTS||to>INVENTORY_SLOTS||from===to)return null;
 const slots=inv.slots.map(s=>s&&({...s}));let offhand=inv.offhand&&({...inv.offhand});
 const get=(index:number)=>index===INVENTORY_SLOTS?offhand:slots[index],set=(index:number,value:ItemStack|null)=>{if(index===INVENTORY_SLOTS)offhand=value;else slots[index]=value;};
 const source=get(from);if(!source)return null;let amount=count??source.count;if(!Number.isSafeInteger(amount)||amount<=0||amount>source.count)return null;
 const target=get(to);if(to===INVENTORY_SLOTS&&!canEquipOffhand(source.item))return null;
 if(target&&target.item!==source.item){if(count!==undefined||from===INVENTORY_SLOTS&&!canEquipOffhand(target.item))return null;set(from,target);set(to,source);return {revision:inv.revision+1,slots,offhand};}
 const limit=to===INVENTORY_SLOTS?stackLimit(source.item):stackLimit(source.item);
 if(target&&count===undefined)amount=Math.min(amount,limit-target.count);if(amount<=0||target&&target.count+amount>limit)return null;
 set(to,target?{item:target.item,count:target.count+amount}:{item:source.item,count:amount});if(amount===source.count)set(from,null);else set(from,{item:source.item,count:source.count-amount});return {revision:inv.revision+1,slots,offhand};
}
function validItem(item:string):boolean{return Object.hasOwn(resourceItems,item)||objectRegistry.has(item)||inventoryItem(item)!==undefined;}
/** Yields only follow a successful destructive edit, so repairing cannot mint items. */
export function resourceYield(prop:{kind:string;x?:number;y?:number;z?:number},source?:SolidSource,point?:readonly[number,number,number]):{item:Resource;count:number}|null {
 if(prop.kind==='oak'||prop.kind==='birch'||prop.kind==='palm')return {item:'wood',count:3};
 if(prop.kind==='rock')return {item:'stone',count:2};
 if(prop.kind==='terrain'){
  const terrain=source?.primitives?.find((p):p is Extract<SolidPrimitive,{type:'heightfield'}>=>p.type==='heightfield'&&!!p.weights),weights=terrain?.weights;if(!weights?.length)return {item:'dirt',count:1};
  let avg=weights[0].map((_,i)=>weights.reduce((n,w)=>n+(w[i]??0),0)/weights.length);
  if(point&&terrain&&Number.isFinite(prop.x)&&Number.isFinite(prop.z)){
   const u=Math.max(0,Math.min(terrain.grid-1e-8,(point[0]-prop.x!-terrain.bounds[0][0])/terrain.spacing)),v=Math.max(0,Math.min(terrain.grid-1e-8,(point[2]-prop.z!-terrain.bounds[0][2])/terrain.spacing)),x=Math.floor(u),z=Math.floor(v),f=u-x,g=v-z,n=terrain.grid+1;
   const ids=f+g<=1?[z*n+x,z*n+x+1,(z+1)*n+x]:[z*n+x+1,(z+1)*n+x+1,(z+1)*n+x],blend=f+g<=1?[1-f-g,f,g]:[1-g,f+g-1,1-f];avg=avg.map((_,i)=>ids.reduce((sum,id,j)=>sum+(weights[id]?.[i]??0)*blend[j],0));
   // Match the rendered surface skin and the exposed stone beneath it.
   const local=point.map((v,i)=>v-([prop.x,prop.y,prop.z][i]??0))as [number,number,number],depth=-primitiveDistance(local,terrain),rock=Math.max(0,Math.min(1,(depth-.12)/.12));
   avg=avg.map((weight,i)=>(1-rock)*weight+(i===3?rock:0));
  }
  const dominant=avg.indexOf(Math.max(...avg));
  return dominant===0?{item:'sand',count:1}:dominant===3?{item:'stone',count:1}:{item:'dirt',count:1};
 }
 return null;
}
