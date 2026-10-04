import { describe,expect,it } from 'vitest';
import { WorldGenerator } from '../shared/world';
import { waterGeometry } from '../shared/water-mesh';
import { VERTEX_FLOATS } from '../shared/mesh';
import { buildDrainage, drainagePath } from '../shared/drainage';
describe('surface water',()=>{
  it.each(['island-z','silver-coast','test-42'].flatMap(seed=>[1024,30720,61440].map(size=>({seed,size}))))
    ('is deterministic with downhill rivers and finite beds for $seed / $size',({seed,size})=>{
      const world=new WorldGenerator({seed,islandSizeMeters:size}),second=new WorldGenerator({seed,islandSizeMeters:size});
      expect(world.water.lakes).toEqual(second.water.lakes);expect(world.water.rivers).toEqual(second.water.rivers);
      expect(world.water.metadataSize.segments).toBeLessThan(9800);
      expect(world.water.metadataSize.bins).toBeLessThan(30000);
      if(size>=30720) {expect(world.water.rivers.length).toBeGreaterThan(0);expect(world.water.lakes.length).toBeGreaterThan(0);}
      for(const river of world.water.rivers)for(let i=1;i<river.points.length;i++) {
        const p=river.points[i],a=river.points[i-1];
        expect(p.level).toBeLessThanOrEqual(a.level);expect(p.distance).toBeGreaterThan(a.distance);
        expect(Number.isFinite(world.height(p.x,p.z))).toBe(true);
        expect(world.height(p.x,p.z)).toBeLessThan(p.level);
        if((p.lake??0)>.999) {
          const matching=world.water.lakes.filter(l=>Math.hypot(p.x-l.x,p.z-l.z)<world.water.lakeRadius(l,Math.atan2(p.z-l.z,p.x-l.x)));
          expect(matching.some(l=>Math.abs(p.level-l.level)<.01)).toBe(true);
        }
      }
      for(let i=0;i<50;i++) {
        const x=(i*997%size)-size/2,z=(i*719%size)-size/2;
        if(!world.water.sample(x,z))expect(world.height(x,z)).toBe(world.terrainHeight(x,z));
      }
  },15000); // Each case builds two networks and verifies every river sample.
  it('routes catchments through basin spillways without cycles or lost contributing area',()=>{
    const coast=(x:number,z:number)=>4000-Math.hypot(x,z);
    const terrain=(x:number,z:number)=>{
      const radius=Math.hypot(x,z),basin=Math.exp(-((x-2200)**2+z*z)/600000);
      return Math.max(-10,(4000-radius)*.04)-basin*100;
    };
    const grid=buildDrainage(73,10000,0,terrain,coast);
    expect(grid.order.length).toBe(grid.parent.length);
    let filledBasins=0,discharged=0;
    for(const id of grid.order) {
      if(grid.filled[id]-grid.height[id]>10&&grid.coast[id]>0)filledBasins++;
      const parent=grid.parent[id];
      if(parent>=0) {
        expect(grid.filled[parent]).toBeLessThanOrEqual(grid.filled[id]);
        expect(grid.area[parent]).toBeGreaterThanOrEqual(grid.area[id]);
      } else discharged+=grid.area[id];
    }
    expect(filledBasins).toBeGreaterThan(0);
    expect(discharged).toBe(grid.coast.filter(c=>c>0).length);
    for(const id of grid.order.filter((_,i)=>i%113===0)) {
      const path=drainagePath(grid,id);
      expect(new Set(path).size).toBe(path.length);
      expect(grid.coast[path.at(-1)!]).toBeLessThan(0);
    }
  });
  it('connects wide main rivers to the ocean and tributaries to matching receiving water',()=>{
    const world=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
    expect(world.water.rivers.filter(r=>r.kind==='main').length).toBe(4);
    expect(world.water.rivers.filter(r=>r.kind==='tributary').length).toBeGreaterThanOrEqual(8);
    expect(world.water.lakes.some(l=>l.radii&&Math.sqrt(l.radii.reduce((n,r)=>n+r*r,0)/l.radii.length)>500)).toBe(true);
    for(let index=0;index<world.water.rivers.length;index++) {
      const river=world.water.rivers[index],end=river.points.at(-1)!;
      if(river.outlet==='ocean') {
        expect(world.coastDistance(end.x,end.z)).toBeLessThan(-30);
        expect(end.level).toBe(0);expect(end.mouth).toBe(1);
        expect(Math.max(...river.points.map(p=>p.width))*2).toBeGreaterThan(100);
      } else {
        expect(river.parent).toBeLessThan(index);
        const target=world.water.rivers[river.parent!].points[river.joinIndex!];
        expect([end.x,end.z,end.level,end.phase,end.speed]).toEqual([target.x,target.z,target.level,target.phase,target.speed]);
        expect(end.junction).toBe(1);
      }
      for(const p of river.points.filter(p=>(p.lake??0)>.999)) {
        const matching=world.water.lakes.filter(l=>Math.hypot(p.x-l.x,p.z-l.z)<world.water.lakeRadius(l,Math.atan2(p.z-l.z,p.x-l.x)));
        expect(matching.some(l=>Math.abs(p.level-l.level)<.01)).toBe(true);
      }
    }
  });
  it('clips lake and river meshes to chunk ownership with matching border elevations',()=>{
    const world=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
    for(const center of [...world.water.lakes,...world.water.rivers.map(r=>r.points[Math.floor(r.points.length/2)])]) {
      const x=Math.floor(center.x/64)*64,z=Math.floor(center.z/64)*64;
      const a=waterGeometry(world.water,{key:'a',x,z,level:0}),b=waterGeometry(world.water,{key:'b',x:x+64,z,level:0});
      for(const mesh of [a,b]) {
        expect(mesh.vertices.every(Number.isFinite)).toBe(true);
        expect(mesh.indices.every(i=>i<mesh.vertices.length/VERTEX_FLOATS)).toBe(true);
        for(let i=0;i<mesh.vertices.length;i+=VERTEX_FLOATS) {
          expect(mesh.vertices[i]).toBeGreaterThanOrEqual(-.001);expect(mesh.vertices[i]).toBeLessThanOrEqual(64.001);
          expect(mesh.vertices[i+2]).toBeGreaterThanOrEqual(-.001);expect(mesh.vertices[i+2]).toBeLessThanOrEqual(64.001);
        }
      }
      const edge=(mesh:typeof a,border:number)=>{const result:string[]=[];for(let i=0;i<mesh.vertices.length;i+=VERTEX_FLOATS)if(Math.abs(mesh.vertices[i]-border)<.001)result.push(`${mesh.vertices[i+1].toFixed(3)}/${mesh.vertices[i+2].toFixed(3)}`);return [...new Set(result)].sort();};
      expect(edge(a,64)).toEqual(edge(b,0));
    }
  });
  it('keeps vegetation out of submerged inland channels and places palms only on suitable coasts',()=>{
    const world=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
    for(const lake of world.water.lakes)for(const p of world.props(lake.x-64,lake.z-64,128)) {
      const water=world.water.sample(p.x,p.z);
      if(water&&water.bank>.25)expect(world.height(p.x,p.z)).toBeGreaterThanOrEqual(water.level);
    }
    let palms=0;
    for(let angle=0;angle<Math.PI*2;angle+=.13) {
      let low=0,high=15360;
      for(let i=0;i<25;i++) {const r=(low+high)/2;if(world.coastDistance(Math.cos(angle)*r,Math.sin(angle)*r)>100)low=r;else high=r;}
      const x=Math.cos(angle)*low,z=Math.sin(angle)*low;
      for(const p of world.props(x-64,z-64,128,false))if(p.kind==='palm') {
        palms++;expect(world.coastDistance(p.x,p.z)).toBeGreaterThan(35);expect(world.coastDistance(p.x,p.z)).toBeLessThan(240);
        expect(world.sample(p.x,p.z).normal[1]).toBeGreaterThan(.97);expect(p.variant).toBeLessThan(3);
      }
    }
    expect(palms).toBeGreaterThan(0);
  });
});
