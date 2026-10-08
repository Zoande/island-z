import {describe,it,expect} from 'vitest';
import {qualities,type Quality} from '../client/quality';
import {lodEntries} from '../client/lod';
import {IslandRenderer} from '../client/renderer';
describe('graphics presets',()=>{
  it('defaults new renderers to the low graphics preset',()=>{
    const renderer=new IslandRenderer({}as HTMLCanvasElement,{seed:'quality-default-test',islandSizeMeters:128});
    expect(renderer.quality).toBe('low');
    expect(renderer.distance).toBe(qualities.low.distance);
  });
  it('increases shadow resolution, range and geometry retention with quality',()=>{
    const list=[qualities.low,qualities.medium,qualities.high];
    for(let i=1;i<list.length;i++) {
      expect(list[i].shadowSize).toBeGreaterThan(list[i-1].shadowSize);
      expect(list[i].shadowRadius).toBeGreaterThan(list[i-1].shadowRadius);
      expect(list[i].treeLod[2].distance).toBeGreaterThan(list[i-1].treeLod[2].distance);
      expect(list[i].grass).toBeGreaterThan(list[i-1].grass);
    }
    expect(qualities.low.shadowLodOffset).toBe(1);expect(qualities.medium.shadowLodOffset).toBe(0);
    for(const q of list)for(let i=0;i<q.treeLod.length;i++) {
      const b=q.treeLod[i];expect(b.width).toBeGreaterThan(0);
      if(i)expect(b.distance-b.width/2).toBeGreaterThan(q.treeLod[i-1].distance+q.treeLod[i-1].width/2);
      expect(lodEntries(b.distance,q.treeLod)).toHaveLength(2);
    }
  });
  it('recreates shadow resources on preset changes and releases the old pair',()=>{
    const fakeTexture=()=>({destroyed:false,destroy(){this.destroyed=true;},createView(){return {};}}),textures:ReturnType<typeof fakeTexture>[]=[];
    const renderer=new IslandRenderer({}as HTMLCanvasElement,{seed:'quality-test',islandSizeMeters:128})as any;
    renderer.device={createTexture:()=>{const texture=fakeTexture();textures.push(texture);return texture;},createSampler:()=>({}),createBindGroup:()=>({})};
    const previous=(globalThis as any).GPUTextureUsage;
    (globalThis as any).GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4,COPY_SRC:8};
    try {
      for(const quality of ['low','medium','high','medium']as Quality[]) {
        renderer.quality=quality;renderer.updateShadows();expect(renderer.shadowSize).toBe(qualities[quality].shadowSize);
        const count=textures.length;renderer.updateShadows();expect(textures).toHaveLength(count);
      }
      expect(textures).toHaveLength(8);expect(textures.slice(0,-2).every(t=>t.destroyed)).toBe(true);
      expect(textures.slice(-2).every(t=>!t.destroyed)).toBe(true);
    }finally{(globalThis as any).GPUTextureUsage=previous;}
  });
});
