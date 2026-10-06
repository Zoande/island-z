import {WorldGenerator} from '../shared/world';
import {BuildScene} from '../shared/build-scene';
import {Character,CHARACTER,idleInput,type CharacterInput} from '../shared/character';
import {SimulationEnvironment} from '../shared/simulation';
import {initializePhysics} from '../shared/solid-physics';
import {encodeMessage,decodeMessage,PROTOCOL_VERSION,type InputStep,type PlayerState} from '../shared/network';
import type {WorldPatch,SolidRecord} from '../shared/destruction';
import {solidCells} from '../shared/destruction';
let socket:WebSocket|undefined,scene:BuildScene,environment:SimulationEnvironment,character:Character;
let identity='',nickname='',endpoint='',api='',connection='',worldKey='',input:CharacterInput=idleInput,seq=0,ack=0,simTime=0,serverTime=0,serverTick=0,connected=false,stopped=false;
let last=performance.now(),accumulator=0,lastSend=0,lastState=0,lastPing=0,backoff=500,retry=0;
let history:InputStep[]=[],outgoing:InputStep[]=[],remote=new Map<string,PlayerState>(),generation=0,wanted:string[]=[],subscription:Promise<void>=Promise.resolve(),subscribeResolve:()=>void=()=>{},subscribeReject:(e:Error)=>void=()=>{},buffered:any[]=[],bufferedBytes=0,loading=0,latestPlayers:any;
const commands=new Map<string,{rpc:number;request:any;kind:string;sent:number}>();
const metrics={sentBytes:0,receivedBytes:0,messages:0};
let lastMetrics=0;
function post(type:string,value:any={}){self.postMessage({type,...value});}
function send(m:any){if(socket?.readyState!==WebSocket.OPEN)return false;if(socket.bufferedAmount>128*1024){socket.close(1013,'Send queue full');return false;}const bytes=encodeMessage(m);metrics.sentBytes+=bytes.length;socket.send(bytes);return true;}
function flushInputs(){if(connected&&outgoing.length){send({type:'inputs',steps:outgoing.splice(0,24)});}}
function applyWorld(m:any){
 const patch=m.patch??m.edits as WorldPatch;for(const o of m.objects??[])scene.add(o);
 if(m.cells)for(const cell of m.cells){const incoming=new Set(cell.objects.map((o:any)=>o.id));for(const old of scene.placed.values())if(`${Math.floor(old.prop.x/512)}:${Math.floor(old.prop.z/512)}`===cell.key&&!incoming.has(old.id))scene.remove(old.id);for(const o of cell.objects)if(!scene.edits.get(o.id)?.removed)scene.add(o);}
 if(patch){for(const floor of patch.leveling??[])scene.keepLeveling(floor);for(const o of patch.openings??[])scene.setOpening(o.id,o.kind);for(const id of patch.removedBuilds??[])scene.remove(id,true);for(const r of patch.solids??[]){const old=scene.edits.get(r.id);if(!old||r.revision>old.revision||r.revision===old.revision&&!old.removed){scene.applyRecord(r);if(r.removed)environment.remove(r.id);}}}
 for(const c of m.collisions??[]){const r=scene.edits.get(c.id);if(r&&!r.removed&&r.revision===c.revision)environment.install(r,c.boxes);}
 post('world',{message:m});
}
function onMessage(m:any,bytes=0){
 if(m.type==='hello'){connection=m.connection;send({type:'join',version:PROTOCOL_VERSION,identity,nickname});return;}
 if(m.type==='welcome'){if(worldKey&&worldKey!==m.worldKey){stopped=true;socket?.close();post('fatal',{error:'The server world changed; reload to join it'});return;}worldKey=m.worldKey;character.restore(m.state);history=[];outgoing=[];remote.clear();latestPlayers=undefined;seq=ack=0;simTime=serverTime=m.time;serverTick=m.tick;connected=true;backoff=500;last=performance.now();accumulator=0;post('welcome',{message:m});if(wanted.length)subscribe(wanted,true);for(const [id,c]of commands){if(performance.now()-c.sent>30000){commands.delete(id);self.postMessage({rpc:c.rpc,error:'Confirmation expired; refresh world state before retrying'});}else send({type:'command',kind:c.kind,request:c.request,inputSeq:0});}return;}
 if(m.type==='subscribed'){if(m.generation===generation)subscribeResolve();return;}
 if(m.type==='players'){if(loading){latestPlayers=m;return;}serverTick=m.tick;serverTime=m.time;remote=new Map(m.players.map((p:PlayerState)=>[p.id,p]));const own=remote.get(identity);if(own){const correction=Math.hypot(...own.state.feet.map((v:number,i:number)=>v-character.feet[i]));ack=own.ack;history=history.filter(i=>i.seq>ack);character.restore(own.state);simTime=m.time;for(const h of history){character.update(CHARACTER.timestep,h.input);simTime+=CHARACTER.timestep;}post('players',{message:m,correction,pending:history.length,receivedAt:performance.timeOrigin+performance.now()});}return;}
 if(loading&&(m.type==='world'||m.type==='motion')){if(buffered.length>=128||(bufferedBytes+=bytes)>8*1024*1024){socket?.close(1013,'Region replay queue exceeded');return;}buffered.push(m);return;}
 if(m.type==='world'){applyWorld(m);return;}
 if(m.type==='motion'){for(const v of m.states){const r=scene.edits.get(v.id);if(r&&r.revision===v.revision){const next={...r,pose:v.pose,fall:v.fall};scene.edits.set(v.id,next);environment.pose(next);}}post('motion',{message:m});return;}
 if(m.type==='receipt'){const c=commands.get(m.id);if(c){commands.delete(m.id);self.postMessage({rpc:c.rpc,value:m.result});}return;}
 if(m.type==='pong'){post('metrics',{rtt:performance.now()-m.sent,serverTick,pending:history.length});return;}
 if(m.type==='error')post('status',{connected:false,error:m.error});
}
function connect(){if(stopped)return;const s=new WebSocket(endpoint);s.binaryType='arraybuffer';socket=s;s.onmessage=e=>{try{metrics.receivedBytes+=e.data.byteLength;metrics.messages++;onMessage(decodeMessage(new Uint8Array(e.data),32*1024*1024),e.data.byteLength);}catch(error){post('status',{connected:false,error:String(error)});s.close(1008,'Invalid server message');}};s.onclose=e=>{connected=false;if(e.code===1008){stopped=true;post('fatal',{error:e.reason||'The server rejected this session; retry to join'});}subscribeReject(new Error('Disconnected'));buffered=[];bufferedBytes=0;latestPlayers=undefined;post('status',{connected:false});retry=performance.now()+backoff;backoff=Math.min(10000,backoff*2);};s.onerror=()=>s.close();}
function evict(){const keep=(r:SolidRecord)=>solidCells(r).some(k=>wanted.includes(k))||[...commands.values()].some(c=>c.request.targetId===r.id);environment.retain(keep);for(const [id,r]of scene.edits)if(!keep(r)){scene.edits.delete(id);scene.damageCollision.delete(id);scene.editedCollisionReady.delete(id);}for(const s of scene.placed.values())if(!wanted.includes(`${Math.floor(s.prop.x/512)}:${Math.floor(s.prop.z/512)}`))scene.remove(s.id);for(const [id,f]of scene.leveling)if(!wanted.includes(`${Math.floor(f.position[0]/512)}:${Math.floor(f.position[2]/512)}`))scene.forgetLeveling(id);}
function subscribe(cells:string[],force=false){if(!force&&cells.join(',')===wanted.join(','))return;subscribeResolve();wanted=cells;generation++;if(!connected)return;subscription=new Promise((resolve,reject)=>{subscribeResolve=resolve;subscribeReject=reject;});subscription.catch(()=>{});send({type:'subscribe',cells,generation});evict();}
async function baseline(cells:string[]){const g=generation;await subscription;if(!connected||g!==generation)throw new Error('Obsolete region load');const cursor=serverTick;loading++;
 try{const snapshots:any[]=[];for(let i=0;i<cells.length;i+=16){const query=new URLSearchParams({cells:cells.slice(i,i+16).join(','),session:connection,generation:String(g)});const response=await fetch(`${api}/api/builds?${query}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Region load failed');const value=decodeMessage(new Uint8Array(await response.arrayBuffer()),32*1024*1024);if(g!==generation)throw new Error('Obsolete region load');applyWorld(value);snapshots.push(value);}
 const result={worldKey,revision:Math.max(...snapshots.map(s=>s.revision)),unchanged:false,cells:snapshots.flatMap(s=>s.cells),edits:{revision:Math.max(...snapshots.map(s=>s.edits.revision)),solids:snapshots.flatMap(s=>s.edits.solids),removedBuilds:[],leveling:snapshots.flatMap(s=>s.edits.leveling),openings:snapshots.flatMap(s=>s.edits.openings)},tick:cursor};return result;
 }finally{loading--;if(!loading){bufferedBytes=0;for(const m of buffered.splice(0))onMessage(m);if(latestPlayers){const m=latestPlayers;latestPlayers=undefined;onMessage(m);}evict();}}
}
self.onmessage=async(e:MessageEvent)=>{const m=e.data;try{
 if(m.type==='start'){await initializePhysics();identity=m.identity;nickname=m.nickname;endpoint=m.endpoint;api=m.api;scene=new BuildScene(new WorldGenerator(m.config));environment=new SimulationEnvironment(scene,identity,()=>[...remote.values()].map(p=>({id:p.id,feet:p.state.feet})),()=>simTime);character=new Character(environment);connect();}
 else if(m.type==='input')input=m.input;
 else if(m.type==='interest')subscribe(m.cells);
 else if(m.type==='baseline')self.postMessage({rpc:m.rpc,value:await baseline(m.cells)});
 else if(m.type==='command'){if(!connected)throw new Error('World disconnected; reconnecting');flushInputs();commands.set(m.request.requestId,{rpc:m.rpc,request:m.request,kind:m.kind,sent:performance.now()});send({type:'command',kind:m.kind,request:m.request,inputSeq:seq});}
 else if(m.type==='stop'){stopped=true;socket?.close();environment?.dispose();}
 }catch(error){if(m.rpc)self.postMessage({rpc:m.rpc,error:String(error)});else post('status',{connected:false,error:String(error)});}};
setInterval(()=>{const now=performance.now();if(stopped)return;if(!connected){if(character&&socket?.readyState===WebSocket.CLOSED&&now>=retry)connect();return;}
 accumulator+=Math.min(.1,(now-last)/1000);last=now;let count=0;while(accumulator>=CHARACTER.timestep&&count++<12){accumulator-=CHARACTER.timestep;if(history.length>=120){socket?.close(1013,'Prediction queue exceeded');break;}const step={seq:++seq,input:{...input,swimVector:input.swimVector&&[...input.swimVector]as [number,number,number]}};character.update(CHARACTER.timestep,step.input);simTime+=CHARACTER.timestep;history.push(step);outgoing.push(step);}
 if(now-lastSend>=1000/30){lastSend=now;flushInputs();}if(now-lastState>=1000/60){lastState=now;post('state',{state:character.capture(),time:simTime,connected});}if(now-lastPing>=5000){lastPing=now;send({type:'ping',sent:now});}
 if(now-lastMetrics>1000){lastMetrics=now;post('metrics',{...metrics,serverTick,pending:history.length});}
 for(const [id,c]of commands)if(now-c.sent>30000){commands.delete(id);self.postMessage({rpc:c.rpc,error:'Confirmation expired; reload the authoritative region before retrying'});}
},1000/120);
