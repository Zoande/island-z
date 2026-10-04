import { describe,expect,it,vi } from 'vitest';
import { readFileSync,readdirSync } from 'node:fs';
import { loadGLB } from '../client/glb';
import { VERTEX_FLOATS } from '../shared/mesh';
describe('exported vegetation assets',()=>{
  it('keeps reduced-detail leaf clusters centered on the same tree',async()=>{
    vi.stubGlobal('fetch',async(url:string)=>new Response(readFileSync(`public${url}`)));
    try {
      for(const name of ['oak-2','birch-4']) {
        const lods=await Promise.all([0,1,2].map(i=>loadGLB(`/models/${name}-lod${i}.glb`)));
        const centers=lods.map(parts=>{
          const mesh=parts.find(p=>p.material.endsWith('foliage'))!,result:number[][]=[];
          for(let i=0;i<mesh.indices.length;i+=6) {
            const ids=[...new Set(mesh.indices.slice(i,i+6))];
            expect(ids).toHaveLength(4);
            result.push([0,1,2].map(axis=>ids.reduce((n,id)=>n+mesh.vertices[id*VERTEX_FLOATS+axis],0)/4));
          }
          return result;
        });
        for(const reduced of centers.slice(1))for(const c of reduced)
          expect(centers[0].some(p=>Math.hypot(p[0]-c[0],p[1]-c[1],p[2]-c[2])<1e-4)).toBe(true);
      }
    }finally{vi.unstubAllGlobals();}
  },15000);
  it('loads every variant and LOD through the constrained shared-material importer',async()=>{
    const materials=new Set(['oak-bark','birch-bark','oak-foliage','birch-foliage','bush-foliage','palm-bark','palm-foliage','palm-dry-foliage','coconut']);
    vi.stubGlobal('fetch',async(url:string)=>new Response(readFileSync(`public${url}`)));
    try {
      const files=readdirSync('public/models').filter(f=>f.endsWith('.glb'));
      expect(files.length).toBe(53);
      for(const file of files) {
        const meshes=await loadGLB(`/models/${file}`);
        expect(meshes.length).toBeGreaterThan(0);
        let height=0;
        for(const mesh of meshes) {
          expect(materials.has(mesh.material)).toBe(true);expect(mesh.vertices.length%VERTEX_FLOATS).toBe(0);
          expect(mesh.vertices.every(Number.isFinite)).toBe(true);expect(mesh.indices.length%3).toBe(0);
          expect(mesh.indices.every(i=>i<mesh.vertices.length/VERTEX_FLOATS)).toBe(true);
          for(let i=1;i<mesh.vertices.length;i+=VERTEX_FLOATS)height=Math.max(height,mesh.vertices[i]);
        }
        expect(height).toBeGreaterThan(file.startsWith('bush')?1:10);
        if(file.startsWith('palm'))expect(meshes.some(m=>m.material==='coconut')).toBe(true);
      }
    }finally{vi.unstubAllGlobals();}
  },15000);
});
