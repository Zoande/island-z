import { hash } from './noise';
export interface DrainageGrid {
  x: Float64Array; z: Float64Array; height: Float64Array; coast: Float64Array;
  filled: Float64Array; parent: Int32Array; area: Float64Array; order: number[]; spacing: number;
}
interface Entry { id: number; level: number; distance: number }
export class FloodQueue {
  private items: Entry[] = [];
  private before(a:Entry,b:Entry) {return a.level<b.level || a.level===b.level && (a.distance<b.distance || a.distance===b.distance && a.id<b.id);}
  push(value:Entry) {
    const a=this.items;a.push(value);let i=a.length-1;
    while(i>0) {const p=(i-1)>>1;if(!this.before(value,a[p]))break;a[i]=a[p];i=p;}a[i]=value;
  }
  pop():Entry|undefined {
    const a=this.items;if(!a.length)return undefined;const first=a[0],last=a.pop()!;
    if(a.length) {let i=0;while(i*2+1<a.length) {let child=i*2+1;if(child+1<a.length&&this.before(a[child+1],a[child]))child++;
      if(!this.before(a[child],last))break;a[i]=a[child];i=child;}a[i]=last;}
    return first;
  }
}
/** Temporary, bounded catchment metadata. Priority flooding finds real spill routes
 * through depressions; parent links always lead to sea and cannot form cycles.
 * This samples a coastal corridor, never allocates a terrain grid for the whole island.
 */
export function buildDrainage(seed:number,size:number,angle:number,terrain:(x:number,z:number)=>number,coast:(x:number,z:number)=>number):DrainageGrid {
  const radialX=Math.cos(angle),radialZ=Math.sin(angle),sideX=-radialZ,sideZ=radialX;
  let low=0,high=size*.6;
  for(let i=0;i<32;i++) {const r=(low+high)*.5;if(coast(radialX*r,radialZ*r)>0)low=r;else high=r;}
  const depth=Math.min(15000,size*.56),width=Math.min(6200,size*.28),offshore=Math.min(650,size*.045);
  const rows=97,columns=65,count=rows*columns,du=depth/(rows-1),dv=width/(columns-1);
  const x=new Float64Array(count),z=new Float64Array(count),height=new Float64Array(count),coasts=new Float64Array(count);
  const filled=new Float64Array(count).fill(Infinity),distance=new Float64Array(count).fill(Infinity),parent=new Int32Array(count).fill(-1);
  const closed=new Uint8Array(count),queue=new FloodQueue(),order:number[]=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
    const id=row*columns+col,u=row*du+(row===0?0:(hash(col,row,seed+1)-.5)*du*.20),v=col*dv-width*.5+(hash(col,row,seed+2)-.5)*dv*.20;
    x[id]=radialX*(high+offshore-u)+sideX*v;z[id]=radialZ*(high+offshore-u)+sideZ*v;
    height[id]=terrain(x[id],z[id]);coasts[id]=coast(x[id],z[id]);
    if(coasts[id]<0) {filled[id]=0;distance[id]=0;queue.push({id,level:0,distance:0});}
  }
  let entry:Entry|undefined;
  while((entry=queue.pop())) {
    const id=entry.id;if(closed[id]||entry.level!==filled[id]||entry.distance!==distance[id])continue;
    closed[id]=1;order.push(id);const row=Math.floor(id/columns),col=id%columns;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
      if(!(dx||dz)||col+dx<0||col+dx>=columns||row+dz<0||row+dz>=rows)continue;
      const next=(row+dz)*columns+col+dx;if(closed[next])continue;
      const level=Math.max(entry.level,height[next]-.16,0),travel=entry.distance+Math.hypot(x[next]-x[id],z[next]-z[id]);
      if(level<filled[next] || level===filled[next] && travel<distance[next]) {
        filled[next]=level;distance[next]=travel;parent[next]=id;queue.push({id:next,level,distance:travel});
      }
    }
  }
  const area=new Float64Array(count);
  for(const id of order)area[id]=coasts[id]>0?1:0;
  for(let i=order.length-1;i>=0;i--) {const id=order[i];if(parent[id]>=0)area[parent[id]]+=area[id];}
  return {x,z,height,coast:coasts,filled,parent,area,order,spacing:Math.max(du,dv)};
}
export function drainagePath(grid:DrainageGrid,start:number,stop?:Set<number>):number[] {
  const result:number[]=[];let id=start;
  while(id>=0 && result.length<grid.parent.length) {result.push(id);if(stop?.has(id)||grid.coast[id]<-30)break;id=grid.parent[id];}
  return result;
}
