import {initializeMeshRefinement,refineVolumeMeshes} from '../shared/mesh-refinement';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {treeSolidAssets,recordFor,actionBrush} from '../shared/destruction';
import {rockPoints} from '../shared/rocks';
import {SparseVolume,meshVolume,contourCacheStats} from '../shared/volume';
import {solidComponents} from '../shared/solid-components';
import {collisionBoxes} from '../shared/volume-collision';
await initializeMeshRefinement();
for(const k of ['oak-0','birch-0','palm-0'])treeSolidAssets.set(k,JSON.parse(readFileSync(`public/models/${k}-solid.json`,'utf8')));
const rocks=Array.from({length:12},(_,i)=>rockPoints('island-z',i)),report:any[]=[];
for(const kind of ['wall-wood','wall-stone','floor-wood','rock','oak','birch','palm']as const){
  const record=recordFor(kind,{kind,x:0,y:0,z:0,rotation:0,variant:0,scale:1},rocks),v=new SparseVolume(record.source),start=performance.now();const warm=refineVolumeMeshes(meshVolume(record.source,v.state)),warmMs=performance.now()-start;console.log(kind,'cold',warmMs.toFixed(1),'tris',warm.reduce((n,m)=>n+m.indices.length/3,0));
  const times:number[]=[];for(let i=0;i<4;i++){const origin:[number,number,number]=[0,kind.startsWith('floor')?.1:1,2],hit=v.ray(origin,[0,0,-1],4);if(!hit)break;v.edit(actionBrush(record,hit.point,[0,0,-1],false,i));const t=performance.now();refineVolumeMeshes(meshVolume(record.source,v.state));times.push(performance.now()-t);}
  const at=performance.now(),components=solidComponents(record.source,v.state,kind==='oak'||kind==='birch'||kind==='palm'||kind==='rock'?.05:.025),componentMs=performance.now()-at,b=performance.now(),boxes=collisionBoxes(record.source,v.state,kind==='oak'||kind==='birch'||kind==='palm'?.1:.05),boxMs=performance.now()-b;
  report.push({kind,warmMs,triangles:warm.reduce((n,m)=>n+m.indices.length/3,0),geometryBytes:warm.reduce((n,m)=>n+m.vertices.byteLength+m.indices.byteLength,0),editMeshMs:times,componentMs,components:components.length,boxMs,boxes:boxes.length,cache:contourCacheStats(),heapMb:process.memoryUsage().heapUsed/1048576});console.log(JSON.stringify(report.at(-1)));
}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/destruction-benchmark.json',JSON.stringify(report,null,2));
