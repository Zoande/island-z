import {afterEach,describe,it,expect,vi} from 'vitest';
import {IslandRenderer} from '../client/renderer';
import {recordFor} from '../shared/destruction';
import {terrainRecord} from '../shared/terrain-volume';
afterEach(()=>vi.unstubAllGlobals());
const config={seed:'cancel-test',islandSizeMeters:128};
describe('renderer initialization cancellation',()=>{
  it('does not create a device after disposal while adapter selection is pending',async()=>{
    let resolve!:(value:any)=>void;
    const adapter=new Promise<any>(r=>resolve=r),requestDevice=vi.fn();
    vi.stubGlobal('navigator',{gpu:{requestAdapter:()=>adapter}});
    const renderer=new IslandRenderer({}as HTMLCanvasElement,config),initializing=renderer.initialize(()=>{});
    renderer.dispose();resolve({features:new Set(),requestDevice});
    await expect(initializing).rejects.toMatchObject({name:'AbortError'});expect(requestDevice).not.toHaveBeenCalled();
  });
  it('destroys a device that arrives after disposal',async()=>{
    let resolve!:(value:any)=>void;
    const devicePromise=new Promise<any>(r=>resolve=r),requestDevice=vi.fn(()=>devicePromise),destroy=vi.fn();
    vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({features:new Set(),requestDevice})}});
    const renderer=new IslandRenderer({}as HTMLCanvasElement,config),initializing=renderer.initialize(()=>{});
    await Promise.resolve();expect(requestDevice).toHaveBeenCalledOnce();renderer.dispose();resolve({destroy});
    await expect(initializing).rejects.toMatchObject({name:'AbortError'});expect(destroy).toHaveBeenCalledOnce();
  });
  it('keeps an accepted prediction and restores the prior draw after rejection',()=>{
    const renderer=new IslandRenderer({}as HTMLCanvasElement,config),base=recordFor('wall',{kind:'wall-wood',x:0,y:0,z:0,scale:1,variant:0,rotation:0},[]),predicted={...base,revision:1,volume:{...base.volume,bricks:{'0:0:0':new Int16Array([1])}}};
    const restore={record:base,meshes:[],lods:[],owns:true},destroyPrediction=vi.fn(),draw={record:predicted,meshes:[],lods:[],owns:true,prediction:{base:restore,regions:[],signature:'pending',buffer:{destroy:destroyPrediction}}};
    (renderer as any).damaged.set(base.id,draw);
    renderer.reconcileDamagedPrediction({...predicted,revision:2});
    expect((renderer as any).damaged.get(base.id)).toBe(draw);
    renderer.reconcileDamagedPrediction(base);
    expect((renderer as any).damaged.get(base.id)).toBe(restore);
    expect(destroyPrediction).toHaveBeenCalledOnce();
    renderer.dispose();
  });
  it('keeps the current terrain draw while replacement prediction is queued',()=>{
    vi.stubGlobal('GPUBufferUsage',{STORAGE:1,VERTEX:2,COPY_DST:4,INDEX:8});
    const renderer=new IslandRenderer({}as HTMLCanvasElement,config),createBuffer=vi.fn(({size}:any)=>({getMappedRange:()=>new ArrayBuffer(size),unmap:vi.fn(),destroy:vi.fn()}));
    (renderer as any).device={createBuffer,createBindGroup:vi.fn(()=>({})),queue:{writeBuffer:vi.fn()},destroy:vi.fn()};(renderer as any).editLayout={};
    const record=terrainRecord([0,0,0],()=>({height:.5,normal:[0,1,0]}),()=>[1,0,0,0,0,0,0,0]),region=[[-.2,.1,.1],[.2,.9,.9]] as [[number,number,number],[number,number,number]];
    renderer.setDamagedMesh(record,[]);const baseline=(renderer as any).damaged.get(record.id);
    renderer.predictSolid(record,[region],[],true);expect((renderer as any).damaged.get(record.id)).toBe(baseline);
    const geometry={material:'terrain',vertices:new Float32Array(48),indices:new Uint32Array([0,1,2])};renderer.predictSolid(record,[region],[geometry]);
    const draw=(renderer as any).damaged.get(record.id);expect(draw).not.toBe(baseline);expect(draw.terrainInstance).toBeDefined();expect(draw.meshes).toHaveLength(1);
    renderer.dispose();
  });
});
