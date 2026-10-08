import {describe,it,expect} from 'vitest';
import {WorldGenerator} from '../shared/world';
import {BuildScene} from '../shared/build-scene';
import {SparseVolume,primitiveDistance,brushDistance,type EditBrush} from '../shared/volume';
import {actionBrush,localPoint,type SolidRecord} from '../shared/destruction';
import {terrainCutCells,terrainRecord,shadeTerrainMeshes} from '../shared/terrain-volume';
import {collisionBoxes} from '../shared/volume-collision';
import {encodeMessage,decodeMessage} from '../shared/network';
import type {Point3} from '../shared/rocks';
import {safeSpawn} from '../shared/spawn';

const grass=()=>[0,1,0,0,0,0,0,0];
function sceneWithHeight(height:(x:number,z:number)=>number){
  const world=new WorldGenerator({seed:'mining-tests',islandSizeMeters:128});
  world.height=height;world.props=()=>[];world.sample=(x,z)=>({height:height(x,z),normal:[0,1,0],forest:0,weights:[0,1,0,0,0,0,0,0]});
  return new BuildScene(world);
}
function cut(scene:BuildScene,point:Point3,brush:EditBrush):SolidRecord[]{
  const root=scene.terrainRecord(point),origin=[root.prop.x,root.prop.y,root.prop.z],center=brush.center.map((v,k)=>v+origin[k])as Point3;
  const records=terrainCutCells(root,brush).map(p=>scene.terrainRecord(p));
  for(const r of records){const volume=new SparseVolume(r.source,r.volume,true),b={...brush,center:localPoint(r,center),noiseOrigin:[r.prop.x,r.prop.y,r.prop.z]as Point3};volume.edit(b);scene.applyRecord({...r,volume:volume.state,revision:r.revision+1});}
  return records.map(r=>scene.edits.get(r.id)!);
}
describe('sparse terrain mining',()=>{
  it('follows local mountain triangles instead of a global grass/stone altitude',()=>{
    const scene=sceneWithHeight((x,z)=>300+.5*x+.25*z),point:Point3=[-1.25,299,-3.5],r=scene.terrainRecord(point),field=r.source.primitives[0];
    for(const [x,z]of [[-1.2,-3.4],[-.8,-3.1]]){const h=scene.terrain(x,z).height;expect(primitiveDistance(localPoint(r,[x,h,z]),field)).toBeCloseTo(0,6);expect(primitiveDistance(localPoint(r,[x,h-4,z]),field)).toBeLessThan(0);expect(primitiveDistance(localPoint(r,[x,h+.5,z]),field)).toBeGreaterThan(0);}
    expect(r.prop.kind).toBe('terrain');expect(r.source.bounds).toEqual([[0,0,0],[1,1,1]]);expect(scene.edits.size).toBe(0);
  });
  it('uses identical cuts and seeded roughness across ownership faces',()=>{
    const scene=sceneWithHeight(()=>.7),point:Point3=[1,.7,.5],r=scene.terrainRecord(point),brush=actionBrush(r,point,[0,-1,0],false,73),records=cut(scene,point,brush);
    const left=records.find(r=>r.prop.x===0&&r.prop.y===0&&r.prop.z===0)!,right=records.find(r=>r.prop.x===1&&r.prop.y===0&&r.prop.z===0)!;
    for(const p of [[.975,.4,.5],[1,.4,.5],[1.025,.4,.5]]as Point3[]){const a=new SparseVolume(left.source,left.volume,true).distance(localPoint(left,p)),b=new SparseVolume(right.source,right.volume,true).distance(localPoint(right,p));expect(a).toBeCloseTo(b,5);expect(a).toBeGreaterThan(0);}
    const p:Point3=[1,.4,.82],a={...brush,center:localPoint(left,point),noiseOrigin:[left.prop.x,left.prop.y,left.prop.z]as Point3},b={...brush,center:localPoint(right,point),noiseOrigin:[right.prop.x,right.prop.y,right.prop.z]as Point3};expect(brushDistance(localPoint(left,p),a)).toBeCloseTo(brushDistance(localPoint(right,p),b),8);
  });
  it('targets and supports the excavated floor while leaving nearby ground intact',()=>{
    const scene=sceneWithHeight(()=>.7),point:Point3=[.5,.7,.5],root=scene.terrainRecord(point);cut(scene,point,actionBrush(root,point,[0,-1,0],false,2));
    const floor=scene.groundSurface(.5,.5,.7);expect(floor.height).toBeCloseTo(.3,2);expect(floor.normal[1]).toBeGreaterThan(.95);expect(scene.groundSurface(2,2).height).toBeCloseTo(.7);
    expect(scene.standingHeight(.5,.5,.3)).toBeCloseTo(.3,2);const hit=scene.raycast([.5,1.5,.5],[0,-1,0],4,false,true);expect(hit?.point[1]).toBeCloseTo(.3,2);expect(hit?.solid?.prop.kind).toBe('terrain');
    expect(scene.raycast([.5,1.5,.5],[0,-1,0],4)?.solid).toBeUndefined();
  });
  it('keeps a tunnel roof and selects its lower floor rather than the hillside above',()=>{
    const scene=sceneWithHeight(()=>1.7),point:Point3=[.5,.5,.5];cut(scene,point,{center:point,axis:[0,1,0],radius:0,depth:0,seed:0,box:[.26,.3,.26]});
    expect(scene.groundDistance([.5,.5,.5])).toBeGreaterThan(0);expect(scene.groundDistance([.5,1.2,.5])).toBeLessThan(0);expect(scene.groundSurface(.5,.5,.2).height).toBeCloseTo(.2,2);expect(scene.groundSurface(.5,.5).height).toBeCloseTo(1.7);expect(safeSpawn(scene,[.5,.2,.5],[],true)[1]).toBeCloseTo(.2,2);
    const side=scene.raycast([.5,.5,.5],[1,0,0],1,false,true);expect(side?.point[0]).toBeCloseTo(.76,2);
  });
  it('cooks only the ownership cell, with empty space retained in colliders',()=>{
    const r=terrainRecord([.5,.5,.5],()=>({height:.7,normal:[0,1,0]}),grass),v=new SparseVolume(r.source);v.edit({center:[.5,.5,.5],axis:[0,0,1],radius:0,depth:0,seed:0,box:[.2,.2,.2]});
    const boxes=collisionBoxes(r.source,v.state,.1);expect(boxes.length).toBeGreaterThan(0);
    for(const b of boxes){for(let k=0;k<3;k++){expect(b.center[k]-b.half[k]).toBeGreaterThanOrEqual(-1e-6);expect(b.center[k]+b.half[k]).toBeLessThanOrEqual(1+1e-6);}expect(b.center.some((n,k)=>Math.abs(n-.5)>=b.half[k]-.001)).toBe(true);}
  });
  it('shows grass at the local surface and stone inside a high mountain',()=>{
    const r=terrainRecord([.5,300,.5],()=>({height:300.7,normal:[0,1,0]}),grass),vertices=new Float32Array(32);vertices.set([.5,.7,.5,0,1,0]);vertices.set([.5,.3,.5,0,1,0],16);
    const mesh=shadeTerrainMeshes(r.source,[{material:'terrain',vertices,indices:new Uint32Array()}])[0];expect(mesh.vertices[9]).toBeCloseTo(1);expect(mesh.vertices[16+11]).toBeCloseTo(1);expect(mesh.vertices[16+9]).toBeCloseTo(0);
  });
  it('retains terrain metadata and typed voxel samples through the network/journal codec',()=>{
    const r=terrainRecord([.5,.5,.5],()=>({height:.7,normal:[0,1,0]}),grass);r.volume.bricks['0:0:0']=new Int16Array([1,-2,3]);const decoded=decodeMessage(encodeMessage({record:r}))as {record:SolidRecord};expect(decoded.record).toEqual(r);expect(decoded.record.volume.bricks['0:0:0']).toBeInstanceOf(Int16Array);
  });
});
