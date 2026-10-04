import {objectDefinition,buildProp,type DoorRequest,type BuildObject,type BuildResult} from './object-registry';
import type {BuildScene} from './build-scene';
import {intersects,type ConvexShape} from './convex';
import {CHARACTER} from './character';
import type {Point3} from './rocks';
export function validDoorRequest(value:unknown):value is DoorRequest {
  const r=value as DoorRequest,vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e9);
  return !!r&&r.action==='door'&&typeof r.requestId==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(r.requestId)&&typeof r.objectId==='string'&&r.objectId.length<=100&&typeof r.open==='boolean'&&vec(r.eye)&&vec(r.direction)&&Math.abs(Math.hypot(...r.direction)-1)<.01;
}
export function doorChange(scene:BuildScene,r:DoorRequest):{ok:true;object:BuildObject}|Extract<BuildResult,{ok:false}>{
  const solid=scene.placed.get(r.objectId),object=solid?.object;
  if(!object||objectDefinition(object.definitionId).attachment!=='door')return {ok:false,code:'door',error:'This door no longer exists'};
  // The client toggles immediately, but the server still traces its current pose.
  const hit=scene.raycast(r.eye,r.direction,3);if(hit?.solid?.id!==object.id)return {ok:false,code:'reach',error:'Look at the door within 3 meters'};
  if(!!object.state?.open===r.open)return {ok:true,object};
  const player:ConvexShape={kind:'cylinder',center:[r.eye[0],r.eye[1]-CHARACTER.eyeHeight+CHARACTER.height/2,r.eye[2]],radius:CHARACTER.radius,halfHeight:CHARACTER.height/2};
  const neighbours=scene.nearby(object.position[0],object.position[2],2.5);
  for(let i=0;i<=12;i++){
    const angle=i/12*Math.PI/2,c=Math.cos(object.rotation),s=Math.sin(object.rotation),x=-.55+.55*Math.cos(angle),z=.55*Math.sin(angle),prop={...buildProp({...object,state:{open:false}}),x:object.position[0]+x*c+z*s,z:object.position[2]-x*s+z*c,rotation:object.rotation+angle};
    const pose=scene.solid(prop,object.id,object);
    if(pose.shapes.some(shape=>intersects(shape,player)))return {ok:false,code:'blocked',error:'Step clear of the swinging door'};
    for(const n of neighbours){if(n.id===object.id||object.support.kind==='wall'&&n.id===object.support.id)continue;if(pose.shapes.some(shape=>n.shapes.some(other=>intersects(shape,other))))return {ok:false,code:'blocked',error:'Something blocks the door swing'};}
  }
  return {ok:true,object:{...object,state:{open:r.open}}};
}
