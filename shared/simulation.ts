import {SpatialIndex} from './spatial-index';
import {BuildScene} from './build-scene';
import {SolidPhysics} from './solid-physics';
import type {Point3} from './rocks';
import type {CharacterEnvironment} from './character';
import {playerContacts} from './player-contact';
import type {SolidRecord} from './destruction';
import type {CollisionBox} from './volume-collision';
/** Canonical collision world; renderer tiles and visual meshes never enter this adapter. */
export class SimulationEnvironment implements CharacterEnvironment {
 private physics?:SolidPhysics;private origin='';private feet?:Point3;private collidersById=new Map<string,{record:SolidRecord;boxes:CollisionBox[]}>();private spatial=new SpatialIndex<{record:SolidRecord;boxes:CollisionBox[]}>();
 constructor(readonly scene:BuildScene,readonly self:string,readonly players:()=>Iterable<{id:string;feet:ArrayLike<number>}>,readonly clock:()=>number){}
 surface(x:number,z:number,feetY?:number){return this.scene.groundSurface(x,z,feetY);}
 colliders(x:number,z:number){return [...this.scene.nearby(x,z,12).filter(s=>!this.scene.edits.get(s.id)?.removed&&!this.collidersById.has(s.id)).flatMap(s=>s.colliders),...playerContacts(this.players(),this.self)];}
 water(x:number,z:number){return this.scene.world.surfaceWater(x,z,this.clock());}
 install(record:SolidRecord,boxes:CollisionBox[]){if(record.removed){this.remove(record.id);return;}this.collidersById.set(record.id,{record,boxes});const p=record.pose?.position??[record.prop.x,record.prop.y,record.prop.z],radius=Math.hypot(...record.source.bounds[1].map((v,k)=>(v-record.source.bounds[0][k])/2))*record.prop.scale;this.spatial.insert(record.id,{record,boxes},p[0],p[2],radius);this.scene.setDamageCollision(record,boxes);if(this.physics&&this.feet&&Math.hypot(p[0]-this.feet[0],p[2]-this.feet[2])<110+radius)this.physics.add(record,boxes,undefined,false);}
 remove(id:string){this.collidersById.delete(id);this.spatial.remove(id);this.physics?.remove(id);}
 pose(record:SolidRecord){const value=this.collidersById.get(record.id);if(value){value.record=record;const p=record.pose!.position;this.spatial.insert(record.id,value,p[0],p[2],Math.hypot(...record.source.bounds[1].map((v,k)=>(v-record.source.bounds[0][k])/2))*record.prop.scale);this.physics?.pose(record);}}
 solidMovement(feet:Point3,desired:Point3,radius:number,height:number,step:number,snap:number){
   this.feet=[...feet];
   const origin:Point3=[Math.floor(feet[0]/512)*512,Math.floor(feet[1]/256)*256,Math.floor(feet[2]/512)*512],key=origin.join(':');
   if(key!==this.origin){this.physics?.dispose();this.physics=new SolidPhysics(origin);this.origin=key;for(const {record,boxes}of this.spatial.query(feet[0],feet[2],110))this.physics.add(record,boxes,undefined,false);}
   for(const [id,s]of this.physics!.solids){const p=s.record.pose?.position??[s.record.prop.x,s.record.prop.y,s.record.prop.z];if(Math.hypot(p[0]-feet[0],p[2]-feet[2])>150)this.physics!.remove(id);}for(const {record,boxes}of this.spatial.query(feet[0],feet[2],110))if(!this.physics!.solids.has(record.id))this.physics!.add(record,boxes,undefined,false);
   return this.physics!.solids.size?this.physics!.movement(feet,desired,radius,height,step,snap):null;
 }
 retain(keep:(record:SolidRecord)=>boolean){for(const [id,{record}]of this.collidersById)if(!keep(record))this.remove(id);}
 dispose(){this.physics?.dispose();for(const id of this.collidersById.keys())this.spatial.remove(id);this.collidersById.clear();}
}
