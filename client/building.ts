import type {MultiplayerClient} from './multiplayer';
import type {PlayerCamera} from './camera';
import type {IslandRenderer} from './renderer';
import type {WorldGenerator} from '../shared/world';
import {BuildScene} from '../shared/build-scene';
import {solvePlacement,type Placement} from '../shared/build-placement';
import {BUILD_CELL,buildCell,buildProp,objectRegistry,objectDefinition,inventoryItem,validBuildObject,type BuildObject,type BuildRequest,type BuildResult,type DoorRequest} from '../shared/object-registry';
import {qualities} from './quality';
import {DestructionController} from './destruction';
import type {WorldPatch} from '../shared/destruction';
import {doorChange} from '../shared/door-interaction';
import {describeHud,itemDisplayName} from './interaction-context';
interface Snapshot {edits?:WorldPatch;worldKey:string;revision:number;unchanged:boolean;cells:{key:string;objects:BuildObject[]}[]}
interface Cell {revision:number;objects:BuildObject[]}
export interface BuildTransport {
  snapshot(cells:string[],since:number|undefined,signal:AbortSignal):Promise<Snapshot>;
  place(request:BuildRequest,signal:AbortSignal):Promise<BuildResult>;
  door?(request:DoorRequest,signal:AbortSignal):Promise<BuildResult>;
}
/** Owns optimistic overlays and bounded region snapshots, independently of rendering. */
export class BuildingController {
  network?:MultiplayerClient;private lastCellSignature='';
  readonly scene:BuildScene;readonly destruction:DestructionController;selected=8;variant=0;rotation=0;tilt=0;preview:Placement|null=null;
  readonly pending=new Map<string,BuildObject>();private confirmed=new Map<string,{object:BuildObject;revision:number}>();
  private cells=new Map<string,Cell>();private worldKey='';private connection='Connecting';private worldChanged=false;
  private polling=false;private lastPoll=-Infinity;private abort=new AbortController();
  menuOpen=false;private previewSignature='';private previousLook='';private lastMotion=0;
  private doorBusy=new Set<string>();private interaction:BuildObject|null=null;private interactionSignature='';
  get definitionId(){const stack=this.network?.inventory?.slots[this.selected];return stack&&objectRegistry.has(stack.item)?stack.item:undefined;}
  get selectedStack(){return this.network?.inventory?.slots[this.selected]??null;}
  get deskTarget(){const hit=this.scene.raycast([...this.camera.position]as [number,number,number],this.camera.forward,3);return hit?.solid?.object?.definitionId==='crafting-desk'?hit.solid.object:undefined;}
  private notice='';private noticeUntil=0;private hudSignature='';private disposed=false;
  constructor(readonly camera:PlayerCamera,world:WorldGenerator,readonly renderer:IslandRenderer,readonly transport:BuildTransport) {
    this.scene=new BuildScene(world);renderer.buildScene=this.scene;this.destruction=new DestructionController(this,camera,renderer,message=>this.notify(message));
    const options={signal:this.abort.signal};
    window.addEventListener('keydown',e=>{if(this.menuOpen||document.pointerLockElement!==camera.canvas||e.repeat)return;if(/^Digit[1-9]$/.test(e.code)){e.preventDefault();this.select(Number(e.code.slice(-1))-1);}else if(e.code==='KeyT'&&this.definitionId){e.preventDefault();if(objectDefinition(this.definitionId).family==='floor')this.adjustTilt(Math.PI/36);else this.rotate(Math.PI/2);}else if(e.code==='KeyF'){e.preventDefault();this.toggleDoor();}},options);
    camera.canvas.addEventListener('wheel',e=>{if(this.menuOpen||document.pointerLockElement!==camera.canvas||!this.definitionId)return;e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?100:1);if(objectDefinition(this.definitionId).family==='floor')this.adjustTilt(Math.max(-5,Math.min(5,delta/100))*Math.PI/180);else this.rotate(Math.max(-5,Math.min(5,delta/100))*Math.PI/180);},{...options,passive:false});
    camera.canvas.addEventListener('click',e=>{if(e.button===0&&document.pointerLockElement===camera.canvas)this.place();},options);
  }
  select(slot:number) {
    if(!Number.isInteger(slot)||slot<0||slot>=9)return;this.selected=slot;this.rotation=0;this.tilt=0;this.noticeUntil=0;
    this.network?.selectSlot(slot);
    this.variant=0;
    this.previewSignature='';this.update(0);
  }
  private rotate(angle:number){if(this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top'&&this.definitionId&&objectDefinition(this.definitionId).family==='wall')return;this.rotation=(this.rotation+angle)%(Math.PI*2);this.previewSignature='';this.update(0);}
  private adjustTilt(angle:number){this.tilt=Math.max(-Math.PI/6,Math.min(Math.PI/6,this.tilt+angle));this.previewSignature='';this.update(0);}
  private request(id='preview-00000000'):BuildRequest {
    return {requestId:id,worldKey:this.worldKey,definitionId:this.definitionId!,variant:this.variant,rotation:this.rotation,tilt:this.definitionId&&objectDefinition(this.definitionId).family==='floor'?this.tilt:undefined,
      eye:[...this.camera.position]as [number,number,number],direction:this.camera.forward,feet:[...this.camera.character.feet]as [number,number,number],standing:this.camera.character.grounded&&!this.camera.character.swimming&&!this.camera.character.crawling};
  }
  get worldIdentity(){return this.worldKey;}
  get connectionState(){return this.connection;}
  visibleCells(){return this.wantedCells();}
  update(_dt:number) {
    this.destruction.update();
    const now=performance.now(),look=`${this.camera.position.join(',')}/${this.camera.yaw}/${this.camera.pitch}`;
    if(look!==this.previousLook){this.previousLook=look;this.lastMotion=now;}
    const id=this.definitionId,signature=`${look}/${id}/${this.variant}/${this.rotation}/${this.tilt}/${this.scene.revision}/${this.camera.character.grounded}/${this.camera.character.crawling}/${this.camera.character.effects.canBuild}/${this.connection}/${this.destruction.active}/${this.menuOpen}`;
    if(signature!==this.previewSignature) {
      this.previewSignature=signature;this.preview=id&&!this.menuOpen&&!this.destruction.active&&this.camera.character.ready?solvePlacement(this.scene,this.request()):null;
      if(this.preview&&!this.camera.character.effects.canBuild){this.preview.valid=false;this.preview.reason='Your injuries prevent building';}
      if(this.preview&&this.connection!=='Connected'){this.preview.valid=false;this.preview.reason=this.connection==='Connecting'?'Connecting building service':this.worldChanged?'World changed · refresh to build':'Building unavailable · retrying';}
    }
    const interactionSignature=`${look}/${this.scene.revision}`;if(interactionSignature!==this.interactionSignature){this.interactionSignature=interactionSignature;this.interaction=null;
      const interactive=(o:BuildObject)=>o.definitionId==='crafting-desk'||objectDefinition(o.definitionId).attachment==='door';
      if(this.scene.placed.query(this.camera.position[0],this.camera.position[2],4).some(s=>s.object&&interactive(s.object))){const hit=this.scene.raycast([...this.camera.position]as [number,number,number],this.camera.forward,3);this.interaction=hit?.solid?.object&&interactive(hit.solid.object)?hit.solid.object:null;}
    }
    this.renderer.buildPreview=this.preview?{prop:buildProp(this.preview.object),valid:this.preview.valid,motion:Math.max(0,1-(now-this.lastMotion)/450)}:null;
    if(this.renderer.buildPreview&&this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='opening'){
      const parent=this.scene.placed.get(this.preview.object.support.id),prop=this.renderer.buildPreview.prop;if(parent){const c=Math.cos(parent.prop.rotation),s=Math.sin(parent.prop.rotation),side=(this.camera.position[0]-parent.prop.x)*s+(this.camera.position[2]-parent.prop.z)*c>=0?1:-1,depth=objectDefinition(parent.object!.definitionId).wall!.depth/2+.07;prop.x+=s*depth*side;prop.z+=c*depth*side;}
    }
    this.updateHud(now);
    const cells=this.wantedCells().join(',');if(this.network&&!this.network.connected)this.connection='Disconnected';if(!this.polling&&!this.worldChanged&&(cells!==this.lastCellSignature||this.connection!=='Connected'&&now-this.lastPoll>2000))void this.sync();
  }
  private updateHud(now:number) {
    const id=this.definitionId,notice=now<this.noticeUntil?this.notice:'',desk=this.interaction?.definitionId==='crafting-desk'?'E use crafting desk':'',door=this.interaction&&!desk?`F ${this.interaction.state?.open?'close':'open'} door`:'',interaction=desk||door,reason=notice||this.preview?.reason||(!this.worldKey?'Connecting building service':'');
    const target=this.destruction.targetContext,signature=`${this.selected}/${this.selectedStack?.item}/${id}/${reason}/${interaction}/${target}/${this.preview?.valid}/${this.pending.size}/${this.menuOpen}`;if(signature===this.hudSignature)return;this.hudSignature=signature;
    const controls=document.getElementById('build-controls')!;
    let buildControls:string|undefined;
    if(id){buildControls=objectDefinition(id).family==='floor'?'Click place · T tilt 5° · Wheel tilt 1°':'Click place · Wheel fine rotate · T turn 90°';
      if(objectDefinition(id).attachment)buildControls='Click attach · alignment follows the wall';
      if(this.preview?.object.support.kind==='wall'&&this.preview.object.support.socket==='top')buildControls=objectDefinition(id).family==='roof'?'Click place · T switch roof side':objectDefinition(id).family==='floor'?'Click connect · T / Wheel tilt':'Click stack · follows wall below';}
    const stack=this.selectedStack,itemName=itemDisplayName(stack?.item,id?objectDefinition(id).label:undefined,stack?inventoryItem(stack.item)?.label:undefined),hud=describeHud({itemName,placementReason:this.preview?.reason||(!this.worldKey?'Connecting building service':''),notice,pending:!!id&&this.pending.size>0,buildControls,target,interaction:target?'':interaction});
    const hint=document.getElementById('build-hint')!;hint.textContent=hud.hint;hint.classList.toggle('invalid',!!notice||!!this.preview&&!this.preview.valid);
    controls.textContent=hud.controls;controls.hidden=this.menuOpen;
  }
  private notify(message:string){this.notice=message;this.noticeUntil=performance.now()+4500;this.hudSignature='';}
  place() {
    this.update(0);if(this.menuOpen||this.destruction.active||!this.preview)return;if(!this.preview.valid){this.notify(this.preview.reason);return;}
    this.noticeUntil=0;
    const request=this.request(crypto.randomUUID()),object={...this.preview.object,id:request.requestId};
    request.expected={position:[...object.position],rotation:object.rotation,support:{...object.support},normal:[...object.normal]};
    this.pending.set(object.id,object);this.scene.add(object);this.previewSignature='';
    // Keep optimistic placement visible while its ordered server command is checked.
    void (async()=>{
      if(!this.pending.has(object.id)||this.disposed)return;
      try {
        const result=await this.transport.place(request,AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)]));if(this.disposed)return;if(!this.pending.has(object.id)){this.lastPoll=-Infinity;return;}
        if(!result.ok){this.undo(object.id);this.notify(result.error);this.lastPoll=-Infinity;return;}
        if(!validBuildObject(result.object)||result.object.id!==object.id)throw new Error('Invalid placed object');
        this.pending.delete(object.id);this.confirmed.set(object.id,{object:result.object,revision:result.revision});this.scene.add(result.object);this.previewSignature='';
      }catch{if(this.disposed)return;this.undo(object.id);this.notify('Confirmation lost; refreshing world state');this.connection='Disconnected';}
      this.lastPoll=-Infinity;
    })();
  }
  private undo(id:string) {
    const dependent=[...this.pending.values()].filter(o=>o.support.kind!=='terrain'&&o.support.id===id);
    this.pending.delete(id);this.scene.remove(id);for(const o of dependent)this.undo(o.id);this.previewSignature='';
  }
  toggleDoor(){this.update(0);const original=this.interaction;if(!original||objectDefinition(original.definitionId).attachment!=='door'||this.pending.has(original.id)||this.doorBusy.has(original.id)||this.connection!=='Connected'||!this.transport.door)return;
    const object={...original,state:{open:!original.state?.open}},request:DoorRequest={action:'door',requestId:crypto.randomUUID(),worldKey:this.worldKey,objectId:object.id,open:object.state.open,eye:[...this.camera.position]as [number,number,number],direction:this.camera.forward};
    const validation=doorChange(this.scene,request);if(!validation.ok){this.notify(validation.error);return;}
    this.doorBusy.add(object.id);this.pending.set(object.id,object);this.scene.add(object);this.previewSignature='';
    void (async()=>{try{const result=await this.transport.door!(request,AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)]));if(this.disposed)return;if(!result.ok){this.scene.add(original);this.notify(result.error);}else{if(!validBuildObject(result.object))throw new Error('Invalid door state');this.confirmed.set(object.id,{object:result.object,revision:result.revision});this.scene.add(result.object);}}catch{if(!this.disposed){this.scene.add(original);this.notify('Door change could not be confirmed');}}finally{this.pending.delete(object.id);this.doorBusy.delete(object.id);this.previewSignature='';this.lastPoll=-Infinity;}})();
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
    this.network?.setInterest(keys);
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
      this.connection='Connected';this.lastCellSignature=keys.join(',');
    }catch{if(!this.disposed)this.connection='Disconnected';}
    finally{this.polling=false;this.previewSignature='';}
  }
  acceptWorld(message:any){
    for(const object of message.objects??[])if(validBuildObject(object)){const key=buildCell(object.position[0],object.position[2]),cell=this.cells.get(key);if(cell){cell.objects=cell.objects.filter(o=>o.id!==object.id);cell.objects.push(object);}this.confirmed.set(object.id,{object,revision:message.buildRevision??0});if(!this.pending.has(object.id))this.scene.add(object);}
    const patch=message.patch??message.edits;
    if(patch){for(const id of patch.removedBuilds??[]){this.confirmed.delete(id);for(const cell of this.cells.values())cell.objects=cell.objects.filter(o=>o.id!==id);}this.destruction.accept(patch);}
    this.destruction.acceptCollisions(message.collisions??[]);this.previewSignature='';
  }
  dispose(){this.disposed=true;this.destruction.dispose();this.abort.abort();this.pending.clear();this.confirmed.clear();this.cells.clear();this.scene.placed.clear();this.renderer.buildPreview=null;this.renderer.buildScene=undefined;}
}
