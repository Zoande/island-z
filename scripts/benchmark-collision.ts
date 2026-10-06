import {writeFileSync} from 'node:fs';
import {SolidPhysics,initializePhysics} from '../shared/solid-physics';
import {initializeMeshRefinement,refineVolumeMeshes,collisionSurfaceMeshes} from '../shared/mesh-refinement';
import {meshVolume} from '../shared/volume';
import type {Point3} from '../shared/rocks';
import {CHARACTER} from '../shared/character';
const snapshot=await(await fetch('http://127.0.0.1:3001/api/builds?cells=4:21')).json();await initializePhysics();await initializeMeshRefinement();const physics=new SolidPhysics([2048,0,10752]),records=snapshot.edits.solids.filter((r:any)=>!r.removed&&r.prop.kind.startsWith('wall'));
for(const r of records){const meshes=collisionSurfaceMeshes(refineVolumeMeshes(meshVolume(r.source,r.volume)));physics.add(r,[],meshes,false);console.log(r.id,r.prop.x,r.prop.z,meshes.reduce((n,m)=>n+m.indices.length/3,0));}
const feet:Point3=[2456.4074539796984,5.782323024968906-CHARACTER.eyeHeight,10993.541009669367];physics.movement(feet,[0,0,-.08],.32,2.16,.28,.3);const controller=(physics as any).controller,results=[];
for(const nudge of [.0001,.0005,.001,.002,.005]){controller.setNormalNudgeFactor(nudge);for(const auto of [true,false]){const canStep=(physics as any).canStep.bind(physics);if(!auto)(physics as any).canStep=()=>false;const start=performance.now();let result:any;for(let i=0;i<100;i++)result=physics.movement(feet,[0,0,-.08],.32,2.16,.28,.3);results.push({nudge,auto,ms:(performance.now()-start)/100,result,collisions:controller.numComputedCollisions()});if(!auto)(physics as any).canStep=canStep;}}
physics.dispose();console.log(results);writeFileSync('artifacts/collision-contact-benchmark.json',JSON.stringify(results,null,2));
