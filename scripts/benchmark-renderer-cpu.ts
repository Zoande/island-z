import {indexChunkNeighborhoods,type SpatialChunk} from '../client/culling';
import {resolveDrawKeys,selectTiles} from '../client/streaming';

const BASE=64;
function makeChunks() {
  const chunks:SpatialChunk[]=[];
  const split=(x:number,z:number,level:number,seed:number)=>{
    if(level>0&&((seed*37+Math.trunc(x/BASE)*13+Math.trunc(z/BASE)*19)%4!==0)) {
      const half=BASE*2**(level-1);
      split(x,z,level-1,seed+1);split(x+half,z,level-1,seed+2);
      split(x,z+half,level-1,seed+3);split(x+half,z+half,level-1,seed+4);
    } else chunks.push({x,z,level});
  };
  for(let z=-4096;z<4096;z+=1024)for(let x=-4096;x<4096;x+=1024)split(x,z,4,(x+4096)/1024+(z+4096)/1024);
  return chunks;
}
function exhaustive(chunks:SpatialChunk[]) {
  const seamLevels=chunks.map(chunk=>{
    const extent=BASE*2**chunk.level,neighbors=[chunk.level,chunk.level,chunk.level,chunk.level];
    for(const other of chunks) {
      const e=BASE*2**other.level;if(other.level<=chunk.level)continue;
      const overlapX=other.x<chunk.x+extent&&other.x+e>chunk.x,overlapZ=other.z<chunk.z+extent&&other.z+e>chunk.z;
      if(overlapX&&other.z+e===chunk.z)neighbors[0]=Math.max(neighbors[0],other.level);
      if(overlapZ&&other.x===chunk.x+extent)neighbors[1]=Math.max(neighbors[1],other.level);
      if(overlapX&&other.z===chunk.z+extent)neighbors[2]=Math.max(neighbors[2],other.level);
      if(overlapZ&&other.x+e===chunk.x)neighbors[3]=Math.max(neighbors[3],other.level);
    }
    return neighbors;
  });
  const supportIndices=chunks.map(chunk=>{
    const extent=BASE*2**chunk.level,result:number[]=[];
    chunks.forEach((other,index)=>{
      const e=BASE*2**other.level;
      if(other.x<chunk.x+extent+32&&other.x+e>chunk.x-32&&other.z<chunk.z+extent+32&&other.z+e>chunk.z-32)result.push(index);
    });
    return result;
  });
  return {seamLevels,supportIndices};
}
function measure(run:()=>unknown,iterations:number) {
  for(let i=0;i<2;i++)run();
  const start=performance.now();
  for(let i=0;i<iterations;i++)run();
  return (performance.now()-start)/iterations;
}
function liveChunks(size:number,distance:number) {
  const roots=selectTiles(173,-241,size,distance),requests=new Map<string,SpatialChunk>();
  const visit=(nodes:typeof roots)=>{for(const node of nodes){requests.set(node.request.key,node.request);visit(node.children);}};
  visit(roots);
  return resolveDrawKeys(roots,new Set(requests.keys())).map(key=>requests.get(key)!);
}
function runCase(name:string,chunks:SpatialChunk[],iterations:number) {
  const reference=exhaustive(chunks),indexed=indexChunkNeighborhoods(chunks,BASE);
  if(JSON.stringify(indexed)!==JSON.stringify(reference))throw new Error(`${name}: indexed results differ from exhaustive results.`);
  const exhaustiveMs=measure(()=>exhaustive(chunks),iterations),indexedMs=measure(()=>indexChunkNeighborhoods(chunks,BASE),iterations);
  return {name,chunks:chunks.length,iterations,exhaustiveMeanMs:+exhaustiveMs.toFixed(3),indexedMeanMs:+indexedMs.toFixed(3),speedup:+(exhaustiveMs/indexedMs).toFixed(2)};
}
const stress=makeChunks(),low=liveChunks(30720,3000),wide=liveChunks(30720,16000);
console.log(JSON.stringify({benchmark:'renderer chunk-neighborhood preparation',gpu:false,islandSize:30720,cases:[runCase('selectTiles low quality (3000 m)',low,50),runCase('selectTiles wide range (16000 m)',wide,50),runCase('dense mixed-level stress',stress,5)]},null,2));
