import {Worker} from 'node:worker_threads';
import type {VolumeJob} from '../shared/volume-jobs';
export class GeometryJobs {
  readonly metrics:{stage:string;milliseconds:number}[]=[];private worker?:Worker;private next=0;private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  run(task:Omit<VolumeJob,'id'>):Promise<any>{if(!this.worker){this.worker=new Worker(new URL('./geometry-worker.mjs',import.meta.url));this.worker.on('message',value=>{const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);this.metrics.push({stage:value.task??'geometry',milliseconds:value.milliseconds??0});if(this.metrics.length>300)this.metrics.shift();if(value.error)p.reject(new Error(value.error));else p.resolve(value);if(!this.pending.size)this.worker?.unref();});this.worker.on('error',e=>{for(const p of this.pending.values())p.reject(e);this.pending.clear();this.worker=undefined;});this.worker.unref();}this.worker.ref();const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker!.postMessage({...task,id});});}
  dispose(){void this.worker?.terminate();this.worker=undefined;for(const p of this.pending.values())p.reject(new Error('Geometry service stopped'));this.pending.clear();}
}
