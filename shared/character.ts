import type { MeshSurface } from './placement';
import {rockSurface,type RockCollisionShape} from './rock-collision';
import {wallContains,wallPush,wallSweep} from './wall-collision';
import type {Point3} from './rocks';
import {healthyBody,cloneBodyHealth,applyDamage,advanceHealth,deriveHealthEffects,validBodyHealth,type BodyHealth,type BodyPart,type Bleeding} from './health';
export type CharacterStance='stand'|'crouch'|'crawl';
export interface CharacterInput { x:number; z:number; sprint:boolean; jump:boolean;swimVector?:[number,number,number]; slot?:number; stance?:CharacterStance }
export interface CharacterWater {level:number;kind:'ocean'|'lake'|'river';offshoreMeters?:number}
export interface CharacterCollider { x:number; z:number; radius:number; bottom:number; top:number; kind:'tree'|'bush'|'rock'|'wall'|'floor'|'fixture'|'player';rock?:RockCollisionShape;wall?:{halfWidth:number;halfDepth:number;yaw:number};floorPlane?:{normal:Point3;point:Point3;xAxis:Point3;zAxis:Point3;halfWidth:number;halfDepth:number;thickness:number} }
export interface CharacterEnvironment {
  surface(x:number,z:number,feetY?:number):MeshSurface|null;
  colliders(x:number,z:number):readonly CharacterCollider[];
  water?(x:number,z:number):CharacterWater|null;
  solidMovement?(feet:[number,number,number],desired:[number,number,number],radius:number,height:number,step:number,snap:number):{feet:[number,number,number];grounded:boolean}|null;
}
export const CHARACTER = { radius:.32, height:2.16, eyeHeight:1.64*1.2, walkSpeed:4.5*1.15, sprintSpeed:7*1.15*1.3,
  runAcceleration:4.5,swimSpeed:3.2,swimUpSpeed:1.8,swimDownSpeed:2.4,idleSinkSpeed:.12,exhaustedSinkSpeed:.75,
  oxygenSeconds:60,staminaCapacity:100,swimDrain:.18,oceanSwimDrain:.35,sprintDrain:.8,accelerationDrain:1.2,walkRecovery:.55,waterRecovery:.5,
  oceanOxygenGraceMeters:50,oceanOxygenRampMeters:350,
  gravity:22, jumpSpeed:4.8*Math.sqrt(1.3), jumpCost:4, stepHeight:.28, snapDistance:.3, slopeCos:Math.cos(48*Math.PI/180), timestep:1/120 };
export interface CharacterState {
 feet:[number,number,number];velocity:[number,number,number];grounded:boolean;inBush:boolean;ready:boolean;
 swimming:boolean;underwater:boolean;sprinting:boolean;accelerating:boolean;exhausted:boolean;oxygen:number;oxygenDrainRate:number;stamina:number;waterLevel:number|null;respawns:number;
 home?:[number,number,number];health?:BodyHealth;crawling?:boolean;stanceIntent?:CharacterStance;posture?:CharacterStance;lastDeathCause?:string;fallStartY?:number;fallStartX?:number;fallStartZ?:number;trustedFallStartY?:number;drowningTime?:number;swimActive:boolean;waterKind:CharacterWater['kind'];accumulator:number;jumpHeld:boolean;jumpBuffer:number;coyote:number;
}
export const idleInput:CharacterInput={x:0,z:0,sprint:false,jump:false};
/** Land movement stays horizontal; swimming follows look pitch. */
export function characterInput(keys:ReadonlySet<string>,yaw:number,pitch=0):CharacterInput {
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  return {x:(Math.sin(yaw)*forward+Math.cos(yaw)*right)||0,z:(-Math.cos(yaw)*forward+Math.sin(yaw)*right)||0,
    sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'),jump:keys.has('Space'),
    swimVector:[Math.sin(yaw)*Math.cos(pitch)*forward+Math.cos(yaw)*right,Math.sin(pitch)*forward,-Math.cos(yaw)*Math.cos(pitch)*forward+Math.sin(yaw)*right]};
}
/** Placeholder standing capsule, represented by its feet. Fixed simulation steps
 * keep collisions stable across frame rates; no browser or GPU dependencies. */
