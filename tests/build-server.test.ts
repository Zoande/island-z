import {describe,it,expect} from 'vitest';
import {BuildStore} from '../server/build-store';
import {DestructionStore} from '../server/destruction-store';
import {recordFor} from '../shared/destruction';
import {SparseVolume} from '../shared/volume';
import type {BuildObject,BuildRequest} from '../shared/object-registry';
const config={seed:'transaction-test',islandSizeMeters:1024};
describe('unified building transactions',()=>{
 it('commits a door and damaged-wall aperture together, and leaves memory unchanged if saving fails',async()=>{
   const b=new BuildStore(config);b.scene.terrain=()=>({height:0,normal:[0,1,0]});b.scene.naturalAt=()=>[];
   const wall:BuildObject={id:'parent-wall-transaction',definitionId:'wall-wood',variant:0,position:[0,-.1,0],rotation:0,normal:[0,1,0],support:{kind:'terrain'}};b.accept(wall);
   const parent=b.scene.placed.get(wall.id)!,r=recordFor(wall.id,parent.prop,b.scene.rocks,wall),v=new SparseVolume(r.source);v.edit({center:[1,1,.1],axis:[0,0,-1],radius:.08,depth:.12,seed:1});r.volume=v.state;r.revision=1;b.scene.applyRecord(r);
   const request:BuildRequest={requestId:'transaction-door-01',worldKey:b.worldKey,definitionId:'door-wood',variant:0,rotation:0,feet:[0,0,2],eye:[0,1.968,2],direction:[0,0,-1],standing:true};
   const commits:any[]=[];let fail=true;const e=new DestructionStore(b,{append:async commit=>{expect(b.scene.placed.get(request.requestId)).toBeUndefined();expect(b.scene.edits.get(wall.id)!.revision).toBe(1);if(fail)throw new Error('Disk failed');commits.push(commit);}});
   try{expect(await e.place(request)).toMatchObject({ok:false,code:'save'});expect(b.scene.placed.get(request.requestId)).toBeUndefined();fail=false;expect(await e.place(request)).toMatchObject({ok:true});expect(commits).toHaveLength(1);expect(commits[0].object.id).toBe(request.requestId);expect(commits[0].patch.solids[0].opening).toBe('door');expect(b.scene.edits.get(wall.id)!.revision).toBe(2);expect(b.scene.placed.get(request.requestId)).toBeDefined();expect(await e.place(request)).toMatchObject({ok:true});expect(commits).toHaveLength(1);}finally{e.dispose();}
 },30000);
});
