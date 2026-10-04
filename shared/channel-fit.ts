import type { River, RiverPoint } from './water';
/** One channel network: water stays below both banks, crossings share a plane,
 * and lowering a tributary propagates through the receiving downstream channel. */
export function fitChannels(rivers:River[],terrain:(x:number,z:number)=>number):void {
  const joins=rivers.map(r=>r.parent===undefined?undefined:rivers[r.parent].points[r.joinIndex!]);
  for(const river of rivers)for(let i=0;i<river.points.length;i++) {
    const p=river.points[i],a=river.points[Math.max(0,i-1)],b=river.points[Math.min(river.points.length-1,i+1)],length=Math.hypot(b.x-a.x,b.z-a.z);
    p.basinLevel=p.level;
    let cap=terrain(p.x,p.z)-.18;
    for(const side of [-1,-.5,.5,1]) {
      const offset=(p.width+Math.max(3,p.width*.12))*side;
      cap=Math.min(cap,terrain(p.x-(b.z-a.z)/length*offset,p.z+(b.x-a.x)/length*offset)-.18);
    }
    p.bankCap=Math.max(0,cap);p.level=Math.min(p.level,p.bankCap);
  }
  interface Segment {river:number;index:number;a:RiverPoint;b:RiverPoint}
  const bins=new Map<string,Segment[]>(),crossings:[RiverPoint,RiverPoint][]=[];
  const insertions=rivers.map(()=>new Map<number,{t:number;p:RiverPoint}[]>());
  const at=(s:Segment,t:number):RiverPoint=>{
    if(t<.00001)return s.a;if(t>.99999)return s.b;
    const list=insertions[s.river].get(s.index)??[];
    const old=list.find(v=>Math.abs(v.t-t)<.00001);if(old)return old.p;
    const p={}as RiverPoint;
    for(const key of Object.keys(s.a)as (keyof RiverPoint)[])p[key]=(s.a[key]??0)*(1-t)+(s.b[key]??0)*t;
    list.push({t,p});insertions[s.river].set(s.index,list);return p;
  };
  for(let river=0;river<rivers.length;river++)for(let index=1;index<rivers[river].points.length;index++) {
    const a=rivers[river].points[index-1],b=rivers[river].points[index],s={river,index,a,b},seen=new Set<Segment>();
    for(let z=Math.floor(Math.min(a.z,b.z)/128);z<=Math.floor(Math.max(a.z,b.z)/128);z++)for(let x=Math.floor(Math.min(a.x,b.x)/128);x<=Math.floor(Math.max(a.x,b.x)/128);x++) {
      const key=`${x}:${z}`,near=bins.get(key)??[];
      for(const other of near) {
        if(seen.has(other)||other.river===river&&Math.abs(other.index-index)<3)continue;seen.add(other);
        const dx=b.x-a.x,dz=b.z-a.z,ex=other.b.x-other.a.x,ez=other.b.z-other.a.z,den=dx*ez-dz*ex;
        if(Math.abs(den)<1e-8)continue;
        const ox=other.a.x-a.x,oz=other.a.z-a.z,t=(ox*ez-oz*ex)/den,u=(ox*dz-oz*dx)/den;
        if(t>=0&&t<=1&&u>=0&&u<=1)crossings.push([at(s,t),at(other,u)]);
      }
      near.push(s);bins.set(key,near);
    }
  }
  for(let r=0;r<rivers.length;r++) {
    const points:RiverPoint[]=[rivers[r].points[0]];
    for(let i=1;i<rivers[r].points.length;i++) {
      points.push(...(insertions[r].get(i)??[]).sort((a,b)=>a.t-b.t).map(v=>v.p),rivers[r].points[i]);
    }
    rivers[r].points=points;
    if(joins[r])rivers[r].joinIndex=rivers[rivers[r].parent!].points.indexOf(joins[r]!);
  }
  // Insertion into a later parent also changes indices: resolve after all arrays.
  rivers.forEach((r,i)=>{if(joins[i])r.joinIndex=rivers[r.parent!].points.indexOf(joins[i]!);});
  const queue:RiverPoint[]=[],downstream=new Map<RiverPoint,RiverPoint[]>();
  const link=(a:RiverPoint,b:RiverPoint)=>{const list=downstream.get(a)??[];list.push(b);downstream.set(a,list);};
  for(const r of rivers) {queue.push(...r.points);for(let i=1;i<r.points.length;i++)link(r.points[i-1],r.points[i]);}
  for(const [a,b]of crossings) {link(a,b);link(b,a);}
  rivers.forEach((r,i)=>{if(joins[i]) {link(r.points.at(-1)!,joins[i]!);link(joins[i]!,r.points.at(-1)!);}});
  for(let i=0;i<queue.length;i++) {
    const p=queue[i];for(const next of downstream.get(p)??[])if(next.level>p.level) {next.level=p.level;queue.push(next);}
  }
}
