import {meshVolume,SparseVolume,type EditBrush,type SolidSource,type VolumeState} from './volume';
import {solidComponents} from './solid-components';
import {collisionBoxes} from './volume-collision';
export type VolumeJob={id:number;task:'mesh'|'components'|'boxes'|'edit';source:SolidSource;state:VolumeState;step?:number;templateUrl?:string;warm?:boolean;lods?:boolean;brush?:EditBrush;repair?:boolean};
export function runVolumeJob(job:VolumeJob){const start=performance.now();if(job.task==='edit'){const v=new SparseVolume(job.source,job.state),changed=v.edit(job.brush!,job.repair);return {id:job.id,task:job.task,result:{state:v.state,changed},milliseconds:performance.now()-start};}return {id:job.id,task:job.task,result:job.task==='mesh'?meshVolume(job.source,job.state):job.task==='boxes'?collisionBoxes(job.source,job.state,job.step):solidComponents(job.source,job.state,job.step),milliseconds:performance.now()-start};}
