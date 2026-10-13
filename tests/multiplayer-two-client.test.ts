import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';
import {createWorldServer} from '../server/app';
import {BuildStore} from '../server/build-store';
import {encodeMessage,decodeMessage,PROTOCOL_VERSION} from '../shared/network';
import {solvePlacement} from '../shared/build-placement';
import {CHARACTER,type CharacterState} from '../shared/character';
import {buildCell,objectDefinition,type BuildRequest} from '../shared/object-registry';
import type {SolidRecord} from '../shared/destruction';

const config={seed:'two-client-trust-check',islandSizeMeters:1024};
type Client={socket:WebSocket;events:any[];connection:string;welcome:any};
const waitFor=async<T>(read:()=>T|undefined,label:string,timeout=12000):Promise<T>=>{const end=Date.now()+timeout;while(Date.now()<end){const value=read();if(value!==undefined)return value;await new Promise(r=>setTimeout(r,10));}throw new Error(`Timed out waiting for ${label}`);};
async function openClient(base:string,identity:string,trust:boolean):Promise<Client>{
 const socket=new WebSocket(base.replace(/^http/,'ws')+'/api/events'),events:any[]=[];socket.on('message',data=>events.push(decodeMessage(new Uint8Array(data as Buffer))));await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 const hello=await waitFor(()=>events.find(m=>m.type==='hello'),'hello');socket.send(encodeMessage({type:'join',version:PROTOCOL_VERSION,identity,nickname:identity}));const welcome=await waitFor(()=>events.find(m=>m.type==='welcome'),'welcome');expect(welcome.antiCheatEnabled).toBe(!trust);
 const cell=`${Math.floor(welcome.state.feet[0]/512)}:${Math.floor(welcome.state.feet[2]/512)}`;socket.send(encodeMessage({type:'subscribe',cells:[cell],generation:1}));await waitFor(()=>events.find(m=>m.type==='subscribed'),'subscription');return {socket,events,connection:hello.connection,welcome};
}
function site(store:BuildStore,state:CharacterState,id:string):BuildRequest{
 const feet=[...state.feet]as [number,number,number],eye:[number,number,number]=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]],angles=Array.from({length:32},(_,i)=>i*Math.PI/16);
 for(const yaw of angles)for(const pitch of [-.25,-.4,-.55,-.7,-.9]){
  const horizontal=Math.cos(pitch),direction:[number,number,number]=[Math.sin(yaw)*horizontal,Math.sin(pitch),-Math.cos(yaw)*horizontal],request:BuildRequest={requestId:id,worldKey:store.worldKey,definitionId:'wall-wood',variant:0,rotation:0,eye,feet,direction,standing:true};
  const placement=solvePlacement(store.scene,request);if(placement.valid&&Math.hypot(...placement.object.position.map((v,i)=>v-eye[i]))<3.6)return request;
 }
 throw new Error(`Could not find a valid wall placement near ${feet.join(',')}`);
}
const sparse=(r:SolidRecord)=>({id:r.id,revision:r.revision,removed:!!r.removed,bricks:Object.keys(r.volume.bricks).sort().map(k=>[k,Array.from(r.volume.bricks[k])])});
async function runMode(trust:boolean){
 const directory=mkdtempSync(join(tmpdir(),'island-two-client-')),servers:any[]=[],clients:Client[]=[];
 try{
  let server=createWorldServer(config,{saveDirectory:directory,antiCheatEnabled:!trust});servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
  const a=await openClient(base,'two-client-alpha-0001',trust),b=await openClient(base,'two-client-bravo-0001',trust);clients.push(a,b);
  const rosterA=await waitFor(()=>a.events.filter(m=>m.type==='players').find(m=>m.players.some((p:any)=>p.id===b.welcome.id)),'client B in A roster');const rosterB=await waitFor(()=>b.events.filter(m=>m.type==='players').find(m=>m.players.some((p:any)=>p.id===a.welcome.id)),'client A in B roster');
  const initialA=rosterA.players.find((p:any)=>p.id===a.welcome.id),initialB=rosterB.players.find((p:any)=>p.id===b.welcome.id),steps=Array.from({length:24},(_,i)=>({seq:i+1,input:{x:0,z:1,sprint:false,jump:false}})),movementWorld=new BuildStore(config);
  if(trust){const af=[a.welcome.state.feet[0],a.welcome.state.feet[1],a.welcome.state.feet[2]-0.5]as [number,number,number],bf=[b.welcome.state.feet[0]+0.5,b.welcome.state.feet[1],b.welcome.state.feet[2]]as [number,number,number];af[1]=movementWorld.scene.standingHeight(af[0],af[2],af[1]);bf[1]=movementWorld.scene.standingHeight(bf[0],bf[2],bf[1]);const s={...a.welcome.state,feet:af,grounded:true,ready:true},t={...b.welcome.state,feet:bf,grounded:true,ready:true};a.socket.send(encodeMessage({type:'inputs',steps,state:s,stateSeq:24}));b.socket.send(encodeMessage({type:'inputs',steps,state:t,stateSeq:24}));}
  else{a.socket.send(encodeMessage({type:'inputs',steps}));b.socket.send(encodeMessage({type:'inputs',steps}));}
  const movedA=await waitFor(()=>a.events.filter(m=>m.type==='players').map(m=>m.players.find((p:any)=>p.id===a.welcome.id)).find((p:any)=>p?.ack===24),'A movement acknowledgement');const movedB=await waitFor(()=>b.events.filter(m=>m.type==='players').map(m=>m.players.find((p:any)=>p.id===b.welcome.id)).find((p:any)=>p?.ack===24),'B movement acknowledgement');
  expect(Math.hypot(movedA.state.feet[0]-initialA.state.feet[0],movedA.state.feet[2]-initialA.state.feet[2])).toBeGreaterThan(.1);expect(Math.hypot(movedB.state.feet[0]-initialB.state.feet[0],movedB.state.feet[2]-initialB.state.feet[2])).toBeGreaterThan(.1);
  const store=movementWorld,request=site(store,movedA.state,`two-client-wall-${trust?'trust':'strict'}`);expect(request.worldKey).toBe(a.welcome.worldKey);
  const cell=buildCell(request.eye[0]+request.direction[0]*4,request.eye[2]+request.direction[2]*4);for(const c of [a,b]){c.socket.send(encodeMessage({type:'subscribe',cells:[cell],generation:2}));await waitFor(()=>c.events.find(m=>m.type==='subscribed'&&m.generation===2),'placement cell subscription');}
  const buildId=request.requestId,buildStartA=a.events.length,buildStartB=b.events.length;a.socket.send(encodeMessage({type:'command',kind:'build',inputSeq:24,request}));const buildReceipt=await waitFor(()=>a.events.slice(buildStartA).find(m=>m.type==='receipt'&&m.id===buildId),'build receipt');expect(buildReceipt.result,JSON.stringify(buildReceipt.result)).toMatchObject({ok:true});
  const buildWorldA=await waitFor(()=>a.events.slice(buildStartA).find(m=>m.type==='world'&&m.objects?.some((o:any)=>o.id===buildId)),'build echo to owner');const buildWorldB=await waitFor(()=>b.events.slice(buildStartB).find(m=>m.type==='world'&&m.objects?.some((o:any)=>o.id===buildId)),'build replication to peer');expect(buildWorldA.objects.find((o:any)=>o.id===buildId)).toEqual(buildWorldB.objects.find((o:any)=>o.id===buildId));
  const object=buildWorldA.objects.find((o:any)=>o.id===buildId),target:[number,number,number]=[object.position[0],object.position[1]+objectDefinition('wall-wood').wall!.height/2,object.position[2]],eye:[number,number,number]=[movedA.state.feet[0],movedA.state.feet[1]+CHARACTER.eyeHeight,movedA.state.feet[2]],delta=target.map((v:number,i:number)=>v-eye[i]),length=Math.hypot(...delta),direction=delta.map((v:number)=>v/length),action={requestId:`two-client-cut-${trust?'trust':'strict'}`,worldKey:request.worldKey,sessionId:a.welcome.id,targetId:buildId,targetRevision:0,action:'cut',eye,feet:[...movedA.state.feet],direction};
  const cutStartA=a.events.length,cutStartB=b.events.length;a.socket.send(encodeMessage({type:'command',kind:'action',inputSeq:24,request:action}));const cutReceipt=await waitFor(()=>a.events.slice(cutStartA).find(m=>m.type==='receipt'&&m.id===action.requestId),'cut receipt',30000);expect(cutReceipt.result,JSON.stringify(cutReceipt.result)).toMatchObject({ok:true});
  const cutA=await waitFor(()=>a.events.slice(cutStartA).find(m=>m.type==='world'&&m.patch?.solids?.some((r:SolidRecord)=>r.id===buildId&&r.revision>0)),'canonical cut to owner',30000);const cutB=await waitFor(()=>b.events.slice(cutStartB).find(m=>m.type==='world'&&m.patch?.solids?.some((r:SolidRecord)=>r.id===buildId&&r.revision>0)),'canonical cut to peer',30000);const solidA=cutA.patch.solids.find((r:SolidRecord)=>r.id===buildId),solidB=cutB.patch.solids.find((r:SolidRecord)=>r.id===buildId);expect(sparse(solidA)).toEqual(sparse(solidB));expect(Object.keys(solidA.volume.bricks).length).toBeGreaterThan(0);
  const closed=[a,b].map(c=>new Promise<void>(resolve=>c.socket.once('close',()=>resolve())));for(const c of [a,b])c.socket.close();await Promise.all(closed);clients.length=0;
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));servers.pop();
  server=createWorldServer(config,{saveDirectory:directory,antiCheatEnabled:!trust});servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const reloadBase=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;const reloadedA=await openClient(reloadBase,'two-client-alpha-0001',trust);clients.push(reloadedA);const hello=reloadedA.welcome;reloadedA.socket.send(encodeMessage({type:'subscribe',cells:[cell],generation:2}));await waitFor(()=>reloadedA.events.find(m=>m.type==='subscribed'&&m.generation===2),'reload cell subscription');const response=await fetch(`${reloadBase}/api/builds?session=${reloadedA.connection}&generation=2&cells=${cell}`);expect(response.status,await response.clone().text()).toBe(200);const baseline=decodeMessage(new Uint8Array(await response.arrayBuffer()));const restoredObject=baseline.cells.flatMap((x:any)=>x.objects).find((o:any)=>o.id===buildId);expect(restoredObject).toBeDefined();const restoredSolid=baseline.edits.solids.find((r:SolidRecord)=>r.id===buildId);expect(sparse(restoredSolid)).toEqual(sparse(solidA));expect(restoredSolid.revision).toBe(solidA.revision);expect(hello.antiCheatEnabled).toBe(!trust);
  const replayBuildStart=reloadedA.events.length;reloadedA.socket.send(encodeMessage({type:'command',kind:'build',inputSeq:0,request}));const replayBuild=await waitFor(()=>reloadedA.events.slice(replayBuildStart).find(m=>m.type==='receipt'&&m.id===buildId),'durable build receipt');expect(replayBuild.result).toMatchObject({ok:true,object:{id:buildId}});
  const replayCutStart=reloadedA.events.length;reloadedA.socket.send(encodeMessage({type:'command',kind:'action',inputSeq:0,request:action}));const replayCut=await waitFor(()=>reloadedA.events.slice(replayCutStart).find(m=>m.type==='receipt'&&m.id===action.requestId),'durable cut receipt');expect(replayCut.result).toMatchObject({ok:true,requestId:action.requestId});expect(replayCut.result.patch.revision).toBe(baseline.edits.revision);
  return {mode:trust?'trust':'strict',playersMoved:true,rosters:true,buildReplicated:true,cutReplicated:true,baselineReloaded:true,receiptsReloaded:true,revision:restoredSolid.revision,bricks:Object.keys(restoredSolid.volume.bricks).length};
 }finally{for(const c of clients){try{c.socket.terminate();}catch{}}for(const server of servers){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}rmSync(directory,{recursive:true,force:true});}
}

it('replicates movement, canonical builds and sparse cuts across two websocket clients in strict and trust modes',async()=>{
 const strict=await runMode(false),trust=await runMode(true);expect(strict).toMatchObject({playersMoved:true,rosters:true,buildReplicated:true,cutReplicated:true,baselineReloaded:true,receiptsReloaded:true});expect(trust).toMatchObject({playersMoved:true,rosters:true,buildReplicated:true,cutReplicated:true,baselineReloaded:true,receiptsReloaded:true});
},120000);
