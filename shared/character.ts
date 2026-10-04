import type { MeshSurface } from './placement';
import {rockSurface,type RockCollisionShape} from './rock-collision';
export interface CharacterInput { x:number; z:number; sprint:boolean; jump:boolean }
export interface CharacterCollider { x:number; z:number; radius:number; bottom:number; top:number; kind:'tree'|'bush'|'rock';rock?:RockCollisionShape }
export interface CharacterEnvironment {
  surface(x:number,z:number):MeshSurface|null;
  colliders(x:number,z:number):readonly CharacterCollider[];
}
export const CHARACTER = { radius:.32, height:1.8, eyeHeight:1.64, walkSpeed:4.5, sprintSpeed:7,
  gravity:22, jumpSpeed:4.8, stepHeight:.28, snapDistance:.3, slopeCos:Math.cos(48*Math.PI/180), timestep:1/120 };
export const idleInput:CharacterInput={x:0,z:0,sprint:false,jump:false};
/** Horizontal movement independent of look pitch. */
export function characterInput(keys:ReadonlySet<string>,yaw:number):CharacterInput {
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  return {x:(Math.sin(yaw)*forward+Math.cos(yaw)*right)||0,z:(-Math.cos(yaw)*forward+Math.sin(yaw)*right)||0,
    sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'),jump:keys.has('Space')};
}
/** Placeholder standing capsule, represented by its feet. Fixed simulation steps
 * keep collisions stable across frame rates; no browser or GPU dependencies. */
export class Character {
  readonly feet=new Float64Array(3);
  readonly velocity=new Float64Array(3);
  grounded=false; inBush=false; ready=false;
  private accumulator=0;private jumpHeld=false;private jumpBuffer=0;private coyote=0;
  constructor(readonly environment:CharacterEnvironment) {}
  spawn(x:number,y:number,z:number) {
    this.feet.set([x,y,z]);this.velocity.fill(0);this.ready=false;this.grounded=false;
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
    return {height,normal};
  }
  update(dt:number,input:CharacterInput) {
    const support=this.support(this.feet[0],this.feet[2]);
    if(!support) {this.accumulator=0;this.jumpHeld=input.jump;return;}
    if(!this.ready) {this.feet[1]=support.height;this.grounded=support.normal[1]>=CHARACTER.slopeCos;this.ready=true;}
    if(input.jump&&!this.jumpHeld)this.jumpBuffer=.12;this.jumpHeld=input.jump;
    this.accumulator+=Math.max(0,Math.min(.1,dt));
    while(this.accumulator+1e-10>=CHARACTER.timestep) {this.step(CHARACTER.timestep,input);this.accumulator-=CHARACTER.timestep;}
  }
  private sweep(x:number,z:number,dx:number,dz:number,colliders:readonly CharacterCollider[]):[number,number] {
    const trees=colliders.filter(c=>c.kind==='tree'&&this.feet[1]<c.top&&this.feet[1]+CHARACTER.height>c.bottom);
    for(let pass=0;pass<4;pass++)for(const c of trees) {
      const nx=x-c.x,nz=z-c.z,distance=Math.hypot(nx,nz),radius=c.radius+CHARACTER.radius+.001;
      if(distance<radius) {x+=(distance?nx/distance:1)*(radius-distance);z+=(distance?nz/distance:0)*(radius-distance);}
    }
    for(let pass=0;pass<4&&Math.hypot(dx,dz)>1e-7;pass++) {
      let time=1,hit:CharacterCollider|undefined;const length2=dx*dx+dz*dz;
      for(const c of trees) {
        const ox=x-c.x,oz=z-c.z,radius=c.radius+CHARACTER.radius+.001;
        const b=ox*dx+oz*dz,constant=ox*ox+oz*oz-radius*radius,discriminant=b*b-length2*constant;
        if(b>=0||discriminant<0)continue;
        const t=(-b-Math.sqrt(discriminant))/length2;
        if(t>=-1e-6&&t<time) {time=Math.max(0,t);hit=c;}
      }
      x+=dx*time;z+=dz*time;if(!hit)break;
      const nx=x-hit.x,nz=z-hit.z,length=Math.hypot(nx,nz),normalX=nx/length,normalZ=nz/length;
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
    this.inBush=colliders.some(c=>c.kind==='bush'&&Math.hypot(x-c.x,z-c.z)<c.radius+CHARACTER.radius
      &&y<c.top&&y+CHARACTER.height>c.bottom);
    const amount=Math.hypot(input.x,input.z),speed=(input.sprint?CHARACTER.sprintSpeed:CHARACTER.walkSpeed)*(this.inBush?.65:1);
    const targetX=amount?input.x/amount*speed:0,targetZ=amount?input.z/amount*speed:0;
    const acceleration=this.grounded?(amount?18:26):3,blend=1-Math.exp(-acceleration*dt);
    this.velocity[0]+=(targetX-this.velocity[0])*blend;this.velocity[2]+=(targetZ-this.velocity[2])*blend;
    this.coyote=this.grounded?.08:Math.max(0,this.coyote-dt);
    if(this.jumpBuffer>0&&this.coyote>0) {this.velocity[1]=CHARACTER.jumpSpeed;this.grounded=false;this.coyote=0;this.jumpBuffer=0;}
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
    this.feet.set([nextX,nextY,nextZ]);
  }
}
