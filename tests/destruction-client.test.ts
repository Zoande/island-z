import {afterEach,it,expect,vi} from 'vitest';
import {DestructionController} from '../client/destruction';
import {recordFor,type WorldPatch} from '../shared/destruction';
import {terrainRecord} from '../shared/terrain-volume';
afterEach(()=>vi.unstubAllGlobals());

it('reuses an equivalent snapshot and rebuilds a corrected same-revision volume',()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn()});vi.stubGlobal('document',{pointerLockElement:null,addEventListener:vi.fn()});
  const record=recordFor('wall',{kind:'wall-wood',x:0,y:0,z:0,scale:1,variant:0,rotation:0},[]),edits=new Map(),scene={edits,keepLeveling:vi.fn(),setOpening:vi.fn(),remove:vi.fn(),applyRecord(r:any){edits.set(r.id,r);}},reconcile=vi.fn(),predict=vi.fn();
  const building={scene,worldIdentity:'world'} as any,camera={canvas:{addEventListener:vi.fn()},position:[0,0,0],character:{}} as any,renderer={reconcileDamagedPrediction:reconcile,predictSolid:predict,removeDamagedMesh:vi.fn()} as any,controller=new DestructionController(building,camera,renderer,vi.fn());
  const patch=(solid:typeof record):WorldPatch=>({revision:1,solids:[solid],removedBuilds:[],leveling:[],openings:[]});
  controller.accept(patch(record));controller['generated'].set(record.id,record.revision);controller['generatedVolumes'].set(record.id,record.volume);controller['tasks'].clear();
  const brush={center:[0,.5,.1]as [number,number,number],axis:[0,0,1]as [number,number,number],radius:.12,depth:.1,seed:1};controller['pending'].set('keep-prediction',{request:{requestId:'keep-prediction',targetId:record.id,action:'cut'} as any,brush});
  const copy={...record,volume:{version:1 as const,bricks:{}}};controller.accept(patch(copy));
  expect(scene.edits.get(record.id)).toBe(record);expect(controller['generatedVolumes'].get(record.id)).toBe(record.volume);expect(controller['tasks'].has(record.id)).toBe(false);expect(controller['predictions'].get(record.id)).toBe('0/0/keep-prediction');
  const correction={...record,volume:{...record.volume,bricks:{'0:0:0':new Int16Array([12])}}};controller.accept(patch(correction));
  expect(controller.authoritative.get(record.id)?.volume).toBe(correction.volume);expect(controller['tasks'].has(record.id)).toBe(true);expect(controller['generated'].has(record.id)).toBe(false);expect(controller['predictions'].get(record.id)).toBe('0/1/keep-prediction');expect(reconcile).toHaveBeenCalledWith(correction);
  controller.dispose();
});

it('holds accepted geometry until the pending prediction clears',()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn()});vi.stubGlobal('document',{pointerLockElement:null,addEventListener:vi.fn()});
  const record=recordFor('wall',{kind:'wall-wood',x:0,y:0,z:0,scale:1,variant:0,rotation:0},[]),scene={edits:new Map([[record.id,record]]),keepLeveling:vi.fn(),setOpening:vi.fn(),remove:vi.fn(),applyRecord(r:any){this.edits.set(r.id,r);}},setMesh=vi.fn(),controller=new DestructionController({scene,worldIdentity:'world'} as any,{canvas:{addEventListener:vi.fn()},position:[0,0,0],character:{}} as any,{setDamagedMesh:setMesh,reconcileDamagedPrediction:vi.fn(),removeDamagedMesh:vi.fn()} as any,vi.fn());
  controller.authoritative.set(record.id,record);controller['pending'].set('pending',{request:{requestId:'pending',targetId:record.id,action:'cut'} as any});
  controller['current']={record,task:'mesh'};controller['workerBusy']=true;const mesh={vertices:new Float32Array(0),indices:new Uint32Array(0)};controller['complete']({result:[mesh],lods:[],milliseconds:1});
  expect(setMesh).not.toHaveBeenCalled();expect(controller['deferredGeometry'].has(record.id)).toBe(true);
  controller['pending'].clear();controller['rebase']();expect(setMesh).toHaveBeenCalledWith(record,[mesh],[]);expect(controller['deferredGeometry'].has(record.id)).toBe(false);controller.dispose();
});

