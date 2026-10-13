import {describe,it,expect} from 'vitest';
import {terrainRecord,terrainMeshes} from '../shared/terrain-volume';
import {SparseVolume,type EditBrush} from '../shared/volume';
import type {Point3} from '../shared/rocks';

describe('terrain mining preview geometry',()=>{
  it('keeps the visible cut seam identical across neighboring cell meshes',()=>{
    const surface=(x:number,z:number)=>({height:.5,normal:[0,1,0]as Point3}),weights=()=>[1,0,0,0,0,0,0,0],records=[[0,0,0],[1,0,0]].map(p=>terrainRecord(p as Point3,surface,weights));
    const brush:EditBrush={center:[1,.5,.5],axis:[0,-1,0],radius:.32,depth:.4,seed:913,noiseOrigin:[0,0,0]};
    const meshes=records.map(record=>{const origin:[number,number,number]=[record.prop.x,record.prop.y,record.prop.z],local={...brush,center:brush.center.map((v,k)=>v-origin[k])as Point3,noiseOrigin:origin},volume=new SparseVolume(record.source,record.volume,true);volume.edit(local);return terrainMeshes(record.source,volume.state);});
    const edge=(level:number)=>[...new Set(meshes[level].flatMap(m=>{const out:string[]=[];for(let i=0;i<m.vertices.length;i+=16)if(Math.abs(m.vertices[i]+records[level].prop.x-1)<1e-5)out.push([m.vertices[i+1]+records[level].prop.y,m.vertices[i+2]+records[level].prop.z].map(v=>Math.round(v*1e5)).join(':'));return out;}))].sort();
    expect(edge(0).length).toBeGreaterThan(0);
    expect(edge(1)).toEqual(edge(0));
    expect(meshes.flat().every(m=>[...m.vertices].every(Number.isFinite))).toBe(true);
    for(const mesh of meshes.flat())for(let i=0;i<mesh.vertices.length;i+=16)expect(mesh.vertices.slice(i+8,i+16).reduce((sum,v)=>sum+v,0)).toBeCloseTo(1,5);
  });
});
