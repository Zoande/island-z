import { mat4, vec3 } from 'gl-matrix';
import { Character, CHARACTER, characterInput, idleInput, type CharacterEnvironment } from '../shared/character';
export class PlayerCamera {
  readonly character:Character;
  readonly position=new Float64Array(3);
  yaw=0;pitch=0;
  readonly keys=new Set<string>();
  private abort=new AbortController();
  constructor(readonly canvas:HTMLCanvasElement,environment:CharacterEnvironment) {
    this.character=new Character(environment);
    const options={signal:this.abort.signal};
    window.addEventListener('keydown',e=>{
      if(document.pointerLockElement!==canvas)return;
      this.keys.add(e.code);
      if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();
    },options);
    window.addEventListener('keyup',e=>this.keys.delete(e.code),options);
    window.addEventListener('blur',()=>this.keys.clear(),options);
    document.addEventListener('pointerlockchange',()=>this.keys.clear(),options);
    document.addEventListener('mousemove',e=>{
      if(document.pointerLockElement!==canvas)return;
      this.yaw+=e.movementX*.002;this.pitch=Math.max(-1.54,Math.min(1.54,this.pitch-e.movementY*.002));
    },options);
    canvas.addEventListener('click',()=>{if(document.pointerLockElement!==canvas)void canvas.requestPointerLock().catch(()=>{});},options);
  }
  spawn(x:number,y:number,z:number) {this.character.spawn(x,y,z);this.syncPosition();}
  private syncPosition() {this.position.set([this.character.feet[0],this.character.feet[1]+CHARACTER.eyeHeight,this.character.feet[2]]);}
  get forward():[number,number,number] {return [Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),-Math.cos(this.yaw)*Math.cos(this.pitch)];}
  update(dt:number) {
    this.character.update(dt,document.pointerLockElement===this.canvas?characterInput(this.keys,this.yaw):idleInput);
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
  dispose() {this.abort.abort();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}
}
