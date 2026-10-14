import {it,expect} from 'vitest';
import {headBlur,HeadInjuryPerception} from '../client/head-injury';

it('keeps head blur gradual and bounded while leaving healthy vision clear',()=>{
  expect(headBlur(100)).toBe(0);expect(headBlur(45)).toBe(0);expect(headBlur(25)).toBeGreaterThan(0);expect(headBlur(0)).toBe(2.4);
});
it('uses stable visual ghosts, reveals contacted objects, and clears illusions on recovery',()=>{
  const a=new HeadInjuryPerception('world',(x,z)=>x+z),b=new HeadInjuryPerception('world',(x,z)=>x+z);
  a.update(9,[0,0,0]);b.update(9,[0,0,0]);expect(a.ghosts).toEqual(b.ghosts);expect(a.ghosts).toHaveLength(9);
  const ghosts=a.ghosts;a.update(8,[3,0,3]);expect(a.ghosts).toBe(ghosts);
  const hidden=Array.from({length:100},(_,i)=>`prop-${i}`).find(id=>a.hidden(id,3,3))!;expect(hidden).toBeDefined();a.reveal(hidden);expect(a.hidden(hidden,3,3)).toBe(false);
  expect(a.hidden('far',1000,1000)).toBe(false);a.update(10,[3,0,3]);expect(a.ghosts).toHaveLength(0);expect(a.hidden(hidden,3,3)).toBe(false);
});
