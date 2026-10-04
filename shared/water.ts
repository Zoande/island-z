import { hash, noise, smooth } from './noise';
import { buildDrainage, drainagePath } from './drainage';
import { fitRiver } from './river-routing';
import { basinSpill } from './lake-basin';
import { fitChannels } from './channel-fit';
export interface Lake { x: number; z: number; radius: number; level: number; depth: number; salt: number; radii?:number[] }
export interface RiverPoint { x: number; z: number; level: number; width: number; distance: number; depth?:number; speed?:number; phase?:number; mouth?:number; lake?:number; junction?:number; basinLevel?:number; bankCap?:number }
export interface River { points: RiverPoint[]; kind?:'main'|'tributary'; outlet?:'ocean'|'river'; parent?:number; joinIndex?:number }
export interface WaterSample { level: number; bed: number; bank: number; shore: number; kind: 'lake' | 'river'; flow: [number, number] }
interface Segment { a: RiverPoint; b: RiverPoint }
type Feature = { lake: Lake } | { segment: Segment };
/** A small deterministic drainage skeleton, queried through a fixed-meter spatial index.
 * Only local waterbeds alter the existing heightfield; no global erosion simulation.
 */
export class WaterNetwork {
  readonly lakes: Lake[] = [];
  readonly rivers: River[] = [];
  private bins = new Map<string, Feature[]>();
  private readonly binSize = 128;
  constructor(readonly seed: number, size: number, terrain: (x: number,z: number)=>number, coast: (x: number,z: number)=>number) {
    const scale = Math.max(.15, Math.min(1.4, size / 16384));
    const catchments = size < 4096 ? 2 : 4;
    const rotation = hash(0,0,seed+801)*Math.PI*2;
    for(let catchment=0;catchment<catchments;catchment++) {
      const grid=buildDrainage(seed+catchment*271,size,rotation+catchment*Math.PI*2/catchments,terrain,coast);
      const sources=grid.order.filter(id=>grid.coast[id]>Math.min(2500*scale,size*.12)
        && grid.height[id]>8*scale && grid.height[id]<850*scale && grid.filled[id]-grid.height[id]<8*scale);
      sources.sort((a,b)=>(Math.min(grid.height[b],500*scale)*.9+grid.coast[b]*.045+grid.area[b]*.12)
        -(Math.min(grid.height[a],500*scale)*.9+grid.coast[a]*.045+grid.area[a]*.12));
      const source=sources.find(id=>!this.rivers.some(r=>r.kind==='main'&&Math.hypot(r.points[0].x-grid.x[id],r.points[0].z-grid.z[id])<800*scale));
      if(source===undefined)continue;
      const mainPath=drainagePath(grid,source);
      if(mainPath.length<8 || grid.coast[mainPath.at(-1)!]>=0)continue;
      const main=fitRiver(grid,mainPath,'main',scale,terrain,coast);
      const mainIndex=this.rivers.length;this.rivers.push(main);
      const owned=new Map<number,number>();for(const id of mainPath)owned.set(id,mainIndex);
      const mainNodes=new Set(mainPath);
      const tributaries:{source:number;score:number}[]=[];
      for(const id of grid.order) {
        if(grid.area[id]<3||grid.height[id]<15*scale||grid.height[id]>900*scale||grid.coast[id]<500*scale
          || grid.filled[id]-grid.height[id]>8*scale || mainNodes.has(id) || hash(id,catchment,seed+831)>.6)continue;
        const path=drainagePath(grid,id,mainNodes);
        if(path.length<7||!mainNodes.has(path.at(-1)!)||path.some(node=>grid.filled[node]-grid.height[node]>30*scale))continue;
        const length=path.reduce((sum,node,i)=>sum+(i?Math.hypot(grid.x[node]-grid.x[path[i-1]],grid.z[node]-grid.z[path[i-1]]):0),0);
        if(length<450*scale)continue;
        tributaries.push({source:id,score:length+Math.min(500*scale,grid.height[id])*2});
      }
      tributaries.sort((a,b)=>b.score-a.score);
      const selected:{x:number;z:number}[]=[];
      for(const candidate of tributaries) {
        if(selected.length>=3)break;
        const id=candidate.source;
        if(owned.has(id)||selected.some(p=>Math.hypot(p.x-grid.x[id],p.z-grid.z[id])<500*scale))continue;
        const path=drainagePath(grid,id,new Set(owned.keys())),join=path.at(-1)!;
        if(path.length<7||!owned.has(join))continue;
        const parentIndex=owned.get(join)!,parent=this.rivers[parentIndex];
        let joinIndex=0,best=Infinity;
        for(let i=3;i<parent.points.length-3;i++) {
          const p=parent.points[i],distance=Math.hypot(p.x-grid.x[join],p.z-grid.z[join]);
          if(distance<best) {best=distance;joinIndex=i;}
        }
        if(!joinIndex || joinIndex<parent.points.length*.12 || best>grid.spacing*1.6)continue;
        const river=fitRiver(grid,path,'tributary',scale,terrain,coast,parent.points[joinIndex],parent.points[Math.max(0,joinIndex-3)]);
        if(river.points.at(-1)!.distance<400*scale || river.points.some(p=>p.level-terrain(p.x,p.z)>45*scale))continue;
        river.parent=parentIndex;river.joinIndex=joinIndex;
        const index=this.rivers.length;this.rivers.push(river);
        for(const node of path.slice(0,-1))owned.set(node,index);
        selected.push({x:grid.x[id],z:grid.z[id]});
      }
    }
    fitChannels(this.rivers,terrain);
    // Fit all basins before setting any final river planes. Later catchments can
    // otherwise create a lake underneath a ribbon finalized by an earlier one.
    for(let riverIndex=0;riverIndex<this.rivers.length;riverIndex++) {
      const river=this.rivers[riverIndex],points=river.points;
      if(river.parent!==undefined) {
        const target=this.rivers[river.parent].points[river.joinIndex!];
        points.at(-1)!.level=target.level;
        for(let i=points.length-2;i>=0;i--)points[i].level=Math.max(points[i].level,points[i+1].level);
      }
      const basinPoints=points.filter(p=>(p.basinLevel??p.level)-terrain(p.x,p.z)>2*scale && coast(p.x,p.z)>700*scale)
        .sort((a,b)=>((b.basinLevel??b.level)-terrain(b.x,b.z))-((a.basinLevel??a.level)-terrain(a.x,a.z)));
      let added=0;
      const inspected:RiverPoint[]=[];
      for(const p of basinPoints) {
        if(this.lakes.length>=12||added>=(river.kind==='main'?3:1)||inspected.length>=24)break;
        if(this.lakes.some(l=>Math.hypot(l.x-p.x,l.z-p.z)<l.radius*1.12))continue;
        // Neighboring samples often describe the same open valley. Bound expensive
        // shoreline searches and move to another depression after a rejected fit.
        if(inspected.some(a=>Math.hypot(a.x-p.x,a.z-p.z)<180*scale))continue;
        inspected.push(p);
        const lake=this.makeLake({...p,level:p.basinLevel??p.level},Math.min(1700*scale,size*.10),scale,terrain);
        if(!lake || this.lakes.some(existing=>this.lakesOverlap(existing,lake)) || !this.lakeSequenceValid([...this.lakes,lake]))continue;
        this.lakes.push(lake);added++;
      }
    }
    // Parents precede children. Basin anchors are exact planes, while the
    // remaining river profile is clamped between adjacent downstream anchors.
    for(const river of this.rivers) {
      const points=river.points;
      const lakePlanes=new Map<RiverPoint,number>();
      const receivingLevel=river.parent===undefined?0:this.rivers[river.parent].points[river.joinIndex!].level;
      for(const p of points) {
        let lakeBlend=0;
        for(const lake of this.lakes) {
          const distance=Math.hypot(p.x-lake.x,p.z-lake.z),radius=this.lakeRadius(lake,Math.atan2(p.z-lake.z,p.x-lake.x));
          if(lake.level<receivingLevel)continue;
          if(distance>radius && Math.abs(p.level-lake.level)>Math.max(8*scale,p.width*.4))continue;
          const blend=1-smooth(radius-30*scale,radius+100*scale,distance);
          if(blend>lakeBlend) {
            p.level=p.level*(1-blend)+lake.level*blend;lakeBlend=blend;
            if(distance<=radius) {lakePlanes.set(p,lake.level);lakeBlend=1;p.level=lake.level;}
          }
        }
        p.lake=lakeBlend;
      }
      const floor=new Float64Array(points.length);
      let next=receivingLevel;
      for(let i=points.length-1;i>=0;i--) {next=Math.max(next,lakePlanes.get(points[i])??0);floor[i]=next;}
      let previous=Infinity;
      for(let i=0;i<points.length;i++) {
        points[i].level=lakePlanes.get(points[i])??Math.max(floor[i],Math.min(previous,points[i].level));
        previous=points[i].level;
      }
      if(river.parent!==undefined) {
        const target=this.rivers[river.parent].points[river.joinIndex!];
        points.at(-1)!.level=target.level;points.at(-1)!.phase=target.phase;points.at(-1)!.lake=target.lake;
        for(let i=points.length-2;i>=0;i--)points[i].level=Math.max(points[i].level,points[i+1].level);
      }
      for(let i=0;i<points.length;i++) {
        const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
        const slope=Math.max(0,(a.level-b.level)/Math.max(1,b.distance-a.distance));
        p.speed=Math.min(3.5,.35+Math.sqrt(slope)*5+p.width*.008)*(1-(p.lake??0)*.85);
        if(river.parent!==undefined) {
          const target=this.rivers[river.parent].points[river.joinIndex!],blend=p.junction??0;
          p.speed=p.speed*(1-blend)+target.speed!*blend;
          p.lake=(p.lake??0)*(1-blend)+(target.lake??0)*blend;
          p.mouth=(p.mouth??0)*(1-blend)+(target.mouth??0)*blend;
        }
      }
    }
    const add=(feature:Feature,x0:number,z0:number,x1:number,z1:number)=>{
      for(let z=Math.floor(z0/this.binSize);z<=Math.floor(z1/this.binSize);z++)for(let x=Math.floor(x0/this.binSize);x<=Math.floor(x1/this.binSize);x++) {
        const key=`${x}:${z}`;if(!this.bins.has(key))this.bins.set(key,[]);this.bins.get(key)!.push(feature);
      }
    };
    for(const lake of this.lakes) {const r=lake.radius*1.22+12;add({lake},lake.x-r,lake.z-r,lake.x+r,lake.z+r);}
    for(const river of this.rivers) for(let i=1;i<river.points.length;i++) {
      const a=river.points[i-1],b=river.points[i],width=Math.max(a.width,b.width),r=width+Math.max(12,width*.2);
      add({segment:{a,b}},Math.min(a.x,b.x)-r,Math.min(a.z,b.z)-r,Math.max(a.x,b.x)+r,Math.max(a.z,b.z)+r);
    }
  }
  private lakeSequenceValid(lakes:Lake[]):boolean {
    const plane=(p:RiverPoint)=>lakes.find(l=>Math.hypot(p.x-l.x,p.z-l.z)<=this.lakeRadius(l,Math.atan2(p.z-l.z,p.x-l.x)))?.level;
    for(const river of this.rivers) {
      let previous=Infinity;
      for(const p of river.points) {
        const level=plane(p);if(level===undefined)continue;
        if(level>previous+1e-6)return false;previous=level;
      }
      // Incoming water must be high enough to reach each lake, without lifting
      // an earlier section off its banks. Width touching a lake is shoreline.
      let required=0;
      for(let i=river.points.length-1;i>=0;i--) {
        const p=river.points[i],inside=plane(p);if(inside!==undefined)required=Math.max(required,inside);
        const nearLake=lakes.some(l=>Math.hypot(p.x-l.x,p.z-l.z)<=this.lakeRadius(l,Math.atan2(p.z-l.z,p.x-l.x))+p.width*1.3);
        if(!nearLake && (p.bankCap??p.level)+.01<required)return false;
      }
      if(river.parent!==undefined) {
        const target=this.rivers[river.parent].points[river.joinIndex!];
        if((plane(target)??target.level)>previous+1e-6)return false;
      }
    }
    return true;
  }
  private makeLake(point:RiverPoint,limit:number,scale:number,terrain:(x:number,z:number)=>number):Lake|null {
    let x=point.x,z=point.z,h=terrain(x,z);
    for(const step of [60,30,15])for(let i=0;i<3;i++) {
      let bx=x,bz=z,bh=h;
      for(let d=0;d<12;d++) {const angle=d*Math.PI/6,nx=x+Math.cos(angle)*step*scale,nz=z+Math.sin(angle)*step*scale,nh=terrain(nx,nz);
        if(nh<bh) {bx=nx;bz=nz;bh=nh;}}
      if(bh===h)break;x=bx;z=bz;h=bh;
    }
    const level=Math.min(point.level,basinSpill(x,z,limit,terrain)-Math.max(.3,.3*scale));
    if(level-h<1*scale)return null;
    const radii:number[]=[],minimum=Math.max(35*scale,point.width*1.3),step=35*scale;
    for(let d=0;d<256;d++) {
      const angle=d*Math.PI/128,dx=Math.cos(angle),dz=Math.sin(angle);
      let r=Math.min(minimum,step);
      while(r<limit&&terrain(x+dx*r,z+dz*r)<level+.08)r+=step;
      // Truncating an open ray creates a vertical, unsupported water edge.
      if(r>=limit && terrain(x+dx*limit,z+dz*limit)<level+.08)return null;
      let low=Math.max(5*scale,r-step),high=Math.min(limit,r);
      for(let i=0;i<12;i++) {const mid=(low+high)/2;if(terrain(x+dx*mid,z+dz*mid)<level+.08)low=mid;else high=mid;}
      radii.push((low+high)*.5);
    }
    const areaRadius=Math.sqrt(radii.reduce((n,r)=>n+r*r,0)/radii.length);
    if(areaRadius<100*scale||Math.hypot(x-point.x,z-point.z)>Math.max(...radii)*.8)return null;
    return {x,z,radius:Math.max(...radii),radii,level,depth:Math.min(12*scale,Math.max(3*scale,level-h)),salt:this.seed+820+this.lakes.length};
  }
  lakesOverlap(a:Lake,b:Lake):boolean {
    // Reject intersecting footprints, not just nearby centers. This also keeps
    // two separately fitted water planes out of the same physical basin.
    if(Math.hypot(a.x-b.x,a.z-b.z)>a.radius+b.radius+12)return false;
    const contains=(lake:Lake,x:number,z:number)=>Math.hypot(x-lake.x,z-lake.z)<=this.lakeRadius(lake,Math.atan2(z-lake.z,x-lake.x))+12;
    if(contains(a,b.x,b.z)||contains(b,a.x,a.z))return true;
    for(const [lake,other]of [[a,b],[b,a]])for(let i=0;i<512;i++) {
      const angle=i*Math.PI/256,r=this.lakeRadius(lake,angle);
      if(contains(other,lake.x+Math.cos(angle)*r,lake.z+Math.sin(angle)*r))return true;
    }
    return false;
  }
  lakeRadius(lake:Lake,angle:number):number {
    if(lake.radii) {const t=((angle/(Math.PI*2))%1+1)%1*lake.radii.length,i=Math.floor(t),fraction=t-i;
      return lake.radii[i]*(1-fraction)+lake.radii[(i+1)%lake.radii.length]*fraction;}
    return lake.radius*(.86+noise(Math.cos(angle)*2.2+17,Math.sin(angle)*2.2-9,lake.salt)*.28);
  }
  sample(x:number,z:number,ground?:number):WaterSample|null {
    const features=this.bins.get(`${Math.floor(x/this.binSize)}:${Math.floor(z/this.binSize)}`);
    if(!features)return null;
    let result:WaterSample|null=null;
    for(const feature of features) {
      let sample:WaterSample;
      if('lake'in feature) {
        const l=feature.lake,dx=x-l.x,dz=z-l.z,r=this.lakeRadius(l,Math.atan2(dz,dx)),distance=Math.hypot(dx,dz);
        const margin=Math.max(12,r*.018),bank=1-smooth(r-margin,r+margin,distance);if(bank<=0)continue;
        const shore=Math.max(0,Math.min(1,1-distance/r));
        sample={level:l.level,bed:l.level+.35-(l.depth+.35)*smooth(0,.25,shore),bank,shore,kind:'lake',flow:[0,0]};
      }else{
        const {a,b}=feature.segment,dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(len*len)));
        const distance=Math.hypot(x-a.x-dx*t,z-a.z-dz*t),r=a.width*(1-t)+b.width*t;
        const bank=1-smooth(r*.86,r+Math.max(10,r*.2),distance);if(bank<=0)continue;
        const level=a.level*(1-t)+b.level*t,shore=Math.max(0,1-distance/r);
        const depth=(a.depth??2)*(1-t)+(b.depth??2)*t;
        sample={level,bed:level+.2-(depth+.2)*smooth(0,.85,shore),bank,shore,kind:'river',flow:[dx/len,dz/len]};
      }
      if(ground!==undefined) sample={...sample,bed:ground+(Math.min(ground,sample.bed)-ground)*sample.bank};
      if(!result) {result=sample;continue;}
      const bed=Math.min(result.bed,sample.bed);
      const bank=Math.max(result.bank,sample.bank);
      if(sample.bank>result.bank||sample.kind==='lake'&&sample.level>result.level)result=sample;
      result={...result,bed,bank};
    }
    return result;
  }
  get metadataSize() {return {lakes:this.lakes.length,rivers:this.rivers.length,segments:this.rivers.reduce((n,r)=>n+r.points.length-1,0),bins:this.bins.size};}
}
