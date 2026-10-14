import {describe,it,expect} from 'vitest';
import {emptyInventory,addItems,collectResource,consumeItem,countItem,craftRecipe,moveInventory,validateInventory,resourceYield,INVENTORY_SLOTS,INVENTORY_STACK} from '../shared/inventory';
import {inventoryItem,objectRegistry} from '../shared/object-registry';
import {BuildStore} from '../server/build-store';
import {WorldJournal} from '../server/journal';
import {WorldRuntime} from '../server/world-runtime';
import {terrainRecord} from '../shared/terrain-volume';
import {solvePlacement} from '../shared/build-placement';
import {CHARACTER} from '../shared/character';
import {healthyBody} from '../shared/health';
import type {BuildRequest} from '../shared/object-registry';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

describe('survival inventory',()=>{
 it('crafts, places, and uses a real desk with canonical interaction geometry',async()=>{
  const events:any[]=[],runtime=new WorldRuntime({seed:'real-inventory-desk',islandSizeMeters:1024},undefined,(_c,m)=>events.push(m));
  try{
   await runtime.initialize();await runtime.join('desk-client',{version:1,identity:'real-desk-browser-identity',nickname:'Builder'});const s=runtime.sessions.get('desk-client')!;
   for(let i=0;i<100&&!s.character.grounded;i++)await new Promise(r=>setTimeout(r,10));
   s.inventory=addItems(emptyInventory(),'wood',30)!;
   runtime.command('desk-client',{kind:'craft',inputSeq:0,request:{requestId:'actual-desk-craft-0001',recipeId:'crafting-desk'}});await s.commands;
   expect(countItem(s.inventory,'crafting-desk')).toBe(1);
   const feet=[...s.character.feet]as [number,number,number],eye:[number,number,number]=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]];let request:BuildRequest|undefined;
   for(let a=0;a<32&&!request;a++)for(const pitch of [-.8,-.9,-1]){
    const yaw=a*Math.PI/16,candidate:BuildRequest={requestId:'actual-desk-place-0001',worldKey:runtime.builds.worldKey,definitionId:'crafting-desk',variant:0,rotation:0,feet,eye,standing:true,direction:[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)]};
    const solved=solvePlacement(runtime.builds.scene,candidate);if(solved.valid&&Math.hypot(...solved.object.position.map((v,i)=>v-eye[i]))<2.6){request=candidate;break;}
   }
   expect(request,'a reachable desk placement').toBeDefined();
   runtime.command('desk-client',{kind:'build',inputSeq:0,request});await s.commands;
   expect(events.find(e=>e.type==='receipt'&&e.id==='actual-desk-place-0001')?.result).toMatchObject({ok:true});expect(countItem(s.inventory,'crafting-desk')).toBe(0);
   runtime.command('desk-client',{kind:'craft',inputSeq:0,request:{requestId:'actual-desk-roof-0001',recipeId:'roof-wood',stationId:'actual-desk-place-0001'}});await s.commands;
   expect(events.find(e=>e.type==='receipt'&&e.id==='actual-desk-roof-0001')?.result).toMatchObject({ok:true});expect(countItem(s.inventory,'roof-wood')).toBe(1);expect(countItem(s.inventory,'wood')).toBe(12);
   runtime.command('desk-client',{kind:'craft',inputSeq:0,request:{requestId:'actual-desk-denied-0001',recipeId:'roof-wood',stationId:'missing-desk'}});await s.commands;
   expect(events.find(e=>e.type==='receipt'&&e.id==='actual-desk-denied-0001')?.result).toMatchObject({ok:false});expect(countItem(s.inventory,'wood')).toBe(12);
  }finally{await runtime.close();}
 },30000);
 it('collects the remaining space from a harvest without exceeding a full stack',()=>{
  const full=addItems(emptyInventory(),'stone',INVENTORY_SLOTS*INVENTORY_STACK)!;full.slots[0]={item:'wood',count:99};
  const collected=collectResource(full,'wood',3)!;expect(collected.slots[0]).toEqual({item:'wood',count:100});expect(full.slots[0]?.count).toBe(99);
  expect(collectResource(collected,'wood',3)).toBeNull();
 });
 it('starts empty, stacks to 100, and refuses overflow without changing the source',()=>{
  const empty=emptyInventory();expect(empty.slots).toHaveLength(INVENTORY_SLOTS);expect(empty.slots.every(v=>v===null)).toBe(true);
  const full=addItems(empty,'wood',INVENTORY_STACK+2)!;expect(full.slots.slice(0,2)).toEqual([{item:'wood',count:100},{item:'wood',count:2}]);
  expect(addItems(full,'wood',INVENTORY_STACK*30)).toBeNull();expect(countItem(full,'wood')).toBe(102);expect(validateInventory(full)).toBe(true);
  expect(validateInventory({...empty,slots:Array(28).fill(null)})).toBe(false);
 });
 it('crafts from exact costs and moves or swaps full stacks',()=>{
  let inventory=addItems(emptyInventory(),'wood',10)!;inventory=addItems(inventory,'stone',10)!;
  const wall=craftRecipe(inventory,'wall-wood')!;expect(countItem(wall,'wood')).toBe(2);expect(countItem(wall,'wall-wood')).toBe(1);
  expect(craftRecipe(emptyInventory(),'wall-wood')).toBeNull();
  const swapped=moveInventory(wall,2,0)!;expect(swapped.slots[0]?.item).toBe('wall-wood');expect(swapped.slots[2]?.item).toBe('wood');
  const moved=moveInventory(swapped,0,3)!;expect(moved.slots[0]).toBeNull();expect(moved.slots[3]?.item).toBe('wall-wood');
  expect(consumeItem(moved,'wall-wood',2)).toBeNull();
  const stacks=emptyInventory();stacks.slots[0]={item:'wood',count:50};stacks.slots[1]={item:'wood',count:80};const merged=moveInventory(stacks,0,1)!;
  expect(merged.slots[0]).toEqual({item:'wood',count:30});expect(merged.slots[1]).toEqual({item:'wood',count:100});expect(moveInventory(stacks,0,1,30)).toBeNull();
 });
 it('keeps a separate offhand slot, caps inventory items, and permits only equipment or crafted items there',()=>{
  const empty=emptyInventory();
  expect(empty.slots).toHaveLength(29);expect(empty.offhand).toBeNull();expect(inventoryItem('crutches')).toMatchObject({stackLimit:1,offhand:true});
  expect(inventoryItem('bandage')).toMatchObject({stackLimit:100,offhand:false});expect(objectRegistry.has('crutches')).toBe(false);expect(objectRegistry.has('bandage')).toBe(false);
  expect(validateInventory({...empty,offhand:undefined})).toBe(true);expect(validateInventory({...empty,offhand:{item:'wood',count:1}})).toBe(false);
  let inventory=addItems(empty,'wood',6)!;inventory=craftRecipe(inventory,'crutches')!;expect(countItem(inventory,'crutches')).toBe(1);
  const offhand=moveInventory(inventory,0,29)!;expect(offhand.slots[0]).toBeNull();expect(offhand.offhand).toEqual({item:'crutches',count:1});
  expect(validateInventory(offhand)).toBe(true);expect(moveInventory(addItems(empty,'wood',2)!,0,29)).toBeNull();expect(moveInventory(addItems(empty,'rock',1)!,0,29)).toBeNull();
  expect(addItems(empty,'crutches',2)?.slots.slice(0,2)).toEqual([{item:'crutches',count:1},{item:'crutches',count:1}]);expect(moveInventory({...offhand,slots:[{item:'crutches',count:1},...offhand.slots.slice(1)]},0,29)).toBeNull();
  expect(moveInventory(offhand,29,1)?.slots[1]).toEqual({item:'crutches',count:1});
  expect(moveInventory(empty,0,29)).toBeNull();
  let materials=addItems(addItems(empty,'sand',2)!,'dirt',2)!;materials=craftRecipe(materials,'bandage')!;expect(countItem(materials,'bandage')).toBe(1);
  const equipped=moveInventory(craftRecipe(addItems(empty,'wood',6)!,'crutches')!,0,29)!;
  expect(addItems(equipped,'wood',1)?.offhand).toEqual({item:'crutches',count:1});
  expect(collectResource(equipped,'stone',1)?.offhand).toEqual({item:'crutches',count:1});
  let supplied=addItems(addItems(equipped,'sand',2)!,'dirt',2)!;supplied=craftRecipe(supplied,'bandage')!;expect(supplied.offhand).toEqual({item:'crutches',count:1});
 });
 it('maps successfully mined natural materials and excludes built objects',()=>{
  expect(resourceYield({kind:'oak'})?.item).toBe('wood');expect(resourceYield({kind:'rock'})?.item).toBe('stone');
  expect(resourceYield({kind:'wall-wood'})).toBeNull();expect(resourceYield({kind:'terrain'})).toEqual({item:'dirt',count:1});
  const terrain=terrainRecord([0,0,0],()=>({height:0,normal:[0,1,0]}),()=>[1,0,0,0,0,0,0,0]);
  expect(resourceYield(terrain.prop,terrain.source,[.5,0,.5])?.item).toBe('sand');
  expect(resourceYield(terrain.prop,terrain.source,[.5,-1,.5])?.item).toBe('stone');
 });
 it('grants mining yields only from successful non-repair edits and deduplicates retries',async()=>{
  const events:any[]=[],runtime=new WorldRuntime({seed:'inventory-mining',islandSizeMeters:1024},undefined,(_c,m)=>events.push(m));
  try{await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'inventory-mining-browser-01',nickname:'Miner'});const session=runtime.sessions.get('one')!;let strokes=0;
   (runtime.edits as any).action=async(_request:any,reward:(record:any)=>unknown)=>{strokes++;if(_request.action!=='repair')reward({prop:{kind:'oak'},source:{primitives:[]}});return {ok:true,patch:{revision:1,solids:[],removedBuilds:[],leveling:[],openings:[]}};};
   const request={requestId:'mine-oak-request-01',targetId:'oak',action:'cut'};runtime.command('one',{kind:'action',inputSeq:0,request});await session.commands;expect(countItem(session.inventory,'wood')).toBe(3);
   runtime.command('one',{kind:'action',inputSeq:0,request});await session.commands;expect(strokes).toBe(1);expect(countItem(session.inventory,'wood')).toBe(3);
   runtime.command('one',{kind:'action',inputSeq:0,request:{...request,requestId:'repair-oak-request-02',action:'repair'}});await session.commands;expect(strokes).toBe(2);expect(countItem(session.inventory,'wood')).toBe(3);
   const updates=events.filter(e=>e.type==='inventory');expect(updates.map(e=>e.requestId)).toEqual(['mine-oak-request-01','mine-oak-request-01']);expect(countItem(updates[1].inventory,'wood')).toBe(3);
  }finally{await runtime.close();}
 },30000);
 it('awards one material for an actual changed terrain stroke and preserves it across retry and reload',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'island-terrain-loot-')),config={seed:'terrain-loot-integration',islandSizeMeters:1024},events:any[]=[];let runtime=new WorldRuntime(config,dir,(_c,m)=>events.push(m));
  try{await runtime.initialize();await runtime.join('one',{version:1,identity:'terrain-loot-browser-01',nickname:'Miner'});const session=runtime.sessions.get('one')!;
   const feet=[...session.character.feet]as [number,number,number],eye:[number,number,number]=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]],hit=runtime.builds.scene.raycast(eye,[0,-1,0],4,false,true);expect(hit?.solid?.prop.kind).toBe('terrain');
   const record=hit!.solid!.record!,reward=resourceYield(record.prop,record.source,hit!.point)!;const request={requestId:'terrain-cut-loot-0001',worldKey:runtime.builds.worldKey,targetId:record.id,targetRevision:record.revision,action:'cut',eye,feet,direction:[0,-1,0]};
   runtime.command('one',{kind:'action',inputSeq:0,request});await session.commands;const receipt=events.find(e=>e.type==='receipt'&&e.id===request.requestId);expect(receipt.result.ok).toBe(true);expect(runtime.builds.scene.edits.get(record.id)?.revision).toBe(record.revision+1);expect(countItem(session.inventory,reward.item)).toBe(reward.count);
   await runtime.close();runtime=new WorldRuntime(config,dir,(_c,m)=>events.push(m));await runtime.initialize();await runtime.join('two',{version:1,identity:'terrain-loot-browser-01',nickname:'Miner'});const restored=runtime.sessions.get('two')!;expect(countItem(restored.inventory,reward.item)).toBe(reward.count);
   runtime.command('two',{kind:'action',inputSeq:0,request});await restored.commands;expect(countItem(restored.inventory,reward.item)).toBe(reward.count);expect(runtime.builds.scene.edits.get(record.id)?.revision).toBe(record.revision+1);
  }finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
 },30000);
 it('consumes a building item only after placement succeeds and checks desk distance and line of sight',async()=>{
  const events:any[]=[],runtime=new WorldRuntime({seed:'inventory-build',islandSizeMeters:1024},undefined,(_c,m)=>events.push(m));
  try{await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'inventory-build-browser-01',nickname:'Builder'});const session=runtime.sessions.get('one')!;session.inventory=addItems(emptyInventory(),'wall-wood',1)!;
   const place=(runtime.edits as any).place;let committed:any;(runtime.edits as any).place=async(_request:any,inventory:any)=>{committed=inventory;return {ok:false,code:'blocked',error:'blocked'};};
   const failed={requestId:'place-wall-request-01',definitionId:'wall-wood',variant:0};runtime.command('one',{kind:'build',inputSeq:0,request:failed});await session.commands;expect(countItem(session.inventory,'wall-wood')).toBe(1);expect(committed.state.slots.some((s:any)=>s?.item==='wall-wood')).toBe(false);
   (runtime.edits as any).place=async(_request:any,inventory:any)=>{committed=inventory;return {ok:true,object:{id:'wall'},revision:1};};runtime.command('one',{kind:'build',inputSeq:0,request:{...failed,requestId:'place-wall-request-02'}});await session.commands;expect(countItem(session.inventory,'wall-wood')).toBe(0);expect(events.find(e=>e.type==='receipt'&&e.id==='place-wall-request-02').result.inventory).toEqual(session.inventory);
   const deskSolid={object:{id:'desk',definitionId:'crafting-desk',position:[session.character.feet[0],session.character.feet[1],session.character.feet[2]+2]}};const oldQuery=runtime.builds.scene.placed.query,oldRaycast=runtime.builds.scene.raycast;
   (runtime.builds.scene.placed as any).query=()=>[deskSolid];(runtime.builds.scene as any).raycast=()=>({solid:{id:'desk'}});expect(runtime['nearCraftingDesk'](session,'desk')).toBe(true);
   (runtime.builds.scene as any).raycast=()=>null;expect(runtime['nearCraftingDesk'](session,'desk')).toBe(false);
   deskSolid.object.position[2]=session.character.feet[2]+4;(runtime.builds.scene as any).raycast=()=>({solid:{id:'desk'}});expect(runtime['nearCraftingDesk'](session,'desk')).toBe(false);
   (runtime.builds.scene.placed as any).query=oldQuery;(runtime.builds.scene as any).raycast=oldRaycast;
  }finally{await runtime.close();}
 },30000);
 it('persists crafted inventory with its receipt across a restart and does not craft twice on retry',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'island-inventory-')),config={seed:'inventory-save',islandSizeMeters:1024},events:any[]=[];let runtime=new WorldRuntime(config,dir,(_connection,message)=>events.push(message));
  try{
   await runtime.initialize();await runtime.join('one',{version:1,identity:'inventory-browser-identity-01',nickname:'Crafter'});const session=runtime.sessions.get('one')!;
   session.inventory=addItems(emptyInventory(),'wood',8)!;runtime['inventories'].set(session.id,session.inventory);
   const append=runtime.journal.append.bind(runtime.journal);let release!:()=>void,started!:()=>void;const writing=new Promise<void>(resolve=>started=resolve),gate=new Promise<void>(resolve=>release=resolve);runtime.journal.append=async commit=>{if(commit.kind==='inventory'){started();await gate;}return append(commit);};
   runtime.command('one',{kind:'craft',inputSeq:0,request:{requestId:'inventory-craft-0001',recipeId:'wall-wood'}});await writing;let left=false;const leaving=runtime.leave('one').then(()=>{left=true;});await Promise.resolve();expect(left).toBe(false);release();await leaving;
   expect(countItem(session.inventory,'wall-wood')).toBe(1);expect(countItem(session.inventory,'wood')).toBe(0);expect(events.some(e=>e.type==='inventory'&&e.requestId==='inventory-craft-0001')).toBe(true);
   await runtime.close();runtime=new WorldRuntime(config,dir,(_connection,message)=>events.push(message));await runtime.initialize();await runtime.join('two',{version:1,identity:'inventory-browser-identity-01',nickname:'Crafter'});const restored=runtime.sessions.get('two')!;
   expect(countItem(restored.inventory,'wall-wood')).toBe(1);runtime.command('two',{kind:'craft',inputSeq:0,request:{requestId:'inventory-craft-0001',recipeId:'wall-wood'}});await restored.commands;
   expect(countItem(restored.inventory,'wall-wood')).toBe(1);expect(countItem(restored.inventory,'wood')).toBe(0);
  }finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
 },30000);
 it('bandages one selected pack slot atomically with health, survives restart, and replays privately',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'island-bandage-')),config={seed:'bandage-journal',islandSizeMeters:1024},events:any[]=[];let runtime=new WorldRuntime(config,dir,(_connection,message)=>events.push(message));
  try{
   await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'bandage-browser-identity-01',nickname:'Medic'});const session=runtime.sessions.get('one')!;
   session.character.damage('head',20,'heavy');session.inventory=addItems(session.inventory,'bandage',1)!;runtime['inventories'].set(session.id,session.inventory);
   const request={requestId:'bandage-head-request-01',part:'head',from:0};runtime.command('one',{kind:'bandage',inputSeq:0,request});await session.commands;
   expect(session.character.health.head).toMatchObject({hp:80,bleeding:'none'});expect(countItem(session.inventory,'bandage')).toBe(0);
   expect(events.find(e=>e.type==='health'&&e.requestId===request.requestId)?.health.head).toMatchObject({hp:80,bleeding:'none'});
   await runtime.close();runtime=new WorldRuntime(config,dir,(_connection,message)=>events.push(message));await runtime.initialize();await runtime.join('two',{version:1,identity:'bandage-browser-identity-01',nickname:'Medic'});const restored=runtime.sessions.get('two')!;
   expect(restored.character.health.head).toMatchObject({hp:80,bleeding:'none'});expect(countItem(restored.inventory,'bandage')).toBe(0);
   runtime.command('two',{kind:'bandage',inputSeq:0,request});await restored.commands;expect(countItem(restored.inventory,'bandage')).toBe(0);expect(restored.character.health.head.hp).toBe(80);
  }finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
 },30000);
 it('ignores client health and vitals in trusted movement and blocks tool work with a ruined right arm',async()=>{
  const events:any[]=[],runtime=new WorldRuntime({seed:'trust-health',islandSizeMeters:1024},undefined,(_c,m)=>events.push(m),false);
  try{
   await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'trust-health-browser-01',nickname:'Runner'});const session=runtime.sessions.get('one')!;
   session.character.damage('rightArm',80);session.character.oxygen=22;session.character.stamina=17;
   const forged={...session.character.capture(),health:healthyBody(),oxygen:60,stamina:100};runtime.inputs('one',{steps:[],state:forged,stateSeq:0});
   expect(session.character.health.rightArm.hp).toBe(20);expect(session.character.oxygen).toBe(22);expect(session.character.stamina).toBe(17);
   session.character.respawns=1;const authoritativeFeet=[...session.character.feet],stale={...session.character.capture(),respawns:0,feet:[100,100,100]as[number,number,number]};runtime.inputs('one',{steps:[],state:stale,stateSeq:0});
   expect([...session.character.feet]).toEqual(authoritativeFeet);expect(events.some(e=>e.type==='health'&&e.reason==='respawn'&&e.ack===0)).toBe(true);
   let edited=false;(runtime.edits as any).action=async()=>{edited=true;return {ok:true,patch:{revision:1,solids:[],removedBuilds:[],leveling:[],openings:[]}};};
   runtime.command('one',{kind:'action',inputSeq:0,request:{requestId:'injured-arm-tool-0001',targetId:'oak',action:'cut'}});await session.commands;
   expect(edited).toBe(false);expect(events.find(e=>e.type==='receipt'&&e.id==='injured-arm-tool-0001')?.result.ok).toBe(false);
   session.character.damage('head',80);session.inventory=addItems(emptyInventory(),'wall-wood',1)!;
   runtime.command('one',{kind:'build',inputSeq:0,request:{requestId:'injured-head-build-0002',definitionId:'wall-wood',variant:0}});await session.commands;
   expect(events.find(e=>e.type==='receipt'&&e.id==='injured-head-build-0002')?.result).toMatchObject({ok:false,error:'Your injuries prevent building'});
  }finally{await runtime.close();}
 },30000);
 it('does not roll back intervening injuries or a fatal respawn while bandage persistence is pending',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'island-bandage-race-')),config={seed:'bandage-race',islandSizeMeters:1024};let runtime=new WorldRuntime(config,dir,()=>{});
  try{
   await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'bandage-race-browser-01',nickname:'Medic'});const session=runtime.sessions.get('one')!;
   session.character.damage('head',20,'heavy');session.inventory=addItems(session.inventory,'bandage',1)!;runtime['inventories'].set(session.id,session.inventory);
   const request={requestId:'bandage-race-injury-01',part:'head',from:0};let release!:()=>void,started!:()=>void;
   const waiting=new Promise<void>(resolve=>started=resolve),gate=new Promise<void>(resolve=>release=resolve),append=runtime.journal.append.bind(runtime.journal);let held=false;
   runtime.journal.append=async commit=>{if(!held&&commit.requestId===request.requestId){held=true;started();await gate;}return append(commit);};
   runtime.command('one',{kind:'bandage',inputSeq:0,request});await waiting;session.character.damage('leftArm',30,'moderate');release();await session.commands;
   expect(session.character.health.head.bleeding).toBe('none');expect(session.character.health.leftArm).toMatchObject({hp:70,bleeding:'moderate'});
   await runtime.close();runtime=new WorldRuntime(config,dir,()=>{});await runtime.initialize();await runtime.join('two',{version:1,identity:'bandage-race-browser-01',nickname:'Medic'});
   expect(runtime.sessions.get('two')!.character.health.leftArm).toMatchObject({hp:70,bleeding:'moderate'});
  }finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
  const deathDir=mkdtempSync(join(tmpdir(),'island-bandage-death-'));runtime=new WorldRuntime(config,deathDir,()=>{});
  try{
   await runtime.initialize();clearInterval(runtime['timer']);await runtime.join('one',{version:1,identity:'bandage-death-browser-01',nickname:'Medic'});const session=runtime.sessions.get('one')!;
   session.character.damage('chest',20,'heavy');session.inventory=addItems(session.inventory,'bandage',1)!;runtime['inventories'].set(session.id,session.inventory);
   const request={requestId:'bandage-race-death-01',part:'chest',from:0};let release!:()=>void,started!:()=>void;
   const waiting=new Promise<void>(resolve=>started=resolve),gate=new Promise<void>(resolve=>release=resolve),append=runtime.journal.append.bind(runtime.journal);let held=false;
   runtime.journal.append=async commit=>{if(!held&&commit.requestId===request.requestId){held=true;started();await gate;}return append(commit);};
   runtime.command('one',{kind:'bandage',inputSeq:0,request});await waiting;session.character.damage('chest',100);session.character.advanceVitals(CHARACTER.timestep);expect(session.character.respawns).toBe(1);release();await session.commands;
   expect(session.character.respawns).toBe(1);expect(session.character.health.chest.hp).toBe(100);
   await runtime.close();runtime=new WorldRuntime(config,deathDir,()=>{});await runtime.initialize();await runtime.join('two',{version:1,identity:'bandage-death-browser-01',nickname:'Medic'});
   expect(runtime.sessions.get('two')!.character.respawns).toBe(1);expect(runtime.sessions.get('two')!.character.health.chest.hp).toBe(100);
  }finally{await runtime.close();rmSync(deathDir,{recursive:true,force:true});}
 },30000);
});
