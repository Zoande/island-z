import {meshVolume,type SolidSource,type VolumeState} from './volume';
import {solidComponents} from './solid-components';
import {collisionBoxes} from './volume-collision';
export type VolumeJob={id:number;task:'mesh'|'components'|'boxes';source:SolidSource;state:VolumeState;step?:number;templateUrl?:string;warm?:boolean};
export function runVolumeJob(job:VolumeJob){const start=performance.now();return {id:job.id,task:job.task,result:job.task==='mesh'?meshVolume(job.source,job.state):job.task==='boxes'?collisionBoxes(job.source,job.state,job.step):solidComponents(job.source,job.state,job.step),milliseconds:performance.now()-start};}
