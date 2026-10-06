import {loadContour} from './contour-assets';
import {initializeMeshRefinement,refineVolumeMeshes,mergeVolumeMeshes} from '../shared/mesh-refinement';
import {runVolumeJob,type VolumeJob} from '../shared/volume-jobs';
import {hasContourTemplate,installContourTemplate,contourCacheStats} from '../shared/volume';
// Install the handler before asynchronous WASM initialization. A message sent
// immediately after new Worker must be queued, never lost during startup.
let queue=Promise.resolve();
self.onmessage=(event:MessageEvent<VolumeJob>)=>{queue=queue.then(async()=>{try{await initializeMeshRefinement();const start=performance.now(),job=event.data;
  if(job.task==='mesh'&&job.templateUrl&&!hasContourTemplate(job.source)){try{const bytes=await loadContour(job.templateUrl);if(bytes)installContourTemplate(job.source,bytes);}catch{/* A missing/outdated preparation asset falls back to deterministic generation. */}}
  const result=job.warm&&hasContourTemplate(job.source)?{id:job.id,task:job.task,result:[],milliseconds:0}:runVolumeJob(job);let lods:any[]=[],colliders:any[]=[];if(result.task==='mesh'&&!job.warm){const patches=result.result;result.result=mergeVolumeMeshes(refineVolumeMeshes(patches as any));lods=(job.lods?[.005,.02,.08]:[]).map(error=>mergeVolumeMeshes(refineVolumeMeshes(patches as any,error)));}if(job.warm)result.result=[];result.milliseconds=performance.now()-start;const transfer:Transferable[]=result.task==='mesh'?[result.result,...lods,colliders].flatMap((level:any)=>level.flatMap((m:any)=>[m.vertices.buffer,m.indices.buffer])):[];self.postMessage({...result,lods,colliders,cache:contourCacheStats()},{transfer:[...new Set(transfer)]});}catch(error){self.postMessage({id:event.data.id,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});}});};
