import {Worker} from 'node:worker_threads';
import type {WorldConfig} from '../shared/config';
export class WorldService {
 private worker:Worker;private next=0;private stopped=false;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 constructor(config:WorldConfig,directory:string|undefined,onEvent:(connection:string,message:any)=>void){this.worker=new Worker(new URL('./world-worker.mjs',import.meta.url),{workerData:{config,directory}});this.worker.on('message',m=>{if(m.event){onEvent(m.connection,m.message);return;}const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(m.error)p.reject(new Error(m.error));else p.resolve(m.value);});this.worker.on('error',e=>{this.stopped=true;for(const p of this.pending.values())p.reject(e);this.pending.clear();});this.worker.unref();}
 request(type:string,connection='',value?:unknown):Promise<any>{if(this.stopped)return Promise.reject(new Error('World service unavailable'));if(this.pending.size>=512)return Promise.reject(new Error('World service busy'));const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,type,connection,value});});}
 async close(){await this.request('close');this.stopped=true;await this.worker.terminate();}
}
