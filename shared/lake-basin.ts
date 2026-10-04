import { FloodQueue } from './drainage';
/** Find the lowest escape saddle around a local depression. Sampling and queue
 * storage stay bounded regardless of island size. An open slope returns its own
 * floor height and cannot become a suspended lake. */
export function basinSpill(x:number,z:number,extent:number,terrain:(x:number,z:number)=>number):number {
  const side=65,center=32,step=extent/center,count=side*side;
  const heights=new Float64Array(count).fill(NaN),levels=new Float64Array(count).fill(Infinity),closed=new Uint8Array(count);
  const point=(id:number):[number,number]=>[x+(id%side-center)*step,z+(Math.floor(id/side)-center)*step];
  const height=(id:number)=>{if(Number.isNaN(heights[id])) {const [px,pz]=point(id);heights[id]=terrain(px,pz);}return heights[id];};
  const start=center*side+center,queue=new FloodQueue();levels[start]=height(start);queue.push({id:start,level:levels[start],distance:0});
  let entry;
  while((entry=queue.pop())) {
    const id=entry.id;if(closed[id]||entry.level!==levels[id])continue;closed[id]=1;
    const col=id%side,row=Math.floor(id/side);
    if(col===0||col===side-1||row===0||row===side-1)return entry.level;
    const [px,pz]=point(id);
    for(const next of [id-1,id+1,id-side,id+side]) {
      if(closed[next])continue;
      const [nx,nz]=point(next),edge=terrain((px+nx)/2,(pz+nz)/2);
      const level=Math.max(entry.level,height(next),edge);
      if(level<levels[next]) {levels[next]=level;queue.push({id:next,level,distance:0});}
    }
  }
  return levels[start];
}
