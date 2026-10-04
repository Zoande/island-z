import {describe,it,expect} from 'vitest';
import {mat4} from 'gl-matrix';
import {FrameProfiler} from '../client/performance';
import {frustumPlanes,sphereInFrustum} from '../client/culling';
import {grassMesh,rockMesh,compactVertices,compactIndices} from '../client/geometry';
import {modelBounds,impostorMesh} from '../client/impostors';
import {WorldGenerator} from '../shared/world';
import {VERTEX_FLOATS} from '../shared/mesh';
import {lodEntries,TREE_LOD,rangeFade} from '../client/lod';

describe('performance foundations',()=>{
  it('packs indices losslessly and retains large mesh addressing',()=>{
    const small=new Uint32Array([0,32768,65535]),large=new Uint32Array([0,65536,1]);
    expect(compactIndices(small)).toBeInstanceOf(Uint16Array);
    expect([...compactIndices(small)]).toEqual([...small]);
    expect(compactIndices(large)).toBe(large);
  });
  it('blends LODs continuously and fades distant scenery before its streaming boundary',()=>{
    for(const boundary of TREE_LOD) {
      const before=lodEntries(boundary.distance-boundary.width/2-1e-6,TREE_LOD),after=lodEntries(boundary.distance+boundary.width/2+1e-6,TREE_LOD);
      expect(before).toHaveLength(1);expect(after).toHaveLength(1);expect(after[0].level).toBe(before[0].level+1);
      const middle=lodEntries(boundary.distance,TREE_LOD);expect(middle).toHaveLength(2);
      expect(middle[0].threshold).toBeCloseTo(.5);expect(middle[1].threshold).toBe(middle[0].threshold);
      expect(middle[0].outgoing).toBe(true);expect(middle[1].outgoing).toBe(false);
    }
    expect(rangeFade(65,120)).toBe(1);expect(rangeFade(120,120)).toBe(0);
    for(let d=79;d<120;d++)expect(rangeFade(d+1,120)).toBeLessThanOrEqual(rangeFade(d,120));
  });
  it('preserves the 3x3 filtered shadow kernel when collapsing bilinear taps',()=>{
    const sample=(cells:number[][],x:number,y:number)=>{
      const a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b;
      return (cells[b][a]*(1-fx)+cells[b][a+1]*fx)*(1-fy)+(cells[b+1][a]*(1-fx)+cells[b+1][a+1]*fx)*fy;
    };
    const cells=Array.from({length:8},(_,y)=>Array.from({length:8},(_,x)=>Math.sin(x*3.4+y*7.1)>0?1:0));
    for(let ix=0;ix<20;ix++)for(let iy=0;iy<20;iy++) {
      const x=3+ix/20,y=3+iy/20,f=[ix/20,iy/20],a=f.map(v=>(2-v)/3),b=f.map(v=>(1+v)/3),lo=f.map(v=>-1-v+1/(2-v)),hi=f.map(v=>1-v+v/(1+v));
      let reference=0;for(let u=-1;u<=1;u++)for(let v=-1;v<=1;v++)reference+=sample(cells,x+u,y+v)/9;
      const optimized=sample(cells,x+lo[0],y+lo[1])*a[0]*a[1]+sample(cells,x+hi[0],y+lo[1])*b[0]*a[1]+sample(cells,x+lo[0],y+hi[1])*a[0]*b[1]+sample(cells,x+hi[0],y+hi[1])*b[0]*b[1];
      expect(optimized).toBeCloseTo(reference,12);
    }
  });
  it('keeps bounded frame captures and associates delayed GPU readbacks',()=>{
    const p=new FrameProfiler(()=>({quality:'medium'}));p.start();
    for(let i=0;i<1300;i++){p.begin(20);p.finish({triangles:i});}
    p.gpu(p.frameId!,{opaque:7,total:7});p.gpu(1,{opaque:99});
    const report=p.export();expect(report.frames).toBe(1200);expect(report.fps).toBe(50);
    expect(report.gpu.opaque?.meanMs).toBe(7);expect(report.counters.triangles).toBe(1299);
    p.reset();expect(p.summary().frames).toBe(0);expect(p.summary().fps).toBeNull();p.stop();p.begin(1);p.finish({});expect(p.summary().frames).toBe(0);
  });
  it('culls only completely excluded bounding spheres using WebGPU clip depth',()=>{
    const planes=frustumPlanes(mat4.create());
    expect(sphereInFrustum(planes,0,0,.5,.1)).toBe(true);
    expect(sphereInFrustum(planes,1.1,0,.5,.2)).toBe(true);
    expect(sphereInFrustum(planes,1.3,0,.5,.2)).toBe(false);
    expect(sphereInFrustum(planes,0,0,-.3,.2)).toBe(false);
    expect(sphereInFrustum(planes,0,0,1.3,.2)).toBe(false);
  });
  it('reduces rock and grass geometry while retaining height and a grounded underside',()=>{
    for(let variant=0;variant<12;variant++) {
      const meshes=[0,1,2].map(lod=>rockMesh('island-z',variant,lod));
      expect(meshes[1].indices.length).toBeLessThan(meshes[0].indices.length);
      expect(meshes[2].indices.length).toBeLessThan(meshes[1].indices.length);
      const bottoms=meshes.map(m=>Math.min(...Array.from(m.vertices).filter((_,i)=>i%VERTEX_FLOATS===1)));
      expect(bottoms[1]).toBe(bottoms[0]);expect(bottoms[2]).toBe(bottoms[0]);
      for(const mesh of meshes)expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    }
    for(let variant=0;variant<4;variant++) {
      const meshes=[0,1,2].map(lod=>grassMesh(variant,lod));
      expect(meshes.map(m=>m.indices.length/3)).toEqual([24,16,8]);
      const heights=meshes.map(m=>modelBounds([m]).top);expect(heights[1]).toBe(heights[0]);expect(heights[2]).toBe(heights[0]);
      expect(impostorMesh(modelBounds([meshes[0]]),'test').indices.length).toBe(6);
    }
    const original=grassMesh(1).vertices,compact=compactVertices(original);
    expect(compact.byteLength).toBe(original.byteLength/2);
    for(let i=0;i<compact.length;i++)expect(compact[i]).toBe(original[Math.floor(i/8)*VERTEX_FLOATS+i%8]);
  });
  it('uses identical tree candidates in distant tiles and detailed ecology',()=>{
    const world=new WorldGenerator({seed:'island-z',islandSizeMeters:1024});
    const trees=world.treeProps(-128,-128,256);
    const detailed=world.props(-128,-128,256,false).filter(p=>['oak','birch','palm'].includes(p.kind));
    expect(trees).toEqual(detailed);
    const divided=[[-128,-128],[0,-128],[-128,0],[0,0]].flatMap(([x,z])=>world.treeProps(x,z,128));
    const sorted=(v:typeof trees)=>v.sort((a,b)=>a.x-b.x||a.z-b.z);
    expect(sorted(divided)).toEqual(sorted(trees));
  },15000);
});
