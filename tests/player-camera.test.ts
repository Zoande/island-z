import { afterEach,describe,expect,it,vi } from 'vitest';
import { PlayerCamera } from '../client/camera';
const flat={surface:()=>({height:0,normal:[0,1,0]as [number,number,number]}),colliders:()=>[]};
let camera:PlayerCamera|undefined;
afterEach(()=>{camera?.dispose();camera=undefined;vi.unstubAllGlobals();});
function setup() {
  const canvas=Object.assign(new EventTarget(),{requestPointerLock:async()=>{}});
  const doc=Object.assign(new EventTarget(),{pointerLockElement:canvas as EventTarget|null,exitPointerLock(){doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));}});
  const win=new EventTarget();vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  camera=new PlayerCamera(canvas as unknown as HTMLCanvasElement,flat);camera.spawn(0,0,0);
  const key=(type:string,code:string)=>win.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{code}));
  const mouse=(x:number,y:number)=>doc.dispatchEvent(Object.assign(new Event('mousemove'),{movementX:x,movementY:y}));
  return {c:camera,doc,win,key,mouse,canvas};
}
describe('player input events',()=>{
  it('looks right when the mouse moves right, and walks horizontally while looking up',()=>{
    const {c,key,mouse}=setup();mouse(100,-500);expect(c.forward[0]).toBeGreaterThan(0);expect(c.forward[1]).toBeGreaterThan(0);
    key('keydown','KeyW');for(let i=0;i<60;i++)c.update(1/60);
    expect(c.position[0]).toBeGreaterThan(0);expect(c.position[2]).toBeLessThan(0);expect(c.character.feet[1]).toBe(0);
    expect(c.position[1]).toBe(1.64);expect(c.pitch).toBe(1);
  });
  it('clears held movement on focus loss and pointer release, and ignores unlocked input',()=>{
    const {c,doc,win,key,mouse}=setup();key('keydown','KeyW');win.dispatchEvent(new Event('blur'));expect(c.keys.size).toBe(0);
    key('keydown','KeyD');doc.exitPointerLock();expect(c.keys.size).toBe(0);
    key('keydown','KeyW');mouse(100,100);expect(c.keys.size).toBe(0);expect(c.yaw).toBe(0);expect(c.pitch).toBe(0);
    c.update(.1);expect([...c.character.feet]).toEqual([0,0,0]);
  });
  it('removes input listeners when the player is disposed',()=>{
    const {c,doc,canvas,key,mouse}=setup();c.dispose();doc.pointerLockElement=canvas;
    key('keydown','KeyW');mouse(100,100);expect(c.keys.size).toBe(0);expect(c.yaw).toBe(0);
  });
});
