import {describe,it,expect} from 'vitest';
import {gpuSceneryReference,type GpuSceneryCandidate,type GpuSceneryConfig,type GpuSceneryFrame} from '../client/gpu-scenery';
import {lodEntries,rangeFade} from '../client/lod';

const planes=(minX=-100,maxX=100,minY=-100,maxY=100,minZ=-100,maxZ=100)=>new Float32Array([
  1,0,0,-minX,-1,0,0,maxX,0,1,0,-minY,0,-1,0,maxY,0,0,1,-minZ,0,0,-1,maxZ,
]);
const frame=(camera:[number,number,number]=[0,0,0],view=planes(),light=planes(),shadowCasterRange=60):GpuSceneryFrame=>({camera,viewPlanes:view,lightPlanes:light,shadowCasterRange,naturalRange:1000});
const candidate=(x:number,opts:Partial<GpuSceneryCandidate>={}):GpuSceneryCandidate=>({
  transform:[x,0,0,1,0,0,0,1],sphere:[x,0,0,1],horizontal:[x,0],maxRange:500,natural:false,...opts,
});
const config=(opts:Partial<GpuSceneryConfig>={}):GpuSceneryConfig=>({mode:'view',level:0,boundaries:[],range:500,tree:false,indexCount:6,...opts});

