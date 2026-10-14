import type {WorldConfig} from '../shared/config';
import type {PlayerCamera} from './camera';
import type {BuildingController,BuildTransport} from './building';
import type {IslandRenderer} from './renderer';
import type {CharacterState,CharacterInput} from '../shared/character';
import {apiBase,socketURL} from './api';
import {RemotePlayerTimeline} from './remote-player-timeline';
import {InventoryPrediction} from './inventory-state';
export class MultiplayerClient {
 private worker:Worker;private rpc=0;private requests=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();private welcomeResolve:()=>void=()=>{};private welcomeReject:(e:Error)=>void=()=>{};
 readonly ready:Promise<void>;connected=false;worldTime=0;private state?:CharacterState;private appliedState?:CharacterState;private frames:any[]=[];private building?:BuildingController;private identity:string;
 private inventoryPrediction=new InventoryPrediction();
 selectedSlot=8;
 get inventory(){return this.inventoryPrediction.state;}
 readonly metrics={rtt:0,correction:0,pending:0,snapshotHz:0,sentBytes:0,receivedBytes:0,messages:0};private snapshotTimes:number[]=[];private remoteTimeline=new RemotePlayerTimeline();
 readonly transport:BuildTransport={snapshot:async cells=>this.request('baseline',{cells}),place:async request=>this.command('build',request),door:async request=>this.command('build',request)};
 constructor(config:WorldConfig,readonly camera:PlayerCamera,readonly renderer:IslandRenderer){
   this.ready=new Promise((resolve,reject)=>{this.welcomeResolve=resolve;this.welcomeReject=reject;});const key='island-z-player-v1';let saved:any;try{saved=JSON.parse(localStorage.getItem(key)??'null');}catch{}
   this.identity=saved?.id??crypto.randomUUID();let nickname=saved?.nickname;while(!nickname?.trim()||nickname.length>24){nickname=window.prompt('Choose your nickname (1–24 characters)',saved?.nickname??'Explorer');if(nickname===null)throw new Error('Choose a nickname to join');}try{localStorage.setItem(key,JSON.stringify({id:this.identity,nickname:nickname.trim()}));}catch{}
   this.worker=new Worker(new URL('./multiplayer.worker.ts',import.meta.url),{type:'module'});this.worker.onmessage=e=>this.receive(e.data);this.worker.onerror=e=>{this.welcomeReject(new Error(e.message));for(const p of this.requests.values())p.reject(new Error('Network worker stopped'));this.requests.clear();};this.worker.postMessage({type:'start',config,identity:this.identity,nickname:nickname.trim(),endpoint:socketURL(),api:apiBase});
   camera.onInput=input=>this.worker.postMessage({type:'input',input});camera.simulate=false;
 }
 attach(building:BuildingController){this.building=building;for(const frame of this.frames.splice(0))this.apply(frame);}
 private request(type:string,value:any){const rpc=++this.rpc;return new Promise<any>((resolve,reject)=>{this.requests.set(rpc,{resolve,reject});this.worker.postMessage({type,rpc,...value});});}
 async command(kind:string,request:any){
   if(!this.connected)throw new Error('World disconnected; reconnecting');
   this.inventoryPrediction.predict(kind,request);
   try{const result=await this.request('command',{kind,request});if(result.inventory)this.inventoryPrediction.accept(result.inventory,request.requestId);return result;}
   finally{this.inventoryPrediction.settle(request.requestId);}
 }
 setInterest(cells:string[]){this.worker.postMessage({type:'interest',cells});}
 selectSlot(slot:number){if(!Number.isInteger(slot)||slot<0||slot>8)return;this.selectedSlot=slot;this.worker.postMessage({type:'slot',slot});}
 private receive(m:any){if(m.rpc){const p=this.requests.get(m.rpc);if(p){this.requests.delete(m.rpc);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);}return;}
   if(m.type==='welcome'){this.connected=true;this.selectedSlot=m.message.selectedSlot??this.selectedSlot;this.inventoryPrediction.accept(m.message.inventory);this.building?.select(this.selectedSlot);this.remoteTimeline.reset();this.snapshotTimes=[];this.renderer.remotePlayers=[];this.state=m.message.state;this.camera.character.restore(this.state!);this.appliedState=this.state;this.camera.adoptStance?.(this.state!.stanceIntent??'stand');this.camera.update(0);this.welcomeResolve();}
   else if(m.type==='inventory')this.inventoryPrediction.accept(m.inventory,m.requestId);
   else if(m.type==='state'){this.state=m.state;this.worldTime=m.time;this.connected=m.connected;}
   else if(m.type==='status'){this.connected=m.connected;if(!m.connected){this.remoteTimeline.reset();this.renderer.remotePlayers=[];}if(m.error&&!this.state)this.welcomeReject(new Error(m.error));}
   else if(m.type==='fatal'){this.connected=false;this.remoteTimeline.reset();this.renderer.remotePlayers=[];this.welcomeReject(new Error(m.error));this.renderer.onFatal?.(m.error);}
   else if(m.type==='metrics')Object.assign(this.metrics,m);
   else if(m.type==='players'){const now=performance.now();this.snapshotTimes.push(now);while(this.snapshotTimes.length&&this.snapshotTimes[0]<now-2000)this.snapshotTimes.shift();this.metrics.snapshotHz=this.snapshotTimes.length>1?(this.snapshotTimes.length-1)*1000/Math.max(1,now-this.snapshotTimes[0]):0;this.metrics.correction=m.correction;this.metrics.pending=m.pending;this.remoteTimeline.push(m.message.time*1000,m.receivedAt,m.message.players.filter((p:any)=>p.id!==this.identity).map((p:any)=>({id:p.id,nickname:p.nickname,feet:p.state.feet,posture:p.state.posture??(p.state.crawling?'crawl':p.state.stanceIntent==='crouch'?'crouch':'stand'),respawns:p.state.respawns,velocity:p.state.velocity,grounded:p.state.grounded})));}
   else if(m.type==='world'||m.type==='motion'){if(this.building)this.apply(m);else this.frames.push(m);}
 }
 private apply(m:any){if(m.type==='world')this.building!.acceptWorld(m.message);else this.building!.destruction.acceptMotion(m.message);}
 update(){this.renderer.remotePlayers=this.remoteTimeline.sample(performance.timeOrigin+performance.now());if(this.state&&this.state!==this.appliedState){const respawns=this.camera.character.respawns;this.camera.character.restore(this.state);this.appliedState=this.state;if(respawns!==this.state.respawns){this.camera.keys.clear();this.camera.yaw=0;this.camera.pitch=-.04;this.camera.adoptStance('stand');this.camera.onInput?.({x:0,z:0,sprint:false,jump:false,stance:'stand'});}}this.camera.character.setHands(this.inventory.slots[this.selectedSlot]?.item,this.inventory.offhand?.item);this.camera.update(0);}
 dispose(){this.camera.onInput=undefined;this.worker.postMessage({type:'stop'});this.worker.terminate();for(const p of this.requests.values())p.reject(new Error('World disconnected'));this.requests.clear();}
}
