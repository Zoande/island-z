import {mkdirSync,existsSync,readFileSync,writeFileSync,truncateSync,openSync,writeSync,fsyncSync,closeSync,fstatSync,ftruncateSync,renameSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {WorldConfig} from '../shared/config';
import {GENERATOR_VERSION} from '../shared/config';
import {BuildScene} from '../shared/build-scene';
import {WorldGenerator} from '../shared/world';
import {buildCell,OBJECT_SCHEMA_VERSION,validBuildObject,type BuildObject,type BuildRequest,type BuildResult} from '../shared/object-registry';
import {validBuildRequest,solvePlacement} from '../shared/build-placement';
import {validDoorRequest,doorChange} from '../shared/door-interaction';
import type {WorldPatch} from '../shared/destruction';
interface SavedBuild {schema:number;worldKey:string;requestId:string;fingerprint:string;object:BuildObject;action?:'door'}
interface BuildCheckpoint {schema:2;worldKey:string;revision:number;journal:string;objects:BuildObject[];leveling:BuildObject[];openings:{id:string;kind:'door'|'window'|null}[];receipts:SavedBuild[]}
/** Durable placement journal with an atomic checkpoint and journal generation. */
export class BuildStore {
  readonly worldKey:string;readonly scene:BuildScene;revision=0;
  private cells=new Map<string,Map<string,BuildObject>>();private receipts=new Map<string,SavedBuild>();private file?:string;private directory?:string;private checkpoint?:string;private records=0;
  constructor(config:WorldConfig,directory?:string) {
    this.worldKey=createHash('sha256').update(JSON.stringify([config.seed,config.islandSizeMeters,GENERATOR_VERSION])).digest('hex').slice(0,24);
    this.scene=new BuildScene(new WorldGenerator(config));
    if(directory) {
      mkdirSync(directory,{recursive:true});this.directory=directory;this.checkpoint=join(directory,`${this.worldKey}.builds.snapshot.json`);this.file=join(directory,`${this.worldKey}.jsonl`);
      if(existsSync(this.checkpoint)){
        const saved=JSON.parse(readFileSync(this.checkpoint,'utf8')) as BuildCheckpoint;
        if(saved.schema!==2||saved.worldKey!==this.worldKey||!Number.isInteger(saved.revision)||saved.revision<0||!new RegExp('^'+this.worldKey+'\\.builds\\.[0-9]+(?:-[0-9]+)?\\.jsonl$').test(saved.journal)||!Array.isArray(saved.objects)||saved.objects.some(o=>!validBuildObject(o))||!Array.isArray(saved.leveling)||saved.leveling.some(o=>!validBuildObject(o)||!o.definitionId.startsWith('floor-')))throw new Error('Invalid build checkpoint');
        this.file=join(directory,saved.journal);
        for(const object of saved.objects)this.restoreObject(object);
        for(const floor of saved.leveling)this.scene.keepLeveling(floor);
        for(const opening of saved.openings)this.scene.setOpening(opening.id,opening.kind);
        for(const receipt of saved.receipts){if(!validBuildObject(receipt.object)||receipt.worldKey!==this.worldKey)throw new Error('Invalid build receipt');this.receipts.set(receipt.requestId,receipt);}
        this.revision=saved.revision;
      }
      if(existsSync(this.file)) {
        let contents=readFileSync(this.file,'utf8');
        if(contents&&!contents.endsWith('\n')) {
          // A crashed append may leave an unconfirmed trailing fragment. Preserve
          // it separately and replay only complete journal records.
          const end=contents.lastIndexOf('\n')+1;writeFileSync(this.file+`.recovery-${Date.now()}`,contents.slice(end));contents=contents.slice(0,end);truncateSync(this.file,Buffer.byteLength(contents));
        }
        const lines=contents.split('\n');
        for(let i=0;i<lines.length;i++) {
          if(!lines[i].trim())continue;
          try {
            const saved=JSON.parse(lines[i]) as SavedBuild;
            if(saved.schema!==OBJECT_SCHEMA_VERSION||saved.worldKey!==this.worldKey||!validBuildObject(saved.object)||typeof saved.fingerprint!=='string'||typeof saved.requestId!=='string'||(saved.action==='door'?!this.scene.placed.get(saved.object.id)||!saved.object.state:saved.action!==undefined||saved.requestId!==saved.object.id))throw new Error('Invalid saved object');
            if(this.receipts.has(saved.requestId))throw new Error('Duplicate saved request');
            if(saved.object.support.kind!=='terrain'&&saved.object.support.kind!=='rock'&&!this.scene.placed.get(saved.object.support.id))throw new Error('Missing supporting build');
            this.accept(saved);this.records++;
          }catch(error){throw new Error(`Cannot load build save ${this.file}, line ${i+1}: ${error instanceof Error?error.message:String(error)}`);}
        }
      }
    }
  }
  private accept(saved:SavedBuild) {
    this.restoreObject(saved.object);this.receipts.set(saved.requestId,saved);while(this.receipts.size>2048)this.receipts.delete(this.receipts.keys().next().value!);this.revision++;
  }
  private restoreObject(object:BuildObject){
    this.scene.add(object);if(object.definitionId.startsWith('floor-'))this.scene.keepLeveling(object);if(object.support.kind==='wall'&&['door-wood','door-reinforced','window'].includes(object.definitionId))this.scene.setOpening(object.support.id,object.definitionId==='window'?'window':'door');const key=buildCell(object.position[0],object.position[2]);
    let cell=this.cells.get(key);if(!cell){cell=new Map();this.cells.set(key,cell);}cell.set(object.id,object);
  }
  snapshot(keys:string[],since?:number) {
    if(since===this.revision)return {worldKey:this.worldKey,revision:this.revision,unchanged:true,cells:[]};
    return {worldKey:this.worldKey,revision:this.revision,unchanged:false,cells:keys.map(key=>({key,objects:[...(this.cells.get(key)?.values()??[])]}))};
  }
  applyWorldPatch(patch:WorldPatch){for(const id of patch.removedBuilds){const object=this.scene.placed.get(id)?.object;if(object)this.cells.get(buildCell(object.position[0],object.position[2]))?.delete(id);this.scene.remove(id,true);}for(const floor of patch.leveling)this.scene.keepLeveling(floor);for(const o of patch.openings)this.scene.setOpening(o.id,o.kind);for(const solid of patch.solids)this.scene.applyRecord(solid);this.revision++;}
  place(value:unknown):BuildResult {
    if(validDoorRequest(value))return this.changeDoor(value);
    if(!validBuildRequest(value))return {ok:false,code:'request',error:'Invalid placement request'};
    const request=value as BuildRequest,fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=this.receipts.get(request.requestId);
    if(request.worldKey!==undefined&&request.worldKey!==this.worldKey)return {ok:false,code:'world',error:'The server world changed; refresh the game'};
    if(existing){if(existing.fingerprint!==fingerprint)return {ok:false,code:'request-id',error:'This request ID was already used for another placement'};const object=this.scene.placed.get(existing.object.id)?.object;return object?{ok:true,object,revision:this.revision}:{ok:false,code:'removed',error:'That placement was already removed'};}
    let placement;
    try{placement=solvePlacement(this.scene,request);}catch{return {ok:false,code:'validation',error:'The placement could not be validated'};}
    if(!placement.valid)return {ok:false,code:placement.code,error:placement.reason};
    const saved:SavedBuild={schema:OBJECT_SCHEMA_VERSION,worldKey:this.worldKey,requestId:request.requestId,fingerprint,object:placement.object};
    return this.commit(saved);
  }
  private changeDoor(request:import('../shared/object-registry').DoorRequest):BuildResult {
    const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=this.receipts.get(request.requestId);
    if(request.worldKey!==undefined&&request.worldKey!==this.worldKey)return {ok:false,code:'world',error:'The server world changed; refresh the game'};
    if(existing){if(existing.fingerprint!==fingerprint)return {ok:false,code:'request-id',error:'This request ID was already used'};const object=this.scene.placed.get(existing.object.id)?.object;return object?{ok:true,object,revision:this.revision}:{ok:false,code:'removed',error:'That door was already removed'};}
    const result=doorChange(this.scene,request);if(!result.ok)return result;
    return this.commit({schema:OBJECT_SCHEMA_VERSION,worldKey:this.worldKey,requestId:request.requestId,fingerprint,object:result.object,action:'door'});
  }
  private commit(saved:SavedBuild):BuildResult {
    // Confirm only after the journal is flushed. Failed writes leave memory unchanged.
    try {
      if(this.file){const descriptor=openSync(this.file,'a'),oldSize=fstatSync(descriptor).size;try{const bytes=Buffer.from(JSON.stringify(saved)+'\n');let offset=0;while(offset<bytes.length){const written=writeSync(descriptor,bytes,offset,bytes.length-offset);if(!written)throw new Error('Incomplete save');offset+=written;}fsyncSync(descriptor);}catch(error){ftruncateSync(descriptor,oldSize);throw error;}finally{closeSync(descriptor);}}
    }catch{return {ok:false,code:'save',error:'The server could not save this placement'};}
    this.accept(saved);if(++this.records>=128)try{this.compact();}catch(error){console.error('Build checkpoint:',error);}return {ok:true,object:saved.object,revision:this.revision};
  }
  compact(){
    if(!this.directory||!this.file||!this.checkpoint)return;
    const old=this.file;let generation=0,journal=`${this.worldKey}.builds.${this.revision}.jsonl`,next=join(this.directory,journal);
    while(existsSync(next)&&next!==old){journal=`${this.worldKey}.builds.${this.revision}-${++generation}.jsonl`;next=join(this.directory,journal);}
    // Reusing the current generation would truncate uncheckpointed writes on a
    // retry. A completed generation needs no second compaction at its revision.
    if(next===old&&this.records===0)return;
    const descriptor=openSync(next,'wx');try{fsyncSync(descriptor);}finally{closeSync(descriptor);}
    const saved:BuildCheckpoint={schema:2,worldKey:this.worldKey,revision:this.revision,journal,objects:this.scene.placed.values().map(s=>s.object!),leveling:[...this.scene.leveling.values()],openings:[...this.scene.openings].map(([id,kind])=>({id,kind})),receipts:[...this.receipts.values()]};
    const temp=this.checkpoint+'.tmp',fd=openSync(temp,'w');try{writeFileSync(fd,JSON.stringify(saved));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,this.checkpoint);this.file=next;this.records=0;
    // Both names originate inside this save directory, never from user input.
    if(old!==next&&existsSync(old))unlinkSync(old);
  }
}
