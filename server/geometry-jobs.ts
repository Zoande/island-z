import {Worker} from 'node:worker_threads';
import type {VolumeJob} from '../shared/volume-jobs';
import {solidSource,emptyVolume} from '../shared/volume';
/** Keep connectivity work off the collision/edit worker to avoid starvation. */
export class GeometryJobs {
 readonly metrics:{stage:string;milliseconds:number}[]=[];private workers=new Map<number,Worker>();private next=0;private pending=new Map<number,{lane:number;resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 async warm(){const source=solidSource([{type:'box',center:[0,0,0],half:[.025,.025,.025],material:'wall-wood'}]),state=emptyVolume();await Promise.all([this.run({task:'boxes',source,state,step:.05}),this.run({task:'components',source,state,step:.025})]);}
 run(task:Omit<VolumeJob,'id'>):Promise<any>{if(this.pending.size>=128)return Promise.reject(new Error('Geometry queue exceeded'));const lane=task.task==='components'?1:0;let worker=this.workers.get(lane);
   if(!worker){worker=new Worker(new URL('./geometry-worker.mjs',import.meta.url));this.workers.set(lane,worker);worker.on('message',value=>{const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);this.metrics.push({stage:value.task??'geometry',milliseconds:value.milliseconds??0});if(this.metrics.length>300)this.metrics.shift();if(value.error)p.reject(new Error(value.error));else p.resolve(value);if(![...this.pending.values()].some(p=>p.lane===lane))worker!.unref();});worker.on('error',e=>{for(const [id,p]of this.pending)if(p.lane===lane){p.reject(e);this.pending.delete(id);}this.workers.delete(lane);});worker.unref();}
   worker.ref();const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{lane,resolve,reject});worker!.postMessage({...task,id});});
 }
 dispose(){for(const worker of this.workers.values())void worker.terminate();this.workers.clear();for(const p of this.pending.values())p.reject(new Error('Geometry service stopped'));this.pending.clear();}
}
