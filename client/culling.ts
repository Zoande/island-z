/** WebGPU's clip depth is [0,1]. All tests include the complete bounding sphere. */
export function frustumPlanes(m:ArrayLike<number>):Float32Array[] {
  const rows=[0,1,2,3].map(r=>[m[r],m[r+4],m[r+8],m[r+12]]);
  const planes=[rows[3].map((v,i)=>v+rows[0][i]),rows[3].map((v,i)=>v-rows[0][i]),rows[3].map((v,i)=>v+rows[1][i]),rows[3].map((v,i)=>v-rows[1][i]),rows[2],rows[3].map((v,i)=>v-rows[2][i])];
  return planes.map(p=>{const len=Math.hypot(p[0],p[1],p[2]);return Float32Array.from(p,v=>v/len);});
}
export function sphereInFrustum(planes:Float32Array[],x:number,y:number,z:number,r:number) {
  // This is called for every candidate chunk and prop. Avoid the callback and
  // iterator created by Array.every in the inner culling loop.
  for(let i=0;i<planes.length;i++) {
    const p=planes[i];
    if(!(p[0]*x+p[1]*y+p[2]*z+p[3]>=-r))return false;
  }
  return true;
}

export interface SpatialChunk {x:number;z:number;level:number}
export interface ChunkNeighborhoods {seamLevels:number[][];supportIndices:number[][]}
/** Build the larger-neighbor levels needed at each tile edge and the nearby
 * tiles used for footprint placement. Preserve source order for support tiles. */
export function indexChunkNeighborhoods(chunks:readonly SpatialChunk[],baseChunk:number,padding=32):ChunkNeighborhoods {
  const byLevel=new Map<number,{index:number;chunk:SpatialChunk}[]>(),byKey=new Map<string,number>();
  let maxLevel=0;
  for(let index=0;index<chunks.length;index++) {
    const chunk=chunks[index];maxLevel=Math.max(maxLevel,chunk.level);
    let level=byLevel.get(chunk.level);if(!level){level=[];byLevel.set(chunk.level,level);}level.push({index,chunk});
    byKey.set(`${chunk.level}:${chunk.x}:${chunk.z}`,index);
  }
  for(const level of byLevel.values())level.sort((a,b)=>a.chunk.x-b.chunk.x||a.chunk.z-b.chunk.z);
  const seamLevels=chunks.map(chunk=>{
    const extent=baseChunk*2**chunk.level,midX=chunk.x+extent/2,midZ=chunk.z+extent/2;
    const neighbors=[chunk.level,chunk.level,chunk.level,chunk.level];
    for(let level=chunk.level+1;level<=maxLevel;level++) {
      const e=baseChunk*2**level;
      const candidates=[
        byKey.get(`${level}:${Math.floor(midX/e)*e}:${chunk.z-e}`),
        byKey.get(`${level}:${chunk.x+extent}:${Math.floor(midZ/e)*e}`),
        byKey.get(`${level}:${Math.floor(midX/e)*e}:${chunk.z+extent}`),
        byKey.get(`${level}:${chunk.x-e}:${Math.floor(midZ/e)*e}`),
      ];
      for(let side=0;side<4;side++) {
        const index=candidates[side];if(index===undefined)continue;
        const other=chunks[index],overlapX=other.x<chunk.x+extent&&other.x+e>chunk.x,overlapZ=other.z<chunk.z+extent&&other.z+e>chunk.z;
        if(side===0&&overlapX&&other.z+e===chunk.z)neighbors[0]=Math.max(neighbors[0],other.level);
        if(side===1&&overlapZ&&other.x===chunk.x+extent)neighbors[1]=Math.max(neighbors[1],other.level);
        if(side===2&&overlapX&&other.z===chunk.z+extent)neighbors[2]=Math.max(neighbors[2],other.level);
        if(side===3&&overlapZ&&other.x+e===chunk.x)neighbors[3]=Math.max(neighbors[3],other.level);
      }
    }
    return neighbors;
  });
  const supportIndices=chunks.map(chunk=>{
    const extent=baseChunk*2**chunk.level,minX=chunk.x-padding,maxX=chunk.x+extent+padding,minZ=chunk.z-padding,maxZ=chunk.z+extent+padding,result:number[]=[];
    for(const [level,list] of byLevel) {
      const otherExtent=baseChunk*2**level,threshold=minX-otherExtent;
      let lo=0,hi=list.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid].chunk.x<=threshold)lo=mid+1;else hi=mid;}
      for(let i=lo;i<list.length&&list[i].chunk.x<maxX;i++) {
        const other=list[i].chunk;
        if(other.z<maxZ&&other.z+otherExtent>minZ)result.push(list[i].index);
      }
    }
    result.sort((a,b)=>a-b);
    return result;
  });
  return {seamLevels,supportIndices};
}
