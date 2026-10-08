import {WorldGenerator,type Prop} from './world';
import {rockPoints,ROCK_RINGS,ROCK_SEGMENTS,type Point3} from './rocks';
import {orientation,rotate,embeddedRockHeight,type MeshSurface} from './placement';
import {playerCollider} from './object-colliders';
import {rockSurface} from './rock-collision';
import {wallContains,wallRay} from './wall-collision';
import type {CharacterCollider} from './character';
import {buildProp,objectDefinition,type BuildObject,BUILD_REACH} from './object-registry';
import {boxShape,type ConvexShape} from './convex';
import {SpatialIndex} from './spatial-index';
import {boxColliders} from './build-parts';
import type {CollisionBox} from './volume-collision';
import {worldPoint,quaternion} from './destruction';
import {naturalId,volumeRay,recordFor,treeSolidAssets,isTree,type SolidRecord,destructionRule} from './destruction';
import {SparseVolume} from './volume';
import {terrainId,terrainRecord} from './terrain-volume';
export interface BuildSolid {id:string;prop:Prop;collider:CharacterCollider;shape:ConvexShape;colliders:CharacterCollider[];shapes:ConvexShape[];object?:BuildObject;record?:SolidRecord}
export interface BuildHit {point:Point3;distance:number;solid?:BuildSolid}
/** A renderer-independent canonical 2m terrain surface and bounded scenery cache.
 * Both previews and authoritative validation sample the same triangles. */
