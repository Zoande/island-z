import type {Prop} from './world';
import type {CharacterCollider} from './character';
import {rockCollider} from './rock-collision';
import type {Point3} from './rocks';
import {objectRegistry} from './object-registry';
import {orientation,rotate} from './placement';
import {type ConvexShape} from './convex';
import {objectBoxes} from './build-parts';
/** Full 3D bounds for a placed box, including a tilted floor's saved normal. */
export function propBoxShapes(prop:Prop):ConvexShape[]|undefined {
  const boxes=objectBoxes(prop);if(!boxes)return;
  const q=orientation(prop.normal??[0,1,0],prop.rotation);
  return boxes.map(b=>{const localCenter=b.center.map(v=>v*prop.scale)as Point3,offset=rotate(localCenter,q),center:[number,number,number]=[prop.x+offset[0],prop.y+offset[1],prop.z+offset[2]],points:Point3[]=[];
    for(const x of [-b.size[0]/2,b.size[0]/2])for(const y of [-b.size[1]/2,b.size[1]/2])for(const z of [-b.size[2]/2,b.size[2]/2]){const p=rotate([(b.center[0]+x)*prop.scale,(b.center[1]+y)*prop.scale,(b.center[2]+z)*prop.scale],q);points.push([prop.x+p[0],prop.y+p[1],prop.z+p[2]]);}
    return {kind:'hull',center,points};
  });
}
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
