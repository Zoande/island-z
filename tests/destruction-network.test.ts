import {it,expect} from 'vitest';
import {WebSocket} from 'ws';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createWorldServer} from '../server/app';
import {BuildStore} from '../server/build-store';
import {solvePlacement} from '../shared/build-placement';
import type {BuildRequest} from '../shared/object-registry';
import type {WorldAction} from '../shared/destruction';
it('synchronizes concurrent editors, rejects stale targets, deduplicates, reconnects, and survives server restart',async()=>{
  const config={seed:'network-edit-test',islandSizeMeters:1024},prefix=join(tmpdir(),'island-z-network-'),dir=mkdtempSync(prefix),probe=new BuildStore(config);let server=createWorldServer(config,{saveDirectory:dir});
  const listen=async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address()as AddressInfo).port}`;};let url=await listen();const clients:WebSocket[]=[];
  async function connect(){const socket=new WebSocket(url.replace('http:','ws:')+'/api/events');clients.push(socket);await new Promise<void>((r,j)=>{socket.once('open',r);socket.once('error',j);});return socket;}
  const close=async()=>{for(const socket of clients)socket.terminate();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));};
  try{
    let request:BuildRequest|undefined;for(let z=40;z<200&&!request;z+=9)for(let x=-100;x<100;x+=9){const y=probe.scene.terrain(x,z+3).height,eye:[number,number,number]=[x,y+1.968,z+3],dy=probe.scene.terrain(x,z).height-eye[1],l=Math.hypot(dy,3),r:BuildRequest={requestId:'network-wall-00001',worldKey:probe.worldKey,definitionId:'wall-wood',variant:0,rotation:0,eye,feet:[x,y,z+3],direction:[0,dy/l,-3/l],standing:true};if(solvePlacement(probe.scene,r).valid){request=r;break;}}
    expect(request).toBeDefined();const placed=await(await fetch(url+'/api/builds',{method:'POST',body:JSON.stringify(request)})).json();expect(placed.ok).toBe(true);const p=placed.object.position,id=placed.object.id,cell=`${Math.floor(p[0]/512)}:${Math.floor(p[2]/512)}`,one=await connect(),two=await connect(),events:any[]=[];
    for(const s of [one,two]){s.on('message',m=>events.push(JSON.parse(String(m))));s.send(JSON.stringify({type:'subscribe',cells:[cell]}));}
    const make=():WorldAction=>({action:'cut',requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),worldKey:probe.worldKey,targetId:id,targetRevision:0,eye:[p[0],p[1]+1.2,p[2]+2],feet:[p[0],p[1]+1.2-1.968,p[2]+2],direction:[0,0,-1]}),a=make(),b=make(),post=async(r:WorldAction)=>(await fetch(url+'/api/actions',{method:'POST',body:JSON.stringify(r)})).json();
    const results=await Promise.all([post(a),post(b)]);expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.find(r=>!r.ok)?.code).toBe('revision');const accepted=results[0].ok?a:b;expect(await post(accepted)).toEqual(results.find(r=>r.ok));expect(events.filter(m=>m.type==='patch'&&m.patch.actionId===accepted.requestId)).toHaveLength(2);
    const reconnect=await connect(),snapshot=new Promise<any>(r=>reconnect.once('message',m=>r(JSON.parse(String(m)))));reconnect.send(JSON.stringify({type:'subscribe',cells:[cell]}));expect((await snapshot).patch.solids.find((s:any)=>s.id===id).revision).toBe(1);
    await close();server=createWorldServer(config,{saveDirectory:dir});url=await listen();const restored=await(await fetch(url+`/api/builds?cells=${cell}`)).json();expect(restored.edits.solids.find((s:any)=>s.id===id).revision).toBe(1);expect(await post(accepted)).toEqual(results.find(r=>r.ok));
    expect((await fetch(url+'/api/actions',{method:'POST',body:'invalid'})).status).toBe(400);expect((await fetch(url+'/api/actions',{method:'POST',body:' '.repeat(9000)})).status).toBe(413);
  }finally{await close();if(!resolve(dir).startsWith(resolve(prefix)))throw new Error('Bad test directory');rmSync(dir,{recursive:true,force:true});}
},30000);
