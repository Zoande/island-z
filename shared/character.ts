import type { MeshSurface } from './placement';
import {rockSurface,type RockCollisionShape} from './rock-collision';
import {wallContains,wallPush,wallSweep} from './wall-collision';
export interface CharacterInput { x:number; z:number; sprint:boolean; jump:boolean;swimVector?:[number,number,number] }
export interface CharacterWater {level:number;kind:'ocean'|'lake'|'river';offshoreMeters?:number}
export interface CharacterCollider { x:number; z:number; radius:number; bottom:number; top:number; kind:'tree'|'bush'|'rock'|'wall'|'fixture';rock?:RockCollisionShape;wall?:{halfWidth:number;halfDepth:number;yaw:number} }
export interface CharacterEnvironment {
  surface(x:number,z:number):MeshSurface|null;
  colliders(x:number,z:number):readonly CharacterCollider[];
  water?(x:number,z:number):CharacterWater|null;
  solidMovement?(feet:[number,number,number],desired:[number,number,number],radius:number,height:number,step:number,snap:number):{feet:[number,number,number];grounded:boolean}|null;
}
export const CHARACTER = { radius:.32, height:2.16, eyeHeight:1.64*1.2, walkSpeed:4.5*1.15, sprintSpeed:7*1.15*1.3,
  runAcceleration:4.5,swimSpeed:3.2,swimUpSpeed:1.8,swimDownSpeed:2.4,idleSinkSpeed:.12,exhaustedSinkSpeed:.75,
  oxygenSeconds:60,staminaCapacity:100,swimDrain:.18,oceanSwimDrain:.35,sprintDrain:.8,accelerationDrain:1.2,walkRecovery:.55,waterRecovery:.5,
  oceanOxygenGraceMeters:50,oceanOxygenRampMeters:350,
  gravity:22, jumpSpeed:4.8*Math.sqrt(1.3), jumpCost:4, stepHeight:.28, snapDistance:.3, slopeCos:Math.cos(48*Math.PI/180), timestep:1/120 };
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
  constructor(readonly environment:CharacterEnvironment) {}
  spawn(x:number,y:number,z:number) {
    this.home??=[x,y,z];
    this.feet.set([x,y,z]);this.velocity.fill(0);this.ready=false;this.grounded=false;
    this.swimming=false;this.underwater=false;this.sprinting=false;this.accelerating=false;this.exhausted=false;this.swimActive=false;
    this.oxygen=CHARACTER.oxygenSeconds;this.oxygenDrainRate=1;this.stamina=CHARACTER.staminaCapacity;this.waterLevel=null;
    this.accumulator=0;this.jumpHeld=false;this.jumpBuffer=0;this.coyote=0;
  }
  private support(x:number,z:number,colliders:readonly CharacterCollider[]=this.environment.colliders(x,z)):MeshSurface|null {
    const center=this.environment.surface(x,z);if(!center)return null;
    let height=center.height,normal=center.normal;
    const offset=CHARACTER.radius*.65,rounding=CHARACTER.radius-Math.sqrt(CHARACTER.radius**2-offset**2);
    for(const [dx,dz]of [[offset,0],[-offset,0],[0,offset],[0,-offset]]) {
      const sample=this.environment.surface(x+dx,z+dz);if(!sample)return null;
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
    for(const collider of colliders)if(collider.kind==='wall'&&collider.top>height&&this.feet[1]>=collider.top-CHARACTER.stepHeight-.002&&wallContains(collider,x,z,CHARACTER.radius*.95)) {height=collider.top;normal=[0,1,0];}
    return {height,normal};
  }
  update(dt:number,input:CharacterInput) {
    if(!Number.isFinite(dt)||dt<=0)return;
    const support=this.support(this.feet[0],this.feet[2]);
    if(!support) {this.accumulator=0;this.jumpHeld=input.jump;this.updateSubmersion();this.updateVitals(dt,input);return;}
    if(!this.ready) {
      if(this.feet[1]<=support.height+CHARACTER.stepHeight){this.feet[1]=support.height;this.grounded=support.normal[1]>=CHARACTER.slopeCos;}
      this.ready=true;
    }
    if(input.jump&&!this.jumpHeld)this.jumpBuffer=.12;this.jumpHeld=input.jump;
    this.accumulator+=Math.max(0,Math.min(.1,dt));
    while(this.accumulator+1e-10>=CHARACTER.timestep) {this.accumulator-=CHARACTER.timestep;this.step(CHARACTER.timestep,input);}
    this.updateSubmersion();this.updateVitals(dt,input);
  }
  private updateSubmersion() {
    const water=this.environment.water?.(this.feet[0],this.feet[2]);this.waterLevel=water?.level??null;
    this.underwater=!!water&&this.feet[1]+CHARACTER.eyeHeight<water.level-.04;
    // A gentle shoreline buffer gives way to continuously increasing offshore
    // risk. Freshwater retains the full one-minute underwater budget.
    const distance=water?.offshoreMeters??0,offshore=Number.isFinite(distance)?Math.max(0,distance):0;
    this.oxygenDrainRate=water?.kind==='ocean'?1+(Math.max(0,offshore-CHARACTER.oceanOxygenGraceMeters)/CHARACTER.oceanOxygenRampMeters)**2:1;
    if(water)this.waterKind=water.kind;
  }
  private updateVitals(dt:number,input:CharacterInput) {
    this.oxygen=Math.max(0,Math.min(CHARACTER.oxygenSeconds,this.oxygen+(this.underwater?-dt*this.oxygenDrainRate:dt*10)));
    if(this.oxygen<=0&&this.home){this.respawns++;this.spawn(...this.home);return;}
    const exerting=this.swimming?this.swimActive:input.sprint&&Math.hypot(input.x,input.z)>.01||this.accelerating;
    const drain=this.swimming?(this.waterKind==='ocean'?CHARACTER.oceanSwimDrain:CHARACTER.swimDrain):this.sprinting?CHARACTER.sprintDrain:CHARACTER.accelerationDrain;
    if(exerting)this.stamina=Math.max(0,this.stamina-drain*dt);
    else if(this.swimming||this.grounded)this.stamina=Math.min(CHARACTER.staminaCapacity,this.stamina+dt*(this.swimming?CHARACTER.waterRecovery:CHARACTER.walkRecovery));
    if(this.stamina<=0)this.exhausted=true;
    else if(this.stamina>=15)this.exhausted=false;
  }
  private sweep(x:number,z:number,dx:number,dz:number,colliders:readonly CharacterCollider[]):[number,number] {
    const trees=colliders.filter(c=>(c.kind==='tree'||c.kind==='fixture')&&this.feet[1]<c.top&&this.feet[1]+CHARACTER.height>c.bottom);
    const walls=colliders.filter(c=>c.kind==='wall'&&this.feet[1]<c.top-.001&&this.feet[1]+CHARACTER.height>c.bottom&&!(this.grounded&&c.top<=this.feet[1]+CHARACTER.stepHeight&&c.top>=this.feet[1]));
    for(let pass=0;pass<4;pass++)for(const c of trees) {
      const nx=x-c.x,nz=z-c.z,distance=Math.hypot(nx,nz),radius=c.radius+CHARACTER.radius+.001;
      if(distance<radius) {x+=(distance?nx/distance:1)*(radius-distance);z+=(distance?nz/distance:0)*(radius-distance);}
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
    const [x,y,z]=this.feet,colliders=this.environment.colliders(x,z);
    const oldGround=this.support(x,z,colliders);if(!oldGround)return;
    const water=this.environment.water?.(x,z);
    this.swimming=!!water&&water.level-oldGround.height>CHARACTER.eyeHeight-.15&&water.level-y>CHARACTER.height*.5;
    if(this.swimming){this.swimStep(dt,input,water!,oldGround,colliders);return;}
    this.swimActive=false;
    this.inBush=colliders.some(c=>c.kind==='bush'&&Math.hypot(x-c.x,z-c.z)<c.radius+CHARACTER.radius
      &&y<c.top&&y+CHARACTER.height>c.bottom);
    const amount=Math.hypot(input.x,input.z),speed=(input.sprint&&!this.exhausted?CHARACTER.sprintSpeed:CHARACTER.walkSpeed)*(this.inBush?.65:1);
    const targetX=amount?input.x/amount*speed:0,targetZ=amount?input.z/amount*speed:0;
    const currentSpeed=Math.hypot(this.velocity[0],this.velocity[2]);
    this.sprinting=!!(input.sprint&&!this.exhausted&&amount>.01);
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
    if(this.jumpBuffer>0&&this.coyote>0&&this.stamina>=CHARACTER.jumpCost&&!this.exhausted) {
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
    nextY=this.ceiling(nextX,nextZ,y,nextY,colliders);
    const solid=this.environment.solidMovement?.([x,y,z],[nextX-x,nextY-y,nextZ-z],CHARACTER.radius,CHARACTER.height,CHARACTER.stepHeight,this.swimming?0:CHARACTER.snapDistance);
    if(solid){this.feet.set(solid.feet);if(!this.swimming&&solid.grounded){this.grounded=true;this.velocity[1]=Math.max(0,this.velocity[1]);}if(Math.abs(solid.feet[1]-nextY)>.003&&this.velocity[1]>0)this.velocity[1]=0;}else this.feet.set([nextX,nextY,nextZ]);
  }
  private ceiling(x:number,z:number,oldY:number,nextY:number,colliders:readonly CharacterCollider[]):number {
    if(nextY<=oldY)return nextY;
    for(const c of colliders)if(c.kind==='wall'&&c.bottom>=oldY+CHARACTER.height-.002&&nextY+CHARACTER.height>c.bottom&&wallContains(c,x,z,CHARACTER.radius*.95)){nextY=Math.min(nextY,c.bottom-CHARACTER.height-.002);this.velocity[1]=Math.min(0,this.velocity[1]);}
    return nextY;
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
    const surfaceFeet=nextWater.level-CHARACTER.eyeHeight+.18;
    if(this.velocity[1]>0&&nextY>surfaceFeet){nextY=Math.max(y,surfaceFeet);this.velocity[1]=0;}
    if(ground&&nextY<ground.height){nextY=ground.height;this.velocity[1]=Math.max(0,this.velocity[1]);}
    nextY=this.ceiling(nextX,nextZ,y,nextY,colliders);
    const solid=this.environment.solidMovement?.([x,y,z],[nextX-x,nextY-y,nextZ-z],CHARACTER.radius,CHARACTER.height,CHARACTER.stepHeight,this.swimming?0:CHARACTER.snapDistance);
    if(solid){this.feet.set(solid.feet);if(!this.swimming&&solid.grounded){this.grounded=true;this.velocity[1]=Math.max(0,this.velocity[1]);}if(Math.abs(solid.feet[1]-nextY)>.003&&this.velocity[1]>0)this.velocity[1]=0;}else this.feet.set([nextX,nextY,nextZ]);
  }
}
