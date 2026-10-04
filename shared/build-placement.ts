import {BuildScene,type BuildSolid} from './build-scene';
import {BUILD_REACH,SNAP_DISTANCE,objectRegistry,objectDefinition,buildProp,type BuildObject,type BuildRequest,type SnapSocket} from './object-registry';
import {CHARACTER} from './character';
import {orientation,embeddedRockHeight} from './placement';
import {rockSurface} from './rock-collision';
import {boxShape,intersects,type ConvexShape} from './convex';
import type {Point3} from './rocks';
export interface Placement {object:BuildObject;valid:boolean;code:string;reason:string}
export function validBuildRequest(value:unknown):value is BuildRequest {
  const r=value as BuildRequest;if(!r||typeof r.requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(r.requestId))return false;
  const definition=objectRegistry.get(r.definitionId),vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e9);
  return !!definition&&Number.isInteger(r.variant)&&!!definition.variants[r.variant]&&Number.isFinite(r.rotation)&&Math.abs(r.rotation)<1e6
    &&vec(r.eye)&&vec(r.direction)&&vec(r.feet)&&Math.abs(Math.hypot(...r.direction)-1)<.01&&typeof r.standing==='boolean'
    &&Math.hypot(r.eye[0]-r.feet[0],r.eye[2]-r.feet[2])<.05&&Math.abs(r.eye[1]-r.feet[1]-CHARACTER.eyeHeight)<.15
    &&(r.expected===undefined||!!r.expected&&vec(r.expected.position)&&Number.isFinite(r.expected.rotation)&&!!r.expected.support);
}
function socketPoint(solid:BuildSolid,socket:SnapSocket):Point3 {
  const w=objectDefinition(solid.object!.definitionId).wall!,p=solid.object!.position,yaw=solid.object!.rotation;
  if(socket==='top')return [p[0],p[1]+w.height,p[2]];
  const side=socket==='left'?-1:1;return [p[0]+Math.cos(yaw)*w.width/2*side,p[1],p[2]-Math.sin(yaw)*w.width/2*side];
}
function shortenedWall(solid:BuildSolid,side:number):ConvexShape {
  const w=objectDefinition(solid.object!.definitionId).wall!,yaw=solid.prop.rotation,trim=.32;
  return boxShape([solid.prop.x-Math.cos(yaw)*side*trim/2,solid.prop.y+w.height/2,solid.prop.z+Math.sin(yaw)*side*trim/2],[w.width/2-trim/2,w.height/2,w.depth/2],yaw);
}
export function solvePlacement(scene:BuildScene,request:BuildRequest):Placement {
  const definition=objectDefinition(request.definitionId),hit=scene.raycast(request.eye,request.direction);
  const point=hit?.point??[request.eye[0]+request.direction[0]*BUILD_REACH,request.eye[1]+request.direction[1]*BUILD_REACH,request.eye[2]+request.direction[2]*BUILD_REACH]as Point3;
  const object:BuildObject={id:request.requestId,definitionId:request.definitionId,variant:request.variant,position:[point[0],scene.terrain(point[0],point[2]).height,point[2]],rotation:request.rotation%(Math.PI*2),normal:[0,1,0],support:{kind:'terrain'}};
  let anchor:BuildSolid|undefined;
  if(definition.wall&&hit) {
    let best=Infinity,socket:SnapSocket|undefined;
    for(const solid of scene.placed.query(point[0],point[2],3)) {
      if(!objectRegistry.get(solid.object!.definitionId)?.wall)continue;
      for(const end of ['left','right']as const) {
        const p=socketPoint(solid,end),d=Math.hypot(p[0]-point[0],p[2]-point[2]);
        if(d<SNAP_DISTANCE&&Math.abs(point[1]-p[1])<2.2&&d<best){best=d;anchor=solid;socket=end;}
      }
    }
    if(hit.solid?.object&&objectRegistry.get(hit.solid.object.definitionId)?.wall&&point[1]>hit.solid.collider.top-.65&&(!socket||point[1]>hit.solid.collider.top-.1)) {anchor=hit.solid;socket='top';}
    if(anchor&&socket) {
      object.support={kind:'wall',id:anchor.id,socket};const p=socketPoint(anchor,socket);
      if(socket==='top'){object.rotation=anchor.prop.rotation;object.position=p;}
      else {object.rotation=(anchor.prop.rotation+request.rotation)%(Math.PI*2);const side=socket==='right'?1:-1;object.position=[p[0]+Math.cos(object.rotation)*definition.wall.width/2*side,p[1],p[2]-Math.sin(object.rotation)*definition.wall.width/2*side];}
    }else if(hit.solid?.collider.kind==='rock'){anchor=hit.solid;object.support={kind:'rock',id:anchor.id};}
  }
  const fail=(code:string,reason:string):Placement=>({object,valid:false,code,reason});
  const terrain=scene.terrain(object.position[0],object.position[2]);
  if(definition.family==='rock') {
    object.normal=terrain.normal;const prop=buildProp(object);
    object.position[1]=embeddedRockHeight(scene.rocks[prop.variant],prop.x,prop.z,prop.scale,orientation(object.normal,object.rotation),(x,z)=>scene.terrain(x,z).height);
  }else if(definition.family==='tree')object.position[1]=terrain.height-.20;
  else if(definition.family==='fixture')object.position[1]=terrain.height-.04;
  if(!hit)return fail('reach','Look at a surface within 10 meters');
  if(!request.standing||Math.abs(request.feet[1]-scene.standingHeight(request.feet[0],request.feet[2]))>.5)return fail('standing','Stand on solid ground to build');
  if(definition.family!=='wall'&&hit.solid)return fail('support','Place this on clear ground');
  let candidate:BuildSolid|undefined;
  if(definition.family==='wall') {
    const w=definition.wall!,samples:Point3[]=[],heights:number[]=[];
    for(let ix=0;ix<=12;ix++)for(const iz of [-1,0,1]) {
      const x=(ix/12-.5)*w.width,z=iz*w.depth/2,c=Math.cos(object.rotation),s=Math.sin(object.rotation),px=object.position[0]+x*c+z*s,pz=object.position[2]-x*s+z*c;
      let height=scene.terrain(px,pz).height;
      if(object.support.kind==='rock') {
        const surface=rockSurface(anchor!.collider,px,pz);if(!surface||surface.normal[1]<.85)return fail('rock-support','The rock needs a broad, level top');height=surface.height;
      }
      heights.push(height);samples.push([px,height,pz]);
    }
    const maximum=Math.max(...heights),minimum=Math.min(...heights);
    if(object.support.kind==='terrain') {
      if(hit.solid)return fail('support','Aim at ground, a wall joint, or a broad rock top');
      if(maximum-minimum>.45)return fail('ground','The ground is too uneven for this wall');
      object.position[1]=maximum-.10;
    }else if(object.support.kind==='rock') {
      if(maximum-minimum>.30)return fail('rock-support','The rock needs a broad, level top');object.position[1]=maximum+.015;
    }else if(object.support.socket!=='top'&&(maximum>object.position[1]+.18||minimum<object.position[1]-.38))return fail('ground','The wall joint leaves too much ground overlap or a gap');
    for(const p of samples) {
      const water=scene.world.surfaceWater(p[0],p[2]);if(water&&object.position[1]<water.level+.05)return fail('water','Walls must stay above water');
      if(p[1]>object.position[1]+.18)return fail('ground','The wall is buried too deeply');
    }
  }else {
    if(terrain.normal[1]<(definition.family==='rock'?.55:.88))return fail('slope','This slope is too steep');
    // A ground-facing rock may follow a slope, but cannot span a cliff or a
    // deep hollow. Check deviation from its support plane over the footprint.
    const prop=buildProp(object);candidate=scene.solid(prop,object.id,object);const radius=candidate.collider.radius;
    for(let i=0;i<12;i++) {
      const angle=i*Math.PI/6,dx=Math.cos(angle)*radius,dz=Math.sin(angle)*radius,plane=terrain.height-(terrain.normal[0]*dx+terrain.normal[2]*dz)/terrain.normal[1];
      if(Math.abs(scene.terrain(prop.x+dx,prop.z+dz).height-plane)>(definition.family==='rock'?.5*prop.scale:.3))return fail('ground','The ground is too uneven for this object');
    }
    const water=scene.world.surfaceWater(object.position[0],object.position[2]);if(definition.family==='tree'&&water&&terrain.height<water.level+.05)return fail('water','Trees need dry ground');
    if(definition.family==='fixture'&&water&&terrain.height<water.level+.05)return fail('water','Torches need dry ground');
  }
  if(Math.hypot(object.position[0]-request.eye[0],object.position[1]-request.eye[1],object.position[2]-request.eye[2])>BUILD_REACH+.65)return fail('reach','Placement is beyond your reach');
  candidate??=scene.solid(buildProp(object),object.id,object);
  const player:ConvexShape={kind:'cylinder',center:[request.feet[0],request.feet[1]+CHARACTER.height/2,request.feet[2]],radius:CHARACTER.radius+.05,halfHeight:CHARACTER.height/2};
  if(intersects(candidate.shape,player))return fail('player','Leave room for yourself');
  for(const solid of scene.nearby(object.position[0],object.position[2],candidate.collider.radius+.2)) {
    if(solid.id===object.id)continue;
    if(solid.id===anchor?.id&&object.support.kind==='rock')continue;
    if(solid.id===anchor?.id&&object.support.kind==='wall') {
      if(object.support.socket==='top')continue;
      const side=object.support.socket==='right'?1:-1;
      if(!intersects(shortenedWall(anchor,side),shortenedWall(candidate,-side)))continue;
    }
    if(intersects(candidate.shape,solid.shape))return fail('overlap',`Overlaps ${solid.collider.kind==='bush'?'a bush':solid.object?'another build':solid.collider.kind==='tree'?'a tree':'a rock'}`);
  }
  if(request.expected) {
    const e=request.expected,rotationDifference=Math.atan2(Math.sin(e.rotation-object.rotation),Math.cos(e.rotation-object.rotation));
    if(Math.hypot(...object.position.map((v,i)=>v-e.position[i]))>.035||Math.abs(rotationDifference)>.001||JSON.stringify(e.support)!==JSON.stringify(object.support))return fail('changed','The placement changed; aim again');
  }
  return {object,valid:true,code:'ok',reason:object.support.kind==='wall'?object.support.socket==='top'?'Stacked · aligned to the wall below':'Snapped · rotate around the joint':object.support.kind==='rock'?'Supported by rock':'Ready to place'};
}