describe('GPU scenery selection reference',()=>{
  it('selects both complementary meshes and the smooth threshold across each LOD boundary',()=>{
    const boundary=[{distance:100,width:20}],points=[90,100,110].map(x=>candidate(x,{horizontal:[x,0]}));
    const f=frame([0,0,0],planes(0,120,-10,10,-10,10));
    const outgoing=gpuSceneryReference(points,config({level:0,boundaries:boundary}),f);
    const incoming=gpuSceneryReference(points,config({level:1,boundaries:boundary}),f);
    expect(outgoing.map(value=>[value.index,value.record[8],value.record[9]])).toEqual([[0,0,1],[1,.5,1]]);
    expect(incoming.map(value=>[value.index,value.record[8],value.record[9]])).toEqual([[0,0,0],[1,.5,0],[2,1,0]]);
    for(const level of [0,1]) {
      const actual=gpuSceneryReference(points,config({level,boundaries:boundary}),f).map(value=>[value.index,level,value.record[8],value.record[9]]);
      const oracle=points.flatMap((value,index)=>lodEntries(value.horizontal[0],boundary).filter(entry=>entry.level===level).map(entry=>[index,level,entry.threshold,entry.outgoing?1:0]));
      expect(actual).toEqual(oracle);
    }
  });

  it('uses view frustum for view instances and light frustum for offscreen shadow casters',()=>{
    const offscreen=candidate(40),camera=planes(-20,20,-20,20,-20,20),light=planes(30,80,-20,20,-20,20),f=frame([0,0,0],camera,light,60);
    expect(gpuSceneryReference([offscreen],config(),f)).toHaveLength(0);
    expect(gpuSceneryReference([offscreen],config({mode:'shadow'}),f)).toHaveLength(1);
    expect(gpuSceneryReference([offscreen],config({mode:'shadow'}),frame([0,0,0],camera,light,38))).toHaveLength(0);
  });

  it('applies horizontal range and distance fade while keeping large-world positions camera-relative',()=>{
    const near=candidate(1,{range:500,maxRange:500}),fade=candidate(400,{range:500,maxRange:500}),outside=candidate(501,{range:500,maxRange:500});
    const records=gpuSceneryReference([near,fade,outside],config({range:1000}),frame([0,0,0],planes(0,600,-10,10,-10,10)));
    expect(records.map(value=>value.index)).toEqual([0,1]);
    expect(records[0].record[10]).toBe(1);
    expect(records[1].record[10]).toBeGreaterThan(0);
    const origin=1_000_000_000,prop=origin+123.456,camera=origin+123.4,relativeX=prop-origin,cameraX=camera-origin;
    expect(Math.fround(prop)-Math.fround(camera)).not.toBeCloseTo(.056,2);
    const relative=candidate(relativeX,{transform:[relativeX,0,0,1,0,0,0,1],sphere:[relativeX,0,0,1],horizontal:[relativeX,0],maxRange:100,range:100});
    const result=gpuSceneryReference([relative],config({range:100}),frame([cameraX,0,0],planes(-10,10,-10,10,-10,10),planes(),20));
    expect(result[0].record[0]).toBeCloseTo(.056,3);
  });

  it('filters natural chunk bounds and excludes trees at the final geometry LOD',()=>{
    const boundaries=[{distance:100,width:20},{distance:250,width:40},{distance:400,width:80}],tree=candidate(450,{natural:true,range:600,boundaries,chunk:{x:440,z:-10,extent:20,sphere:[450,0,0,15]}});
    expect(gpuSceneryReference([tree],config({level:3,boundaries,tree:true,range:600}),frame([0,0,0],planes(-500,500,-20,20,-20,20)))).toHaveLength(0);
    const beyondNaturalRange=candidate(1001,{natural:true,range:2000,chunk:{x:990,z:-10,extent:20,sphere:[1001,0,0,15]}});
    expect(gpuSceneryReference([beyondNaturalRange],config({range:2000}),frame([0,0,0],planes(),planes(),60))).toHaveLength(0);
  });

  it('returns no rows for empty candidates and respects per-candidate range overrides',()=>{
    expect(gpuSceneryReference([],config(),frame())).toEqual([]);
    const short=candidate(80,{range:50,maxRange:500}),long=candidate(80,{range:100,maxRange:500});
    expect(gpuSceneryReference([short,long],config({range:200}),frame()).map(value=>value.index)).toEqual([1]);
  });

  it('uses per-candidate scaled-prop range and LOD overrides instead of batch defaults',()=>{
    const candidates=[
      candidate(85,{range:120,boundaries:[{distance:100,width:40}]}),
      candidate(140,{range:300,boundaries:[{distance:200,width:40},{distance:400,width:60}]}),
    ];
    const result=gpuSceneryReference(candidates,config({range:50,boundaries:[{distance:20,width:10}]}),frame([0,0,0],planes(0,200,-10,10,-10,10)));
    expect(result.map(value=>value.index)).toEqual([0,1]);
    expect(result[0].record[8]).toBeCloseTo(.04296875,6);
    expect(result[0].record[9]).toBe(1);
    expect(result[0].record[10]).toBeCloseTo(rangeFade(85,120),6);
    expect(result[1].record[8]).toBe(1);
    expect(result[1].record[10]).toBe(1);
  });

  it('maps shadow mesh levels through the configured LOD offset',()=>{
    const boundaries=[{distance:100,width:20}],candidates=[90,100,110].map(x=>candidate(x));
    const f=frame([0,0,0],planes(-200,200,-20,20,-20,20),planes(-200,200,-20,20,-20,20),200);
    const level1=gpuSceneryReference(candidates,config({mode:'shadow',level:1,boundaries,shadowLodOffset:1}),f);
    const level2=gpuSceneryReference(candidates,config({mode:'shadow',level:2,boundaries,shadowLodOffset:1}),f);
    expect(level1.map(value=>[value.index,value.record[8],value.record[9]])).toEqual([[0,0,1],[1,.5,1]]);
    expect(level2.map(value=>[value.index,value.record[8],value.record[9]])).toEqual([[0,0,0],[1,.5,0],[2,1,0]]);
  });

  it('allows built tree LOD2 fade and keeps natural tree coverage opaque',()=>{
    const built=candidate(400,{range:500,boundaries:[{distance:100,width:20},{distance:220,width:40}]}),builtResult=gpuSceneryReference([built],config({level:2,boundaries:[{distance:100,width:20},{distance:220,width:40}],range:500,tree:false}),frame([0,0,0],planes(0,500,-10,10,-10,10)));
    expect(builtResult).toHaveLength(1);expect(builtResult[0].record[8]).toBe(1);expect(builtResult[0].record[10]).toBeCloseTo(rangeFade(400,500),6);expect(builtResult[0].record[10]).toBeLessThan(1);
    const natural=candidate(400,{natural:true,range:500,boundaries:[{distance:100,width:20},{distance:220,width:40},{distance:400,width:160}]}),naturalResult=gpuSceneryReference([natural],config({level:2,boundaries:natural.boundaries,range:500,tree:true}),frame([0,0,0],planes(0,500,-10,10,-10,10)));
    expect(naturalResult).toHaveLength(1);expect(naturalResult[0].record[8]).toBeCloseTo(.5,5);expect(naturalResult[0].record[9]).toBe(1);expect(naturalResult[0].record[10]).toBe(1);
  });

  it('uses inclusive lower and exclusive upper distance-bin edges',()=>{
    const values=[99,100,249,250].map(x=>candidate(x)),binConfig=config({range:300,distanceMin:100,distanceMax:250});
    expect(gpuSceneryReference(values,binConfig,frame([0,0,0],planes(0,300,-10,10,-10,10))).map(value=>value.index)).toEqual([1,2]);
  });
});
