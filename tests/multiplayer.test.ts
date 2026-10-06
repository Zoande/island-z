import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readdirSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';
import {encodeMessage,decodeMessage,PROTOCOL_VERSION} from '../shared/network';
import {Character,idleInput,CHARACTER} from '../shared/character';
import {playerContacts,separatePlayers} from '../shared/player-contact';
import {WorldJournal} from '../server/journal';
import {WorldRuntime} from '../server/world-runtime';
import {createWorldServer} from '../server/app';
import {recordFor,solidCells} from '../shared/destruction';
import {DestructionStore} from '../server/destruction-store';
import {BuildStore} from '../server/build-store';
import {DestructionController} from '../client/destruction';
import {SolidPhysics,initializePhysics} from '../shared/solid-physics';
const flat={surface:()=>({height:0,normal:[0,1,0]as [number,number,number]}),colliders:()=>[]};
it('encodes large messages and typed bricks without JSON and rejects malformed bounds',()=>{
 const value={text:'x'.repeat(8000),bricks:new Int16Array([-32767,0,123,32767]),items:[true,false,null,{key:'value'}]};expect(decodeMessage(encodeMessage(value))).toEqual(value);expect(()=>decodeMessage(new Uint8Array([1,5,255,255,255,255]))).toThrow();expect(()=>decodeMessage(encodeMessage(value),100)).toThrow();
});
it('restores and replays complete fixed-step movement and vitals across frame batching',()=>{
 const a=new Character(flat),b=new Character(flat);a.spawn(0,0,0);b.spawn(0,0,0);const input={x:1,z:0,sprint:true,jump:false};for(let i=0;i<40;i++)a.update(1/30,input);for(let i=0;i<160;i++)b.update(1/120,input);expect(a.capture()).toEqual(b.capture());const saved=a.capture();for(let i=0;i<30;i++)a.update(1/120,{...input,jump:i===0});b.restore(saved);for(let i=0;i<30;i++)b.update(1/120,{...input,jump:i===0});expect(a.capture()).toEqual(b.capture());
});
it('blocks and slides player contact without making players support platforms',()=>{
 const c=new Character({...flat,colliders:()=>playerContacts([{id:'other',feet:[0,0,0]}],'self')});c.spawn(0,0,2);for(let i=0;i<120;i++)c.update(1/120,{...idleInput,z:-1});expect(c.feet[2]).toBeGreaterThan(CHARACTER.radius*2);expect(c.feet[1]).toBe(0);const a={id:'a',feet:new Float64Array([0,0,0]),velocity:new Float64Array(3)},b={id:'b',feet:new Float64Array([.1,0,0]),velocity:new Float64Array(3)};separatePlayers([b,a]);expect(b.feet[0]-a.feet[0]).toBeGreaterThanOrEqual(.64);expect(a.feet[1]).toBe(0);
});
it('does not reject an unseen region because a different region has a newer global revision',()=>{
 const controller=Object.create(DestructionController.prototype);controller.authoritative=new Map();controller.pending=new Map();controller.poses=new Map();controller.worldRevision=100;controller.building={scene:new BuildStore({seed:'region-order',islandSizeMeters:1024}).scene};controller.rebase=()=>{};
 const r=recordFor('late-region-wall',{kind:'wall-wood',x:513,y:0,z:1,variant:0,scale:1,rotation:0},[]);r.revision=2;
 controller.accept({revision:20,solids:[r],removedBuilds:[],leveling:[],openings:[]});expect(controller.authoritative.get(r.id)).toBe(r);
 controller.accept({revision:101,solids:[{...r,revision:1}],removedBuilds:[],leveling:[],openings:[]});expect(controller.authoritative.get(r.id)).toBe(r);
});
it('archives and reloads a cold edited volume through every cell its bounds cross',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'island-cell-'));const b=new BuildStore({seed:'archive-world',islandSizeMeters:1024}),j=new WorldJournal(dir,b.worldKey);let e:DestructionStore|undefined;
 try{await j.loadWorld();const r=recordFor('border-wall',{kind:'wall-wood',x:511.8,y:0,z:12,variant:0,scale:1,rotation:0},[]);r.revision=3;r.volume.bricks={'0:0:0':new Int16Array(512).fill(-50)};expect(solidCells(r)).toContain('1:0');await j.append({kind:'edit',patch:{revision:7,solids:[r],removedBuilds:[],leveling:[],openings:[]}});
 e=new DestructionStore(b,{append:c=>j.append(c),loadCells:(keys,revision)=>j.cells(keys,revision)});e.revision=7;await e.hydrateCells(['1:0']);expect(b.scene.edits.get(r.id)?.volume.bricks['0:0:0']).toEqual(r.volume.bricks['0:0:0']);e.evictIdle();expect(b.scene.edits.has(r.id)).toBe(false);await j.checkpoint([]);await e.hydrateCells(['0:0']);expect(b.scene.edits.get(r.id)?.revision).toBe(3);
 }finally{e?.dispose();await j.close();rmSync(dir,{recursive:true,force:true});}
},30000);
it('updates existing Rapier queries without advancing falling bodies during collider installation',async()=>{
 await initializePhysics();const p=new SolidPhysics();try{const r=recordFor('body',{kind:'wall-wood',x:0,y:4,z:0,variant:0,scale:1,rotation:0},[]);r.fall={velocity:[0,0,0],angular:[0,0,0],started:Date.now(),persistent:false};p.add(r,[{center:[0,0,0],half:[1,1,1]}]);const y=p.states()[0].pose!.position[1];p.add({...r,id:'fixed',fall:undefined,prop:{...r.prop,x:3}},[{center:[0,0,0],half:[1,1,1]}]);p.movement([3,0,2],[0,0,-2],.32,2.16,.28,.3);expect(p.states().find(s=>s.id==='body')!.pose!.position[1]).toBe(y);}finally{p.dispose();}
});
it('recovers atomic journal records, truncated tails, and checkpoints in the new save format',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'island-journal-'));let j=new WorldJournal(dir,'unit-world');try{expect(await j.load()).toEqual([]);const state=new Character(flat);state.spawn(1,0,2);await j.append({kind:'players',players:[{id:'remembered-player',nickname:'Name',state:state.capture()}]});await j.close();const log=join(dir,readdirSync(dir).find(n=>n.endsWith('.bin'))!);appendFileSync(log,new Uint8Array([4,5,6]));j=new WorldJournal(dir,'unit-world');const loaded=await j.load();expect(loaded).toHaveLength(1);expect(loaded[0].players![0].state.feet).toEqual([1,0,2]);await j.checkpoint(loaded);await j.append({kind:'support',completeSupport:'a'});await j.close();j=new WorldJournal(dir,'unit-world');expect(await j.load()).toHaveLength(2);}finally{await j.close();rmSync(dir,{recursive:true,force:true});}
});
it('removes disconnected bodies and retains position and paused vitals on restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'island-player-')),config={seed:'player-state-test',islandSizeMeters:1024};let runtime=new WorldRuntime(config,dir,()=>{});
 try{await runtime.initialize();await runtime.join('one',{version:1,identity:'browser-identity-00001',nickname:'Cooperator'});const s=runtime.sessions.get('one')!;s.character.stamina=42;s.character.oxygen=23;const feet=[...s.character.feet];await runtime.leave('one');expect(runtime.sessions.size).toBe(0);await runtime.close();runtime=new WorldRuntime(config,dir,()=>{});await runtime.initialize();await runtime.join('one',{version:1,identity:'browser-identity-00001',nickname:'Cooperator'});const restored=runtime.sessions.get('one')!.character;expect(restored.stamina).toBeCloseTo(42,1);expect(restored.oxygen).toBeCloseTo(23,1);expect([...restored.feet]).toEqual(feet);expect(()=>runtime.inputs('one',[{seq:1,input:{...idleInput,x:999}}])).toThrow();}finally{await runtime.close();rmSync(dir,{recursive:true,force:true});}
},30000);
it('joins and reconnects one WebSocket client with bounded binary input and region loading',async()=>{
 const server=createWorldServer({seed:'one-client-network',islandSizeMeters:1024});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;let socket:WebSocket|undefined;
 try{expect((await fetch(base+'/api/actions',{method:'POST',body:'{}'})).status).toBe(405);socket=new WebSocket(base.replace('http','ws')+'/api/events');const events:any[]=[];socket.on('message',data=>events.push(decodeMessage(new Uint8Array(data as Buffer))));await new Promise<void>((r,j)=>{socket!.once('open',r);socket!.once('error',j);});
  const wait=async(type:string)=>{for(let i=0;i<1000;i++){const m=events.find(m=>m.type===type);if(m)return m;await new Promise(r=>setTimeout(r,10));}throw new Error('Missing '+type);};const hello=await wait('hello');socket.send(encodeMessage({type:'join',version:PROTOCOL_VERSION,identity:'browser-identity-single',nickname:'Single'}));const welcome=await wait('welcome');expect(welcome.state.oxygen).toBe(60);socket.send(encodeMessage({type:'inputs',steps:[{seq:1,input:idleInput}]}));const cell=`${Math.floor(welcome.state.feet[0]/512)}:${Math.floor(welcome.state.feet[2]/512)}`;socket.send(encodeMessage({type:'subscribe',cells:[cell],generation:1}));await wait('subscribed');const response=await fetch(base+`/api/builds?session=${hello.connection}&generation=1&cells=${cell}`);expect(response.ok).toBe(true);expect(decodeMessage(new Uint8Array(await response.arrayBuffer())).cells[0].key).toBe(cell);const closed=new Promise(r=>socket!.once('close',r));socket.close();await closed;expect((await fetch(base+`/api/builds?session=${hello.connection}&generation=1&cells=${cell}`)).status).toBe(400);events.length=0;socket=new WebSocket(base.replace('http','ws')+'/api/events');socket.on('message',data=>events.push(decodeMessage(new Uint8Array(data as Buffer))));await new Promise<void>((r,j)=>{socket!.once('open',r);socket!.once('error',j);});expect((await wait('hello')).connection).not.toBe(hello.connection);socket.send(encodeMessage({type:'join',version:PROTOCOL_VERSION,identity:'browser-identity-single',nickname:'Single'}));expect((await wait('welcome')).id).toBe(welcome.id);events.length=0;const rejected=new Promise<number>(r=>socket!.once('close',r));socket.send(encodeMessage(null));expect(await rejected).toBe(1008);
 }finally{socket?.terminate();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
