import {mkdirSync,writeFileSync} from 'node:fs';
import {SolidPhysics,initializePhysics} from '../shared/solid-physics';
import {recordFor} from '../shared/destruction';
import {SparseVolume} from '../shared/volume';
import {collisionBoxes} from '../shared/volume-collision';
import type {Point3} from '../shared/rocks';
import {CHARACTER} from '../shared/character';
// Offline canonical fixture; no old test save or unauthenticated HTTP endpoint.
await initializePhysics();const physics=new SolidPhysics(),record=recordFor('benchmark-wall',{kind:'wall-wood',x:0,y:0,z:0,variant:0,rotation:0,scale:1},[]),volume=new SparseVolume(record.source);
volume.edit({center:[0,1.2,.1],axis:[0,0,-1],radius:.12,depth:.1,seed:1});record.volume=volume.state;
physics.add(record,collisionBoxes(record.source,record.volume,.05),undefined,false);
const feet:Point3=[0,0,.43],results:any[]=[];
try{physics.movement(feet,[0,0,-.08],CHARACTER.radius,CHARACTER.height,.28,.3);const controller=(physics as any).controller;
 for(const nudge of [.0001,.0005,.001,.002,.005]){controller.setNormalNudgeFactor(nudge);const start=performance.now();let result:any;for(let i=0;i<100;i++)result=physics.movement(feet,[0,0,-.08],CHARACTER.radius,CHARACTER.height,.28,.3);results.push({nudge,ms:(performance.now()-start)/100,result,collisions:controller.numComputedCollisions()});}
}finally{physics.dispose();}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/collision-contact-benchmark.json',JSON.stringify(results,null,2));console.log(results);
