import {afterEach,describe,it,expect,vi} from 'vitest';
import {IslandRenderer} from '../client/renderer';
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
});
