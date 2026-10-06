import {parentPort} from 'node:worker_threads';
import {initializeMeshRefinement,refineVolumeMeshes} from '../shared/mesh-refinement';
import {runVolumeJob,type VolumeJob} from '../shared/volume-jobs';
let queue=Promise.resolve();
parentPort!.on('message',(job:VolumeJob)=>{queue=queue.then(async()=>{try{if(job.task==='mesh')await initializeMeshRefinement();const start=performance.now(),result=runVolumeJob(job);if(result.task==='mesh')result.result=refineVolumeMeshes(result.result as any);result.milliseconds=performance.now()-start;parentPort!.postMessage(result);}catch(error){parentPort!.postMessage({id:job.id,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});}});});