export class BuildScene {
  readonly placed=new SpatialIndex<BuildSolid>();revision=0;terrainRevision=0;miningRevision=0;
  readonly damageCollision=new Map<string,{revision:number;shapes:ConvexShape[];colliders:CharacterCollider[]}>();
  readonly edits=new Map<string,SolidRecord>();readonly editedCollisionReady=new Set<string>();readonly openings=new Map<string,'door'|'window'|null>();
  readonly leveling=new Map<string,BuildObject>();private permanentFloors=new SpatialIndex<BuildObject>();
  private floors=new SpatialIndex<BuildObject>();
  readonly rocks:Point3[][];
  private solidSources=new WeakMap<BuildSolid,SolidRecord>();private natural=new Map<string,BuildSolid[]>();private heights=new Map<string,number>();
  constructor(readonly world:WorldGenerator){this.rocks=Array.from({length:12},(_,i)=>rockPoints(world.config.seed,i));}
  private terrainVolumes=new WeakMap<SolidRecord,SparseVolume>();
  terrainRecord(point:Point3):SolidRecord {return this.edits.get(terrainId(point))??terrainRecord(point,(x,z)=>this.terrain(x,z),(x,z)=>this.world.sample(x,z).weights);}
  groundDistance(point:Point3):number {
    const record=this.edits.get(terrainId(point));if(record){let volume=this.terrainVolumes.get(record);if(!volume){volume=new SparseVolume(record.source,record.volume,true);this.terrainVolumes.set(record,volume);}return volume.distance([point[0]-record.prop.x,point[1]-record.prop.y,point[2]-record.prop.z]);}
    const surface=this.terrain(point[0],point[2]);return (point[1]-surface.height)*surface.normal[1];
  }
  /** Select the floor below the actor, retaining ceilings and higher surfaces
   * as solids rather than snapping an underground player onto the hillside. */
  groundSurface(x:number,z:number,feetY=Infinity):MeshSurface {
    const original=this.terrain(x,z),start=Math.min(original.height+.05,feetY+.28);
    if(!this.edits.has(terrainId([x,Math.min(start,original.height-.001),z]))&&!this.edits.has(terrainId([x,original.height-.001,z])))return original;
    let previous=start;
    for(let y=start,n=0;n<20000;n++){
      const d=this.groundDistance([x,y,z]);if(d<=0){let low=y,high=previous;for(let i=0;i<12;i++){const mid=(low+high)/2;if(this.groundDistance([x,mid,z])>0)high=mid;else low=mid;}const height=(low+high)/2,h=.025,normal:Point3=[this.groundDistance([x+h,height,z])-this.groundDistance([x-h,height,z]),this.groundDistance([x,height+h,z])-this.groundDistance([x,height-h,z]),this.groundDistance([x,height,z+h])-this.groundDistance([x,height,z-h])],length=Math.hypot(...normal)||1;return {height,normal:normal.map(v=>v/length)as Point3};}
      previous=y;y-=Math.max(.0125,Math.min(.2,d*.75));
    }
    return original;
  }
  terrain(x:number,z:number):MeshSurface {
    const cx=Math.floor(x/2)*2,cz=Math.floor(z/2)*2,u=(x-cx)/2,v=(z-cz)/2;
    const height=(x:number,z:number)=>{const key=`${x}:${z}`;let value=this.heights.get(key);if(value===undefined){value=this.world.height(x,z);this.heights.set(key,value);if(this.heights.size>32768)this.heights.delete(this.heights.keys().next().value!);}return value;};
    const a=this.grade(cx,cz,height(cx,cz)),b=this.grade(cx+2,cz,height(cx+2,cz)),c=this.grade(cx,cz+2,height(cx,cz+2)),d=this.grade(cx+2,cz+2,height(cx+2,cz+2));
    const y=u+v<=1?a+(b-a)*u+(c-a)*v:b*(1-v)+d*(u+v-1)+c*(1-u);
    const dx=(u+v<=1?b-a:d-c)/2,dz=(u+v<=1?c-a:d-b)/2,length=Math.hypot(dx,1,dz);
    return {height:y,normal:[-dx/length,1/length,-dz/length]};
  }
  /** A bounded cut, never a cumulative dig. Three metres of covered grid support
   * prevent terrain triangles poking through rotated thin floor slabs. */
  grade(x:number,z:number,original:number):number {
    let result=original;
    for(const floor of [...this.floors.query(x,z,0),...this.permanentFloors.query(x,z,0)]){
      // Underground floors support a cave interior; they must not grade its roof.
      if(original-floor.position[1]>.45)continue;
      const slab=objectDefinition(floor.definitionId).slab!,dx=x-floor.position[0],dz=z-floor.position[2],c=Math.cos(floor.rotation),s=Math.sin(floor.rotation);
      const distance=Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-slab.width/2),Math.max(0,Math.abs(dx*s+dz*c)-slab.depth/2));
      if(distance>=4)continue;
      const t=Math.max(0,Math.min(1,distance-3)),weight=1-t*t*(3-2*t);
      result=Math.min(result,original-Math.min(.4,Math.max(0,original-floor.position[1]+.015))*weight);
    }return result;
  }
  gradingSignature(x:number,z:number,extent:number):string{return [...this.floors.query(x+extent/2,z+extent/2,extent*.71+7),...this.permanentFloors.query(x+extent/2,z+extent/2,extent*.71+7)].filter(o=>Math.abs(o.position[0]-(x+extent/2))<extent/2+7&&Math.abs(o.position[2]-(z+extent/2))<extent/2+7).map(o=>JSON.stringify(o)).sort().join('|');}
  floorAt(x:number,z:number):boolean {return this.floors.query(x,z,0).some(o=>{const a=objectDefinition(o.definitionId).slab!,dx=x-o.position[0],dz=z-o.position[2],c=Math.cos(o.rotation),s=Math.sin(o.rotation);return Math.abs(dx*c-dz*s)<=a.width/2+.1&&Math.abs(dx*s+dz*c)<=a.depth/2+.1;});}
  solid(prop:Prop,id:string,object?:BuildObject):BuildSolid {
    const boxes=boxColliders(prop),collider=boxes?.length?{kind:'wall' as const,x:prop.x,z:prop.z,bottom:Math.min(...boxes.map(b=>b.bottom)),top:Math.max(...boxes.map(b=>b.top)),radius:Math.max(...boxes.map(b=>Math.hypot(b.x-prop.x,b.z-prop.z)+b.radius)),wall:boxes[0].wall}:playerCollider(prop,this.rocks[prop.variant]);if(!collider)throw new Error('Object has no physical shape');
    let shape:ConvexShape;
    if(collider.wall){const w=collider.wall;shape=boxShape([prop.x,(collider.top+collider.bottom)/2,prop.z],[w.halfWidth,(collider.top-collider.bottom)/2,w.halfDepth],w.yaw);}
    else if(prop.kind==='rock') {
      const q=orientation(prop.normal??[0,1,0],prop.rotation),points=this.rocks[prop.variant].map(p=>{const v=rotate([p[0]*prop.scale,p[1]*prop.scale,p[2]*prop.scale],q);return [v[0]+prop.x,v[1]+prop.y,v[2]+prop.z] as Point3;});
      shape={kind:'hull',points,center:[prop.x,(collider.bottom+collider.top)/2,prop.z]};
    }else shape={kind:'cylinder',center:[prop.x,(collider.top+collider.bottom)/2,prop.z],radius:collider.radius,halfHeight:(collider.top-collider.bottom)/2};
    let colliders=boxes??[collider],shapes=boxes?boxes.map(c=>boxShape([c.x,(c.bottom+c.top)/2,c.z],[c.wall!.halfWidth,(c.top-c.bottom)/2,c.wall!.halfDepth],c.wall!.yaw)):[shape];
    const cooked=this.damageCollision.get(id);if(cooked&&cooked.revision===this.edits.get(id)?.revision&&prop.aperture===this.placed.get(id)?.prop.aperture){shapes=cooked.shapes;colliders=cooked.colliders;}return {id,prop,collider,shape,colliders,shapes,object,record:this.edits.get(id)};
  }
  naturalAt(x:number,z:number,radius:number):BuildSolid[] {
    const result:BuildSolid[]=[];
    for(let tz=Math.floor((z-radius-20)/64)*64;tz<=z+radius+20;tz+=64)for(let tx=Math.floor((x-radius-20)/64)*64;tx<=x+radius+20;tx+=64) {
      const key=`${tx}:${tz}`;let solids=this.natural.get(key);
      if(!solids) {
        solids=this.world.props(tx,tz,64,false).map(prop=>{
          const surface=this.terrain(prop.x,prop.z),placed={...prop,y:surface.height-.20};
          if(prop.kind==='rock'){placed.normal=surface.normal;placed.y=embeddedRockHeight(this.rocks[prop.variant],prop.x,prop.z,prop.scale,orientation(surface.normal,prop.rotation),(x,z)=>this.terrain(x,z).height);}
          return this.solid(placed,naturalId(prop));
        });
        this.natural.set(key,solids);if(this.natural.size>128)this.natural.delete(this.natural.keys().next().value!);
      }
      for(const solid of solids)if(Math.hypot(solid.prop.x-x,solid.prop.z-z)<=radius+(isTree(solid.prop)?treeRadius(solid.prop):solid.collider.radius)&&!this.edits.get(solid.id)?.removed){solid.record=this.edits.get(solid.id);result.push(solid);}
    }
    return result;
  }
  nearby(x:number,z:number,radius:number):BuildSolid[]{const fragments:BuildSolid[]=[];for(const r of this.edits.values())if(r.fragmentOf&&!r.removed){const p=r.pose?.position??[r.prop.x,r.prop.y,r.prop.z],b=r.fragmentBounds??r.source.bounds,reach=Math.hypot(...b[1].map((v,k)=>Math.max(Math.abs(v),Math.abs(b[0][k]))))*r.prop.scale;if(Math.hypot(p[0]-x,p[2]-z)<=radius+reach)fragments.push(this.solid(r.prop,r.id));}return [...this.naturalAt(x,z,radius),...this.placed.query(x,z,radius),...fragments];}
  private refreshWall(id:string){const parent=this.placed.get(id);if(!parent?.object||!objectDefinition(parent.object.definitionId).wall)return;
    const child=this.placed.query(parent.prop.x,parent.prop.z,3).find(s=>s.object?.support.kind==='wall'&&s.object.support.id===id&&['door','window'].includes(objectDefinition(s.object.definitionId).attachment??''));
    const prop=buildProp(parent.object);if(child)prop.aperture=objectDefinition(child.object!.definitionId).attachment as 'door'|'window';else if(this.openings.get(id))prop.aperture=this.openings.get(id)!;
    const solid=this.solid(prop,id,parent.object);this.placed.insert(id,solid,prop.x,prop.z,solid.collider.radius);
  }
  add(object:BuildObject){const previous=this.placed.get(object.id)?.object,solid=this.solid(buildProp(object),object.id,object);this.placed.insert(object.id,solid,solid.prop.x,solid.prop.z,solid.collider.radius);
    if(objectDefinition(object.definitionId).family==='floor'&&JSON.stringify(previous)!==JSON.stringify(object)){this.floors.insert(object.id,object,object.position[0],object.position[2],7);this.terrainRevision++;this.natural.clear();}
    this.refreshWall(object.id);if(object.support.kind==='wall')this.refreshWall(object.support.id);this.revision++;return this.placed.get(object.id)!;}
  remove(id:string,permanent=false){const object=this.placed.get(id)?.object;if(object){if(permanent&&objectDefinition(object.definitionId).family==='floor')this.keepLeveling(object);if(permanent&&object.support.kind==='wall'&&objectDefinition(object.definitionId).attachment&&['door','window'].includes(objectDefinition(object.definitionId).attachment!))this.openings.set(object.support.id,objectDefinition(object.definitionId).attachment as 'door'|'window');this.placed.remove(id);if(objectDefinition(object.definitionId).family==='floor'){this.floors.remove(id);this.terrainRevision++;this.natural.clear();}if(object.support.kind==='wall')this.refreshWall(object.support.id);this.revision++;}}
  keepLeveling(object:BuildObject){if(JSON.stringify(this.leveling.get(object.id))===JSON.stringify(object))return;this.leveling.set(object.id,object);this.permanentFloors.insert(object.id,object,object.position[0],object.position[2],7);this.terrainRevision++;this.natural.clear();}
  forgetLeveling(id:string){if(this.leveling.delete(id)){this.permanentFloors.remove(id);this.terrainRevision++;}}
  setDamageCollision(record:SolidRecord,boxes:CollisionBox[]){const shapes:ConvexShape[]=[],colliders:CharacterCollider[]=[];for(const box of boxes){const points=[0,1,2,3,4,5,6,7].map(n=>worldPoint(record,box.center.map((v,k)=>v+box.half[k]*(n&(1<<k)?1:-1))as Point3)),center=worldPoint(record,box.center);shapes.push({kind:'hull',points,center});const q=quaternion(record),upright=Math.abs(q[0])+Math.abs(q[2])<.001;if(upright)colliders.push({kind:'wall',x:center[0],z:center[2],bottom:center[1]-box.half[1]*record.prop.scale,top:center[1]+box.half[1]*record.prop.scale,radius:Math.hypot(box.half[0],box.half[2])*record.prop.scale,wall:{halfWidth:box.half[0]*record.prop.scale,halfDepth:box.half[2]*record.prop.scale,yaw:2*Math.atan2(q[1],q[3])}});}this.damageCollision.set(record.id,{revision:record.revision,shapes,colliders});const placed=this.placed.get(record.id);if(placed){placed.shapes=shapes;placed.colliders=colliders;}this.revision++;}
  applyRecord(record:SolidRecord){const old=this.edits.get(record.id);this.edits.set(record.id,record);if(record.prop.kind==='terrain'&&old!==record){this.miningRevision++;this.terrainRevision++;}if(record.removed)this.remove(record.id,true);else{const solid=this.placed.get(record.id);if(solid)solid.record=record;}this.revision++;}
  setOpening(id:string,kind:'door'|'window'|null){if(this.openings.get(id)===kind)return;this.openings.set(id,kind);this.refreshWall(id);this.revision++;}
  destructible(id:string):BuildSolid|undefined{const placed=this.placed.get(id);if(placed)return placed;const record=this.edits.get(id);if(record&&!record.removed)return this.solid(record.prop,id,record.object);return;}
  colliders(x:number,z:number,radius=12):CharacterCollider[]{return this.placed.query(x,z,radius).filter(s=>!this.edits.get(s.id)?.removed&&!this.editedCollisionReady.has(s.id)).flatMap(s=>s.colliders);}
  standingHeight(x:number,z:number,feetY=Infinity):number {
    let height=this.groundSurface(x,z,feetY).height;
    for(const solid of this.nearby(x,z,1)) {
      if(solid.record){const start=Math.min(Number.isFinite(feetY)?feetY+.5:solid.collider.top+.5,solid.collider.top+.5),hit=volumeRay(solid.record,[x,start,z],[0,-1,0],Math.max(0,start-height));if(hit)height=Math.max(height,hit.point[1]);continue;}
      for(const c of solid.colliders){
      if(c.kind==='rock')height=Math.max(height,rockSurface(c,x,z)?.height??height);
      if(c.kind==='wall'&&c.top<=feetY+.5&&wallContains(c,x,z,.32))height=Math.max(height,c.top);}
    }
    return height;
  }
  raycast(eye:Point3,direction:Point3,limit=BUILD_REACH,repair=false,volumetric=false):BuildHit|null {
    let distance=limit+1,closest:BuildSolid|undefined;
    for(const solid of this.nearby(eye[0]+direction[0]*limit/2,eye[2]+direction[2]*limit/2,limit/2+1)) {
      let record=this.edits.get(solid.id);if(record?.removed)continue;if(!record&&volumetric&&destructionRule(solid.prop)?.mode==='voxel'){record=this.solidSources.get(solid);if(!record){record=recordFor(solid.id,solid.prop,this.rocks,solid.object);this.solidSources.set(solid,record);}}const hit=record?volumeRay(record,eye,direction,limit,repair&&!!solid.object&&!!destructionRule(record.prop)?.repairable)?.distance??null:solidRay(solid,eye,direction,limit);if(hit!==null&&hit<distance){distance=hit;closest={...solid,record};}
    }
    for(const record of this.edits.values())if(record.fragmentOf&&!record.removed){const hit=volumeRay(record,eye,direction,limit);if(hit&&hit.distance<distance){distance=hit.distance;closest={...this.solid(record.prop,record.id),record};}}
    const terrainDistance=(t:number)=>this.groundDistance([eye[0]+direction[0]*t,eye[1]+direction[1]*t,eye[2]+direction[2]*t]);
    let previous=0;
    for(let t=0;t<=Math.min(limit,distance)+.0001;) {
      const d=terrainDistance(t);
      if(d<=0){let low=previous,high=t;for(let i=0;i<16;i++){const mid=(low+high)/2;if(terrainDistance(mid)>0)low=mid;else high=mid;}distance=(low+high)/2;closest=undefined;
        if(volumetric&&!repair){const point=eye.map((v,k)=>v+direction[k]*Math.min(limit,distance+.002))as Point3,record=this.terrainRecord(point),p=record.prop,shape=boxShape([p.x+.5,p.y+.5,p.z+.5],[.5,.5,.5],0),collider:CharacterCollider={kind:'wall',x:p.x+.5,z:p.z+.5,bottom:p.y,top:p.y+1,radius:Math.SQRT1_2,wall:{halfWidth:.5,halfDepth:.5,yaw:0}};closest={id:record.id,prop:p,record,collider,shape,colliders:[],shapes:[]};}
        break;}previous=t;t+=Math.max(.005,Math.min(.2,d*.75));
    }
    if(distance>limit)return null;
    return {point:[eye[0]+direction[0]*distance,eye[1]+direction[1]*distance,eye[2]+direction[2]*distance],distance,solid:closest};
  }
}
function cylinderRay(c:CharacterCollider,o:Point3,d:Point3,limit:number):number|null {
  const x=o[0]-c.x,z=o[2]-c.z,a=d[0]**2+d[2]**2,b=x*d[0]+z*d[2],constant=x*x+z*z-c.radius*c.radius;
  const candidates:number[]=[];
  if(a>1e-12){const discriminant=b*b-a*constant;if(discriminant>=0){const root=Math.sqrt(discriminant);candidates.push((-b-root)/a,(-b+root)/a);}}
  if(Math.abs(d[1])>1e-12)for(const y of [c.bottom,c.top]){const t=(y-o[1])/d[1];if((x+d[0]*t)**2+(z+d[2]*t)**2<=c.radius*c.radius)candidates.push(t);}
  if(constant<0&&o[1]>c.bottom&&o[1]<c.top)return 0;
  const hits=candidates.filter(t=>t>=0&&t<=limit&&o[1]+d[1]*t>=c.bottom-.00001&&o[1]+d[1]*t<=c.top+.00001);return hits.length?Math.min(...hits):null;
}
function triangleRay(o:Point3,d:Point3,a:Point3,b:Point3,c:Point3):number|null {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const px=d[1]*vz-d[2]*vy,py=d[2]*vx-d[0]*vz,pz=d[0]*vy-d[1]*vx,det=ux*px+uy*py+uz*pz;if(Math.abs(det)<1e-10)return null;
  const tx=o[0]-a[0],ty=o[1]-a[1],tz=o[2]-a[2],u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)return null;
  const qx=ty*uz-tz*uy,qy=tz*ux-tx*uz,qz=tx*uy-ty*ux,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)return null;
  const t=(vx*qx+vy*qy+vz*qz)/det;return t>=0?t:null;
}
export function solidRay(s:BuildSolid,o:Point3,d:Point3,limit:number):number|null {
  if(s.collider.kind==='wall'){const hits=s.colliders.map(c=>wallRay(c,o,d,limit)).filter((t):t is number=>t!==null);return hits.length?Math.min(...hits):null;}
  if(s.collider.kind!=='rock')return cylinderRay(s.collider,o,d,limit);
  const points=(s.shape as Extract<ConvexShape,{kind:'hull'}>).points;let nearest=limit+1;
  for(let r=0;r<ROCK_RINGS;r++)for(let j=0;j<ROCK_SEGMENTS;j++) {
    const a=r*(ROCK_SEGMENTS+1)+j,b=a+1,c=a+ROCK_SEGMENTS+1,e=c+1;
    for(const indices of [[a,b,c],[b,e,c]]){const t=triangleRay(o,d,points[indices[0]],points[indices[1]],points[indices[2]]);if(t!==null&&t<nearest)nearest=t;}
  }
  return nearest<=limit?nearest:null;
}

const treeRadii=new Map<string,number>();
function treeRadius(p:Prop){const key=`${p.kind}-${p.variant}`;let radius=treeRadii.get(key);if(radius===undefined){radius=0;for(const s of treeSolidAssets.get(key)?.primitives??[])if(s.type==='capsule')radius=Math.max(radius,Math.hypot(s.a[0],s.a[2])+s.r0,Math.hypot(s.b[0],s.b[2])+s.r1);treeRadii.set(key,radius);}return radius*p.scale;}
