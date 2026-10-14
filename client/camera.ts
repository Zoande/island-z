import { mat4, vec3 } from 'gl-matrix';
import { Character, CHARACTER, characterInput, idleInput, type CharacterEnvironment } from '../shared/character';
import {STANCE_HOLD_MS,stanceAfterGesture,type Stance} from './stance-controls';
export class PlayerCamera {
  readonly character:Character;
  readonly position=new Float64Array(3);
  yaw=0;pitch=0;
  simulate=true;onInput?:(input:ReturnType<typeof characterInput>)=>void;
  private stanceIntent:Stance='stand';private stancePress?:{from:Stance;held:boolean;timer:ReturnType<typeof setTimeout>};
  adoptStance(stance:Stance){this.cancelStancePress();this.stanceIntent=stance;}
  private publishInput(){const input=document.pointerLockElement===this.canvas?characterInput(this.keys,this.yaw,this.pitch):idleInput;this.onInput?.({...input,stance:this.stanceIntent});}
  private cancelStancePress(){if(this.stancePress)clearTimeout(this.stancePress.timer);this.stancePress=undefined;}
  private requestStance(stance:Stance){
    if(this.character.effects.crawling||stance==='crouch'&&this.character.crutchesEquipped)return;
    this.stanceIntent=stance;this.publishInput();
  }
  readonly keys=new Set<string>();
  private abort=new AbortController();
  constructor(readonly canvas:HTMLCanvasElement,environment:CharacterEnvironment) {
    this.character=new Character(environment);
    const options={signal:this.abort.signal};
    window.addEventListener('keydown',e=>{
      if(document.pointerLockElement!==canvas)return;
      if(e.code==='KeyC'){
        e.preventDefault();if(e.repeat||this.stancePress||this.character.effects.crawling)return;
        const from=this.character.posture,press={from,held:false,timer:setTimeout(()=>{if(this.stancePress!==press)return;press.held=true;this.requestStance(stanceAfterGesture(from,true));},STANCE_HOLD_MS)};
        this.stancePress=press;return;
      }
      this.keys.add(e.code);this.publishInput();
      if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();
    },options);
    window.addEventListener('keyup',e=>{if(e.code==='KeyC'&&this.stancePress){const press=this.stancePress;this.cancelStancePress();if(!press.held&&document.pointerLockElement===canvas)this.requestStance(stanceAfterGesture(press.from,false));return;}this.keys.delete(e.code);this.publishInput();},options);
    window.addEventListener('blur',()=>{this.cancelStancePress();this.keys.clear();this.publishInput();},options);
    document.addEventListener('pointerlockchange',()=>{this.cancelStancePress();this.keys.clear();this.publishInput();},options);
    document.addEventListener('mousemove',e=>{
      if(document.pointerLockElement!==canvas)return;
      this.yaw+=e.movementX*.002;this.pitch=Math.max(-1.54,Math.min(1.54,this.pitch-e.movementY*.002));this.publishInput();
    },options);
    canvas.addEventListener('click',()=>{if(document.pointerLockElement!==canvas)void canvas.requestPointerLock().catch(()=>{});},options);
  }
  spawn(x:number,y:number,z:number) {this.character.spawn(x,y,z);this.syncPosition();}
  private syncPosition() {this.position.set([this.character.feet[0],this.character.feet[1]+this.character.eyeHeight,this.character.feet[2]]);}
  get forward():[number,number,number] {return [Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),-Math.cos(this.yaw)*Math.cos(this.pitch)];}
  update(dt:number) {
    const respawns=this.character.respawns;
    if(this.simulate)this.character.update(dt,{...(document.pointerLockElement===this.canvas?characterInput(this.keys,this.yaw,this.pitch):idleInput),stance:this.stanceIntent});
    if(this.character.respawns!==respawns){this.cancelStancePress();this.stanceIntent='stand';this.keys.clear();this.yaw=0;this.pitch=-.04;}
    this.syncPosition();
  }
  matrices(aspect:number,far:number) {
    const view=mat4.lookAt(mat4.create(),[0,0,0],this.forward,[0,1,0]);
    const projection=mat4.perspectiveZO(mat4.create(),Math.PI/3,aspect,.06,far);
    const vp=mat4.multiply(mat4.create(),projection,view);
    return {view,projection,vp,inverse:mat4.invert(mat4.create(),vp)!};
  }
  visible(x:number,y:number,z:number,radius:number,far:number) {
    const v=vec3.fromValues(x-this.position[0],y-this.position[1],z-this.position[2]),d=vec3.length(v);
    if(d>far+radius)return false;
    const along=vec3.dot(v,this.forward);return along>=-radius&&along>d*.35-radius*2;
  }
  dispose() {this.cancelStancePress();this.abort.abort();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
}
