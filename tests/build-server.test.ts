import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {BuildStore} from '../server/build-store';
import {createWorldServer} from '../server/app';
import {CHARACTER} from '../shared/character';
import {solvePlacement} from '../shared/build-placement';
import {buildCell,type BuildRequest} from '../shared/object-registry';
const config={seed:'building-server-test',islandSizeMeters:1024};
function clearRequest(store:BuildStore,definitionId='wall-wood'):BuildRequest {
  for(let z=40;z<200;z+=7)for(let x=-100;x<100;x+=7) {
    const height=store.scene.terrain(x,z).height,feet:[number,number,number]=[x,height,z+4],eye:[number,number,number]=[x,height+CHARACTER.eyeHeight,z+4];feet[1]=store.scene.terrain(feet[0],feet[2]).height;eye[1]=feet[1]+CHARACTER.eyeHeight;
    const dx=0,dy=height-eye[1],dz=-4,length=Math.hypot(dx,dy,dz);
    const request:BuildRequest={requestId:'server-request-01',worldKey:store.worldKey,definitionId,variant:0,rotation:0,feet,eye,direction:[0,dy/length,dz/length],standing:true};
    if(solvePlacement(store.scene,request).valid)return request;
  }
  throw new Error('No clear build site');
}
describe('authoritative building saves and protocol',()=>{
  it('persists torches with stable registry IDs and reconstructs their physical shape after restart',()=>{
    const prefix=join(tmpdir(),'island-z-torch-'),directory=mkdtempSync(prefix);
    try {
      const store=new BuildStore(config,directory),request={...clearRequest(store,'torch'),requestId:'saved-torch-001'},result=store.place(request);
      expect(result.ok).toBe(true);if(!result.ok)return;
      const reloaded=new BuildStore(config,directory),solid=reloaded.scene.placed.get(result.object.id)!;expect(solid.object).toEqual(result.object);expect(solid.collider.kind).toBe('fixture');expect(reloaded.place(request)).toEqual(result);
    }finally{if(!resolve(directory).startsWith(resolve(prefix)))throw new Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});}
  });
  it('saves before confirming, survives reload, preserves IDs/connections, and makes retries idempotent',()=>{
    const prefix=join(tmpdir(),'island-z-build-'),directory=mkdtempSync(prefix);
    try {
      const store=new BuildStore(config,directory),request=clearRequest(store),first=store.place(request);expect(first.ok).toBe(true);if(!first.ok)return;
      expect(store.place(request)).toEqual(first);expect(store.revision).toBe(1);
      expect(store.place({...request,rotation:.2})).toMatchObject({ok:false,code:'request-id'});
      const reloaded=new BuildStore(config,directory);expect(reloaded.place(request)).toEqual(first);expect(reloaded.scene.placed.size).toBe(1);
      const key=buildCell(first.object.position[0],first.object.position[2]);expect(reloaded.snapshot([key]).cells[0].objects[0]).toEqual(first.object);
      expect(reloaded.snapshot([key],1).unchanged).toBe(true);expect(new BuildStore({...config,seed:'another-world'},directory).scene.placed.size).toBe(0);
      const saved=readFileSync(join(directory,store.worldKey+'.jsonl'),'utf8');expect(saved).not.toContain('owner');
      writeFileSync(join(directory,store.worldKey+'.jsonl'),saved+'{"interrupted":');const recovered=new BuildStore(config,directory);expect(recovered.scene.placed.size).toBe(1);expect(readdirSync(directory).some(file=>file.includes('.recovery-'))).toBe(true);
      writeFileSync(join(directory,store.worldKey+'.jsonl'),saved+'broken\n');expect(()=>new BuildStore(config,directory)).toThrow('line 2');
    }finally{if(!resolve(directory).startsWith(resolve(prefix)))throw new Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});}
  });
  it('rejects overlapping concurrent requests and exposes nearby snapshots and input errors',async()=>{
    const store=new BuildStore(config),request=clearRequest(store),server=createWorldServer(config);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
    try {
      const responses=await Promise.all([request,{...request,requestId:'server-request-02'}].map(r=>fetch(url+'/api/builds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(r)})));
      expect(responses.map(r=>r.status).sort()).toEqual([201,409]);const a=await responses[0].json();expect(a.ok).toBe(true);
      const key=buildCell(a.object.position[0],a.object.position[2]);const snapshot=await(await fetch(url+`/api/builds?cells=${key}`)).json();expect(snapshot.cells[0].objects).toHaveLength(1);
      const unchanged=await(await fetch(url+`/api/builds?cells=${key}&since=1`)).json();expect(unchanged.unchanged).toBe(true);
      expect((await fetch(url+'/api/builds?cells=bad')).status).toBe(400);
      expect((await fetch(url+'/api/builds',{method:'POST',body:'{'})).status).toBe(400);
      expect((await fetch(url+'/api/builds',{method:'POST',body:JSON.stringify({...request,requestId:'new-world-request',worldKey:'different-world'})})).status).toBe(409);
      expect((await fetch(url+'/api/builds',{method:'POST',body:'x'.repeat(9000)})).status).toBe(413);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
