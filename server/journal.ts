import {Worker} from 'node:worker_threads';
import type {WorldPatch,WorldAction} from '../shared/destruction';
import type {BuildObject} from '../shared/object-registry';
import type {CharacterState} from '../shared/character';
export interface WorldCommit {kind:'edit'|'build'|'motion'|'support'|'players';patch?:WorldPatch;object?:BuildObject;requestId?:string;fingerprint?:string;analysis?:WorldAction;completeSupport?:string;players?:{id:string;nickname:string;state:CharacterState}[];result?:unknown;receiptFingerprint?:string;motion?:Pick<import('../shared/destruction').SolidRecord,'id'|'revision'|'pose'|'fall'>[]}
/** Serialization, checksums and fsync run on a separate persistence thread. */
export class WorldJournal {
 private worker?:Worker;private next=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 constructor(readonly directory:string|undefined,readonly worldKey:string){}
 private request(type:string,value?:unknown):Promise<any>{
   if(!this.directory)return Promise.resolve(['load','loadWorld','cells'].includes(type)?[]:undefined);
   if(!this.worker){this.worker=new Worker(new URL('./journal-worker.mjs',import.meta.url),{workerData:{directory:this.directory,worldKey:this.worldKey}});this.worker.on('message',m=>{const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);if(!this.pending.size)this.worker?.unref();});this.worker.on('error',e=>{for(const p of this.pending.values())p.reject(e);this.pending.clear();this.worker=undefined;});this.worker.unref();}
   this.worker.ref();const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker!.postMessage({id,type,value});});
 }
 load():Promise<WorldCommit[]>{return this.request('load');}
 loadWorld():Promise<WorldCommit[]>{return this.request('loadWorld');}
 cells(keys:string[],revision:number):Promise<import('../shared/destruction').SolidRecord[]>{return this.request('cells',{keys,revision});}
 append(commit:WorldCommit):Promise<void>{return this.request('append',commit);}
 checkpoint(commits:WorldCommit[]):Promise<void>{return this.request('checkpoint',commits);}
 async close(){await this.request('flush');await this.worker?.terminate();this.worker=undefined;}
}
