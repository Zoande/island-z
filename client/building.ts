import type {PlayerCamera} from './camera';
import type {IslandRenderer} from './renderer';
import type {WorldGenerator} from '../shared/world';
import {BuildScene} from '../shared/build-scene';
import {solvePlacement,type Placement} from '../shared/build-placement';
import {BUILD_CELL,buildCell,buildProp,hotbarSlots,objectDefinition,validBuildObject,type BuildObject,type BuildRequest,type BuildResult} from '../shared/object-registry';
import {qualities} from './quality';
interface Snapshot {worldKey:string;revision:number;unchanged:boolean;cells:{key:string;objects:BuildObject[]}[]}
interface Cell {revision:number;objects:BuildObject[]}
export interface BuildTransport {
  snapshot(cells:string[],since:number|undefined,signal:AbortSignal):Promise<Snapshot>;
  place(request:BuildRequest,signal:AbortSignal):Promise<BuildResult>;
}
export const httpBuildTransport:BuildTransport={
  async snapshot(cells,since,signal){const query=new URLSearchParams({cells:cells.join(',')});if(since!==undefined)query.set('since',String(since));const response=await fetch(`/api/builds?${query}`,{signal,cache:'no-store'});if(!response.ok)throw new Error('Cannot load saved builds');return response.json();},
  async place(request,signal){const response=await fetch('/api/builds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});const result=await response.json();if(typeof result.ok!=='boolean')throw new Error('Invalid server confirmation');return result;},
};
const icons:Record<string,string>={rock:'<path d="M6 24 11 10 25 6 34 17 30 30 16 32Z"/><path d="m11 10 9 10 14-3M20 20l-4 12"/>',tree:'<path d="M17 32V20h6v12M20 4c-7 0-12 6-10 10-6 5-2 13 6 12h8c8 1 12-7 6-12C32 10 27 4 20 4Z"/>',wood:'<path d="M7 7h26v26H7ZM13 7v26M20 7v26M27 7v26M7 13h26M7 27h26"/>',stone:'<path d="M5 8h30v24H5ZM5 16h30M5 24h30M15 8v8M27 8v8M11 16v8M23 16v8M16 24v8M29 24v8"/>'};
/** Owns optimistic overlays and bounded region snapshots, independently of rendering. */
export class BuildingController {
  readonly scene:BuildScene;selected=8;variant=0;rotation=0;preview:Placement|null=null;
  readonly pending=new Map<string,BuildObject>();private confirmed=new Map<string,{object:BuildObject;revision:number}>();
  private cells=new Map<string,Cell>();private worldKey='';private connection='Connecting';private worldChanged=false;
  private polling=false;private lastPoll=-Infinity;private queue=Promise.resolve();private abort=new AbortController();
  private previousVariants=new Map<string,number>();private previewSignature='';private previousLook='';private lastMotion=0;
  private notice='';private noticeUntil=0;private hudSignature='';private disposed=false;
  constructor(readonly camera:PlayerCamera,world:WorldGenerator,readonly renderer:IslandRenderer,readonly transport:BuildTransport=httpBuildTransport) {
    this.scene=new BuildScene(world);renderer.buildScene=this.scene;
    const hotbar=document.getElementById('hotbar')!;
    hotbar.innerHTML=hotbarSlots.map((id,i)=>{const d=id?objectDefinition(id):null;return `<button class="hotbar-slot" data-slot="${i}" aria-label="${i+1}: ${d?.label??'Empty slot'}" aria-pressed="${i===this.selected}"><span class="slot-number">${i+1}</span>${d?`<svg viewBox="0 0 40 40" aria-hidden="true">${icons[d.icon]}</svg><span class="slot-label">${d.label}</span>`:''}</button>`;}).join('');
    const options={signal:this.abort.signal};
    hotbar.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-slot]');if(button)this.select(Number(button.dataset.slot));},options);
    window.addEventListener('keydown',e=>{if(document.pointerLockElement!==camera.canvas||e.repeat)return;if(/^Digit[1-9]$/.test(e.code)){e.preventDefault();this.select(Number(e.code.slice(-1))-1);}else if(e.code==='KeyR'&&hotbarSlots[this.selected]){e.preventDefault();this.rotate(Math.PI/2);}},options);
    camera.canvas.addEventListener('wheel',e=>{if(document.pointerLockElement!==camera.canvas||!hotbarSlots[this.selected])return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);this.rotate(Math.max(-5,Math.min(5,delta/100))*Math.PI/180);},{...options,passive:false});
    camera.canvas.addEventListener('click',e=>{if(e.button===0&&document.pointerLockElement===camera.canvas)this.place();},options);
  }
  select(slot:number) {
    if(!Number.isInteger(slot)||slot<0||slot>=hotbarSlots.length)return;this.selected=slot;this.rotation=0;this.noticeUntil=0;
    const id=hotbarSlots[slot];if(id){const variants=objectDefinition(id).variants.length,previous=this.previousVariants.get(id);this.variant=Math.floor(Math.random()*variants);if(variants>1&&this.variant===previous)this.variant=(this.variant+1+Math.floor(Math.random()*(variants-1)))%variants;this.previousVariants.set(id,this.variant);}
    this.previewSignature='';this.update(0);
  }
  private rotate(angle:number){if(this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top')return;this.rotation=(this.rotation+angle)%(Math.PI*2);this.previewSignature='';this.update(0);}
  private request(id='preview-00000000'):BuildRequest {
    return {requestId:id,worldKey:this.worldKey,definitionId:hotbarSlots[this.selected]!,variant:this.variant,rotation:this.rotation,
      eye:[...this.camera.position]as [number,number,number],direction:this.camera.forward,feet:[...this.camera.character.feet]as [number,number,number],standing:this.camera.character.grounded&&!this.camera.character.swimming};
  }
  update(_dt:number) {
    const now=performance.now(),look=`${this.camera.position.join(',')}/${this.camera.yaw}/${this.camera.pitch}`;
    if(look!==this.previousLook){this.previousLook=look;this.lastMotion=now;}
    const id=hotbarSlots[this.selected],signature=`${look}/${id}/${this.variant}/${this.rotation}/${this.scene.revision}/${this.camera.character.grounded}/${this.connection}`;
    if(signature!==this.previewSignature) {
      this.previewSignature=signature;this.preview=id&&this.camera.character.ready?solvePlacement(this.scene,this.request()):null;
      if(this.preview&&this.connection!=='Connected'){this.preview.valid=false;this.preview.reason=this.connection==='Connecting'?'Connecting building service':this.worldChanged?'World changed · refresh to build':'Building unavailable · retrying';}
    }
    this.renderer.buildPreview=this.preview?{prop:buildProp(this.preview.object),valid:this.preview.valid,motion:Math.max(0,1-(now-this.lastMotion)/450)}:null;
    this.updateHud(now);
    if(!this.polling&&!this.worldChanged&&now-this.lastPoll>2000)void this.sync();
  }
  private updateHud(now:number) {
    const id=hotbarSlots[this.selected],notice=now<this.noticeUntil?this.notice:'',reason=notice||this.preview?.reason||(!this.worldKey?'Connecting building service':'');
    const signature=`${this.selected}/${id}/${reason}/${this.preview?.valid}/${this.pending.size}`;if(signature===this.hudSignature)return;this.hudSignature=signature;
    document.querySelectorAll<HTMLElement>('.hotbar-slot').forEach((slot,i)=>{slot.classList.toggle('selected',i===this.selected);slot.setAttribute('aria-pressed',String(i===this.selected));});
    const hint=document.getElementById('build-hint')!;hint.textContent=id?`${objectDefinition(id).label} · ${reason}${this.pending.size?' · Saving…':''}`:notice||'1–9 select · empty slots put building away';
    hint.classList.toggle('invalid',!!notice||!!this.preview&&!this.preview.valid);
    const controls=document.getElementById('build-controls')!;controls.hidden=!id;
    controls.textContent=this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top'?'Left click stack · rotation follows the wall below':'Left click place · Wheel fine rotate · R turn 90°';
  }
  private notify(message:string){this.notice=message;this.noticeUntil=performance.now()+4500;this.hudSignature='';}
  place() {
    this.update(0);if(!this.preview)return;if(!this.preview.valid){this.notify(this.preview.reason);return;}
    this.noticeUntil=0;
    const request=this.request(crypto.randomUUID()),object={...this.preview.object,id:request.requestId};
    request.expected={position:[...object.position],rotation:object.rotation,support:{...object.support}};
    this.pending.set(object.id,object);this.scene.add(object);this.previewSignature='';
    // Serialize dependent snaps so a stacked/connected wall never outruns its parent.
    this.queue=this.queue.then(async()=>{
      if(!this.pending.has(object.id)||this.disposed)return;
      try {
        const result=await this.transport.place(request,AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)]));if(this.disposed)return;
        if(!result.ok){this.undo(object.id);this.notify(result.error);return;}
        if(!validBuildObject(result.object)||result.object.id!==object.id)throw new Error('Invalid placed object');
        this.pending.delete(object.id);this.confirmed.set(object.id,{object:result.object,revision:result.revision});this.scene.add(result.object);this.previewSignature='';
      }catch{if(this.disposed)return;this.undo(object.id);this.notify('Placement could not be confirmed · undone');this.connection='Disconnected';}
      this.lastPoll=-Infinity;
    });
  }
  private undo(id:string) {
    const dependent=[...this.pending.values()].filter(o=>o.support.kind==='wall'&&o.support.id===id);
    this.pending.delete(id);this.scene.remove(id);for(const o of dependent)this.undo(o.id);this.previewSignature='';
  }
  private wantedCells():string[] {
    const [x,,z]=this.camera.position,radius=qualities[this.renderer.quality].trees+BUILD_CELL,keys:string[]=[];
    for(let cz=Math.floor((z-radius)/BUILD_CELL);cz<=Math.floor((z+radius)/BUILD_CELL);cz++)for(let cx=Math.floor((x-radius)/BUILD_CELL);cx<=Math.floor((x+radius)/BUILD_CELL);cx++) {
      if(Math.hypot(Math.max(cx*BUILD_CELL-x,0,x-(cx+1)*BUILD_CELL),Math.max(cz*BUILD_CELL-z,0,z-(cz+1)*BUILD_CELL))<=radius)keys.push(`${cx}:${cz}`);
    }
    return keys;
  }
  async initialize(){await this.sync();}
  async sync() {
    if(this.polling||this.disposed||this.worldChanged)return;this.polling=true;this.lastPoll=performance.now();
    const keys=this.wantedCells(),wanted=new Set(keys),signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(7000)]);
    try {
      const groups:string[][]=[];for(let i=0;i<keys.length;i+=64)groups.push(keys.slice(i,i+64));
      const snapshots=await Promise.all(groups.map(group=>{const known=group.every(key=>this.cells.has(key)),since=known?Math.min(...group.map(key=>this.cells.get(key)!.revision)):undefined;return this.transport.snapshot(group,since,signal);}));
      if(this.disposed)return;
      for(const snapshot of snapshots) {
        if(this.worldKey&&snapshot.worldKey!==this.worldKey){this.worldChanged=true;throw new Error('Server world changed');}this.worldKey=snapshot.worldKey;
        if(snapshot.unchanged)continue;
        for(const cell of snapshot.cells){if(!wanted.has(cell.key)||cell.objects.some(o=>!validBuildObject(o)||buildCell(o.position[0],o.position[2])!==cell.key))throw new Error('Invalid saved build region');if((this.cells.get(cell.key)?.revision??-1)<=snapshot.revision)this.cells.set(cell.key,{revision:snapshot.revision,objects:cell.objects});}
      }
      for(const key of this.cells.keys())if(!wanted.has(key))this.cells.delete(key);
      const objects=new Map<string,BuildObject>();for(const cell of this.cells.values())for(const object of cell.objects)objects.set(object.id,object);
      for(const [id,confirmed]of this.confirmed){const key=buildCell(confirmed.object.position[0],confirmed.object.position[2]),cell=this.cells.get(key);if(!wanted.has(key)||cell&&cell.revision>=confirmed.revision&&objects.has(id))this.confirmed.delete(id);else objects.set(id,confirmed.object);}
      for(const object of this.pending.values())objects.set(object.id,object);
      for(const solid of this.scene.placed.values())if(!objects.has(solid.id))this.scene.remove(solid.id);
      for(const object of objects.values())if(JSON.stringify(this.scene.placed.get(object.id)?.object)!==JSON.stringify(object))this.scene.add(object);
      this.connection='Connected';
    }catch{if(!this.disposed)this.connection='Disconnected';}
    finally{this.polling=false;this.previewSignature='';}
  }
  dispose(){this.disposed=true;this.abort.abort();this.pending.clear();this.confirmed.clear();this.cells.clear();this.scene.placed.clear();this.renderer.buildPreview=null;this.renderer.buildScene=undefined;}
}
