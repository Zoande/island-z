import type {PlayerCamera} from './camera';
import type {IslandRenderer} from './renderer';
import type {WorldGenerator} from '../shared/world';
import {BuildScene} from '../shared/build-scene';
import {solvePlacement,type Placement} from '../shared/build-placement';
import {BUILD_CELL,buildCell,buildProp,hotbarSlots,catalogueChoices,objectDefinition,validBuildObject,type BuildObject,type BuildRequest,type BuildResult,type DoorRequest} from '../shared/object-registry';
import {qualities} from './quality';
import {DestructionController} from './destruction';
import type {WorldPatch} from '../shared/destruction';
import {doorChange} from '../shared/door-interaction';
interface Snapshot {edits?:WorldPatch;worldKey:string;revision:number;unchanged:boolean;cells:{key:string;objects:BuildObject[]}[]}
interface Cell {revision:number;objects:BuildObject[]}
export interface BuildTransport {
  snapshot(cells:string[],since:number|undefined,signal:AbortSignal):Promise<Snapshot>;
  place(request:BuildRequest,signal:AbortSignal):Promise<BuildResult>;
  door?(request:DoorRequest,signal:AbortSignal):Promise<BuildResult>;
}
export const httpBuildTransport:BuildTransport={
  async snapshot(cells,since,signal){const query=new URLSearchParams({cells:cells.join(',')});if(since!==undefined)query.set('since',String(since));const response=await fetch(`/api/builds?${query}`,{signal,cache:'no-store'});if(!response.ok)throw new Error('Cannot load saved builds');return response.json();},
  async place(request,signal){const response=await fetch('/api/builds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});const result=await response.json();if(typeof result.ok!=='boolean')throw new Error('Invalid server confirmation');return result;},
  async door(request,signal){const response=await fetch('/api/builds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});const result=await response.json();if(typeof result.ok!=='boolean')throw new Error('Invalid door confirmation');return result;},
};
const icons:Record<string,string>={rock:'<path d="M6 24 11 10 25 6 34 17 30 30 16 32Z"/><path d="m11 10 9 10 14-3M20 20l-4 12"/>',tree:'<path d="M17 32V20h6v12M20 4c-7 0-12 6-10 10-6 5-2 13 6 12h8c8 1 12-7 6-12C32 10 27 4 20 4Z"/>',wood:'<path d="M7 7h26v26H7ZM13 7v26M20 7v26M27 7v26M7 13h26M7 27h26"/>',stone:'<path d="M5 8h30v24H5ZM5 16h30M5 24h30M15 8v8M27 8v8M11 16v8M23 16v8M16 24v8M29 24v8"/>',torch:'<path d="M17 22h6l-1 13h-4ZM14 18h12l-3 5h-6ZM20 3c1 6 7 7 5 13-1 3-9 3-10 0-2-4 3-5 3-9 1 2 2 2 2-4Z"/>'};
/** Owns optimistic overlays and bounded region snapshots, independently of rendering. */
Object.assign(icons,{floor:'<path d="m4 22 16-9 16 9-16 9ZM4 22v5l16 9 16-9v-5M20 31v5M12 18l16 9M20 13l16 9"/>',roof:'<path d="m3 25 17-17 17 17M7 22v11h26V22M12 16l17 17M20 8l13 14"/>',fire:'<path d="m7 30 26 5M7 35l26-5M20 4c0 7 10 10 7 18-3 7-16 7-16-1 0-4 5-6 6-11 1 3 3 4 3-6Z"/>',bed:'<path d="M5 34V10h3v17h27v7M8 18h12v9M20 20h15v7M12 18v-5h7v5M5 30h30"/>',table:'<path d="M4 16h32v5H4ZM8 21v15M32 21v15M5 16l5-8h20l5 8M10 21h20"/>',chair:'<path d="M10 4h20v18H10ZM8 22h24v5H8ZM10 27v9M30 27v9M10 10h20M10 16h20"/>',door:'<path d="M7 36V4h26v32M12 9h17v27H12ZM24 22h2M12 14h17M12 30h17"/>',window:'<path d="M5 8h30v25H5ZM8 11h24v19H8ZM20 11v19M8 21h24M3 34h34"/>'});
export class BuildingController {
  readonly scene:BuildScene;readonly destruction:DestructionController;selected=8;variant=0;rotation=0;preview:Placement|null=null;
  readonly pending=new Map<string,BuildObject>();private confirmed=new Map<string,{object:BuildObject;revision:number}>();
  private cells=new Map<string,Cell>();private worldKey='';private connection='Connecting';private worldChanged=false;
  private polling=false;private lastPoll=-Infinity;private queue=Promise.resolve();private abort=new AbortController();
  private choices=new Map<number,number>();private previewSignature='';private previousLook='';private lastMotion=0;
  private doorBusy=new Set<string>();private interaction:BuildObject|null=null;private interactionSignature='';
  get definitionId(){return catalogueChoices(this.selected)[this.choices.get(this.selected)??0]?.definitionId;}
  private notice='';private noticeUntil=0;private hudSignature='';private disposed=false;
  constructor(readonly camera:PlayerCamera,world:WorldGenerator,readonly renderer:IslandRenderer,readonly transport:BuildTransport=httpBuildTransport) {
    this.scene=new BuildScene(world);renderer.buildScene=this.scene;this.destruction=new DestructionController(this,camera,renderer,message=>this.notify(message));
    const hotbar=document.getElementById('hotbar')!;
    hotbar.innerHTML=hotbarSlots.map((group,i)=>{const d=group?objectDefinition(group[0]):null;return `<button class="hotbar-slot" data-slot="${i}" aria-label="${i+1}: ${d?.label??'Empty slot'}" aria-pressed="${i===this.selected}"><span class="slot-number">${i+1}</span>${d?`<svg viewBox="0 0 40 40" aria-hidden="true">${icons[d.icon]??icons.wood}</svg><span class="slot-label">${d.label}</span><span class="slot-choices">1 / ${catalogueChoices(i).length}</span>`:'<span class="slot-label">Hands</span>'}</button>`;}).join('');
    const options={signal:this.abort.signal};
    hotbar.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-slot]');if(button)this.select(Number(button.dataset.slot));},options);
    window.addEventListener('keydown',e=>{if(document.pointerLockElement!==camera.canvas||e.repeat)return;if(/^Digit[1-9]$/.test(e.code)){e.preventDefault();this.select(Number(e.code.slice(-1))-1);}else if((e.code==='KeyQ'||e.code==='KeyE')&&hotbarSlots[this.selected]){e.preventDefault();this.cycle(e.code==='KeyQ'?-1:1);}else if(e.code==='KeyT'&&hotbarSlots[this.selected]){e.preventDefault();this.rotate(Math.PI/2);}else if(e.code==='KeyF'){e.preventDefault();this.toggleDoor();}},options);
    camera.canvas.addEventListener('wheel',e=>{if(document.pointerLockElement!==camera.canvas||!hotbarSlots[this.selected])return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);this.rotate(Math.max(-5,Math.min(5,delta/100))*Math.PI/180);},{...options,passive:false});
    camera.canvas.addEventListener('click',e=>{if(e.button===0&&document.pointerLockElement===camera.canvas)this.place();},options);
  }
  select(slot:number) {
    if(!Number.isInteger(slot)||slot<0||slot>=hotbarSlots.length)return;this.selected=slot;this.rotation=0;this.noticeUntil=0;
    this.variant=catalogueChoices(slot)[this.choices.get(slot)??0]?.variant??0;
    this.previewSignature='';this.update(0);
  }
  cycle(direction:number){const choices=catalogueChoices(this.selected);if(!choices.length)return;const index=((this.choices.get(this.selected)??0)+direction+choices.length)%choices.length;this.choices.set(this.selected,index);this.variant=choices[index].variant;this.noticeUntil=0;this.previewSignature='';this.hudSignature='';this.update(0);}
  private rotate(angle:number){if(this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top'&&this.definitionId&&objectDefinition(this.definitionId).family==='wall')return;this.rotation=(this.rotation+angle)%(Math.PI*2);this.previewSignature='';this.update(0);}
  private request(id='preview-00000000'):BuildRequest {
    return {requestId:id,worldKey:this.worldKey,definitionId:this.definitionId!,variant:this.variant,rotation:this.rotation,
      eye:[...this.camera.position]as [number,number,number],direction:this.camera.forward,feet:[...this.camera.character.feet]as [number,number,number],standing:this.camera.character.grounded&&!this.camera.character.swimming};
  }
  get worldIdentity(){return this.worldKey;}
  visibleCells(){return this.wantedCells();}
  update(_dt:number) {
    this.destruction.update();
    const now=performance.now(),look=`${this.camera.position.join(',')}/${this.camera.yaw}/${this.camera.pitch}`;
    if(look!==this.previousLook){this.previousLook=look;this.lastMotion=now;}
    const id=this.definitionId,signature=`${look}/${id}/${this.variant}/${this.rotation}/${this.scene.revision}/${this.camera.character.grounded}/${this.connection}/${this.destruction.active}`;
    if(signature!==this.previewSignature) {
      this.previewSignature=signature;this.preview=id&&!this.destruction.active&&this.camera.character.ready?solvePlacement(this.scene,this.request()):null;
      if(this.preview&&this.connection!=='Connected'){this.preview.valid=false;this.preview.reason=this.connection==='Connecting'?'Connecting building service':this.worldChanged?'World changed · refresh to build':'Building unavailable · retrying';}
    }
    const interactionSignature=`${look}/${this.scene.revision}`;if(interactionSignature!==this.interactionSignature){this.interactionSignature=interactionSignature;this.interaction=null;
      if(this.scene.placed.query(this.camera.position[0],this.camera.position[2],4).some(s=>s.object&&objectDefinition(s.object.definitionId).attachment==='door')){const hit=this.scene.raycast([...this.camera.position]as [number,number,number],this.camera.forward,3);this.interaction=hit?.solid?.object&&objectDefinition(hit.solid.object.definitionId).attachment==='door'?hit.solid.object:null;}
    }
    this.renderer.buildPreview=this.preview?{prop:buildProp(this.preview.object),valid:this.preview.valid,motion:Math.max(0,1-(now-this.lastMotion)/450)}:null;
    if(this.renderer.buildPreview&&this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='opening'){
      const parent=this.scene.placed.get(this.preview.object.support.id),prop=this.renderer.buildPreview.prop;if(parent){const c=Math.cos(parent.prop.rotation),s=Math.sin(parent.prop.rotation),side=(this.camera.position[0]-parent.prop.x)*s+(this.camera.position[2]-parent.prop.z)*c>=0?1:-1,depth=objectDefinition(parent.object!.definitionId).wall!.depth/2+.07;prop.x+=s*depth*side;prop.z+=c*depth*side;}
    }
    this.updateHud(now);
    if(!this.polling&&!this.worldChanged&&now-this.lastPoll>2000)void this.sync();
  }
  private updateHud(now:number) {
    const id=this.definitionId,notice=now<this.noticeUntil?this.notice:'',interaction=this.interaction?`F ${this.interaction.state?.open?'close':'open'} door`:'',reason=notice||this.preview?.reason||(!this.worldKey?'Connecting building service':'');
    const signature=`${this.selected}/${id}/${this.variant}/${reason}/${interaction}/${this.preview?.valid}/${this.pending.size}`;if(signature===this.hudSignature)return;this.hudSignature=signature;
    document.querySelectorAll<HTMLElement>('.hotbar-slot').forEach((slot,i)=>{slot.classList.toggle('selected',i===this.selected);slot.setAttribute('aria-pressed',String(i===this.selected));});
    const button=document.querySelector<HTMLElement>(`[data-slot="${this.selected}"]`);if(id&&button){const d=objectDefinition(id);button.querySelector('.slot-label')!.textContent=d.label;button.querySelector('.slot-choices')!.textContent=`${(this.choices.get(this.selected)??0)+1} / ${catalogueChoices(this.selected).length}`;button.querySelector('svg')!.innerHTML=icons[d.icon]??icons.wood;button.setAttribute('aria-label',`${this.selected+1}: ${d.label}, choice ${(this.choices.get(this.selected)??0)+1}`);}
    const hint=document.getElementById('build-hint')!;hint.textContent=id?`${objectDefinition(id).label} · ${reason}${this.pending.size?' · Saving…':''}`:notice||'1–8 build · Q / E cycle · 9 empty hands';
    hint.classList.toggle('invalid',!!notice||!!this.preview&&!this.preview.valid);
    const controls=document.getElementById('build-controls')!;controls.hidden=!id;
    controls.textContent='Q / E previous / next · Click place · Wheel fine rotate · T turn 90°';
    if(id&&objectDefinition(id).attachment)controls.textContent='Q / E cycle · Click attach · alignment follows the wall';
    if(id&&['floor','roof'].includes(objectDefinition(id).family)&&this.preview?.object.support.kind!=='terrain')controls.textContent='Q / E cycle · Click connect · alignment follows the support';
    if(id&&this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top')controls.textContent=objectDefinition(id).family==='roof'?'Q / E cycle · Click place · T switch roof side':'Q / E cycle · Click stack · rotation follows the wall below';
    controls.textContent+=' \u00b7 Right-click cut/dismantle \u00b7 Hold R repair';controls.hidden=false;
    if(interaction){hint.textContent+=` · ${interaction}`;controls.hidden=false;}
  }
  private notify(message:string){this.notice=message;this.noticeUntil=performance.now()+4500;this.hudSignature='';}
  place() {
    this.update(0);if(this.destruction.active||!this.preview)return;if(!this.preview.valid){this.notify(this.preview.reason);return;}
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
    const dependent=[...this.pending.values()].filter(o=>o.support.kind!=='terrain'&&o.support.id===id);
    this.pending.delete(id);this.scene.remove(id);for(const o of dependent)this.undo(o.id);this.previewSignature='';
  }
  toggleDoor(){this.update(0);const original=this.interaction;if(!original||this.pending.has(original.id)||this.doorBusy.has(original.id)||this.connection!=='Connected'||!this.transport.door)return;
    const object={...original,state:{open:!original.state?.open}},request:DoorRequest={action:'door',requestId:crypto.randomUUID(),worldKey:this.worldKey,objectId:object.id,open:object.state.open,eye:[...this.camera.position]as [number,number,number],direction:this.camera.forward};
    const validation=doorChange(this.scene,request);if(!validation.ok){this.notify(validation.error);return;}
    this.doorBusy.add(object.id);this.pending.set(object.id,object);this.scene.add(object);this.previewSignature='';
    this.queue=this.queue.then(async()=>{try{const result=await this.transport.door!(request,AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)]));if(this.disposed)return;if(!result.ok){this.scene.add(original);this.notify(result.error);}else{if(!validBuildObject(result.object))throw new Error('Invalid door state');this.confirmed.set(object.id,{object:result.object,revision:result.revision});this.scene.add(result.object);}}catch{if(!this.disposed){this.scene.add(original);this.notify('Door change could not be confirmed');}}finally{this.pending.delete(object.id);this.doorBusy.delete(object.id);this.previewSignature='';this.lastPoll=-Infinity;}});
  }
  private wantedCells():string[] {
    const [x,,z]=this.camera.position,radius=qualities[this.renderer.quality].trees+BUILD_CELL,keys:string[]=[];
    for(let cz=Math.floor((z-radius)/BUILD_CELL);cz<=Math.floor((z+radius)/BUILD_CELL);cz++)for(let cx=Math.floor((x-radius)/BUILD_CELL);cx<=Math.floor((x+radius)/BUILD_CELL);cx++) {
      if(Math.hypot(Math.max(cx*BUILD_CELL-x,0,x-(cx+1)*BUILD_CELL),Math.max(cz*BUILD_CELL-z,0,z-(cz+1)*BUILD_CELL))<=radius)keys.push(`${cx}:${cz}`);
    }
    return keys;
  }
  async initialize(){await this.destruction.initialize();await this.sync();}
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
        if(snapshot.edits)this.destruction.accept(snapshot.edits);
        for(const cell of snapshot.cells){if(!wanted.has(cell.key)||cell.objects.some(o=>!validBuildObject(o)||buildCell(o.position[0],o.position[2])!==cell.key))throw new Error('Invalid saved build region');if((this.cells.get(cell.key)?.revision??-1)<=snapshot.revision)this.cells.set(cell.key,{revision:snapshot.revision,objects:cell.objects});}
      }
      this.destruction.evict(wanted);
      for(const key of this.cells.keys())if(!wanted.has(key))this.cells.delete(key);
      const objects=new Map<string,BuildObject>();for(const cell of this.cells.values())for(const object of cell.objects)objects.set(object.id,object);
      for(const [id,confirmed]of this.confirmed){const key=buildCell(confirmed.object.position[0],confirmed.object.position[2]),cell=this.cells.get(key);if(!wanted.has(key)||cell&&cell.revision>=confirmed.revision)this.confirmed.delete(id);else objects.set(id,confirmed.object);}
      for(const object of this.pending.values())objects.set(object.id,object);
      for(const solid of this.scene.placed.values())if(!objects.has(solid.id))this.scene.remove(solid.id);
      for(const object of objects.values())if(!this.scene.edits.get(object.id)?.removed&&(JSON.stringify(this.scene.placed.get(object.id)?.object)!==JSON.stringify(object)))this.scene.add(object);
      this.connection='Connected';
    }catch{if(!this.disposed)this.connection='Disconnected';}
    finally{this.polling=false;this.previewSignature='';}
  }
  dispose(){this.disposed=true;this.destruction.dispose();this.abort.abort();this.pending.clear();this.confirmed.clear();this.cells.clear();this.scene.placed.clear();this.renderer.buildPreview=null;this.renderer.buildScene=undefined;}
}
