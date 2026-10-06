import {describe,it,expect} from 'vitest';
import {solidSource,SparseVolume,meshVolume,encodeContourTemplate,installContourTemplate,meshVolumeRegion,brushRegion,type EditBrush} from '../shared/volume';
import {initializeMeshRefinement,refineVolumeMeshes,mergeVolumeMeshes,collisionSurfaceMeshes} from '../shared/mesh-refinement';
import {simplifyPlanar} from '../shared/planar-mesh';
const source=solidSource([{type:'box',center:[0,.3,0],half:[.3,.3,.11],material:'wall-wood'}]);
const cut:EditBrush={center:[0,.3,.11],axis:[0,0,-1],radius:.12,depth:.1,seed:31};
describe('shared sparse solid editing',()=>{
  it('extracts a cut locally without preparing the full solid, and restores the same region',()=>{
    const v=new SparseVolume(source,undefined,true),region=brushRegion(cut);v.edit(cut);const mesh=meshVolumeRegion(source,v.state,region);expect(mesh.reduce((n,m)=>n+m.indices.length,0)).toBeGreaterThan(0);
    for(const m of mesh)for(let i=0;i<m.vertices.length;i+=16)for(let k=0;k<3;k++){expect(m.vertices[i+k]).toBeGreaterThanOrEqual(region[0][k]-1e-6);expect(m.vertices[i+k]).toBeLessThanOrEqual(region[1][k]+1e-6);}
    // A shallow recess has a real inward surface; it is not a colored decal.
    expect(mesh.some(m=>{for(let i=0;i<m.vertices.length;i+=16)if(m.vertices[i+2]<.09&&m.vertices[i+2]>.001)return true;return false;})).toBe(true);
    v.edit({...cut,depth:.4},true);expect(meshVolumeRegion(source,v.state,region).every(m=>[...m.vertices].every(Number.isFinite))).toBe(true);expect(v.distance([0,.3,.08])).toBeLessThan(0);
  });
  it('keeps local branch bounds culling identical to the uncached solid field',()=>{
    const tree=solidSource(Array.from({length:20},(_,i)=>({type:'capsule' as const,a:[i*.1,i*.2,0]as [number,number,number],b:[i*.1+.3,i*.2+2,.4]as [number,number,number],r0:.3,r1:.12,material:'oak-bark'}))),local=new SparseVolume(tree,undefined,true),ordinary=new SparseVolume(tree);
    for(let z=-1;z<1;z+=.17)for(let y=-.3;y<6;y+=.19)for(let x=-1;x<3;x+=.23)expect(local.sample(Math.round(x/.025),Math.round(y/.025),Math.round(z/.025))).toBe(ordinary.sample(Math.round(x/.025),Math.round(y/.025),Math.round(z/.025)));
  });
  it('keeps cached tree patches stitched across tile boundaries and transfers mesh ownership safely',async()=>{
    await initializeMeshRefinement();const tree=solidSource([{type:'capsule',a:[0,0,0],b:[0,4,0],r0:.24,r1:.18,material:'oak-bark'}]),v=new SparseVolume(tree);v.edit({center:[.22,2,0],axis:[-1,0,0],radius:.12,depth:.12,seed:4});
    const patches=meshVolume(tree,v.state),meshes=mergeVolumeMeshes(refineVolumeMeshes(patches)),edges=new Map<string,number>();
    for(const m of meshes){const p=(id:number)=>[0,1,2].map(k=>Math.round(m.vertices[id*16+k]*1e6)).join(':');for(let i=0;i<m.indices.length;i+=3)for(let j=0;j<3;j++){const a=p(m.indices[i+j]),b=p(m.indices[i+(j+1)%3]);if(a===b)continue;const key=[a,b].sort().join('/');edges.set(key,(edges.get(key)??0)+1);}}
    expect([...edges.values()].every(n=>n===2)).toBe(true);const collider=collisionSurfaceMeshes(meshes);expect(collider[0].indices.length).toBeLessThan(meshes.reduce((n,m)=>n+m.indices.length,0));const bytes=encodeContourTemplate(tree);installContourTemplate(tree,bytes);const copied=mergeVolumeMeshes(refineVolumeMeshes(meshVolume(tree,v.state))),size=copied.reduce((n,m)=>n+m.vertices.byteLength,0);
    structuredClone(copied,{transfer:copied.flatMap(m=>[m.vertices.buffer,m.indices.buffer])});expect(mergeVolumeMeshes(refineVolumeMeshes(meshVolume(tree,v.state))).reduce((n,m)=>n+m.vertices.byteLength,0)).toBe(size);
  });
  it('loads prepared contours without changing deterministic cut geometry and rejects outdated sources',()=>{
    const bytes=encodeContourTemplate(source),v=new SparseVolume(source);v.edit(cut);const before=meshVolume(source,v.state);installContourTemplate(source,bytes);
    const after=meshVolume(source,v.state);expect(after.map(m=>[...m.vertices])).toEqual(before.map(m=>[...m.vertices]));expect(after.map(m=>[...m.indices])).toEqual(before.map(m=>[...m.indices]));
    expect(()=>installContourTemplate({...source,primitives:[]},bytes)).toThrow('Outdated');
  });
  it('handles large fallback mesh patches without exceeding the JavaScript argument limit',()=>{
    const vertices=[0,0,0,1,0,0,0,1,0,-1,0,0,0,-1,0].flatMap((_,i,a)=>i%3?[]:[a[i],a[i+1],a[i+2],0,0,1,0,0,0,0,0,0,0,0,0,0]);
    const indices=Array.from({length:30000},()=>[0,1,2,0,3,4]).flat();
    // Two disconnected faces sharing one vertex cannot be retriangulated as a
    // single boundary. Retaining this large patch must not use push(...array).
    expect(simplifyPlanar(vertices,indices)).toEqual(indices);
  });
  it('makes shallow damage, bores a real passage, and repairs to the original source',()=>{
    const v=new SparseVolume(source);expect(v.edit(cut)).toBe(true);expect(v.distance([0,.3,.08])).toBeGreaterThan(0);expect(v.distance([0,.3,-.05])).toBeLessThan(0);
    for(let i=0;i<4;i++){const hit=v.ray([0,.3,.5],[0,0,-1],1);if(hit)v.edit({...cut,center:hit.point});}expect(v.ray([0,.3,.5],[0,0,-1],1)).toBeNull();
    v.edit({...cut,depth:.4,center:[0,.3,.12]},true);expect(v.distance([0,.3,0])).toBeLessThan(0);
  });
  it('owns samples across negative brick boundaries and clones without mutating snapshots',()=>{
    const a=new SparseVolume(source);a.edit(cut);const snapshot=JSON.stringify(a.state),b=new SparseVolume(source,a.state);b.edit({...cut,center:[-.2,.2,.11]});expect(JSON.stringify(a.state)).toBe(snapshot);const c=new SparseVolume(source,JSON.parse(JSON.stringify(b.state)));for(const p of [[-.2,.2,0],[.01,.3,.1],[0,0,0]]as [number,number,number][])expect(c.distance(p)).toBe(b.distance(p));
  });
  it('meshes finite outward surfaces and retains material ownership',()=>{
    const v=new SparseVolume(source);v.edit(cut);const meshes=meshVolume(source,v.state);expect(meshes).toHaveLength(1);expect(meshes[0].material).toBe('wall-wood');expect(meshes[0].indices.length).toBeGreaterThan(100);expect([...meshes[0].vertices].every(Number.isFinite)).toBe(true);expect(Math.max(...meshes[0].indices)).toBeLessThan(meshes[0].vertices.length/16);
  });
  it('keeps closed manifold edges and deterministic meshing after planar simplification',()=>{
    const v=new SparseVolume(source);v.edit({...cut,depth:.4});const a=meshVolume(source,v.state),b=meshVolume(JSON.parse(JSON.stringify(source)),JSON.parse(JSON.stringify(v.state)));
    expect(a.map(m=>[...m.indices])).toEqual(b.map(m=>[...m.indices]));expect(a.map(m=>[...m.vertices])).toEqual(b.map(m=>[...m.vertices]));
    const edges=new Map<string,number>();for(const mesh of a){const point=(i:number)=>[0,1,2].map(k=>Math.round(mesh.vertices[i*16+k]*1e6)).join(':');for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const x=point(mesh.indices[i+j]),y=point(mesh.indices[i+(j+1)%3]);if(x===y)continue;const key=[x,y].sort().join('/');edges.set(key,(edges.get(key)??0)+1);}}
    expect([...edges.values()].every(n=>n===2)).toBe(true);
  });
  it('refines surfaces without opening the shell or filling a cut',async()=>{await initializeMeshRefinement();const v=new SparseVolume(source);v.edit({...cut,depth:.4});const original=meshVolume(source,v.state),meshes=refineVolumeMeshes(original),edges=new Map<string,number>();for(const m of meshes){const p=(id:number)=>[0,1,2].map(k=>Math.round(m.vertices[id*16+k]*1e6)).join(':');for(let i=0;i<m.indices.length;i+=3)for(let j=0;j<3;j++){const a=p(m.indices[i+j]),b=p(m.indices[i+(j+1)%3]);if(a===b)continue;const key=[a,b].sort().join('/');edges.set(key,(edges.get(key)??0)+1);}}expect([...edges.values()].every(n=>n===2)).toBe(true);expect(meshes.reduce((n,m)=>n+m.indices.length,0)).toBeLessThan(original.reduce((n,m)=>n+m.indices.length,0));expect(v.ray([0,.3,.5],[0,0,-1],1)).toBeNull();});
});
