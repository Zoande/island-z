import {describe,it,expect} from 'vitest';
import {DAYLIGHT,DaylightClock,daylightLighting,hourPhase,phaseHour,shadowDirection} from '../shared/daylight';
import {packLighting,LIGHTING_FLOATS,MAX_POINT_LIGHTS,MAX_LIGHT_WALLS} from '../client/lighting';
import {torchGeometry} from '../client/torch-geometry';
import {BuildScene} from '../shared/build-scene';
import {objectDefinition,type BuildObject} from '../shared/object-registry';
import type {WorldGenerator} from '../shared/world';
const scene=()=>new BuildScene({config:{seed:'lighting-test',islandSizeMeters:1024}}as WorldGenerator);
const torch=(id:string,x:number,z=0):BuildObject=>({id,definitionId:'torch',variant:0,position:[x,0,z],rotation:0,normal:[0,1,0],support:{kind:'terrain'}});
describe('daylight clock and lighting',()=>{
  it('runs a three-hour day and ninety-minute night, including midnight and many cycles',()=>{
    const clock=new DaylightClock(100);clock.setHour(6,100);
    expect(clock.hour(100+DAYLIGHT.daySeconds/2)).toBeCloseTo(12);
    expect(clock.hour(100+DAYLIGHT.daySeconds)).toBeCloseTo(18);
    expect(clock.hour(100+DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds/2)).toBeCloseTo(0);
    expect(clock.hour(100+DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds)).toBeCloseTo(6);
    expect(clock.hour(100+1000*(DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds))).toBeCloseTo(6);
    for(let hour=0;hour<24;hour+=.1)expect(phaseHour(hourPhase(hour))).toBeCloseTo(hour,8);
  });
  it('pauses, resumes and restores elapsed real time without resetting manual time',()=>{
    const clock=new DaylightClock(10);clock.setHour(12,10);clock.setAutomatic(false,10);
    expect(clock.hour(100000)).toBeCloseTo(12);const paused=new DaylightClock(500,clock.snapshot(300));expect(paused.hour(600)).toBeCloseTo(12);
    paused.setAutomatic(true,600);expect(paused.hour(600+900)).toBeCloseTo(13);
    const restored=new DaylightClock(600+1800,paused.snapshot(600+900));expect(restored.hour(600+1800)).toBeCloseTo(14);
    expect(new DaylightClock(0,{phase:NaN}).hour(0)).toBe(DAYLIGHT.startHour);
    clock.setHour(-1,10);expect(clock.hour(10)).toBeCloseTo(23);
  });
  it('keeps directions and lighting finite and smooth through sunrise, sunset and midnight',()=>{
    for(let hour=0;hour<24;hour+=.01){const sky=daylightLighting(hour);for(const direction of [sky.sun,sky.moon,sky.primary,shadowDirection(sky.primary)])expect(Math.hypot(...direction)).toBeCloseTo(1,8);expect(Object.values(sky).filter(v=>typeof v==='number').every(Number.isFinite)).toBe(true);}
    const noon=daylightLighting(12),night=daylightLighting(0);expect(noon.sunPower).toBeGreaterThan(3);expect(night.sunPower).toBe(0);expect(night.moonPower).toBeGreaterThan(.1);expect(night.ambientSky[1]).toBeLessThan(noon.ambientSky[1]/10);expect(night.stars).toBe(1);expect(noon.stars).toBe(0);
    for(const hour of [0,6,18]){const a=daylightLighting(hour-.001),b=daylightLighting(hour+.001);for(const field of ['sunPower','moonPower','daylight','twilight','exposure']as const)expect(Math.abs(a[field]-b[field])).toBeLessThan(.01);}
  });
});
describe('registry-driven torch lighting',()=>{
  it('reuses materials with finite small meshes and physical dimensions independent of flame cards',()=>{
    const parts=torchGeometry();expect(parts.map(p=>p.material)).toContain('torch-flame');for(const part of parts){expect(part.vertices.length%16).toBe(0);expect(part.vertices.every(Number.isFinite)).toBe(true);expect(Math.max(...part.indices)).toBeLessThan(part.vertices.length/16);}
    const s=scene(),solid=s.add(torch('test-torch',0));expect(solid.collider.kind).toBe('fixture');expect(solid.collider.top).toBe(objectDefinition('torch').fixture!.height);expect(solid.collider.radius).toBeLessThan(.2);
  });
  it('bounds local light/occluder budgets, prioritizes nearby lights and keeps relative coordinates precise',()=>{
    const s=scene();for(let i=0;i<50;i++)s.add(torch(`torch-${i}`,1e7+i));
    for(let i=0;i<30;i++)s.add({id:`wall-${i}`,definitionId:'wall-wood',variant:0,position:[1e7+i,0,1],rotation:.3,normal:[0,1,0],support:{kind:'terrain'}});
    const values=new Float32Array(LIGHTING_FLOATS),objects=s.placed.values();
    expect(packLighting(values,daylightLighting(0),[1e7,2,0],objects,100,1)).toBe(MAX_POINT_LIGHTS);expect(values[32]).toBe(MAX_POINT_LIGHTS);expect(values[33]).toBe(MAX_LIGHT_WALLS);expect(values[36]).toBe(0);expect(values.every(Number.isFinite)).toBe(true);
    expect(packLighting(values,daylightLighting(12),[1e7,2,0],objects,8,2)).toBe(8);
    expect(packLighting(values,daylightLighting(12),[0,2,0],objects,24,2)).toBe(0);expect(values[33]).toBe(0);expect(values.slice(36).every(v=>v===0)).toBe(true);
  });
});