it('removes a rejected cut region while preserving another pending stroke',()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn()});vi.stubGlobal('document',{pointerLockElement:null,addEventListener:vi.fn()});
  const record=recordFor('wall',{kind:'wall-wood',x:0,y:0,z:0,scale:1,variant:0,rotation:0},[]),scene={edits:new Map([[record.id,record]]),keepLeveling:vi.fn(),setOpening:vi.fn(),remove:vi.fn(),applyRecord:vi.fn()},predict=vi.fn();
  const controller=new DestructionController({scene,worldIdentity:'world'} as any,{canvas:{addEventListener:vi.fn()},position:[0,0,0],character:{}} as any,{predictSolid:predict,reconcileDamagedPrediction:vi.fn(),removeDamagedMesh:vi.fn()} as any,vi.fn());
  controller.authoritative.set(record.id,record);
  const left={center:[-.3,.5,.1]as [number,number,number],axis:[0,0,1]as [number,number,number],radius:.08,depth:.08,seed:1},right={...left,center:[.3,.5,.1]as [number,number,number],seed:2};
  const request=(requestId:string)=>({requestId,targetId:record.id,action:'cut'} as any);
  controller['pending'].set('rejected',{request:request('rejected'),brush:left});controller['pending'].set('pending',{request:request('pending'),brush:right});controller['rebase']();
  controller['pending'].delete('rejected');controller['rebase']();
  const regions=predict.mock.calls.at(-1)![1] as [[number,number,number],[number,number,number]][];
  expect(regions).toHaveLength(1);expect(regions[0][0][0]).toBeGreaterThan(0);expect(regions[0][1][0]).toBeGreaterThan(0);
  controller.dispose();
});

it('installs multi-cell terrain meshes together and waits for newer overlapping geometry',()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn()});vi.stubGlobal('document',{pointerLockElement:null,addEventListener:vi.fn()});
  const surface=()=>({height:.5,normal:[0,1,0]as [number,number,number]}),weights=()=>[1,0,0,0,0,0,0,0],a=terrainRecord([0,0,0],surface,weights),b=terrainRecord([1,0,0],surface,weights),calls:any[]=[],scene={edits:new Map(),keepLeveling:vi.fn(),setOpening:vi.fn(),remove:vi.fn(),applyRecord(r:any){this.edits.set(r.id,r);}},renderer={setDamagedMesh:(...args:any[])=>calls.push(args),reconcileDamagedPrediction:vi.fn(),removeDamagedMesh:vi.fn()};
  const controller=new DestructionController({scene,worldIdentity:'world'} as any,{canvas:{addEventListener:vi.fn()},position:[0,0,0],character:{}} as any,renderer as any,vi.fn()),patch=(...solids:any[]):WorldPatch=>({revision:1,actionId:'cut',solids,removedBuilds:[],leveling:[],openings:[]}),mesh={vertices:new Float32Array(0),indices:new Uint32Array(0)};
  controller.accept(patch(a,b));
  const finish=(record:any)=>{controller['current']={record,task:'mesh'};controller['workerBusy']=true;controller['complete']({result:[mesh],lods:[],milliseconds:1});};
  finish(a);expect(calls).toHaveLength(0);
  const corrected={...a,revision:1,volume:{...a.volume,bricks:{'0:0:0':new Int16Array([3])}}};controller.accept(patch(corrected));
  finish(corrected);expect(calls).toHaveLength(0);
  finish(b);expect(calls.map(args=>args[0].id).sort()).toEqual([a.id,b.id].sort());
  controller.dispose();
});

it('releases staged terrain meshes when their cells are evicted',()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn()});vi.stubGlobal('document',{pointerLockElement:null,addEventListener:vi.fn()});
  const surface=()=>({height:.5,normal:[0,1,0]as [number,number,number]}),weights=()=>[1,0,0,0,0,0,0,0],a=terrainRecord([0,0,0],surface,weights),b=terrainRecord([1,0,0],surface,weights),scene={edits:new Map(),openings:new Map(),placed:new Map(),leveling:new Map(),damageCollision:new Map(),editedCollisionReady:new Set(),keepLeveling:vi.fn(),forgetLeveling:vi.fn(),setOpening:vi.fn(),remove:vi.fn(),applyRecord(r:any){this.edits.set(r.id,r);}},controller=new DestructionController({scene,worldIdentity:'world'} as any,{canvas:{addEventListener:vi.fn()},position:[0,0,0],character:{}} as any,{setDamagedMesh:vi.fn(),reconcileDamagedPrediction:vi.fn(),removeDamagedMesh:vi.fn()} as any,vi.fn());
  controller.accept({revision:1,actionId:'cut',solids:[a,b],removedBuilds:[],leveling:[],openings:[]});controller['current']={record:a,task:'mesh'};controller['workerBusy']=true;controller['complete']({result:[],lods:[],milliseconds:1});
  expect(controller['terrainBatchReady'].size).toBe(1);controller.evict(new Set());expect(controller['terrainBatchReady'].size).toBe(0);expect(controller['terrainBatches'].size).toBe(0);controller.dispose();
});
