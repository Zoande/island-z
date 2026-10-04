import {describe,it,expect} from 'vitest';
import {Character,CHARACTER,idleInput,type CharacterEnvironment} from '../shared/character';
import {rockCollider,rockSurface} from '../shared/rock-collision';
import {rockPoints} from '../shared/rocks';
import {orientation,rotate} from '../shared/placement';
import type {Prop} from '../shared/world';
import {playerCollider} from '../client/player-colliders';
const base:Prop={kind:'rock',x:0,y:-.15,z:-3,variant:3,scale:3,rotation:.3,normal:[0,1,0]};
const environment=(prop=base):CharacterEnvironment=>{
  const collider=rockCollider(prop,rockPoints('island-z',prop.variant));
  return {surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[collider]};
};
describe('rock mesh collision',()=>{
  it('uses the scaled, rotated, buried visible shape instead of a round obstacle',()=>{
    for(let variant=0;variant<12;variant++) {
      const prop={...base,variant,x:1250000,z:-1250000,normal:[.3,Math.sqrt(.9),-.1]as [number,number,number]};
      const points=rockPoints('island-z',variant),c=playerCollider(prop,points)!;
      const transformed=points.map(p=>rotate(p.map(n=>n*prop.scale)as [number,number,number],orientation(prop.normal,prop.rotation)));
      expect(c.kind).toBe('rock');expect(c.top).toBeCloseTo(prop.y+Math.max(...transformed.map(p=>p[1])),10);
      expect(c.radius).toBeCloseTo(Math.max(...transformed.map(p=>Math.hypot(p[0],p[2]))),10);
      const surface=rockSurface(c,prop.x,prop.z)!;
      expect(surface.height).toBeGreaterThan(prop.y);expect(surface.height).toBeLessThanOrEqual(c.top);
      expect(surface.normal.every(Number.isFinite)).toBe(true);
      expect(rockSurface(c,prop.x+c.radius+1,prop.z)).toBeNull();
    }
  });
  it('blocks sprinting and jumping through large rocks at low and high frame rates',()=>{
    for(const fps of [10,30,120]) {
      const env=environment(),c=new Character(env);c.spawn(0,0,3);
      for(let i=0;i<fps*3;i++) {
        c.update(1/fps,{x:0,z:-1,sprint:true,jump:i===Math.floor(fps/2)});
        const roof=rockSurface(env.colliders(0,0)[0],c.feet[0],c.feet[2]);
        if(roof)expect(c.feet[1]).toBeGreaterThanOrEqual(roof.height-1e-6);
      }
      // A sloped face may divert the player around it, but never straight
      // through its middle. Without rock collision this run remains at x=0.
      expect(c.feet[2]>base.z||Math.abs(c.feet[0])>1).toBe(true);expect(c.feet.every(Number.isFinite)).toBe(true);
      expect(c.feet[1]).toBeLessThan(1);
    }
  });
  it('allows walking around the actual footprint',()=>{
    const c=new Character(environment());c.spawn(8,0,3);
    for(let i=0;i<240;i++)c.update(1/60,{x:0,z:-1,sprint:true,jump:false});
    expect(c.feet[2]).toBeLessThan(-15);expect(c.feet[1]).toBe(0);
  });
  it('steps across low slabs without treating them as tall cylinders',()=>{
    const prop={...base,variant:1,scale:.35,y:-.05,z:-1,rotation:0},c=new Character(environment(prop));c.spawn(0,0,1);
    let highest=0;
    for(let i=0;i<180;i++){c.update(1/60,{x:0,z:-1,sprint:false,jump:false});highest=Math.max(highest,c.feet[1]);}
    expect(highest).toBeGreaterThan(.03);expect(highest).toBeLessThan(CHARACTER.stepHeight);
    expect(c.feet[2]).toBeLessThan(-5);expect(c.feet[1]).toBe(0);
  });
  it('lands on a rock surface and falls off its edge',()=>{
    const prop={...base,variant:1,scale:2,y:-.15,z:0,rotation:0},env=environment(prop),c=new Character(env);
    const roof=rockSurface(env.colliders(0,0)[0],0,0)!;c.spawn(0,roof.height,0);
    c.update(1/60,idleInput);expect(c.feet[1]).toBeCloseTo(roof.height,8);
    c.update(1/60,{...idleInput,jump:true});expect(c.feet[1]).toBeGreaterThan(roof.height);
    for(let i=0;i<120;i++)c.update(1/60,idleInput);
    expect(c.grounded).toBe(true);expect(c.feet[1]).toBeCloseTo(roof.height,8);
    for(let i=0;i<180;i++)c.update(1/60,{x:1,z:0,sprint:false,jump:false});
    expect(c.feet[0]).toBeGreaterThan(5);expect(c.feet[1]).toBe(0);
  });
});
