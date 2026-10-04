import { smooth } from './noise';
import type { DrainageGrid } from './drainage';
import type { River, RiverPoint } from './water';
interface RoutePoint {x:number;z:number;area:number}
export function fitRiver(grid:DrainageGrid,path:number[],kind:'main'|'tributary',scale:number,terrain:(x:number,z:number)=>number,
  coast:(x:number,z:number)=>number,target?:RiverPoint,approach?:RiverPoint):River {
  let route:RoutePoint[]=path.map(id=>({x:grid.x[id],z:grid.z[id],area:grid.area[id]}));
  if(target) {route.pop();if(approach)route.push({...approach,area:route.at(-1)!.area});route.push({...target,area:route.at(-1)!.area});}
  else {
    // Flood roots can lie just a few meters offshore. Continue the estuary into
    // open water so the shared ocean waves overlap the entire river mouth.
    const end=route.at(-1)!,e=10;
    const gx=coast(end.x+e,end.z)-coast(end.x-e,end.z),gz=coast(end.x,end.z+e)-coast(end.x,end.z-e),length=Math.hypot(gx,gz);
    if(length>0)for(let distance=80*scale;distance<=800*scale;distance+=80*scale) {
      const p={x:end.x-gx/length*distance,z:end.z-gz/length*distance,area:end.area};route.push(p);
      if(coast(p.x,p.z)<-220*scale)break;
    }
  }
  for(let iteration=0;iteration<2;iteration++) {
    const next:RoutePoint[]=[route[0]];
    for(let i=1;i<route.length;i++) {const a=route[i-1],b=route[i];
      next.push({x:a.x*.75+b.x*.25,z:a.z*.75+b.z*.25,area:a.area*.75+b.area*.25},
        {x:a.x*.25+b.x*.75,z:a.z*.25+b.z*.75,area:a.area*.25+b.area*.75});}
    next.push(route.at(-1)!);route=next;
  }
  const lengths=[0];for(let i=1;i<route.length;i++)lengths.push(lengths[i-1]+Math.hypot(route[i].x-route[i-1].x,route[i].z-route[i-1].z));
  const total=lengths.at(-1)!,step=Math.max(5,24*scale),sampled:RoutePoint[]=[];let segment=1;
  for(let distance=0;distance<total;distance+=step) {
    while(segment<lengths.length-1&&lengths[segment]<distance)segment++;
    const a=route[segment-1],b=route[segment],t=(distance-lengths[segment-1])/Math.max(.0001,lengths[segment]-lengths[segment-1]);
    sampled.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,area:a.area+(b.area-a.area)*t});
  }
  sampled.push(route.at(-1)!);
  // Settle the smoothed centerline into nearby low ground, avoiding coarse grid steps.
  for(let i=1;i<sampled.length-4;i++) {
    const p=sampled[i],a=sampled[i-1],b=sampled[i+1],length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
    let best=terrain(p.x,p.z),offset=0;
    for(const fraction of [-.30,-.15,.15,.30]) {
      const shift=grid.spacing*fraction,score=terrain(p.x+nx*shift,p.z+nz*shift)+fraction*fraction*6;
      if(score<best) {best=score;offset=shift;}
    }
    p.x+=nx*offset;p.z+=nz*offset;
  }
  for(let iteration=0;iteration<3;iteration++) {
    const copy=sampled.map(p=>({...p}));
    for(let i=1;i<sampled.length-3;i++) {sampled[i].x=(copy[i-1].x+copy[i].x*4+copy[i+1].x)/6;sampled[i].z=(copy[i-1].z+copy[i].z*4+copy[i+1].z)/6;}
  }
  const points:RiverPoint[]=sampled.map((p,i)=>({x:p.x,z:p.z,level:Math.max(0,terrain(p.x,p.z)-.16),
    width:Math.max(2.5,Math.min(kind==='main'?70:24,3+Math.sqrt(p.area)*.85))*scale,distance:0}));
  if(target)points.at(-1)!.level=target.level;else points.at(-1)!.level=0;
  for(let i=points.length-2;i>=0;i--)points[i].level=Math.max(points[i].level,points[i+1].level);
  for(let i=1;i<points.length;i++)points[i].distance=points[i-1].distance+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
  const length=points.at(-1)!.distance;
  for(let i=0;i<points.length;i++) {
    const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],slope=(a.level-b.level)/Math.max(1,b.distance-a.distance);
    if(kind==='main')p.width=Math.max(p.width,(7+48*smooth(.08,.85,p.distance/Math.max(1,length)))*scale);
    p.width*=1-smooth(.045,.20,slope)*.70;
    p.width*=.35+.65*smooth(0,180*scale,p.distance);
    if(target) p.width=Math.min(p.width,target.width*.72);
    p.depth=.75+Math.min(4.5,p.width*.075);p.speed=Math.min(3.5,.35+Math.sqrt(Math.max(0,slope))*5+p.width*.008);
    p.phase=p.distance+(target?(target.phase??target.distance)-length:0);
    p.mouth=target?0:(1-smooth(0,650*scale,coast(p.x,p.z)))*(1-smooth(.1,3.5,p.level));
    p.junction=target?smooth(length-180*scale,length,p.distance):0;
    if(target)p.speed=p.speed*(1-p.junction)+target.speed!*p.junction;
  }
  return {points,kind,outlet:target?'river':'ocean'};
}