export class Character {
  readonly feet=new Float64Array(3);
  readonly velocity=new Float64Array(3);
  grounded=false; inBush=false; ready=false;
  swimming=false;underwater=false;sprinting=false;accelerating=false;exhausted=false;
  oxygen=CHARACTER.oxygenSeconds;oxygenDrainRate=1;stamina=CHARACTER.staminaCapacity;waterLevel:number|null=null;respawns=0;
  private home?:[number,number,number];private swimActive=false;private waterKind:CharacterWater['kind']='ocean';
  private accumulator=0;private jumpHeld=false;private jumpBuffer=0;private coyote=0;
  health:BodyHealth=healthyBody();stanceIntent:CharacterStance='stand';private postureValue:CharacterStance='stand';lastDeathCause?:string;private fallStartY?:number;private fallStartX?:number;private fallStartZ?:number;private drowningTime=0;private trustedFallStartY?:number;private hands:{right?:string;left?:string}={};
  get posture():CharacterStance{return this.postureValue;}
  get stanceName():string{return this.postureValue==='stand'?'Standing':this.postureValue==='crouch'?'Crouching':'Crawling';}
  get crawling(){return this.postureValue==='crawl';}
  get crouching(){return this.postureValue==='crouch';}
  get crutchesEquipped(){return this.hasCrutches();}
  get height(){return this.postureValue==='crawl'?1.05:this.postureValue==='crouch'?1.5:CHARACTER.height;}
  get eyeHeight(){return this.postureValue==='crawl'?.82:this.postureValue==='crouch'?1.25:CHARACTER.eyeHeight;}
  setStanceIntent(stance:CharacterStance){if(!['stand','crouch','crawl'].includes(stance))return;if(this.healthEffects().crawling&&stance!=='crawl')return;if(stance==='crouch'&&this.hasCrutches()&&!this.healthEffects().crawling)stance='stand';if(stance==='crawl'&&this.healthEffects().crawlBlocked&&!this.healthEffects().crawling)stance='stand';this.stanceIntent=stance;this.refreshHealthEffects();}
  setHands(right?:string,left?:string){this.hands={right,left};if(this.stanceIntent==='crouch'&&this.hasCrutches()&&!this.healthEffects().crawling)this.stanceIntent='stand';this.refreshHealthEffects();}
  private hasCrutches(){return this.hands.right==='crutches'||this.hands.left==='crutches';}
  private crawlArmFactor(effects:ReturnType<typeof deriveHealthEffects>){return effects.canWalk?Math.min(this.health.leftArm.hp,this.health.rightArm.hp)/100:1;}
  damage(part:BodyPart,amount:number,bleeding?:Bleeding){this.health=applyDamage(this.health,{part,amount,bleeding});this.refreshHealthEffects();}
  get effects(){return deriveHealthEffects(this.health,this.hands);}
  get oxygenCapacity(){return CHARACTER.oxygenSeconds*this.effects.oxygenCapacityMultiplier;}
  private healthEffects(){return this.effects;}
  private refreshHealthEffects(){
    const effects=this.healthEffects();
    if(effects.crawling){this.postureValue='crawl';return;}
    let desired=this.stanceIntent;
    if(desired==='crouch'&&this.hasCrutches()){desired='stand';this.stanceIntent='stand';}
    if(desired==='crawl'&&effects.crawlBlocked){desired='stand';this.stanceIntent='stand';}
    if(desired===this.postureValue)return;
    if(this.hasPostureClearance(desired)){this.postureValue=desired;return;}
    const candidates:CharacterStance[]=desired==='stand'?(this.hasCrutches()?['crawl']:['crouch','crawl']):desired==='crouch'?['crawl']:[];
    if(candidates.includes(this.postureValue)&&this.hasPostureClearance(this.postureValue))return;
    for(const candidate of candidates)if(this.hasPostureClearance(candidate)){this.postureValue=candidate;return;}
    this.postureValue='crawl';
  }
  private hasPostureClearance(posture:CharacterStance):boolean {
    const [x,y,z]=this.feet,height=posture==='stand'?CHARACTER.height:posture==='crouch'?1.5:1.05;
    for(const c of this.environment.colliders(x,z)) {
      if(c.kind==='wall'&&!c.floorPlane&&c.wall&&c.top>y+.05&&c.bottom<y+height-.02&&wallContains(c,x,z,CHARACTER.radius*.95))return false;
      if(c.floorPlane) {
        const f=c.floorPlane,dx=x-f.point[0],dz=z-f.point[2],bottomY=f.point[1]-(f.normal[0]*dx+f.normal[2]*dz)/f.normal[1]-f.thickness/f.normal[1];
        if(bottomY>y+.05&&bottomY<y+height&&this.floorIntersectsBody(f,x,z,y,height,CHARACTER.radius))return false;
      }
    }
    return true;
  }
  constructor(readonly environment:CharacterEnvironment) {}
  spawn(x:number,y:number,z:number) {
    this.home??=[x,y,z];
    this.feet.set([x,y,z]);this.velocity.fill(0);this.ready=false;this.grounded=false;
    this.swimming=false;this.underwater=false;this.sprinting=false;this.accelerating=false;this.exhausted=false;this.swimActive=false;
    this.oxygen=CHARACTER.oxygenSeconds;this.oxygenDrainRate=1;this.stamina=CHARACTER.staminaCapacity;this.waterLevel=null;
    this.accumulator=0;this.jumpHeld=false;this.jumpBuffer=0;this.coyote=0;this.health=healthyBody();this.stanceIntent='stand';this.postureValue='stand';this.lastDeathCause=undefined;this.fallStartY=y;this.fallStartX=x;this.fallStartZ=z;this.drowningTime=0;this.trustedFallStartY=undefined;
  }
  capture():CharacterState {
    if(Math.abs(this.accumulator)<1e-10)this.accumulator=0;
    const {grounded,inBush,ready,swimming,underwater,sprinting,accelerating,exhausted,oxygen,oxygenDrainRate,stamina,waterLevel,respawns,swimActive,waterKind,accumulator,jumpHeld,jumpBuffer,coyote}=this;
    return {health:cloneBodyHealth(this.health),stanceIntent:this.stanceIntent,posture:this.postureValue,trustedFallStartY:this.trustedFallStartY,crawling:this.crawling,lastDeathCause:this.lastDeathCause,fallStartY:this.fallStartY,fallStartX:this.fallStartX,fallStartZ:this.fallStartZ,drowningTime:this.drowningTime,feet:[...this.feet]as [number,number,number],velocity:[...this.velocity]as [number,number,number],home:this.home&&[...this.home],grounded,inBush,ready,swimming,underwater,sprinting,accelerating,exhausted,oxygen,oxygenDrainRate,stamina,waterLevel,respawns,swimActive,waterKind,accumulator,jumpHeld,jumpBuffer,coyote};
  }
  restore(state:CharacterState){this.feet.set(state.feet);this.velocity.set(state.velocity);const {feet,velocity,crawling:_legacyCrawling,posture:_savedPosture,...rest}=state;Object.assign(this,rest);this.home=state.home&&[...state.home];this.health=state.health&&validBodyHealth(state.health)?cloneBodyHealth(state.health):healthyBody();this.stanceIntent=state.stanceIntent??(state.crawling?'crawl':'stand');this.postureValue=state.posture??(state.crawling?'crawl':this.stanceIntent);this.lastDeathCause=state.lastDeathCause;this.fallStartY=state.fallStartY;this.fallStartX=state.fallStartX;this.fallStartZ=state.fallStartZ;this.drowningTime=state.drowningTime??0;this.trustedFallStartY=state.trustedFallStartY;this.refreshHealthEffects();}
  /** Server-side support check for accepted feet; does not use snapshot grounded flags. */
  isSupportedAtCurrentFeet():boolean {const [x,y,z]=this.feet,support=this.support(x,z);return !!support&&support.normal[1]>=CHARACTER.slopeCos&&Math.abs(y-support.height)<=.05;}
    contact(delta:[number,number,number]):[number,number,number]{const [x,y,z]=this.feet,colliders=this.environment.colliders(x,z).filter(c=>c.kind!=='player'),[nx,nz]=this.sweep(x,z,delta[0],delta[2],colliders),surface=this.support(nx,nz,colliders);if(!surface||surface.height>y+CHARACTER.stepHeight)return [x,y,z];return this.environment.solidMovement?.([x,y,z],[nx-x,0,nz-z],CHARACTER.radius,this.height,0,0)?.feet??[nx,y,nz];}
  private support(x:number,z:number,colliders:readonly CharacterCollider[]=this.environment.colliders(x,z)):MeshSurface|null {
    const center=this.environment.surface(x,z,this.feet[1]);if(!center)return null;
    let height=center.height,normal=center.normal;
    const offset=CHARACTER.radius*.65,rounding=CHARACTER.radius-Math.sqrt(CHARACTER.radius**2-offset**2);
    for(const [dx,dz]of [[offset,0],[-offset,0],[0,offset],[0,-offset]]) {
      const sample=this.environment.surface(x+dx,z+dz,this.feet[1]);if(!sample)return null;
      height=Math.max(height,sample.height-rounding);
    }
    for(const collider of colliders)if(collider.kind==='rock'&&collider.top>height&&Math.hypot(x-collider.x,z-collider.z)<collider.radius+CHARACTER.radius) {
      // Sample the rounded capsule underside, not a bounding cylinder. This
      // catches walls before the body penetrates and permits steps/jump landings.
      const centerRock=rockSurface(collider,x,z);
      const stepNormal:MeshSurface['normal']|undefined=collider.top<=this.feet[1]+CHARACTER.stepHeight?[0,1,0]:undefined;
      if(centerRock&&centerRock.height>height){height=centerRock.height;normal=stepNormal??centerRock.normal;}
      const reach=CHARACTER.radius*.95,drop=CHARACTER.radius-Math.sqrt(CHARACTER.radius**2-reach**2);
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4,rock=rockSurface(collider,x+Math.cos(angle)*reach,z+Math.sin(angle)*reach);
        if(rock&&rock.height-drop>height){height=rock.height-drop;normal=stepNormal??rock.normal;}
      }
    }
    for(const collider of colliders)if(collider.kind==='wall'&&!collider.floorPlane&&collider.top>height&&this.feet[1]>=collider.top-CHARACTER.stepHeight-.002&&wallContains(collider,x,z,CHARACTER.radius*.95)) {height=collider.top;normal=[0,1,0];}
    for(const collider of colliders)if(collider.floorPlane) {const f=collider.floorPlane,dx=x-f.point[0],dz=z-f.point[2],dy=this.feet[1]-f.point[1],alongX=dx*f.xAxis[0]+dy*f.xAxis[1]+dz*f.xAxis[2],alongZ=dx*f.zAxis[0]+dy*f.zAxis[1]+dz*f.zAxis[2];if(Math.abs(alongX)<=f.halfWidth+CHARACTER.radius&&Math.abs(alongZ)<=f.halfDepth+CHARACTER.radius){const plane=f.point[1]-(f.normal[0]*dx+f.normal[2]*dz)/f.normal[1];if(plane>height&&plane<=this.feet[1]+CHARACTER.stepHeight){height=plane;normal=f.normal;}}}
    return {height,normal};
  }
  update(dt:number,input:CharacterInput) {
    if(!Number.isFinite(dt)||dt<=0)return;if(input.stance!==undefined)this.setStanceIntent(input.stance);this.refreshHealthEffects();
    const support=this.support(this.feet[0],this.feet[2]);
    if(!support) {this.jumpHeld=input.jump;this.accumulator+=Math.min(.1,dt);while(this.accumulator+1e-10>=CHARACTER.timestep){this.accumulator-=CHARACTER.timestep;this.updateSubmersion();this.updateVitals(CHARACTER.timestep,input);}return;}
    if(!this.ready) {
      if(this.feet[1]<=support.height+CHARACTER.stepHeight){this.feet[1]=support.height;this.grounded=support.normal[1]>=CHARACTER.slopeCos;}
      this.ready=true;
    }
    if(input.jump&&!this.jumpHeld)this.jumpBuffer=.12;this.jumpHeld=input.jump;
    this.accumulator+=Math.max(0,Math.min(.1,dt));
    while(this.accumulator+1e-10>=CHARACTER.timestep) {this.accumulator-=CHARACTER.timestep;this.step(CHARACTER.timestep,input);this.updateSubmersion();this.updateVitals(CHARACTER.timestep,input);}

  }
  private updateSubmersion() {
    const water=this.environment.water?.(this.feet[0],this.feet[2]);this.waterLevel=water?.level??null;
    this.underwater=!!water&&this.feet[1]+this.eyeHeight<water.level-.04;
    // A gentle shoreline buffer gives way to continuously increasing offshore
    // risk. Freshwater retains the full one-minute underwater budget.
    const distance=water?.offshoreMeters??0,offshore=Number.isFinite(distance)?Math.max(0,distance):0;
    this.oxygenDrainRate=water?.kind==='ocean'?1+(Math.max(0,offshore-CHARACTER.oceanOxygenGraceMeters)/CHARACTER.oceanOxygenRampMeters)**2:1;
    if(water)this.waterKind=water.kind;
  }
  private updateVitals(dt:number,input:CharacterInput) {
    const oxygenCapacity=this.oxygenCapacity;this.oxygen=Math.max(0,Math.min(oxygenCapacity,this.oxygen+(this.underwater?-dt*this.oxygenDrainRate:dt*10)));
    if(this.underwater&&this.oxygen<=1e-8){this.drowningTime+=dt;this.damage('head',dt*8);if(this.health.head.hp<=0)this.lastDeathCause='drowning';}else this.drowningTime=0;
    if(this.checkDeath())return;
    this.health=advanceHealth(this.health,dt,{allowNaturalHealing:!(this.underwater&&this.oxygen<=1e-8)});this.refreshHealthEffects();if(this.checkDeath())return;
    const exerting=this.swimming?this.swimActive:input.sprint&&Math.hypot(input.x,input.z)>.01||this.accelerating;
    const drain=this.swimming?(this.waterKind==='ocean'?CHARACTER.oceanSwimDrain:CHARACTER.swimDrain):input.sprint&&Math.hypot(input.x,input.z)>.01?CHARACTER.sprintDrain:CHARACTER.accelerationDrain;
    if(exerting)this.stamina=Math.max(0,this.stamina-drain*dt);
    else if(this.swimming||this.grounded)this.stamina=Math.min(CHARACTER.staminaCapacity,this.stamina+dt*(this.swimming?CHARACTER.waterRecovery:CHARACTER.walkRecovery));
    if(this.stamina<=0)this.exhausted=true;
    else if(this.stamina>=15)this.exhausted=false;
  }
  private checkDeath():boolean {
    if(this.health.head.hp>0&&this.health.chest.hp>0)return false;
    const cause=this.lastDeathCause??(this.health.head.bleeding!=='none'||this.health.chest.bleeding!=='none'?'bleeding':'injury');this.lastDeathCause=cause;
    if(!this.home)return true;
    this.respawns++;this.spawn(...this.home);this.lastDeathCause=cause;return true;
  }
  /** Advances authoritative oxygen, stamina, bleeding and passive healing without client movement. */
  advanceVitals(dt:number,input:CharacterInput=idleInput){if(!Number.isFinite(dt)||dt<=0)return;if(input.stance!==undefined)this.setStanceIntent(input.stance);this.refreshHealthEffects();this.updateSubmersion();const water=this.environment.water?.(this.feet[0],this.feet[2]),ground=this.environment.surface(this.feet[0],this.feet[2],this.feet[1]);this.swimming=!!water&&water.level-this.feet[1]>this.height*.5&&(!ground||water.level-ground.height>this.eyeHeight-.15);this.swimActive=this.swimming&&(input.jump||input.sprint||Math.hypot(input.x,input.z)>.01);this.sprinting=input.sprint&&Math.hypot(input.x,input.z)>.01;this.accelerating=false;this.updateVitals(dt,input);}
  /** Server-only reconciliation hook. Call with landed=false while a fall is in progress and landed=true once accepted movement reaches ground. */
  applyTrustedLanding(previousFeet:ArrayLike<number>,acceptedFeet:ArrayLike<number>,waterLanding=false,landed=true){
    if(previousFeet.length<3||acceptedFeet.length<3||![previousFeet[0],previousFeet[1],previousFeet[2],acceptedFeet[0],acceptedFeet[1],acceptedFeet[2]].every(Number.isFinite))return;
    if(!landed){if(this.trustedFallStartY===undefined&&acceptedFeet[1]<previousFeet[1]-.02)this.trustedFallStartY=previousFeet[1];return;}
    const start=this.trustedFallStartY??previousFeet[1],drop=start-acceptedFeet[1];this.trustedFallStartY=undefined;this.applyFallDamage(drop,waterLanding);
  }
  private sweep(x:number,z:number,dx:number,dz:number,colliders:readonly CharacterCollider[]):[number,number] {
    const trees=colliders.filter(c=>(c.kind==='tree'||c.kind==='fixture'||c.kind==='player')&&this.feet[1]<c.top&&this.feet[1]+this.height>c.bottom);
    const walls=colliders.filter(c=>c.kind==='wall'&&!c.floorPlane&&this.feet[1]<c.top-.001&&this.feet[1]+this.height>c.bottom&&!(this.grounded&&c.top<=this.feet[1]+CHARACTER.stepHeight&&c.top>=this.feet[1]));
    for(let pass=0;pass<4;pass++)for(const c of trees) {
      const nx=x-c.x,nz=z-c.z,distance=Math.hypot(nx,nz),radius=c.radius+CHARACTER.radius+.001;
      if(distance<radius) {x+=(distance?nx/distance:1)*(radius-distance);z+=(distance?nz/distance:0)*(radius-distance);}
    }
    for(const c of colliders)if(c.floorPlane) {
      const f=c.floorPlane,startsInside=this.floorIntersectsBody(f,x,z,this.feet[1],this.height,CHARACTER.radius),endsInside=this.floorIntersectsBody(f,x+dx,z+dz,this.feet[1],this.height,CHARACTER.radius);
      if(!startsInside&&endsInside) {
        let lo=0,hi=1;
        for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(this.floorIntersectsBody(f,x+dx*mid,z+dz*mid,this.feet[1],this.height,CHARACTER.radius))hi=mid;else lo=mid;}
        x+=dx*lo;z+=dz*lo;dx=0;dz=0;
      }
    }
    for(const c of walls)[x,z]=wallPush(c,x,z,CHARACTER.radius+.001);
    for(let pass=0;pass<4&&Math.hypot(dx,dz)>1e-7;pass++) {
      let time=1,hit:CharacterCollider|undefined,wallNormal:[number,number]|undefined;const length2=dx*dx+dz*dz;
      for(const c of trees) {
        const ox=x-c.x,oz=z-c.z,radius=c.radius+CHARACTER.radius+.001;
        const b=ox*dx+oz*dz,constant=ox*ox+oz*oz-radius*radius,discriminant=b*b-length2*constant;
        if(b>=0||discriminant<0)continue;
        const t=(-b-Math.sqrt(discriminant))/length2;
        if(t>=-1e-6&&t<time) {time=Math.max(0,t);hit=c;}
      }
      for(const c of walls){const result=wallSweep(c,x,z,dx,dz,CHARACTER.radius+.001);if(result&&result.time<time){time=result.time;hit=c;wallNormal=result.normal;}}
      x+=dx*time;z+=dz*time;if(!hit)break;
      const nx=x-hit.x,nz=z-hit.z,length=Math.hypot(nx,nz),normalX=wallNormal?.[0]??nx/length,normalZ=wallNormal?.[1]??nz/length;
      dx*=1-time;dz*=1-time;
      const inward=Math.min(0,dx*normalX+dz*normalZ);dx-=normalX*inward;dz-=normalZ*inward;
      const speedInto=Math.min(0,this.velocity[0]*normalX+this.velocity[2]*normalZ);
      this.velocity[0]-=normalX*speedInto;this.velocity[2]-=normalZ*speedInto;
    }
    return [x,z];
  }
  private step(dt:number,input:CharacterInput) {
    if(this.health.head.hp<=0||this.health.chest.hp<=0){this.velocity.fill(0);return;}
    const [x,y,z]=this.feet,colliders=this.environment.colliders(x,z);
    const oldGround=this.support(x,z,colliders);if(!oldGround)return;
    const wasGrounded=this.grounded,fallStart=this.fallStartY;
    const water=this.environment.water?.(x,z);
    this.swimming=!!water&&water.level-oldGround.height>this.eyeHeight-.15&&water.level-y>this.height*.5;
    if(this.swimming){this.fallStartY=this.fallStartX=this.fallStartZ=undefined;this.swimStep(dt,input,water!,oldGround,colliders);return;}
    this.swimActive=false;
    this.inBush=colliders.some(c=>c.kind==='bush'&&Math.hypot(x-c.x,z-c.z)<c.radius+CHARACTER.radius
      &&y<c.top&&y+this.height>c.bottom);
    this.refreshHealthEffects();const effects=this.healthEffects(),actualCanWalk=effects.canWalk&&this.postureValue==='stand',canMove=actualCanWalk||effects.canWalk&&this.postureValue==='crouch'||this.postureValue==='crawl'&&!effects.crawlBlocked,amount=canMove?Math.hypot(input.x,input.z):0,stanceMultiplier=this.postureValue==='crawl'?(effects.canWalk?.42*this.crawlArmFactor(effects):1):this.postureValue==='crouch'?.65:1,speed=(actualCanWalk&&input.sprint&&!this.exhausted?CHARACTER.sprintSpeed:CHARACTER.walkSpeed)*(this.inBush?.65:1)*stanceMultiplier*effects.speedMultiplier;
    const targetX=amount?input.x/amount*speed:0,targetZ=amount?input.z/amount*speed:0;
    const currentSpeed=Math.hypot(this.velocity[0],this.velocity[2]);
    if(!canMove){this.velocity[0]=this.velocity[2]=0;}
    this.sprinting=!!(actualCanWalk&&input.sprint&&!this.exhausted&&amount>.01);
    this.accelerating=!!(amount>.01&&this.grounded&&currentSpeed<speed-.25);
    if(this.grounded&&amount>0) {
      const directionDot=currentSpeed?(this.velocity[0]*targetX+this.velocity[2]*targetZ)/(currentSpeed*speed):1;
      if(directionDot<.5) {
        // Brake/reverse promptly. Normalizing a blend of opposite directions
        // would otherwise keep moving the old way indefinitely.
        const dx=targetX-this.velocity[0],dz=targetZ-this.velocity[2],length=Math.hypot(dx,dz),change=Math.min(length,22*dt);
        this.velocity[0]+=dx/length*change;this.velocity[2]+=dz/length*change;
      }else {
      const nextSpeed=currentSpeed<speed?Math.min(speed,currentSpeed+(this.sprinting?CHARACTER.runAcceleration:18)*dt):Math.max(speed,currentSpeed-22*dt);
      const blend=1-Math.exp(-18*dt),dx=(currentSpeed?this.velocity[0]/currentSpeed:targetX/speed)*(1-blend)+targetX/speed*blend,dz=(currentSpeed?this.velocity[2]/currentSpeed:targetZ/speed)*(1-blend)+targetZ/speed*blend;
      const length=Math.hypot(dx,dz);this.velocity[0]=(length>1e-8?dx/length:targetX/speed)*nextSpeed;this.velocity[2]=(length>1e-8?dz/length:targetZ/speed)*nextSpeed;
      }
    }else {
      const blend=1-Math.exp(-(this.grounded?26:3)*dt);
      this.velocity[0]+=(targetX-this.velocity[0])*blend;this.velocity[2]+=(targetZ-this.velocity[2])*blend;
    }
    this.coyote=this.grounded?.08:Math.max(0,this.coyote-dt);
    const effectsForJump=this.healthEffects(),crutchBound=!effectsForJump.canUseCrutches||this.health.leftLeg.hp>30&&this.health.rightLeg.hp>30,canJump=this.healthEffects().canWalk&&this.postureValue==='stand';
    if(this.jumpBuffer>0&&this.coyote>0&&this.stamina>=CHARACTER.jumpCost&&!this.exhausted&&crutchBound&&canJump) {
      this.stamina-=CHARACTER.jumpCost;this.velocity[1]=CHARACTER.jumpSpeed;this.grounded=false;this.coyote=0;this.jumpBuffer=0;
      if(this.stamina<=0)this.exhausted=true;
    }
    this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    let dx=this.velocity[0]*dt,dz=this.velocity[2]*dt;const proposed=this.support(x+dx,z+dz,colliders);
    if(proposed&&proposed.normal[1]<CHARACTER.slopeCos) {
      const [nx,,nz]=proposed.normal,normalLength=nx*nx+nz*nz,inward=dx*nx+dz*nz;
      if(inward<0&&normalLength>0) {dx-=nx*inward/normalLength;dz-=nz*inward/normalLength;}
    }
    let [nextX,nextZ]=this.sweep(x,z,dx,dz,colliders),ground=this.support(nextX,nextZ,colliders);
    if(!ground||ground.height>y+CHARACTER.stepHeight) {
      const alongX=this.support(nextX,z,colliders),alongZ=this.support(x,nextZ,colliders);
      if(alongX&&alongX.height<=y+CHARACTER.stepHeight) {nextZ=z;ground=alongX;}
      else if(alongZ&&alongZ.height<=y+CHARACTER.stepHeight) {nextX=x;ground=alongZ;}
      else {nextX=x;nextZ=z;ground=oldGround;this.velocity[0]=0;this.velocity[2]=0;}
      [nextX,nextZ]=this.sweep(x,z,nextX-x,nextZ-z,colliders);ground=this.support(nextX,nextZ,colliders)??oldGround;
    }
    this.velocity[1]-=CHARACTER.gravity*dt;let nextY=y+this.velocity[1]*dt;
    const snap=this.grounded&&this.velocity[1]<=0&&y-ground.height<=CHARACTER.snapDistance;
    if(nextY<=ground.height||snap) {
      nextY=ground.height;this.velocity[1]=0;this.grounded=ground.normal[1]>=CHARACTER.slopeCos;
      if(!this.grounded) {this.coyote=0;this.velocity[0]+=ground.normal[0]*CHARACTER.gravity*dt;this.velocity[2]+=ground.normal[2]*CHARACTER.gravity*dt;}
    } else this.grounded=false;
    if(wasGrounded&&!this.grounded){this.fallStartY=y;this.fallStartX=x;this.fallStartZ=z;}
    nextY=this.ceiling(nextX,nextZ,y,nextY,colliders);
    const solid=this.environment.solidMovement?.([x,y,z],[nextX-x,nextY-y,nextZ-z],CHARACTER.radius,this.height,CHARACTER.stepHeight,this.swimming?0:CHARACTER.snapDistance);
    if(solid){this.feet.set(solid.feet);if(!this.swimming&&solid.grounded){this.grounded=true;this.velocity[1]=Math.max(0,this.velocity[1]);}if(Math.abs(solid.feet[1]-nextY)>.003&&this.velocity[1]>0)this.velocity[1]=0;}else this.feet.set([nextX,nextY,nextZ]);
    if(!wasGrounded&&this.grounded&&fallStart!==undefined){const drop=fallStart-this.feet[1],water=this.environment.water?.(this.feet[0],this.feet[2]),surface=this.environment.surface(this.feet[0],this.feet[2],this.feet[1]),waterDepth=water?(water.level-(surface?.height??this.feet[1])):0,waterLanding=waterDepth>=1;this.applyFallDamage(drop,waterLanding);this.fallStartY=this.fallStartX=this.fallStartZ=undefined;}
    this.refreshHealthEffects();
  }
  private applyFallDamage(drop:number,water:boolean){if(!Number.isFinite(drop)||drop<=3||water)return;const severity=drop-3,bleed=(light:number,moderate:number,heavy:number):Bleeding|undefined=>drop>=heavy?'heavy':drop>=moderate?'moderate':drop>=light?'light':undefined;this.damage('leftLeg',severity*7,bleed(6,10,14));this.damage('rightLeg',severity*7,bleed(6,10,14));if(drop>=6){this.damage('chest',(drop-5)*5,bleed(8,14,18));const armBleeding=drop>=16?'moderate':drop>=12?'light':undefined;this.damage('leftArm',(drop-5)*3,armBleeding);this.damage('rightArm',(drop-5)*3,armBleeding);}if(drop>=10)this.damage('head',(drop-9)*9,drop>=18?'heavy':drop>=13?'moderate':undefined);if(this.health.head.hp<=0||this.health.chest.hp<=0)this.lastDeathCause='fall';}
  private ceiling(x:number,z:number,oldY:number,nextY:number,colliders:readonly CharacterCollider[]):number {
    if(nextY<=oldY)return nextY;
    for(const c of colliders)if(c.kind==='wall'&&!c.floorPlane&&c.bottom>=oldY+this.height-.002&&nextY+this.height>c.bottom&&wallContains(c,x,z,CHARACTER.radius*.95)){nextY=Math.min(nextY,c.bottom-this.height-.002);this.velocity[1]=Math.min(0,this.velocity[1]);}
    for(const c of colliders)if(c.floorPlane){const f=c.floorPlane,dx=x-f.point[0],dz=z-f.point[2],topY=f.point[1]-(f.normal[0]*dx+f.normal[2]*dz)/f.normal[1],bottomY=topY-f.thickness/f.normal[1],localX=dx*f.xAxis[0]+(bottomY-f.point[1])*f.xAxis[1]+dz*f.xAxis[2],localZ=dx*f.zAxis[0]+(bottomY-f.point[1])*f.zAxis[1]+dz*f.zAxis[2];if(Math.abs(localX)<=f.halfWidth+CHARACTER.radius&&Math.abs(localZ)<=f.halfDepth+CHARACTER.radius&&bottomY>=oldY+this.height-.002&&nextY+this.height>bottomY){nextY=Math.min(nextY,bottomY-this.height-.002);this.velocity[1]=Math.min(0,this.velocity[1]);}}
    return nextY;
  }
  private floorIntersectsBody(f:NonNullable<CharacterCollider['floorPlane']>,x:number,z:number,feetY:number,height:number,radius:number):boolean {
    const center:Point3=[f.point[0]-f.normal[0]*f.thickness/2,f.point[1]-f.normal[1]*f.thickness/2,f.point[2]-f.normal[2]*f.thickness/2],dot=(axis:Point3,y:number)=>axis[0]*(x-center[0])+axis[1]*(y-center[1])+axis[2]*(z-center[2]),overlap=(axis:Point3,half:number,margin:number)=>{const a=dot(axis,feetY),b=dot(axis,feetY+height),lo=Math.min(a,b)-margin,hi=Math.max(a,b)+margin;return lo<half-.001&&hi>-half+.001;};
    return overlap(f.xAxis,f.halfWidth,radius*Math.hypot(f.xAxis[0],f.xAxis[2]))&&overlap(f.zAxis,f.halfDepth,radius*Math.hypot(f.zAxis[0],f.zAxis[2]))&&overlap(f.normal,f.thickness/2,0);
  }
  private swimStep(dt:number,input:CharacterInput,water:CharacterWater,oldGround:MeshSurface,colliders:readonly CharacterCollider[]) {
    const [x,y,z]=this.feet,vector=input.swimVector??[input.x,0,input.z],amount=Math.hypot(...vector);
    this.grounded=false;this.inBush=false;this.sprinting=false;this.accelerating=false;this.jumpBuffer=0;this.coyote=0;
    this.swimActive=amount>.01||input.jump||input.sprint;
    const speed=this.exhausted?.65:CHARACTER.swimSpeed;
    let tx=amount?vector[0]/amount*speed:0,tz=amount?vector[2]/amount*speed:0;
    let ty=this.exhausted?-CHARACTER.exhaustedSinkSpeed:input.jump&&!input.sprint?CHARACTER.swimUpSpeed:input.sprint&&!input.jump?-CHARACTER.swimDownSpeed:(amount?vector[1]/amount*speed:0)-CHARACTER.idleSinkSpeed;
    // Do not gain diagonal speed by combining forward motion and ascent.
    const length=Math.hypot(tx,ty,tz),limit=this.exhausted?1:speed;
    if(length>limit){tx*=limit/length;ty*=limit/length;tz*=limit/length;}
    const blend=1-Math.exp(-4*dt);this.velocity[0]+=(tx-this.velocity[0])*blend;this.velocity[1]+=(ty-this.velocity[1])*blend;this.velocity[2]+=(tz-this.velocity[2])*blend;
    let [nextX,nextZ]=this.sweep(x,z,this.velocity[0]*dt,this.velocity[2]*dt,colliders);
    let ground=this.support(nextX,nextZ,colliders);
    if(!ground||ground.height>y+CHARACTER.stepHeight) {
      const alongX=this.support(nextX,z,colliders),alongZ=this.support(x,nextZ,colliders);
      if(alongX&&alongX.height<=y+CHARACTER.stepHeight){nextZ=z;ground=alongX;}
      else if(alongZ&&alongZ.height<=y+CHARACTER.stepHeight){nextX=x;ground=alongZ;}
      else {nextX=x;nextZ=z;ground=oldGround;this.velocity[0]=0;this.velocity[2]=0;}
    }
    let nextY=y+this.velocity[1]*dt;
    // Keep the head just above water while paddling upward, without flight.
    const nextWater=this.environment.water?.(nextX,nextZ)??water;
    const surfaceFeet=nextWater.level-this.eyeHeight+.18;
    if(this.velocity[1]>0&&nextY>surfaceFeet){nextY=Math.max(y,surfaceFeet);this.velocity[1]=0;}
    if(ground&&nextY<ground.height){nextY=ground.height;this.velocity[1]=Math.max(0,this.velocity[1]);}
    nextY=this.ceiling(nextX,nextZ,y,nextY,colliders);
    const solid=this.environment.solidMovement?.([x,y,z],[nextX-x,nextY-y,nextZ-z],CHARACTER.radius,this.height,CHARACTER.stepHeight,this.swimming?0:CHARACTER.snapDistance);
    if(solid){this.feet.set(solid.feet);if(!this.swimming&&solid.grounded){this.grounded=true;this.velocity[1]=Math.max(0,this.velocity[1]);}if(Math.abs(solid.feet[1]-nextY)>.003&&this.velocity[1]>0)this.velocity[1]=0;}else this.feet.set([nextX,nextY,nextZ]);
  }
}
