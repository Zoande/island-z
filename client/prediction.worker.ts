import {SparseVolume,meshVolumeRegion,mergeVolumeRegions,brushRegion} from '../shared/volume';
import type {VolumeRegion} from '../shared/volume';
import {shadeTerrainMeshes} from '../shared/terrain-volume';
import type {SolidRecord} from '../shared/destruction';
const pending=new Map<string,any>();let scheduled=false;self.onmessage=e=>{pending.set(e.data.record.id,e.data);if(!scheduled){scheduled=true;setTimeout(run,0);}};
function run(){scheduled=false;const job=pending.entries().next().value;if(!job)return;pending.delete(job[0]);const {record,strokes,regions:requestedRegions,signature}=job[1];try{let next=record as SolidRecord;for(const s of strokes){if(s.action==='dismantle')next={...next,removed:true,revision:next.revision+1};else if(s.brush){const v=new SparseVolume(next.source,next.volume,true);v.edit(s.brush,s.action==='repair');next={...next,volume:v.state,revision:next.revision+1};}}
 const regions=(requestedRegions as VolumeRegion[]|undefined)??mergeVolumeRegions(strokes.filter((s:any)=>s.brush).map((s:any)=>brushRegion(s.brush)));let meshes=next.removed?[]:regions.flatMap(r=>meshVolumeRegion(next.source,next.volume,r));if(next.prop.kind==='terrain')meshes=shadeTerrainMeshes(next.source,meshes);self.postMessage({record:next,regions,meshes,signature},{transfer:meshes.flatMap(m=>[m.vertices.buffer,m.indices.buffer])});
 }catch(error){self.postMessage({id:record.id,signature,error:String(error)});}if(pending.size){scheduled=true;setTimeout(run,0);}}
