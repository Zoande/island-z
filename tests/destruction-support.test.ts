import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {BuildStore} from '../server/build-store';
import {DestructionStore} from '../server/destruction-store';
import {FallingSimulation} from '../server/falling';
import {treeSolidAssets,recordFor,openingBrush,type WorldAction} from '../shared/destruction';
import {SparseVolume,solidSource,emptyVolume} from '../shared/volume';
import {solidComponents} from '../shared/solid-components';
import type {BuildObject} from '../shared/object-registry';
const config={seed:'destruction-support-test',islandSizeMeters:1024};
function fixture(directory?:string){const b=new BuildStore(config,directory),e=new DestructionStore(b,directory);b.scene.terrain=()=>({height:0,normal:[0,1,0]});b.scene.naturalAt=()=>[];return {b,e};}
function add(b:BuildStore,id:string,definitionId:string,position:[number,number,number],variant=0,support:BuildObject['support']={kind:'terrain'}){return b.scene.add({id,definitionId,position,variant,rotation:0,normal:[0,1,0],support});}
function action(b:BuildStore,id:string,point:[number,number,number],kind:WorldAction['action']='cut'):WorldAction{return {action:kind,requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),worldKey:b.worldKey,targetId:id,targetRevision:b.scene.edits.get(id)?.revision??0,eye:[point[0],point[1],point[2]+2],feet:[point[0],point[1]-1.968,point[2]+2],direction:[0,0,-1]};}
describe('material connectivity, attachments, and persistent pieces',()=>{
  it('acknowledges and saves cuts while slow support analysis is still running, then rebases its analysis',async()=>{
    const {b,e}=fixture(),run=e.jobs.run.bind(e.jobs);let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>started=r);let held=true;
    e.jobs.run=async task=>{if(task.task==='components'&&held){held=false;started();await gate;}return run(task);};
    try{add(b,'fast-ack-wall','wall-wood',[0,-.1,0]);const first=await e.action(action(b,'fast-ack-wall',[0,1,0]));expect(first.ok).toBe(true);await began;
      expect(e['supportRunning']).toBeDefined();const second=await e.action(action(b,'fast-ack-wall',[0,1,0]));expect(second.ok).toBe(true);expect(b.scene.edits.get('fast-ack-wall')?.revision).toBe(2);
      release();await e.flushSupport();expect(b.scene.edits.get('fast-ack-wall')?.revision).toBe(2);expect(b.scene.edits.get('fast-ack-wall')?.removed).not.toBe(true);
    }finally{release();e.dispose();}
  });
  it('inherits the latest falling pose when a concurrent cut releases a new tree section',async()=>{
    const {b,e}=fixture(),run=e.jobs.run.bind(e.jobs);let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),began=new Promise<void>(r=>started=r);let held=true;
    e.jobs.run=async task=>{if(task.task==='components'&&held){held=false;started();await gate;}return run(task);};
    try{const tree=add(b,'moving-cut-tree','tree',[0,-.05,0],6),r=recordFor(tree.id,tree.prop,b.scene.rocks,tree.object),v=new SparseVolume(r.source);v.edit({center:[0,.4,0],axis:[0,1,0],radius:0,depth:0,seed:1,box:[2,.08,2]});v.edit({center:[0,.4,0],axis:[0,1,0],radius:0,depth:0,seed:1,box:[.035,.11,.035]},true);r.volume=v.state;r.revision=1;r.pose={position:[0,-.05,0],rotation:[0,0,0,1]};r.fall={velocity:[0,0,0],angular:[0,0,0],started:Date.now(),persistent:true};b.scene.applyRecord(r);
      expect((await e.action(action(b,r.id,[0,.35,0]))).ok).toBe(true);await began;const latest=b.scene.edits.get(r.id)!;await e.saveMotion([{...latest,pose:{position:[.2,1,0],rotation:[0,0,0,1]},fall:{...latest.fall!,velocity:[1,-2,0]}}]);release();await e.flushSupport();const pieces=[...b.scene.edits.values()].filter(s=>s.fragmentOf===r.id&&!s.removed);expect(pieces.length).toBeGreaterThan(0);for(const piece of pieces){expect(piece.pose?.position).toEqual([.2,1,0]);expect(piece.fall?.velocity).toEqual([1,-2,0]);}
    }finally{release();e.dispose();}
  });
  it('keeps every prepared tree variant connected before cutting',()=>{const {e}=fixture();try{for(const [key,asset]of treeSolidAssets){const parts=solidComponents(solidSource(asset.primitives),emptyVolume(),.05);expect(parts.length,key).toBe(1);}}finally{e.dispose();}},60000);
  it('severs a tree, retains an anchored stump, and saves its falling crown',async()=>{
    const prefix=join(tmpdir(),'island-z-fragments-'),directory=mkdtempSync(prefix),{b,e}=fixture(directory);
    try{const tree=add(b,'test-birch','tree',[0,-.05,0],6),record=recordFor(tree.id,tree.prop,b.scene.rocks,tree.object),v=new SparseVolume(record.source);v.edit({center:[0,.4,0],axis:[0,1,0],radius:0,depth:0,seed:1,box:[2,.08,2]});v.edit({center:[0,.4,0],axis:[0,1,0],radius:0,depth:0,seed:1,box:[.035,.11,.035]},true);record.volume=v.state;record.revision=1;b.scene.applyRecord(record);
      // Break the remaining narrow central bridge using server-derived wood cuts.
      for(let i=0;i<6;i++){const r=await e.action(action(b,tree.id,[0,.35,0]));if(!r.ok&&r.code!=='target')throw new Error(r.error);await e.flushSupport();if([...b.scene.edits.values()].some(s=>s.fragmentOf===tree.id))break;}
      const pieces=[...b.scene.edits.values()].filter(s=>s.fragmentOf===tree.id&&!s.removed);expect(pieces.length).toBeGreaterThan(0);expect(pieces.every(s=>s.fall?.persistent)).toBe(true);expect(b.scene.edits.get(tree.id)?.removed).not.toBe(true);expect(b.scene.edits.get(tree.id)?.volume.mask).toBeDefined();
      e.compact();const restored=new BuildStore(config,directory),loaded=new DestructionStore(restored,directory);try{loaded.hydrateNear(0,0);expect([...restored.scene.edits.values()].filter(s=>s.fragmentOf===tree.id).length).toBe(pieces.length);}finally{loaded.dispose();}
    }finally{e.dispose();if(!resolve(directory).startsWith(resolve(prefix)))throw new Error('Bad test directory');rmSync(directory,{recursive:true,force:true});}
  },30000);
  it('uses alternate material contacts and releases a roof and furniture after the last support is gone',async()=>{const {b,e}=fixture();try{
    add(b,'support-left','wall-wood',[-1.5,-.1,0]);add(b,'support-right','wall-wood',[1.5,-.1,0]);add(b,'roof','roof-wood',[0,2.4,0]);add(b,'chair','chair',[0,2.57,0]);
    for(const id of ['support-left','support-right']){const s=b.scene.placed.get(id)!,r=recordFor(id,s.prop,b.scene.rocks,s.object);r.removed=true;r.revision=1;const patch={revision:e.revision+1,solids:[r],removedBuilds:[id],leveling:[],openings:[]};await e['support'](patch,action(b,id,[s.prop.x,1,0],'cut'));e.apply(patch);if(id==='support-left')expect(b.scene.placed.get('roof')).toBeDefined();}
    expect(b.scene.placed.get('roof')).toBeUndefined();expect(b.scene.placed.get('chair')).toBeUndefined();const pieces=[...b.scene.edits.values()].filter(s=>s.fragmentOf);expect(new Set(pieces.map(s=>s.id)).size).toBe(pieces.length);expect(pieces.every(s=>s.fall&&!s.fall.persistent)).toBe(true);
  }finally{e.dispose();}},30000);
  it('preserves occupied openings, closes empty ones, and avoids another player during repair',async()=>{const {b,e}=fixture();try{const wall=add(b,'occupied-wall','wall-wood',[0,-.1,0]),door=add(b,'occupied-door','door-wood',[0,-.1,0],0,{kind:'wall',id:wall.id,socket:'opening'}),r=recordFor(wall.id,wall.prop,b.scene.rocks,wall.object),v=new SparseVolume(r.source);v.edit(openingBrush(r,'door'));r.volume=v.state;r.opening='door';r.revision=1;b.scene.applyRecord(r);
    const protectedPoint:[number,number,number]=[.55,1,.11],before=new SparseVolume(r.source,r.volume).distance([0,1.1,0]);await e.action(action(b,wall.id,protectedPoint,'repair'));expect(new SparseVolume(r.source,b.scene.edits.get(wall.id)!.volume).distance([0,1.1,0])).toBe(before);
    const removed=await e.action(action(b,door.id,[0,1,.15],'dismantle'));expect(removed).toMatchObject({ok:true});expect(b.scene.openings.get(wall.id)).toBe('door');e.updateActor('other-player',[.55,0,0]);const occupied=await e.action(action(b,wall.id,protectedPoint,'repair'));expect(occupied).toMatchObject({ok:false,code:'unchanged'});e.actors.clear();const repaired=await e.action(action(b,wall.id,protectedPoint,'repair'));expect(repaired).toMatchObject({ok:true});
  }finally{e.dispose();}},30000);
  it('does not publish a change when saving fails',async()=>{const {b,e}=fixture();try{const s=add(b,'save-failure-wall','wall-wood',[0,-.1,0]);e['file']=join('Z:','missing-path','edits.jsonl');expect(await e.action(action(b,s.id,[0,1,0]))).toMatchObject({ok:false,code:'save'});expect(b.scene.edits.size).toBe(0);}finally{e.dispose();}},30000);
  it('does not resurrect a split body or undo a newer cut with a delayed motion save',async()=>{const {b,e}=fixture();try{const s=add(b,'motion-ordering','tree',[0,-.05,0],6),r=recordFor(s.id,s.prop,b.scene.rocks,s.object);r.fall={velocity:[0,0,0],angular:[0,0,0],started:Date.now(),persistent:true};r.revision=1;await e.saveMotion([r]);await e.saveMotion([{...r,removed:true}]);await e.saveMotion([r]);expect(b.scene.edits.get(r.id)?.removed).toBe(true);const newer={...r,id:'newer-cut',revision:2};await e.saveMotion([newer]);await e.saveMotion([{...newer,revision:1}]);expect(b.scene.edits.get(newer.id)?.revision).toBe(2);}finally{e.dispose();}});
  it('bounds decoded region residency and keeps archived cuts after repeated compaction',()=>{const prefix=join(tmpdir(),'island-z-regions-'),directory=mkdtempSync(prefix),{b,e}=fixture(directory);try{const records=[];for(let i=0;i<150;i++)records.push(recordFor('archived-'+i,{kind:'wall-wood',variant:0,scale:1,rotation:0,x:i*600,y:0,z:0},b.scene.rocks));e.apply({revision:1,solids:records,removedBuilds:[],leveling:[],openings:[]});e.compact();expect(b.scene.edits.size).toBeLessThanOrEqual(128);expect(e.snapshot(['0:0']).solids.some(r=>r.id==='archived-0')).toBe(true);e.compact();const restored=new BuildStore(config,directory),loaded=new DestructionStore(restored,directory);try{expect(restored.scene.edits.size).toBe(0);expect(loaded.snapshot(['0:0']).solids[0].id).toBe('archived-0');}finally{loaded.dispose();}}finally{e.dispose();if(!resolve(directory).startsWith(resolve(prefix)))throw new Error('Bad test directory');rmSync(directory,{recursive:true,force:true});}});
});
