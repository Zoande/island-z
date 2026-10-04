import {mkdirSync,existsSync,readFileSync,writeFileSync,truncateSync,openSync,writeSync,fsyncSync,closeSync,fstatSync,ftruncateSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {WorldConfig} from '../shared/config';
import {GENERATOR_VERSION} from '../shared/config';
import {BuildScene} from '../shared/build-scene';
import {WorldGenerator} from '../shared/world';
import {buildCell,OBJECT_SCHEMA_VERSION,validBuildObject,type BuildObject,type BuildRequest,type BuildResult} from '../shared/object-registry';
import {validBuildRequest,solvePlacement} from '../shared/build-placement';
interface SavedBuild {schema:number;worldKey:string;requestId:string;fingerprint:string;object:BuildObject}
/** Append-only durable placements. No owners or removal events in this first pass. */
export class BuildStore {
  readonly worldKey:string;readonly scene:BuildScene;revision=0;
  private cells=new Map<string,Map<string,BuildObject>>();private receipts=new Map<string,SavedBuild>();private file?:string;
  constructor(config:WorldConfig,directory?:string) {
    this.worldKey=createHash('sha256').update(JSON.stringify([config.seed,config.islandSizeMeters,GENERATOR_VERSION])).digest('hex').slice(0,24);
    this.scene=new BuildScene(new WorldGenerator(config));
    if(directory) {
      mkdirSync(directory,{recursive:true});this.file=join(directory,`${this.worldKey}.jsonl`);
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
            if(saved.schema!==OBJECT_SCHEMA_VERSION||saved.worldKey!==this.worldKey||saved.requestId!==saved.object?.id||!validBuildObject(saved.object)||typeof saved.fingerprint!=='string')throw new Error('Invalid saved object');
            if(this.receipts.has(saved.requestId))throw new Error('Duplicate saved request');
            if(saved.object.support.kind==='wall'&&!this.scene.placed.get(saved.object.support.id))throw new Error('Missing supporting wall');
            this.accept(saved);
          }catch(error){throw new Error(`Cannot load build save ${this.file}, line ${i+1}: ${error instanceof Error?error.message:String(error)}`);}
        }
      }
    }
  }
  private accept(saved:SavedBuild) {
    this.scene.add(saved.object);this.receipts.set(saved.requestId,saved);const key=buildCell(saved.object.position[0],saved.object.position[2]);
    let cell=this.cells.get(key);if(!cell){cell=new Map();this.cells.set(key,cell);}cell.set(saved.object.id,saved.object);this.revision++;
  }
  snapshot(keys:string[],since?:number) {
    if(since===this.revision)return {worldKey:this.worldKey,revision:this.revision,unchanged:true,cells:[]};
    return {worldKey:this.worldKey,revision:this.revision,unchanged:false,cells:keys.map(key=>({key,objects:[...(this.cells.get(key)?.values()??[])]}))};
  }
  place(value:unknown):BuildResult {
    if(!validBuildRequest(value))return {ok:false,code:'request',error:'Invalid placement request'};
    const request=value as BuildRequest,fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=this.receipts.get(request.requestId);
    if(request.worldKey!==undefined&&request.worldKey!==this.worldKey)return {ok:false,code:'world',error:'The server world changed; refresh the game'};
    if(existing)return existing.fingerprint===fingerprint?{ok:true,object:existing.object,revision:this.revision}:{ok:false,code:'request-id',error:'This request ID was already used for another placement'};
    let placement;
    try{placement=solvePlacement(this.scene,request);}catch{return {ok:false,code:'validation',error:'The placement could not be validated'};}
    if(!placement.valid)return {ok:false,code:placement.code,error:placement.reason};
    const saved:SavedBuild={schema:OBJECT_SCHEMA_VERSION,worldKey:this.worldKey,requestId:request.requestId,fingerprint,object:placement.object};
    // Confirm only after the journal is flushed. Failed writes leave memory unchanged.
    try {
      if(this.file){const descriptor=openSync(this.file,'a'),oldSize=fstatSync(descriptor).size;try{const bytes=Buffer.from(JSON.stringify(saved)+'\n');let offset=0;while(offset<bytes.length){const written=writeSync(descriptor,bytes,offset,bytes.length-offset);if(!written)throw new Error('Incomplete save');offset+=written;}fsyncSync(descriptor);}catch(error){ftruncateSync(descriptor,oldSize);throw error;}finally{closeSync(descriptor);}}
    }catch{return {ok:false,code:'save',error:'The server could not save this placement'};}
    this.accept(saved);return {ok:true,object:saved.object,revision:this.revision};
  }
}
