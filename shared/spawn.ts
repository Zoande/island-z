import {CHARACTER} from './character';
import type {BuildScene} from './build-scene';
import type {Point3} from './rocks';
export function worldSpawn(scene:BuildScene):Point3 {
  const world=scene.world,x=world.config.islandSizeMeters*.08;let inner=0,outer=world.config.islandSizeMeters*.5;
  for(let i=0;i<28;i++){const z=(inner+outer)/2;if(world.coastDistance(x,z)>Math.min(140,world.config.islandSizeMeters*.04))inner=z;else outer=z;}
  return safeSpawn(scene,[x,scene.terrain(x,(inner+outer)/2).height,(inner+outer)/2]);
}
export function safeSpawn(scene:BuildScene,at:Point3,occupied:Point3[]=[],remembered=false):Point3 {
  for(let i=0;i<200;i++){const angle=i*2.399963,radius=i?Math.sqrt(i)*2:0,x=at[0]+Math.cos(angle)*radius,z=at[2]+Math.sin(angle)*radius,s=scene.groundSurface(x,z,remembered&&i===0?at[1]:Infinity),water=scene.world.water.sample(x,z);
    if((!remembered||i!==0)&&(s.normal[1]<.95||water&&water.level>s.height)||occupied.some(p=>Math.hypot(p[0]-x,p[2]-z)<CHARACTER.radius*2+.1&&Math.abs(p[1]-at[1])<CHARACTER.height))continue;
    const feetY=i===0?Math.max(at[1],s.height):s.height;
    if(scene.nearby(x,z,3).some(n=>!scene.edits.get(n.id)?.removed&&n.colliders.some(c=>feetY<c.top&&feetY+CHARACTER.height>c.bottom&&Math.hypot(c.x-x,c.z-z)<c.radius+CHARACTER.radius+.1)))continue;
    return [x,feetY,z];
  }
  return [at[0],Math.max(scene.groundSurface(at[0],at[2],remembered?at[1]:Infinity).height,at[1]),at[2]];
}
