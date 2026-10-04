import { VERTEX_FLOATS, BASE_CHUNK, type ChunkRequest } from './mesh';
import type { WaterNetwork } from './water';
export interface WaterGeometry { vertices: Float32Array; indices: Uint32Array }
/** Clip continuous lake fans and river ribbons to chunk ownership, independent of LOD. */
export function waterGeometry(network: WaterNetwork, request: ChunkRequest): WaterGeometry {
  const vertices: number[] = [], indices: number[] = [], extent = BASE_CHUNK * 2 ** request.level;
  const x0=request.x,z0=request.z,x1=x0+extent,z1=z0+extent;
  const vertex=(x:number,y:number,z:number,u:number,v:number,fx:number,fz:number,kind:number,speed:number,nx=0,nz=0,transitions=[0,0,0,0]):number[]=>
    [x,y,z,nx,1,nz,u,v,fx,fz,kind,speed,...transitions];
  const triangle=(a:number[],b:number[],c:number[])=>{
    let polygon=[a,b,c];
    for(const [axis,bound,sign] of [[0,x0,1],[0,x1,-1],[2,z0,1],[2,z1,-1]]) {
      const clipped:number[][]=[];
      for(let i=0;i<polygon.length;i++) {
        const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=(p[axis]-bound)*sign,dq=(q[axis]-bound)*sign;
        if(dp>=0)clipped.push(p);
        if((dp>=0)!==(dq>=0)) {const t=dp/(dp-dq);clipped.push(p.map((v,k)=>v+(q[k]-v)*t));}
      }
      polygon=clipped;if(polygon.length<3)return;
    }
    const start=vertices.length/VERTEX_FLOATS;
    for(const point of polygon) {const p=point.slice();p[0]-=x0;p[2]-=z0;vertices.push(...p);}
    for(let i=1;i<polygon.length-1;i++) indices.push(start,start+i,start+i+1);
  };
  for(const l of network.lakes) {
    const r=l.radius*1.15;
    if(l.x+r<x0||l.x-r>x1||l.z+r<z0||l.z-r>z1)continue;
    const center=vertex(l.x,l.level,l.z,0,0,0,0,2,0,0,0,[0,1,0,0]),segments=l.radii?.length??80;
    for(let i=0;i<segments;i++) {
      const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments,ra=network.lakeRadius(l,a),rb=network.lakeRadius(l,b);
      triangle(center,vertex(l.x+Math.cos(a)*ra,l.level,l.z+Math.sin(a)*ra,0,1,0,0,2,0,0,0,[0,1,0,0]),
        vertex(l.x+Math.cos(b)*rb,l.level,l.z+Math.sin(b)*rb,0,1,0,0,2,0,0,0,[0,1,0,0]));
    }
  }
  for(const river of network.rivers) for(let i=1;i<river.points.length;i++) {
    const a=river.points[i-1],b=river.points[i],r=Math.max(a.width,b.width);
    if(Math.max(a.x,b.x)+r<x0||Math.min(a.x,b.x)-r>x1||Math.max(a.z,b.z)+r<z0||Math.min(a.z,b.z)-r>z1)continue;
    const direction=(j:number):[number,number,number]=>{
      const p=river.points[Math.max(0,j-1)],q=river.points[Math.min(river.points.length-1,j+1)],length=Math.hypot(q.x-p.x,q.z-p.z);
      let fx=(q.x-p.x)/length,fz=(q.z-p.z)/length,slope=(p.level-q.level)/Math.max(1,q.distance-p.distance);
      if(river.parent!==undefined) {
        const parent=network.rivers[river.parent],join=river.joinIndex!,a=parent.points[Math.max(0,join-1)],b=parent.points[Math.min(parent.points.length-1,join+1)];
        const parentLength=Math.hypot(b.x-a.x,b.z-a.z),blend=river.points[j].junction??0;
        fx=fx*(1-blend)+(b.x-a.x)/parentLength*blend;fz=fz*(1-blend)+(b.z-a.z)/parentLength*blend;
        slope=slope*(1-blend)+(a.level-b.level)/Math.max(1,b.distance-a.distance)*blend;
        const normalized=Math.hypot(fx,fz);fx/=normalized;fz/=normalized;
      }
      return [fx,fz,slope];
    };
    const da=direction(i-1),db=direction(i),length=Math.hypot(b.x-a.x,b.z-a.z),slope=(a.level-b.level)/length;
    const speed=Math.min(3,.35+Math.sqrt(Math.max(0,slope))*5);
    const row=(p:typeof a,d:[number,number,number],side:number)=>vertex(p.x-d[1]*p.width*side,p.level,p.z+d[0]*p.width*side,
      p.phase??p.distance,side,d[0],d[1],1,p.speed??speed,d[0]*d[2],d[1]*d[2],[p.mouth??0,p.lake??0,p.junction??0,p.width]);
    for(const [left,right] of [[-1,0],[0,1]]) {
      const al=row(a,da,left),ar=row(a,da,right),bl=row(b,db,left),br=row(b,db,right);
      triangle(al,bl,ar);triangle(ar,bl,br);
    }
  }
  return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices)};
}
