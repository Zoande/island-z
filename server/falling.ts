import {createHash} from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import {quaternion} from '../shared/destruction';
import {SolidPhysics,initializePhysics} from '../shared/solid-physics';
import {isTree,worldPoint,type SolidRecord} from '../shared/destruction';
import {SparseVolume,emptyVolume,type SolidPrimitive} from '../shared/volume';
import {DestructionStore} from './destruction-store';
import type {Point3} from '../shared/rocks';
import type {CollisionBox} from '../shared/volume-collision';
export class FallingSimulation {
  readonly regions=new Map<string,{physics:SolidPhysics;grounds:Set<string>}>();
  readonly listeners=new Set<(states:Pick<SolidRecord,'id'|'pose'|'fall'>[])=>void>();
  private known=new Map<string,number>();private warmed=new Map<string,string>();private preparing=new Set<string>();private timer?:ReturnType<typeof setInterval>;private last=performance.now();private accumulator=0;private motion=0;private save=0;private savedStates=new Map<string,string>();private sentStates=new Map<string,string>();private idle=new Map<string,number>();private stopped=false;
  constructor(readonly store:DestructionStore,autoTick=true){store.listeners.add(patch=>{for(const r of patch.solids)if(!r.fall&&!r.removed)for(const region of this.regions.values())if(region.physics.solids.has(r.id))void this.refreshStatic(region.physics,r);void this.refresh();});void initializePhysics().then(()=>{if(this.stopped)return;void this.refresh();this.last=performance.now();if(autoTick){this.timer=setInterval(()=>this.tick(),16);this.timer.unref();}});}
  private async refreshStatic(physics:SolidPhysics,record:SolidRecord){try{const job=await this.store.jobs.run({task:'boxes',source:record.source,state:record.volume,step:isTree(record.prop)?.1:.05});if(!this.stopped&&this.store.builds.scene.edits.get(record.id)?.revision===record.revision)physics.add(record,job.result,undefined,false);}catch(error){if(!this.stopped)console.error('Static falling contact:',error);}}
  private async refresh(){
    if(this.stopped)return;await initializePhysics();
    for(const record of this.store.builds.scene.edits.values()){
      if(record.removed){for(const region of this.regions.values())region.physics.remove(record.id);this.known.delete(record.id);continue;}
      if(!record.fall||record.fall.settled||this.known.get(record.id)===record.revision||this.preparing.has(record.id))continue;this.preparing.add(record.id);
      try{
        const p=record.pose?.position??[record.prop.x,record.prop.y,record.prop.z],origin:Point3=[Math.floor(p[0]/1024)*1024,Math.floor(p[1]/256)*256,Math.floor(p[2]/1024)*1024],key=origin.join(':');let region=this.regions.get(key);if(!region){region={physics:new SolidPhysics(origin),grounds:new Set()};this.regions.set(key,region);}
        await this.store.hydrateNear(p[0],p[2]);const scene=this.store.builds.scene;
        for(let z=Math.floor((p[2]-40)/64)*64;z<=p[2]+40;z+=64)for(let x=Math.floor((p[0]-40)/64)*64;x<=p[0]+40;x+=64){const k=`${x}:${z}`;if(!region.grounds.has(k)){region.physics.ground(x,z,(x,z)=>scene.terrain(x,z).height);region.grounds.add(k);}}
        for(const solid of scene.nearby(p[0],p[2],45)){if(solid.id===record.id||scene.edits.get(solid.id)?.removed||region.physics.solids.has(solid.id))continue;const damaged=scene.edits.get(solid.id);if(damaged){const result=await this.store.jobs.run({task:'boxes',source:damaged.source,state:damaged.volume,step:isTree(damaged.prop)?.1:.05});region.physics.add(damaged,result.result,undefined,false);continue;}if(solid.prop.kind==='rock'){const r={...record,id:solid.id,prop:solid.prop,fall:undefined,pose:undefined};const body=region.physics.add(r,[],undefined,false),vertices=new Float32Array(scene.rocks[solid.prop.variant].flatMap(p=>p.map(v=>v*solid.prop.scale))),desc=RAPIER.ColliderDesc.convexHull(vertices);if(desc)region.physics.world.createCollider(desc,body);continue;}const boxes=solid.colliders.map(c=>({center:[c.x-solid.prop.x,(c.bottom+c.top)/2-solid.prop.y,c.z-solid.prop.z]as Point3,half:[c.wall?.halfWidth??c.radius,(c.top-c.bottom)/2,c.wall?.halfDepth??c.radius]as Point3,rotation:c.wall?[0,Math.sin(c.wall.yaw/2),0,Math.cos(c.wall.yaw/2)]as [number,number,number,number]:undefined}));if(!boxes.length)continue;
          const staticRecord:SolidRecord={id:solid.id,prop:{...solid.prop,rotation:0,scale:1},source:record.source,volume:emptyVolume(),revision:0};region.physics.add(staticRecord,boxes,undefined,false);
        }
        const job=await this.store.jobs.run({task:'boxes',source:record.source,state:record.volume,step:isTree(record.prop)?.1:.05});if(this.stopped)break;const current=scene.edits.get(record.id);if(!current||current.removed||current.revision!==record.revision)continue;for(const other of this.regions.values())other.physics.remove(record.id);region.physics.add(current,job.result as CollisionBox[],undefined,true);this.known.set(record.id,record.revision);this.warmed.set(record.id,`${Math.floor(p[0]/64)}:${Math.floor(p[1]/256)}:${Math.floor(p[2]/64)}`);
      }catch(error){console.error('Falling geometry:',error);}finally{this.preparing.delete(record.id);const latest=this.store.builds.scene.edits.get(record.id);if(latest&&!latest.removed&&latest.revision!==record.revision)setImmediate(()=>void this.refresh());}
    }
  }
  advance(dt:number){this.last=performance.now()-dt*1000;this.tick();}
  private tick(){if(this.stopped)return;const now=performance.now(),dt=Math.min(.1,(now-this.last)/1000);this.last=now;this.accumulator+=dt;const start=performance.now();while(this.accumulator>=1/60){for(const r of this.regions.values())if([...r.physics.solids.values()].some(s=>s.record.fall&&s.body.isDynamic()&&!s.body.isSleeping()))r.physics.step();this.accumulator-=1/60;}
    this.motion+=dt;this.save+=dt;if(this.motion<.05)return;this.motion=0;const states=[...this.regions.values()].flatMap(r=>r.physics.states()).filter(s=>{const previous=this.store.builds.scene.edits.get(s.id);return previous&&!previous.removed&&previous.revision===s.revision&&!(previous.fall?.split&&!s.fall?.split);});for(const s of states){const previous=this.store.builds.scene.edits.get(s.id)!;s.fall!.impactSpeed=Math.max(previous.fall?.impactSpeed??0,Math.hypot(...previous.fall?.velocity??[0,0,0]));this.store.updateMotion(s);const p=s.pose!.position,key=`${Math.floor(p[0]/64)}:${Math.floor(p[1]/256)}:${Math.floor(p[2]/64)}`;if(!s.fall!.settled&&this.warmed.get(s.id)!==key){this.known.delete(s.id);void this.refresh();}const age=Date.now()-s.fall!.started;
      if(!s.fall!.persistent&&(age>15000||s.fall!.settled&&Date.now()-s.fall!.settled>2000)){s.removed=true;for(const r of this.regions.values())r.physics.remove(s.id);void this.store.saveMotion([s]).catch(e=>console.error('Fall save:',e));}
      else if(isTree(s.prop)&&!s.fall!.split&&Math.hypot(...s.fall!.velocity)<.5&&age>800&&(s.fall!.impactSpeed??0)>3&&!s.volume.clips?.length){void this.split(s);}
    }
    const moved=states.filter(s=>{const signature=JSON.stringify([s.pose,s.fall]);if(this.sentStates.get(s.id)===signature)return false;this.sentStates.set(s.id,signature);return true;});if(moved.length)for(const fn of this.listeners)fn(moved.map(({id,pose,fall})=>({id,pose,fall})));
    for(const id of this.sentStates.keys())if(!this.store.builds.scene.edits.has(id)||this.store.builds.scene.edits.get(id)?.removed){this.sentStates.delete(id);this.savedStates.delete(id);}
    if(this.save>=1){this.save=0;const changed=states.filter(s=>{if(s.removed)return false;const key=JSON.stringify([s.pose,s.fall?.velocity,s.fall?.angular,s.fall?.settled]);if(this.savedStates.get(s.id)===key)return false;this.savedStates.set(s.id,key);return true;});void this.store.saveMotion(changed).catch(e=>console.error('Motion save:',e));}
    const ms=performance.now()-start;this.store.timings.push({stage:'physics',milliseconds:ms});if(this.store.timings.length>300)this.store.timings.shift();
    for(const [key,r]of this.regions){const active=[...r.physics.solids.values()].some(s=>s.record.fall&&s.body.isDynamic()&&!s.body.isSleeping());if(active)this.idle.delete(key);else{const since=this.idle.get(key)??Date.now();this.idle.set(key,since);if(Date.now()-since>30000){for(const id of r.physics.solids.keys())this.known.delete(id);r.physics.dispose();this.regions.delete(key);this.idle.delete(key);}}}
  }
  private async split(record:SolidRecord){record.fall!.split=true;const lo=record.fragmentBounds?.[0][1]??record.source.bounds[0][1],hi=record.fragmentBounds?.[1][1]??record.source.bounds[1][1],length=hi-lo;if(length<6)return;const volume=new SparseVolume(record.source,record.volume),branches=record.source.primitives.filter(p=>p.type==='capsule'&&p.a[1]>lo+1&&Math.hypot(p.b[0]-p.a[0],p.b[2]-p.a[2])>Math.abs(p.b[1]-p.a[1])*.6),crown=branches.length?Math.min(...branches.map(p=>p.type==='capsule'?p.a[1]:hi)):hi,at=Math.min(lo+length*.45,crown-.75);if(at-lo<1.5||hi-at<1.5)return;
    const pieces=[{normal:[0,1,0]as Point3,offset:at},{normal:[0,-1,0]as Point3,offset:-at}],solids:SolidRecord[]=[{...record,removed:true}];for(let i=0;i<pieces.length;i++)solids.push({...record,id:'fragment:'+createHash('sha256').update(record.id+':impact:'+i).digest('hex').slice(0,24),revision:1,removed:false,volume:{...record.volume,clips:[...(record.volume.clips??[]),pieces[i]]},fall:{...record.fall!,split:true,settled:undefined}});await this.store.saveMotion(solids);
  }
  dispose(){this.stopped=true;if(this.timer)clearInterval(this.timer);for(const r of this.regions.values())r.physics.dispose();this.regions.clear();this.listeners.clear();}
}
