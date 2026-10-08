import {terrainCutCells} from '../shared/terrain-volume';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BuildStore} from './build-store';
import {materialNear,pointInSolid} from '../shared/solid-contact';
import {GeometryJobs} from './geometry-jobs';
import {solidCells,treeSolidAssets,brushSeed,DESTRUCTION,recordFor,actionBrush,openingBrush,destructionRule,validAction,worldPoint,localPoint,volumeRay,isTree,type SolidRecord,type WorldAction,type WorldPatch,type ActionResult} from '../shared/destruction';
import {SparseVolume,emptyVolume,sourceDistance,type VolumeState} from '../shared/volume';
import {objectDefinition,buildCell,type BuildObject} from '../shared/object-registry';
import type {Point3} from '../shared/rocks';
import type {SolidComponent} from '../shared/solid-components';
import {SpatialIndex} from '../shared/spatial-index';

export interface SavedEdit {schema:1;worldKey:string;requestId:string;fingerprint:string;patch:WorldPatch;analysis?:WorldAction}
/** Authoritative world edits. Checkpoints contain current bricks and poses. */
export class DestructionStore {
  readonly actors=new Map<string,{feet:Point3;touched:number}>();
  updateActor(id:string,feet:Point3){if(typeof id==='string'&&id.length<=100&&Array.isArray(feet)&&feet.length===3&&feet.every(n=>Number.isFinite(n)&&Math.abs(n)<1e8)){this.actors.set(id,{feet,touched:Date.now()});for(const [key,p]of this.actors)if(Date.now()-p.touched>5000)this.actors.delete(key);}}
  revision=0;readonly jobs=new GeometryJobs();readonly listeners=new Set<(patch:WorldPatch)=>void>();
  readonly timings:{stage:string;milliseconds:number}[]=[];
  private collisionData=new WeakMap<VolumeState,import('../shared/volume-collision').CollisionBox[]>();
  private receipts=new Map<string,SavedEdit>();private componentCache=new Map<string,{revision:number;components:SolidComponent[]}>();private collisionCache=new Map<string,{revision:number;boxes:import('../shared/volume-collision').CollisionBox[];volume:VolumeState}>();private cadence=new Map<string,number>();private queue=Promise.resolve();private lanes=new Map<string,Promise<unknown>>();private records=0;private stopped=false;private supportRunning?:Promise<void>;private supportRequests=new Map<string,WorldAction>();private geometryVersions=new Map<string,number>();private placementEpoch=0;
  constructor(readonly builds:BuildStore,readonly persistence:{append:(commit:import('./journal').WorldCommit)=>Promise<void>;loadCells?:(keys:string[],revision:number)=>Promise<SolidRecord[]>;protected?:()=>Point3[];activate?:(apply:()=>void)=>Promise<void>}={append:async()=>{}}){
    for(const kind of ['oak','birch','palm'])for(let i=0;i<(kind==='palm'?3:6);i++){const key=kind+'-'+i;if(!treeSolidAssets.has(key))treeSolidAssets.set(key,JSON.parse(readFileSync(new URL('../public/models/'+key+'-solid.json',import.meta.url),'utf8')));}
  }
  private activate(apply:()=>void){return this.persistence.activate?this.persistence.activate(apply):Promise.resolve(apply());}
  restore(saved:import('./journal').WorldCommit){
    if(saved.object){this.builds.accept(saved.object);if(saved.requestId&&saved.fingerprint)this.builds.remember(saved.requestId,saved.fingerprint,saved.result as any);this.placementEpoch++;}
    if(saved.patch)this.apply(saved.patch,false);
    if(saved.kind==='edit'&&saved.requestId&&saved.fingerprint&&saved.patch)this.remember({schema:1,worldKey:this.builds.worldKey,requestId:saved.requestId,fingerprint:saved.fingerprint,patch:saved.patch});
    if(saved.analysis)this.supportRequests.set(saved.analysis.targetId,saved.analysis);
    if(saved.completeSupport)this.supportRequests.delete(saved.completeSupport);
  }
  resumeSupport(){this.startSupport();}
  async idle(){await Promise.all([...this.lanes.values()]);await this.queue;await this.flushSupport();}
  checkpoint():import('./journal').WorldCommit[]{return [...this.builds.scene.placed.values().map(s=>({kind:'build' as const,object:s.object!})),{kind:'edit',patch:{revision:this.revision,solids:[...this.builds.scene.edits.values()],removedBuilds:[...this.builds.scene.edits.values()].filter(r=>r.removed).map(r=>r.id),leveling:[...this.builds.scene.leveling.values()],openings:[...this.builds.scene.openings].map(([id,kind])=>({id,kind}))}},...[...this.supportRequests.values()].map(analysis=>({kind:'support' as const,analysis}))];}

