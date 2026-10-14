import type {BuildScene,BuildSolid} from './build-scene';
import {buildProp,objectDefinition,BUILD_REACH,SNAP_DISTANCE,type BuildRequest,type BuildObject,type SnapSocket} from './object-registry';
import {OPENINGS} from './build-parts';
import {CHARACTER} from './character';
import {intersects,type ConvexShape} from './convex';
import type {Point3} from './rocks';
import type {Placement} from './build-placement';
import {orientation,rotate,floorTiltNormal} from './placement';
import {FLOOR_MAX_GRADE_DEPTH,floorPlaneHeight,floorFootprintContains} from './build-terrain';
const pairHit=(a:BuildSolid,b:BuildSolid)=>a.shapes.some(x=>b.shapes.some(y=>intersects(x,y)));
export function finishPlacement(scene:BuildScene,r:BuildRequest,object:BuildObject,anchor?:BuildSolid):Placement {
  const fail=(code:string,reason:string):Placement=>({object,valid:false,code,reason}),candidate=scene.solid(buildProp(object),object.id,object);
  if(Math.hypot(object.position[0]-r.eye[0],object.position[1]-r.eye[1],object.position[2]-r.eye[2])>BUILD_REACH+.65)return fail('reach','Placement is beyond your reach');
  if(!r.standing||Math.abs(r.feet[1]-scene.standingHeight(r.feet[0],r.feet[2],r.feet[1]))>.5)return fail('standing','Stand on solid ground to build');
  const player:ConvexShape={kind:'cylinder',center:[r.feet[0],r.feet[1]+CHARACTER.height/2,r.feet[2]],radius:CHARACTER.radius+.05,halfHeight:CHARACTER.height/2};
  if(candidate.shapes.some(s=>intersects(s,player)))return fail('player','Leave room for yourself');
  for(const s of scene.nearby(candidate.prop.x,candidate.prop.z,candidate.collider.radius+.2)){
    if(s.id===object.id||s.id===anchor?.id)continue;
    if(pairHit(candidate,s))return fail('overlap',`Overlaps ${s.object?'another build':s.collider.kind==='bush'?'a bush':s.collider.kind==='tree'?'a tree':'a rock'}`);
  }
  if(r.expected){const e=r.expected,d=Math.atan2(Math.sin(e.rotation-object.rotation),Math.cos(e.rotation-object.rotation));if(Math.hypot(...object.position.map((n,i)=>n-e.position[i]))>.035||Math.abs(d)>.001||e.normal&&Math.hypot(...object.normal.map((n,i)=>n-e.normal![i]))>.001||JSON.stringify(e.support)!==JSON.stringify(object.support))return fail('changed','The placement changed; aim again');}
  return {object,valid:true,code:'ok',reason:object.support.kind==='terrain'?'Ready to place':object.support.kind==='wall'&&object.support.socket==='opening'?'Creates an opening in this wall':'Attached · aligned to support'};
}
export function cataloguePlacement(scene:BuildScene,r:BuildRequest):Placement|null {
  const d=objectDefinition(r.definitionId),hit=scene.raycast(r.eye,r.direction),p=hit?.point??r.eye;
  const floorHit=hit?.solid?.object&&objectDefinition(hit.solid.object.definitionId).family==='floor';
  if(!['floor','roof','furniture','attachment'].includes(d.family)&&!(d.family==='fixture'&&floorHit)&&!(d.wall&&floorHit))return null;
  const object:BuildObject={id:r.requestId,definitionId:r.definitionId,variant:r.variant,position:[p[0],scene.groundSurface(p[0],p[2],p[1]).height,p[2]],rotation:r.rotation%(Math.PI*2),normal:[0,1,0],support:{kind:'terrain'}};
  const fail=(code:string,reason:string):Placement=>({object,valid:false,code,reason});if(!hit)return fail('reach','Look at a surface within 10 meters');
  let anchor:BuildSolid|undefined;
  if(d.attachment){
    anchor=hit.solid;if(anchor?.object&&objectDefinition(anchor.object.definitionId).attachment&&anchor.object.support.kind==='wall')anchor=scene.placed.get(anchor.object.support.id);
    if(!anchor?.object||!objectDefinition(anchor.object.definitionId).wall)return fail('support','Aim at a placed wall');
    const parent=anchor.object,w=objectDefinition(parent.definitionId).wall!,c=Math.cos(parent.rotation),s=Math.sin(parent.rotation);
    object.rotation=parent.rotation;object.support={kind:'wall',id:parent.id,socket:d.attachment==='mount'?'mount':'opening'};
    if(d.attachment==='mount'){
      const dx=p[0]-parent.position[0],dz=p[2]-parent.position[2],localX=Math.max(-w.width/2+.20,Math.min(w.width/2-.20,dx*c-dz*s));
      const side=(r.eye[0]-parent.position[0])*s+(r.eye[2]-parent.position[2])*c>=0?1:-1,z=side*(w.depth/2+.025);
      object.position=[parent.position[0]+localX*c+z*s,Math.max(parent.position[1]+.20,Math.min(parent.position[1]+w.height-.90,p[1]-.35)),parent.position[2]-localX*s+z*c];if(side<0)object.rotation+=Math.PI;
      // A mounting plate must land on wall material, rather than bridging a hole.
      if(anchor.prop.aperture){const o=OPENINGS[anchor.prop.aperture];if(Math.abs(localX)<o.width/2+.15&&object.position[1]<parent.position[1]+o.bottom+o.height&&object.position[1]+.84>parent.position[1]+o.bottom)return fail('support','Mount the torch beside the opening');}
    }else{
      if(scene.placed.query(parent.position[0],parent.position[2],3).some(s=>s.object?.support.kind==='wall'&&s.object.support.id===parent.id&&['door','window'].includes(objectDefinition(s.object.definitionId).attachment??'')))return fail('opening','This wall already has a door or window');if(anchor.prop.aperture&&anchor.prop.aperture!==d.attachment)return fail('opening','Use the matching attachment for this opening, or repair it first');
      const o=OPENINGS[d.attachment];object.position=[parent.position[0],parent.position[1]+o.bottom,parent.position[2]];if(d.attachment==='door')object.state={open:false};
      // Cutting is derived from the child object. Removing a rejected optimistic
      // attachment restores the solid wall without an extra network mutation.
      const cut={...anchor.prop,aperture:d.attachment};const frame=scene.solid(cut,anchor.id,parent),child=scene.solid(buildProp(object),object.id,object);
      if(pairHit(frame,child))return fail('opening','The opening does not fit this wall');
      if(scene.placed.query(parent.position[0],parent.position[2],3).some(solid=>solid.object?.support.kind==='wall'&&solid.object.support.id===parent.id&&solid.object.support.socket==='mount'&&Math.abs((solid.prop.x-parent.position[0])*c-(solid.prop.z-parent.position[2])*s)<o.width/2+.15&&solid.collider.top>object.position[1]&&solid.collider.bottom<object.position[1]+o.height))return fail('overlap','The opening would remove a torch support');
    }
  }else if(d.slab){
    let best=SNAP_DISTANCE,side:SnapSocket|undefined;
    for(const solid of scene.placed.query(p[0],p[2],5)){
      const parent=solid.object!,pd=objectDefinition(parent.definitionId);if(pd.family!==d.family)continue;
      const a=pd.slab!,q=orientation(parent.normal,parent.rotation);
      for(const [socket,x,z]of [['left',-a.width/2,0],['right',a.width/2,0],['front',0,a.depth/2],['back',0,-a.depth/2]]as const){
        const off=rotate([x,0,z],q),edge:[number,number,number]=[parent.position[0]+off[0],parent.position[1]+off[1],parent.position[2]+off[2]],distance=Math.hypot(p[0]-edge[0],p[2]-edge[2]);
        if(distance<best&&Math.abs(p[1]-edge[1])<.65){best=distance;anchor=solid;side=socket;}
      }
    }
    if(anchor&&side){const a=anchor.object!,ad=objectDefinition(a.definitionId).slab!,q=orientation(a.normal,a.rotation),x=side==='left'?-(ad.width+d.slab.width)/2:side==='right'?(ad.width+d.slab.width)/2:0,z=side==='front'?(ad.depth+d.slab.depth)/2:side==='back'?-(ad.depth+d.slab.depth)/2:0,off=rotate([x,0,z],q);object.rotation=a.rotation;object.normal=d.family==='floor'?floorTiltNormal(a.normal,r.direction,r.tilt??0):a.normal;object.position=[a.position[0]+off[0],a.position[1]+off[1],a.position[2]+off[2]];object.support={kind:d.family as 'floor'|'roof',id:a.id,socket:side};}
    else if(d.family==='roof'){
      anchor=hit.solid;
      if(anchor?.object&&objectDefinition(anchor.object.definitionId).attachment&&anchor.object.support.kind==='wall')anchor=scene.placed.get(anchor.object.support.id);
      if(!anchor?.object||!objectDefinition(anchor.object.definitionId).wall)return fail('support','Roofs need a wall top or another roof edge');
      const parent=anchor.object,w=objectDefinition(parent.definitionId).wall!,c=Math.cos(parent.rotation),s=Math.sin(parent.rotation);
      let base=parent;for(let i=0;i<32&&base.support.kind==='wall'&&base.support.socket==='top';i++){const next=scene.placed.get(base.support.id)?.object;if(!next)break;base=next;}
      const floor=base.support.kind==='floor'?scene.placed.get(base.support.id)?.object:undefined;
      const reference=floor?.position??r.eye,projection=(reference[0]-parent.position[0])*s+(reference[2]-parent.position[2])*c;
      const defaultSide=(projection>=0?1:-1)*(floor?1:-1),side=defaultSide*(Math.abs(Math.round(r.rotation/(Math.PI/2)))%2?-1:1);
      object.rotation=parent.rotation;object.position=[parent.position[0]+s*1.5*side,parent.position[1]+w.height,parent.position[2]+c*1.5*side];object.support={kind:'wall',id:parent.id,socket:'top'};
    }else if(d.family==='floor'&&hit.solid?.object&&objectDefinition(hit.solid.object.definitionId).wall){
      anchor=hit.solid;const parent=anchor.object!,wall=objectDefinition(parent.definitionId).wall!,c=Math.cos(parent.rotation),s=Math.sin(parent.rotation),projection=(r.eye[0]-parent.position[0])*s+(r.eye[2]-parent.position[2])*c,side=projection>=0?1:-1;
      object.rotation=parent.rotation;object.normal=floorTiltNormal([0,1,0],r.direction,r.tilt??0,parent.rotation);object.position=[parent.position[0]+s*1.5*side,parent.position[1]+wall.height,parent.position[2]+c*1.5*side];object.support={kind:'wall',id:parent.id,socket:'top'};
    }else if(hit.solid)return fail('support','Floors need ground, a wall top, or a floor edge');
    if(d.family==='floor'){
      const terrain=scene.groundSurface(object.position[0],object.position[2],object.position[1]);
      if(!anchor)object.normal=floorTiltNormal(terrain.normal,r.direction,r.tilt??0);
      if(object.normal[1]<.5)return fail('slope','The floor tilt is too steep');
      const q=orientation(object.normal,object.rotation),support:number[]=[];
      for(let ix=0;ix<=12;ix++)for(let iz=0;iz<=12;iz++){const localX=(ix/12-.5)*d.slab.width,localZ=(iz/12-.5)*d.slab.depth,off=rotate([localX,0,localZ],q),x=object.position[0]+off[0],z=object.position[2]+off[2],ground=scene.groundSurface(x,z,object.position[1]).height,offset=floorPlaneHeight([object.position[0],0,object.position[2]],object.normal,x,z);support.push(ground-offset);}
      if(!anchor)object.position[1]=Math.max(...support)-.10;
      const maxCut=anchor?0:Math.max(...support.map(required=>required-object.position[1]));
      if(maxCut>FLOOR_MAX_GRADE_DEPTH)return fail('ground',`This floor needs more than ${FLOOR_MAX_GRADE_DEPTH} m of excavation`);
      const samples=footprint(d.slab.width,d.slab.depth,object);
      if(!anchor&&samples.some(pt=>floorPlaneHeight(object.position,object.normal,pt[0],pt[2])-scene.groundSurface(pt[0],pt[2],object.position[1]).height>.48))return fail('support','The floor would leave too much unsupported ground');
    }
  }else if(d.wall&&floorHit){
    anchor=hit.solid!;const parent=anchor.object!,slab=objectDefinition(parent.definitionId).slab!,dx=p[0]-parent.position[0],dz=p[2]-parent.position[2],c=Math.cos(parent.rotation),s=Math.sin(parent.rotation),x=dx*c-dz*s,z=dx*s+dz*c;
    const alongX=Math.abs(z)>=Math.abs(x),side=(alongX?z:x)>=0?1:-1;
    object.rotation=parent.rotation+(alongX?0:Math.PI/2)+r.rotation;object.position=[parent.position[0]+(alongX?s:c)*1.5*side,parent.position[1]+slab.height,parent.position[2]+(alongX?c:-s)*1.5*side];object.support={kind:'floor',id:parent.id,socket:alongX?(side>0?'front':'back'):(side>0?'right':'left')};
  }else{
    if(hit.solid){anchor=hit.solid;const pd=anchor.object&&objectDefinition(anchor.object.definitionId);if(!pd||!pd.slab)return fail('support','Furniture needs ground or a floor');object.position[1]=anchor.collider.top;object.support={kind:pd.family as 'floor'|'roof',id:anchor.id,socket:'top'};}
    const boxes=d.boxes,extent=boxes?Math.max(...boxes.map(b=>Math.hypot(b.center[0],b.center[2])+Math.hypot(b.size[0],b.size[2])/2)):d.fixture?.radius??.5;
    const heights=footprint(extent*2,extent*2,object).map(q=>scene.groundSurface(q[0],q[2],object.position[1]).height);
    if(!anchor){if(Math.max(...heights)-Math.min(...heights)>.24)return fail('ground','Furniture needs reasonably level ground');object.position[1]=Math.max(...heights)-.02;}
    else if(footprint(extent*2,extent*2,object).some(q=>!containsSlab(anchor!,q[0],q[2])))return fail('support','Keep the whole object on the floor');
  }
  for(const q of footprint(d.slab?.width??d.wall?.width??.3,d.slab?.depth??d.wall?.depth??.3,object)){
    const water=scene.world.surfaceWater(q[0],q[2]);if(water&&object.position[1]<water.level+.05)return fail('water','Build above the water');
    if(d.family!=='floor'&&scene.groundSurface(q[0],q[2],object.position[1]).height>object.position[1]+.18)return fail('ground','The object would be buried too deeply');
  }
  return finishPlacement(scene,r,object,anchor);
}
function containsSlab(s:BuildSolid,x:number,z:number){const d=objectDefinition(s.object!.definitionId).slab!;return floorFootprintContains(s.object!.position,s.object!.normal,s.prop.rotation,d.width,d.depth,x,z);}
function footprint(w:number,d:number,o:BuildObject):Point3[]{const q=orientation(o.normal,o.rotation),result:Point3[]=[];for(let ix=0;ix<=4;ix++)for(let iz=0;iz<=4;iz++){const p=rotate([(ix/4-.5)*w,0,(iz/4-.5)*d],q);result.push([o.position[0]+p[0],o.position[1]+p[1],o.position[2]+p[2]]);}return result;}
