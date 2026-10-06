import RAPIER from '@dimforge/rapier3d-compat';
import type {Point3} from './rocks';
import {worldPoint,quaternion,type SolidRecord} from './destruction';
import type {CollisionBox} from './volume-collision';
import type {VolumeMesh} from './volume';
let initialization:Promise<void>|undefined;
export const initializePhysics=()=>initialization??=RAPIER.init();
const vector=(p:Point3)=>({x:p[0],y:p[1],z:p[2]});
const rotation=(q:[number,number,number,number])=>({x:q[0],y:q[1],z:q[2],w:q[3]});
type StepFace={lo:Point3;hi:Point3};
export interface PhysicsSolid {steps?:Map<string,StepFace[]>;body:RAPIER.RigidBody;colliders:RAPIER.Collider[];record:SolidRecord}
/** A local-origin region, shared by server dynamics and browser capsule queries. */
export class SolidPhysics {
  readonly world=new RAPIER.World({x:0,y:-22,z:0});readonly solids=new Map<string,PhysicsSolid>();
  private queriesDirty=false;private queryWorld?:SolidPhysics;private queryRevision=0;private copiedRevision=-1;private geometry=new Map<string,{record:SolidRecord;boxes:CollisionBox[];meshes?:VolumeMesh[]}>();private capsule?:RAPIER.Collider;private controller?:RAPIER.KinematicCharacterController;
  constructor(readonly origin:Point3=[0,0,0]){this.world.timestep=1/60;}
  remove(id:string){this.geometry.delete(id);this.queryRevision++;this.queriesDirty=true;const solid=this.solids.get(id);if(solid){this.world.removeRigidBody(solid.body);this.solids.delete(id);}}
  add(record:SolidRecord,boxes:CollisionBox[],meshes?:VolumeMesh[],dynamic=!!record.fall){
    this.remove(record.id);const p=record.pose?.position??[record.prop.x,record.prop.y,record.prop.z],desc=dynamic?RAPIER.RigidBodyDesc.dynamic():record.fall?RAPIER.RigidBodyDesc.kinematicPositionBased():RAPIER.RigidBodyDesc.fixed();desc.setTranslation(p[0]-this.origin[0],p[1]-this.origin[1],p[2]-this.origin[2]).setRotation(rotation(quaternion(record)));if(dynamic){desc.setCcdEnabled(true).setLinearDamping(.25).setAngularDamping(.4);if(record.fall){desc.setLinvel(...record.fall.velocity);desc.setAngvel(vector(record.fall.angular));}}const body=this.world.createRigidBody(desc),colliders:RAPIER.Collider[]=[];
    if(!dynamic&&meshes?.length){for(const mesh of meshes){const vertices=new Float32Array(mesh.vertices.length/16*3);for(let i=0;i<vertices.length/3;i++)for(let k=0;k<3;k++)vertices[i*3+k]=mesh.vertices[i*16+k]*record.prop.scale;colliders.push(this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,mesh.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.7),body));}}
    else for(const b of boxes){const s=record.prop.scale;colliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(...b.half.map(v=>v*s)as Point3).setTranslation(...b.center.map(v=>v*s)as Point3).setRotation(rotation(b.rotation??[0,0,0,1])).setFriction(.7).setRestitution(.04).setDensity(record.prop.kind==='rock'?2500:700),body));}
    this.solids.set(record.id,{body,colliders,record,steps:meshes?this.prepareSteps(record,meshes):undefined});this.geometry.set(record.id,{record,boxes,meshes});this.queriesDirty=true;this.queryRevision++;return body;
  }
  pose(record:SolidRecord){const s=this.solids.get(record.id);if(!s)return;const p=record.pose?.position??[record.prop.x,record.prop.y,record.prop.z];s.record=record;const geometry=this.geometry.get(record.id);if(geometry)geometry.record=record;this.queryRevision++;s.body.setTranslation(vector(p.map((v,i)=>v-this.origin[i])as Point3),true);s.body.setRotation(rotation(quaternion(record)),true);this.queriesDirty=true;}
  /** Conservative index of climbable faces. Skip costly automatic stepping
   * only when no face within the unchanged step height can be reached. */
  private prepareSteps(record:SolidRecord,meshes:VolumeMesh[]){
    const index=new Map<string,StepFace[]>();
    for(const mesh of meshes){const points:Point3[]=[];for(let i=0;i<mesh.vertices.length;i+=16)points.push(worldPoint(record,[mesh.vertices[i],mesh.vertices[i+1],mesh.vertices[i+2]]).map((v,k)=>v-this.origin[k])as Point3);
      for(let i=0;i<mesh.indices.length;i+=3){const a=points[mesh.indices[i]],b=points[mesh.indices[i+1]],c=points[mesh.indices[i+2]],u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(n[1]<Math.cos(48*Math.PI/180)*Math.hypot(...n))continue;
        const face:StepFace={lo:[0,1,2].map(k=>Math.min(a[k],b[k],c[k]))as Point3,hi:[0,1,2].map(k=>Math.max(a[k],b[k],c[k]))as Point3};
        for(let z=Math.floor(face.lo[2]);z<=Math.floor(face.hi[2]);z++)for(let x=Math.floor(face.lo[0]);x<=Math.floor(face.hi[0]);x++){const key=x+':'+z,list=index.get(key)??[];list.push(face);index.set(key,list);}
      }
    }return index;
  }
  private canStep(p:Point3,desired:Point3,radius:number,height:number,stepHeight:number){
    const extent=radius+.152+Math.hypot(desired[0],desired[2]),feet=p[1]-height/2,lo=[p[0]-extent,feet-.01,p[2]-extent],hi=[p[0]+extent,feet+stepHeight+.004,p[2]+extent];
    for(const solid of this.solids.values()){
      // Moving compound bodies retain the full controller path. Reinstalled
      // settled surfaces get an index at their final authoritative transform.
      if(!solid.steps||solid.record.fall&&!solid.record.fall.settled){const r=solid.record,center=worldPoint(r,r.source.bounds[0].map((v,k)=>(v+r.source.bounds[1][k])/2)as Point3),bound=Math.hypot(...r.source.bounds[1].map((v,k)=>(v-r.source.bounds[0][k])/2))*r.prop.scale;if(Math.hypot(center[0]-this.origin[0]-p[0],center[2]-this.origin[2]-p[2])<=bound+extent)return true;continue;}
      for(let z=Math.floor(lo[2]);z<=Math.floor(hi[2]);z++)for(let x=Math.floor(lo[0]);x<=Math.floor(hi[0]);x++)for(const face of solid.steps.get(x+':'+z)??[])if([0,1,2].every(k=>face.lo[k]<=hi[k]&&face.hi[k]>=lo[k]))return true;
    }return false;
  }
  ground(x:number,z:number,height:(x:number,z:number)=>number){const step=2,extent=64,verts:number[]=[],indices:number[]=[];for(let j=0;j<=32;j++)for(let i=0;i<=32;i++)verts.push(x+i*step-this.origin[0],height(x+i*step,z+j*step)-this.origin[1],z+j*step-this.origin[2]);for(let j=0;j<32;j++)for(let i=0;i<32;i++){const a=j*33+i;indices.push(a,a+33,a+1,a+1,a+33,a+34);}return this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts),new Uint32Array(indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.8));}
  step(){this.world.step();}
  movement(feet:Point3,desired:Point3,radius:number,height:number,stepHeight:number,snap:number):{feet:Point3;grounded:boolean}{
    if([...this.solids.values()].some(s=>s.body.isDynamic())){
      if(this.copiedRevision!==this.queryRevision){this.queryWorld?.dispose();this.queryWorld=new SolidPhysics(this.origin);for(const g of this.geometry.values())this.queryWorld.add(g.record,g.boxes,g.meshes,false);this.copiedRevision=this.queryRevision;}
      return this.queryWorld!.movement(feet,desired,radius,height,stepHeight,snap);
    }
    if(!this.capsule){this.capsule=this.world.createCollider(RAPIER.ColliderDesc.capsule(height/2-radius,radius));this.controller=this.world.createCharacterController(.002);this.controller.enableAutostep(stepHeight,.15,false);this.controller.enableSnapToGround(snap);this.controller.setMaxSlopeClimbAngle(48*Math.PI/180);this.controller.setMinSlopeSlideAngle(48*Math.PI/180);this.controller.setApplyImpulsesToDynamicBodies(false);}
    if(snap>0)this.controller!.enableSnapToGround(snap);else this.controller!.disableSnapToGround();
    if(this.queriesDirty){this.world.propagateModifiedBodyPositionsToColliders();this.world.step();this.queriesDirty=false;}
    let p:Point3=[feet[0]-this.origin[0],feet[1]+height/2-this.origin[1],feet[2]-this.origin[2]];
    // Recover safely from a server-driven body entering the capsule between
    // snapshots; no damage/death and no forced return to spawn.
    for(let pass=0;pass<3;pass++){let moved=false;this.world.intersectionsWithShape(vector(p),{x:0,y:0,z:0,w:1},this.capsule.shape,c=>{if(c.handle===this.capsule!.handle)return true;const hit=c.contactShape(this.capsule!.shape,vector(p),{x:0,y:0,z:0,w:1},0);if(hit&&hit.distance<-.003){p=[p[0]+hit.normal1.x*(-hit.distance+.004),p[1]+hit.normal1.y*(-hit.distance+.004),p[2]+hit.normal1.z*(-hit.distance+.004)];moved=true;}return true;});if(!moved)break;}
    this.capsule.setTranslation(vector(p));if(this.canStep(p,desired,radius,height,stepHeight))this.controller!.enableAutostep(stepHeight,.15,false);else this.controller!.disableAutostep();this.controller!.computeColliderMovement(this.capsule,vector(desired));const m=this.controller!.computedMovement();return {feet:[p[0]+m.x+this.origin[0],p[1]+m.y+this.origin[1]-height/2,p[2]+m.z+this.origin[2]],grounded:this.controller!.computedGrounded()};
  }
  states():SolidRecord[]{return [...this.solids.values()].filter(s=>s.record.fall&&s.body.isDynamic()).map(s=>{const p=s.body.translation(),q=s.body.rotation(),v=s.body.linvel(),w=s.body.angvel();const record:SolidRecord={...s.record,pose:{position:[p.x+this.origin[0],p.y+this.origin[1],p.z+this.origin[2]],rotation:[q.x,q.y,q.z,q.w]},fall:{...s.record.fall!,velocity:[v.x,v.y,v.z],angular:[w.x,w.y,w.z],settled:s.body.isSleeping()?(s.record.fall!.settled??Date.now()):undefined}};s.record=record;return record;});}
  dispose(){this.queryWorld?.dispose();this.geometry.clear();this.world.free();this.solids.clear();}
}