  private measure(stage:string,start:number){this.timings.push({stage,milliseconds:performance.now()-start});if(this.timings.length>300)this.timings.shift();}
  snapshot(keys:string[]){const wanted=new Set(keys),scene=this.builds.scene;const result={revision:this.revision,solids:[...scene.edits.values()].filter(r=>solidCells(r).some(k=>wanted.has(k))),leveling:[...scene.leveling.values()].filter(o=>wanted.has(buildCell(o.position[0],o.position[2]))),openings:[...scene.openings].filter(([id])=>{const r=scene.placed.get(id);return r&&wanted.has(buildCell(r.prop.x,r.prop.z));}).map(([id,kind])=>({id,kind})),removedBuilds:[]};this.pruneResident();return result;}
  action(value:unknown):Promise<ActionResult>{const key=(value as any)?.targetId??'invalid',previous=this.lanes.get(key)??Promise.resolve();const task=previous.catch(()=>{}).then(async()=>{const start=performance.now();try{return await this.perform(value);}finally{this.measure('acknowledgement',start);}});this.lanes.set(key,task);void task.finally(()=>{if(this.lanes.get(key)===task)this.lanes.delete(key);}).catch(()=>{});return task;}
  place(value:unknown):Promise<import('../shared/object-registry').BuildResult>{const task=this.queue.then(async()=>{
    const input=value as any;if(Array.isArray(input?.eye))await this.hydrateNear(input.eye[0],input.eye[2]);
    await this.prepareCollisions([...this.builds.scene.edits.values()].filter(r=>{const p=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z];return !r.removed&&Math.hypot(p[0]-(input.eye?.[0]??0),p[2]-(input.eye?.[2]??0))<40;}));
    const prepared=this.builds.prepare(value),result=prepared.result;if(!result.ok||!prepared.fresh)return result;
    const patch=this.placementPatch(result.object);patch.objects=[result.object];await this.cookCollisions(patch.solids);
    try{await this.persistence.append({kind:'build',object:result.object,patch,requestId:input.requestId,fingerprint:prepared.fingerprint,result});}catch{return {ok:false,code:'save',error:'The server could not save this placement'}as const;}
    await this.activate(()=>{this.builds.accept(result.object);this.builds.remember(input.requestId,prepared.fingerprint!,result);this.placementEpoch++;this.apply(patch);});return result;
  });this.queue=task.then(()=>{},()=>{});return task;}
  integratePlacement(object:BuildObject):Promise<void>{const task=this.queue.then(async()=>{const patch=this.placementPatch(object);if(!patch.solids.length)return;await this.persistence.append({kind:'edit',patch});await this.activate(()=>this.apply(patch));});this.queue=task.then(()=>{},()=>{});return task;}
  private placementPatch(object:BuildObject):WorldPatch{
    const patch:WorldPatch={revision:this.revision+1,solids:[],removedBuilds:[],leveling:[],openings:[]},kind=objectDefinition(object.definitionId).attachment;
    if(object.support.kind!=='wall'||!['door','window'].includes(kind??''))return patch;
    const parent=this.builds.scene.placed.get(object.support.id),old=this.builds.scene.edits.get(object.support.id);if(!parent||!old)return patch;
    const v=new SparseVolume(old.source,old.volume);if(!v.edit(openingBrush(old,kind as 'door'|'window')))return patch;
    patch.solids.push({...old,volume:v.state,opening:kind as 'door'|'window',revision:old.revision+1});patch.openings.push({id:parent.id,kind:kind as 'door'|'window'});return patch;
  }
  private async perform(value:unknown):Promise<ActionResult>{
    const fail=(code:string,error:string):ActionResult=>({ok:false,code,error});if(!validAction(value))return fail('request','Invalid destruction request');const a=value as WorldAction,placementAtStart=this.placementEpoch;
    if(a.worldKey!==this.builds.worldKey)return fail('world','World changed · refresh the game');const fingerprint=createHash('sha256').update(JSON.stringify(a)).digest('hex'),receipt=this.receipts.get(a.requestId);if(receipt)return receipt.fingerprint===fingerprint?{ok:true,patch:receipt.patch,requestId:a.requestId}:fail('request-id','Action ID was reused');
    const now=a.actionTime??Date.now();if(now-(this.cadence.get(a.sessionId)??-Infinity)<DESTRUCTION.intervalMs-15)return fail('cadence','Wait for the next stroke');
    await this.hydrateNear(a.eye[0],a.eye[2]);const scene=this.builds.scene,hit=scene.raycast(a.eye,a.direction,DESTRUCTION.reach,a.action==='repair',true);if(!hit?.solid||hit.solid.id!==a.targetId)return fail('target','Target moved or is out of reach');
    const solid=hit.solid,old=scene.edits.get(solid.id);if((old?.revision??0)!==a.targetRevision)return fail('revision','Target changed · aim again');const rule=destructionRule(solid.prop);if(!rule)return fail('target','This object cannot be destroyed');
    if(a.action==='repair'&&(!solid.object||!rule.repairable||old?.fall))return fail('repair','Only surviving built walls, floors, and roofs can be repaired');
    if(a.action==='dismantle'&&rule.mode!=='whole'||a.action==='cut'&&rule.mode==='whole')return fail('mode','Wrong action for this object');
    const patch:WorldPatch={revision:this.revision+1,actionId:a.requestId,solids:[],removedBuilds:[],leveling:[],openings:[]};let record=old??solid.record??recordFor(solid.id,solid.prop,scene.rocks,solid.object);const terrainReads=new Map<string,number>();
    if(a.action==='dismantle'){
      record={...record,removed:true,revision:record.revision+1};patch.solids.push(record);patch.removedBuilds.push(record.id);
      const o=solid.object;if(o?.support.kind==='wall'&&['door','window'].includes(objectDefinition(o.definitionId).attachment??'')){patch.openings.push({id:o.support.id,kind:objectDefinition(o.definitionId).attachment as 'door'|'window'});const parent=scene.placed.get(o.support.id);if(parent){let r=scene.edits.get(parent.id)??recordFor(parent.id,parent.prop,scene.rocks,parent.object),v=new SparseVolume(r.source,r.volume);v.edit(openingBrush(r,objectDefinition(o.definitionId).attachment as 'door'|'window'));patch.solids.push({...r,opening:objectDefinition(o.definitionId).attachment as 'door'|'window',volume:v.state,revision:r.revision+1});}}
    }else if(record.prop.kind==='terrain'){
      const brush=actionBrush(record,hit.point,a.direction,false,brushSeed(a.requestId));
      const cells=terrainCutCells(record,brush).map(point=>scene.terrainRecord(point));
      for(const r of cells)terrainReads.set(r.id,r.revision);
      for(const r of cells){const b={...brush,center:hit.point.map((v,k)=>v-[r.prop.x,r.prop.y,r.prop.z][k])as Point3,noiseOrigin:[r.prop.x,r.prop.y,r.prop.z]as Point3},job=await this.jobs.run({task:'edit',source:r.source,state:r.volume,brush:b});if(job.result.changed)patch.solids.push({...r,volume:job.result.state,revision:r.revision+1});}
      if(!patch.solids.length)return fail('unchanged','No ground material hit');
      record=patch.solids.find(r=>r.id===record.id)??record;
    }else{
      const start=performance.now(),volume=new SparseVolume(record.source,record.volume);if(!old&&record.opening)volume.edit(openingBrush(record,record.opening));
      const brush=actionBrush(record,hit.point,a.direction,a.action==='repair',brushSeed(a.requestId));
      const players=[a.feet,...[...this.actors].filter(([id,p])=>id!==a.sessionId&&Date.now()-p.touched<5000).map(([,p])=>p.feet)];
      const obstacles=a.action==='repair'?scene.nearby(hit.point[0],hit.point[2],1):[];
      const allowed=a.action==='repair'?(p:Point3)=>{const w=worldPoint(record,p);if(players.some(feet=>Math.hypot(w[0]-feet[0],w[2]-feet[2])<.39&&w[1]>feet[1]-.025&&w[1]<feet[1]+2.19))return false;for(const other of obstacles){if(other.id===record.id)continue;if(other.object?.support.kind==='wall'&&other.object.support.id===record.id&&['door','window'].includes(objectDefinition(other.object.definitionId).attachment??'')){const o=openingBrush(record,objectDefinition(other.object.definitionId).attachment as 'door'|'window');if(Math.abs(p[0])<o.box![0]+.025&&Math.abs(p[1]-o.center[1])<o.box![1]+.025)return false;}else if(pointInSolid(other,w))return false;}return true;}:undefined;
      const changed=a.action==='repair'?volume.edit(brush,true,allowed):await this.jobs.run({task:'edit',source:record.source,state:volume.state,brush}).then(job=>{Object.assign(volume.state,job.result.state);return job.result.changed;});if(!changed)return fail('unchanged',a.action==='repair'?'Nothing repairable here':'No solid material hit');this.measure('edit',start);
      record={...record,volume:volume.state,revision:record.revision+1,fall:record.fall&&{...record.fall,settled:undefined}};
      if(a.action==='repair'&&record.opening&&!scene.placed.query(record.prop.x,record.prop.z,3).some(s=>s.object?.support.kind==='wall'&&s.object.support.id===record.id&&['door','window'].includes(objectDefinition(s.object.definitionId).attachment??''))){const opening=openingBrush(record,record.opening),box=opening.box!;let missing=false;for(let y=opening.center[1]-box[1]+.05;y<opening.center[1]+box[1]&&!missing;y+=.05)for(let x=-box[0]+.05;x<box[0]&&!missing;x+=.05)for(let z=-box[2]/2+.025;z<box[2]/2;z+=.025)if(volume.distance([x,y,z])>0){missing=true;break;}if(!missing){record={...record,opening:undefined};patch.openings.push({id:record.id,kind:null});}}
      patch.solids.push(record);
    }
    if(record.object&&objectDefinition(record.object.definitionId).family==='floor')patch.leveling.push(record.object);
    if(a.action==='repair'){const start=performance.now();try{await this.support(patch,a);}catch(error){if(error instanceof Error&&error.message==='unsupported-repair')return fail('support','Repair from an edge connected to supported material');throw error;}this.measure('support',start);}
    await this.cookCollisions(patch.solids);
    const task=this.queue.then(async()=>{
      if([...terrainReads].some(([id,revision])=>(scene.edits.get(id)?.revision??0)!==revision))return fail('revision','Ground changed; aim again');
      const current=scene.edits.get(a.targetId);if((current?.revision??0)!==a.targetRevision||a.action==='repair'&&placementAtStart!==this.placementEpoch)return fail('revision','Target or its support changed; aim again');
      const commitNow=a.actionTime??Date.now();if(commitNow-(this.cadence.get(a.sessionId)??-Infinity)<DESTRUCTION.intervalMs-15)return fail('cadence','Wait for the next stroke');
      patch.revision=this.revision+1;const saved:SavedEdit={schema:1,worldKey:this.builds.worldKey,requestId:a.requestId,fingerprint,patch,analysis:a.action!=='repair'&&record.prop.kind!=='terrain'?a:undefined};
      try{await this.persistence.append({kind:'edit',patch,requestId:saved.requestId,fingerprint:saved.fingerprint,analysis:saved.analysis,result:{ok:true,patch,requestId:a.requestId}});}catch{return fail('save','The server could not save this change');}
      this.cadence.set(a.sessionId,commitNow);for(const [id,time]of this.cadence)if(commitNow-time>60000)this.cadence.delete(id);this.remember(saved);await this.activate(()=>this.apply(patch,true));
      if(a.action!=='repair'&&record.prop.kind!=='terrain'){this.supportRequests.set(a.targetId,a);setImmediate(()=>this.startSupport());}this.records++;return {ok:true,patch,requestId:a.requestId}as ActionResult;
    });this.queue=task.then(()=>{},()=>{});return task;

  }
  /** Damage is durable before acknowledgement. Connectivity is queued separately,
   * coalesced per target, and may only publish against the revisions it read. */
  private startSupport(){if(this.stopped||this.supportRunning||!this.supportRequests.size)return;this.supportRunning=this.drainSupport().catch(error=>{if(!this.stopped)console.error('Support analysis:',error);}).finally(()=>{this.supportRunning=undefined;if(!this.stopped&&this.supportRequests.size)setImmediate(()=>this.startSupport());});}
  async flushSupport(){while(!this.stopped&&(this.supportRequests.size||this.supportRunning)){this.startSupport();await this.supportRunning;}}
  private async drainSupport(){while(!this.stopped&&this.supportRequests.size){
    const [id,action]=this.supportRequests.entries().next().value!,record=this.builds.scene.edits.get(id);if(!record){this.supportRequests.delete(id);continue;}
    const patch:WorldPatch={revision:0,solids:[record],removedBuilds:[],leveling:[],openings:[]},reads=new Map<string,number>(),parents=new Map<string,string>(),placement=this.placementEpoch,terrain=this.builds.scene.terrainRevision,start=performance.now();
    await this.support(patch,action,reads,parents);this.measure('support',start);if(this.stopped)return;
    patch.solids=patch.solids.filter(r=>{const old=this.builds.scene.edits.get(r.id);return !old||r.volume!==old.volume||r.removed!==old.removed;}).map(r=>{const old=this.builds.scene.edits.get(r.id);return old?{...r,pose:old.pose,fall:old.fall,revision:Math.max(r.revision,old.revision+1)}:r;});
    await this.cookCollisions(patch.solids);
    const commit=this.queue.then(async()=>{
      if(this.stopped)return;
      if(placement!==this.placementEpoch||terrain!==this.builds.scene.terrainRevision||[...reads].some(([key,version])=>(this.geometryVersions.get(key)??0)!==version))return;
      patch.solids=patch.solids.map(r=>{const old=this.builds.scene.edits.get(r.id),parent=this.builds.scene.edits.get(parents?.get(r.id)??'');return parent?.pose&&!old?{...r,pose:parent.pose,fall:r.fall&&{...r.fall,velocity:parent.fall?.velocity??r.fall.velocity,angular:parent.fall?.angular??r.fall.angular}}:r;});
      if(patch.solids.length){patch.revision=this.revision+1;const saved:SavedEdit={schema:1,worldKey:this.builds.worldKey,requestId:'support-'+action.requestId,fingerprint:'support',patch};await this.cookCollisions(patch.solids);if(placement!==this.placementEpoch||terrain!==this.builds.scene.terrainRevision||[...reads].some(([key,version])=>(this.geometryVersions.get(key)??0)!==version))return;await this.persistence.append({kind:'support',patch,completeSupport:id});await this.activate(()=>this.apply(patch));this.records++;}
      if(this.supportRequests.get(id)?.requestId===action.requestId){if(!patch.solids.length)await this.persistence.append({kind:'support',completeSupport:id});this.supportRequests.delete(id);}
    });this.queue=commit.then(()=>{},()=>{});await commit;
  }}
  private async support(patch:WorldPatch,a:WorldAction,reads?:Map<string,number>,parents?:Map<string,string>){
    const scene=this.builds.scene,changed=patch.solids[0];if(!changed)return;
    const center=changed.pose?.position??[changed.prop.x,changed.prop.y,changed.prop.z],nearby=scene.nearby(center[0],center[2],35).filter(s=>destructionRule(s.prop));
    const records=new Map<string,SolidRecord>(nearby.map(s=>[s.id,scene.edits.get(s.id)??recordFor(s.id,s.prop,scene.rocks,s.object)]));for(const r of patch.solids)records.set(r.id,r);if(reads)for(const id of records.keys())reads.set(id,this.geometryVersions.get(id)??0);
    const frontier=[...records.values()];for(let i=0;i<frontier.length;i++){const r=frontier[i];await this.hydrateCells([buildCell(r.prop.x,r.prop.z)]);for(const s of scene.placed.query(r.pose?.position[0]??r.prop.x,r.pose?.position[2]??r.prop.z,5))if(!records.has(s.id)&&destructionRule(s.prop)){const next=scene.edits.get(s.id)??recordFor(s.id,s.prop,scene.rocks,s.object);records.set(s.id,next);reads?.set(s.id,this.geometryVersions.get(s.id)??0);frontier.push(next);}if(i%32===31)await new Promise<void>(resolve=>setImmediate(resolve));}
    if(reads)for(const id of records.keys())if(!reads.has(id))reads.set(id,this.geometryVersions.get(id)??0);
    const nodes:{record:SolidRecord;component?:SolidComponent;points:Point3[];ground:boolean;bounds:[Point3,Point3]}[]=[];
    for(const r of records.values()){
      if(r.removed||r.fall&&!r.fall.settled&&r.id!==changed.id)continue;const edited=r.id===changed.id&&a.action!=='dismantle'||!!r.volume.mask||!!r.volume.clips?.length||!!Object.keys(r.volume.bricks).length;
      let components:SolidComponent[]|undefined;if(edited){const cached=this.componentCache.get(r.id);if(cached?.revision===r.revision)components=cached.components;else{const job=await this.jobs.run({task:'components',source:r.source,state:r.volume,step:.025});components=job.result;this.componentCache.set(r.id,{revision:r.revision,components:components!});while(this.componentCache.size>16)this.componentCache.delete(this.componentCache.keys().next().value!);}}
      const groups=components??[{points:r.prop.kind==='rock'?scene.rocks[r.prop.variant]:[...r.source.primitives.flatMap(p=>p.type==='box'?boxSupportPoints(p.center,p.half):'a'in p?[p.a,p.b]:[p.bounds[0],p.bounds[1]])]as Point3[],bounds:r.source.bounds}];
      if(!groups.length){const index=patch.solids.findIndex(s=>s.id===r.id);if(index>=0)patch.solids[index]={...r,removed:true};patch.removedBuilds.push(r.id);continue;}
      for(const c of groups){const definition=r.object?objectDefinition(r.object.definitionId):undefined,samples=definition?.attachment==='door'?([.35,1.1,1.9].map(y=>[r.object?.state?.open ? .55 : -.55,y,0])as Point3[]):definition?.supportSamples??c.points,points=samples.map(p=>worldPoint(r,p)),corners=[0,1,2,3,4,5,6,7].map(n=>worldPoint(r,[c.bounds[n&1?1:0][0],c.bounds[n&2?1:0][1],c.bounds[n&4?1:0][2]])),bounds:[Point3,Point3]=[[0,1,2].map(i=>Math.min(...corners.map(p=>p[i])))as Point3,[0,1,2].map(i=>Math.max(...corners.map(p=>p[i])))as Point3];nodes.push({record:r,component:components?c as SolidComponent:undefined,points,ground:!definition?.attachment&&points.some(p=>scene.groundDistance(p)<=.055),bounds});}
    }
    const contacts=new SpatialIndex<(typeof nodes)[number]>(16),anchored=nodes.filter(n=>n.ground);let slice=performance.now();
    for(let i=0;i<nodes.length;i++){const n=nodes[i];contacts.insert(String(i),n,(n.bounds[0][0]+n.bounds[1][0])/2,(n.bounds[0][2]+n.bounds[1][2])/2,Math.hypot(n.bounds[1][0]-n.bounds[0][0],n.bounds[1][2]-n.bounds[0][2])/2+.065);}
    for(let i=0;i<anchored.length;i++){const other=anchored[i],v=new SparseVolume(other.record.source,other.component?{...other.record.volume,mask:other.component.mask}:other.record.volume),radius=Math.hypot(other.bounds[1][0]-other.bounds[0][0],other.bounds[1][2]-other.bounds[0][2])/2+.065;
      for(const node of contacts.query((other.bounds[0][0]+other.bounds[1][0])/2,(other.bounds[0][2]+other.bounds[1][2])/2,radius)){
        if(node.ground||other.record.id===node.record.id||![0,1,2].every(k=>node.bounds[0][k]<=other.bounds[1][k]+.065&&node.bounds[1][k]>=other.bounds[0][k]-.065))continue;
        for(let j=0;j<node.points.length;j++){if(j%128===0&&performance.now()-slice>5){await new Promise<void>(resolve=>setImmediate(resolve));slice=performance.now();}if(materialNear(v,localPoint(other.record,node.points[j]),.045/other.record.prop.scale)){node.ground=true;anchored.push(node);break;}}
      }
      if(performance.now()-slice>5){await new Promise<void>(resolve=>setImmediate(resolve));slice=performance.now();}
    }
    const grouped=new Map<string,typeof nodes>();for(const n of nodes){const list=grouped.get(n.record.id)??[];list.push(n);grouped.set(n.record.id,list);}
    for(const [id,group]of grouped){const falling=group.filter(n=>!n.ground);if(!falling.length)continue;if(group.length===1&&group[0].record.fall)continue;const r=group[0].record,kept=group.filter(n=>n.ground);
      if(a.action==='repair'&&id===changed.id)throw new Error('unsupported-repair');
      const index=patch.solids.findIndex(s=>s.id===id),root={...r,removed:!kept.length,revision:r.revision+(id===changed.id?0:1),volume:{...r.volume,mask:kept.length?mergeMasks(kept.map(n=>n.component?.mask).filter(Boolean)as Record<string,number[]>[]):r.volume.mask}};
      if(index>=0)patch.solids[index]=root;else patch.solids.push(root);if(root.removed)patch.removedBuilds.push(id);
      if(r.object&&objectDefinition(r.object.definitionId).family==='floor')patch.leveling.push(r.object);
      for(let i=0;i<falling.length;i++){const n=falling[i],extent=n.bounds[1].map((v,k)=>v-n.bounds[0][k]);if(isTree(r.prop)&&Math.max(...extent)<.75)continue;const fragmentId=`fragment:${createHash('sha256').update(a.requestId+id+':'+i).digest('hex').slice(0,32)}`;parents?.set(fragmentId,id);patch.solids.push({...r,id:fragmentId,object:undefined,opening:undefined,fragmentOf:r.fragmentOf??id,fragmentBounds:n.component?.bounds??r.source.bounds,revision:1,volume:n.component?{...r.volume,mask:n.component.mask}:r.volume,fall:{velocity:r.fall?.velocity??[0,0,0],angular:r.fall?.angular??(isTree(r.prop)?[.15,0,.12]:[0,0,0]),started:Date.now(),persistent:isTree(r.prop),split:r.fall?.split}});}
    }
  }
  apply(patch:WorldPatch,broadcast=true){this.revision=Math.max(this.revision,patch.revision);for(const r of patch.solids){const old=this.builds.scene.edits.get(r.id);if(!old||r.volume!==old.volume||r.removed!==old.removed||JSON.stringify(r.pose)!==JSON.stringify(old.pose)){this.geometryVersions.set(r.id,(this.geometryVersions.get(r.id)??0)+1);this.componentCache.delete(r.id);}}
    this.builds.applyWorldPatch(patch);for(const r of patch.solids){const boxes=this.collisionData.get(r.volume);if(boxes)this.builds.scene.setDamageCollision(r,boxes);}if(broadcast)for(const fn of this.listeners)fn(patch);}
  updateMotion(record:SolidRecord){const old=this.builds.scene.edits.get(record.id);if(!old||old.removed||old.revision!==record.revision)return;this.builds.scene.edits.set(record.id,record);if(JSON.stringify(old.pose)!==JSON.stringify(record.pose))this.geometryVersions.set(record.id,(this.geometryVersions.get(record.id)??0)+1);}
  saveMotion(solids:SolidRecord[]):Promise<void>{const task=this.queue.then(async()=>{solids=solids.filter(r=>{const old=this.builds.scene.edits.get(r.id);return !old||!old.removed&&old.revision===r.revision;});if(!solids.length)return;
    const geometry=solids.some(r=>{const old=this.builds.scene.edits.get(r.id);return !old||r.removed||r.volume!==old.volume;});
    if(geometry){const patch:WorldPatch={revision:this.revision+1,solids,removedBuilds:solids.filter(r=>r.removed).map(r=>r.id),leveling:[],openings:[]};await this.cookCollisions(solids);await this.persistence.append({kind:'edit',patch});await this.activate(()=>this.apply(patch));}
    else{const before=new Map(solids.map(r=>[r.id,this.builds.scene.edits.get(r.id)]));await this.persistence.append({kind:'motion',motion:solids.map(({id,revision,pose,fall})=>({id,revision,pose,fall}))});for(const r of solids){const old=this.builds.scene.edits.get(r.id);if(old&&old===before.get(r.id)&&old.revision===r.revision){this.builds.scene.edits.set(r.id,r);this.geometryVersions.set(r.id,(this.geometryVersions.get(r.id)??0)+1);}}}
  });this.queue=task.then(()=>{},()=>{});return task;}
  private async cookCollisions(records:SolidRecord[]):Promise<[SolidRecord,import('../shared/volume-collision').CollisionBox[]][]>{const result:[SolidRecord,import('../shared/volume-collision').CollisionBox[]][]=[];for(const r of records)if(!r.removed){const cached=this.collisionData.get(r.volume);if(cached){result.push([r,cached]);continue;}const job=await this.jobs.run({task:'boxes',source:r.source,state:r.volume,step:r.prop.kind==='terrain'?.1:isTree(r.prop)?.1:.05});this.collisionData.set(r.volume,job.result);this.collisionCache.set(r.id+':'+r.revision,{revision:r.revision,volume:r.volume,boxes:job.result});while(this.collisionCache.size>128)this.collisionCache.delete(this.collisionCache.keys().next().value!);result.push([r,job.result]);}return result;}
  private async prepareCollisions(records:SolidRecord[]){for(const [r,boxes]of await this.cookCollisions(records))this.builds.scene.setDamageCollision(r,boxes);}
  private remember(saved:SavedEdit){this.receipts.set(saved.requestId,saved);while(this.receipts.size>64)this.receipts.delete(this.receipts.keys().next().value!);}
  async hydrateCells(keys:string[]){if(!this.persistence.loadCells)return;for(const r of await this.persistence.loadCells(keys,this.revision)){const old=this.builds.scene.edits.get(r.id);if(!old||old.revision<r.revision)this.builds.scene.applyRecord(r);}}
  async hydrateNear(x:number,z:number){const keys:string[]=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)keys.push(buildCell(x+dx*512,z+dz*512));await this.hydrateCells(keys);}
  evictIdle(){this.pruneResident(true);}
  private pruneResident(force=false){if(!this.persistence.loadCells||this.supportRunning)return;const scene=this.builds.scene,protectedPlayers=this.persistence.protected?.()??[];let bytes=[...scene.edits.values()].reduce((n,r)=>n+Object.values(r.volume.bricks).reduce((n,b)=>n+b.byteLength,0),0);for(const [id,r]of scene.edits){if(!force&&scene.edits.size<=128&&bytes<=32*1024*1024)break;const p=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z];if(r.fall&&!r.fall.settled||this.supportRequests.has(id)||protectedPlayers.some(a=>Math.hypot(a[0]-p[0],a[2]-p[2])<128))continue;scene.edits.delete(id);scene.damageCollision.delete(id);for(const key of this.collisionCache.keys())if(key.startsWith(id+':'))this.collisionCache.delete(key);this.componentCache.delete(id);bytes-=Object.values(r.volume.bricks).reduce((n,b)=>n+b.byteLength,0);}}

  async compact(){await this.persistence.append({kind:'support'});}
  collision(id:string){const r=this.builds.scene.edits.get(id);if(!r)return;const boxes=this.collisionData.get(r.volume);return boxes?{revision:r.revision,boxes}:undefined;}
  async prepareNearby(x:number,z:number){await this.hydrateNear(x,z);await this.prepareCollisions([...this.builds.scene.edits.values()].filter(r=>!r.removed&&Math.hypot((r.pose?.position[0]??r.prop.x)-x,(r.pose?.position[2]??r.prop.z)-z)<96));}
  performanceReport(){const stages=new Set([...this.timings,...this.jobs.metrics].map(s=>s.stage));return {revision:this.revision,residentSolids:this.builds.scene.edits.size,residentBytes:[...this.builds.scene.edits.values()].reduce((n,r)=>n+Object.values(r.volume.bricks).reduce((b,v)=>b+v.byteLength,0),0),stages:Object.fromEntries([...stages].map(stage=>{const times=[...this.timings,...this.jobs.metrics].filter(v=>v.stage===stage).map(v=>v.milliseconds).sort((a,b)=>a-b);return [stage,{samples:times.length,meanMs:times.reduce((n,v)=>n+v,0)/times.length,p95Ms:times[Math.max(0,Math.ceil(times.length*.95)-1)]}];}))};}
  dispose(){this.stopped=true;this.supportRequests.clear();this.jobs.dispose();this.listeners.clear();}
}
function mergeMasks(masks:Record<string,number[]>[]){const result:Record<string,number[]>={};for(const mask of masks)for(const [key,values]of Object.entries(mask)){const v=result[key]??=new Array(16).fill(0);for(let i=0;i<16;i++)v[i]|=values[i];}return result;}

function boxSupportPoints(center:Point3,half:Point3):Point3[]{const points:Point3[]=[];for(let axis=0;axis<3;axis++){const u=(axis+1)%3,v=(axis+2)%3,nu=Math.max(1,Math.ceil(half[u]*2/.2)),nv=Math.max(1,Math.ceil(half[v]*2/.2));for(const side of [-1,1])for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const p=[...center]as Point3;p[axis]+=half[axis]*side;p[u]+=(i/nu*2-1)*half[u];p[v]+=(j/nv*2-1)*half[v];points.push(p);}}return points;}
