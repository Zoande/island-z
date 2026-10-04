import type {Prop} from './world';
import type {CharacterCollider} from './character';
import {rockCollider} from './rock-collision';
import type {Point3} from './rocks';
import {objectRegistry} from './object-registry';
/** Physical asset dimensions shared by client movement and server placement. */
export function playerCollider(prop:Prop,points?:Point3[]):CharacterCollider|null {
  if(prop.kind==='rock'&&points)return rockCollider(prop,points);
  const wall=objectRegistry.get(prop.kind)?.wall;
  if(wall)return {kind:'wall',x:prop.x,z:prop.z,bottom:prop.y,top:prop.y+wall.height,radius:Math.hypot(wall.width,wall.depth)/2,wall:{halfWidth:wall.width/2,halfDepth:wall.depth/2,yaw:prop.rotation}};
  const fixture=objectRegistry.get(prop.kind)?.fixture;
  if(fixture)return {kind:'fixture',x:prop.x,z:prop.z,radius:fixture.radius*prop.scale,bottom:prop.y,top:prop.y+fixture.height*prop.scale};
  if(prop.kind==='oak'||prop.kind==='birch') {
    const oak=prop.kind==='oak',radius=(oak?[.42,.58,.70,.78,.55,.25]:[.19,.25,.29,.32,.22,.13])[prop.variant];
    const height=(oak?[14,19,23,27,18,11]:[17,21,25,29,20,13])[prop.variant];
    return {x:prop.x,z:prop.z,radius:(radius*1.5+.06)*prop.scale,bottom:prop.y,top:prop.y+height*prop.scale,kind:'tree'};
  }
  if(prop.kind==='palm')return {x:prop.x,z:prop.z,radius:.42*prop.scale,bottom:prop.y,top:prop.y+[12,17,14][prop.variant]*prop.scale,kind:'tree'};
  if(prop.kind==='bush') {
    const height=[1.2,1.8,2.4,3.1][prop.variant]*prop.scale;
    return {x:prop.x,z:prop.z,radius:height*.6+.2*prop.scale,bottom:prop.y,top:prop.y+height,kind:'bush'};
  }
  return null;
}
