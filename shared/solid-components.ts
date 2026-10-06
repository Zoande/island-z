import {SparseVolume,primitiveBounds,primitiveDistance,VOXEL_SIZE,type SolidSource,type VolumeState} from './volume';
import type {Point3} from './rocks';
export interface SolidComponent {mask:Record<string,number[]>;points:Point3[];bounds:[Point3,Point3];count:number}
/** Connectivity is a solid-material query, independent of placement ancestry.
 * Structures use native samples; broad natural solids use a 5cm support grid. */
export function solidComponents(source:SolidSource,state:VolumeState,step=VOXEL_SIZE):SolidComponent[]{
  const ratio=Math.round(step/VOXEL_SIZE),lo=source.bounds[0].map(v=>Math.floor(v/step)),hi=source.bounds[1].map(v=>Math.ceil(v/step)),nx=hi[0]-lo[0]+1,ny=hi[1]-lo[1]+1,plane=nx*ny;
  // Numeric sparse keys avoid millions of temporary strings and Point3 arrays.
  // This is sparse even for a wide, branching tree: no bounding-box voxel array.
  const occupied=new Set<number>();
  for(const primitive of source.primitives){const [a,b]=primitiveBounds(primitive),start=a.map(v=>Math.floor(v/step)),end=b.map(v=>Math.ceil(v/step));
    for(let z=start[2];z<=end[2];z++)for(let y=start[1];y<=end[1];y++)for(let x=start[0];x<=end[0];x++){
      const key=(z-lo[2])*plane+(y-lo[1])*nx+x-lo[0];if(occupied.has(key))continue;
      const p:Point3=[x*step,y*step,z*step],d=primitiveDistance(p,primitive);if(Math.round(d/.0001)*.0001>=-.001)continue;
      const sx=x*ratio,sy=y*ratio,sz=z*ratio,bx=Math.floor(sx/8),by=Math.floor(sy/8),bz=Math.floor(sz/8),brick=`${bx}:${by}:${bz}`,index=(sz-bz*8)*64+(sy-by*8)*8+sx-bx*8;
      if(state.mask&&!(state.mask[brick]?.[index>>>5]&(1<<(index&31))))continue;
      if(state.bricks[brick]&&state.bricks[brick][index]*.0001>=-.001)continue;
      if(state.clips?.some(c=>Math.round((p[0]*c.normal[0]+p[1]*c.normal[1]+p[2]*c.normal[2]-c.offset)/.0001)*.0001>=-.001))continue;
      occupied.add(key);
    }
  }
  const components:SolidComponent[]=[],offsets=[1,-1,nx,-nx,plane,-plane];
  while(occupied.size){const first=occupied.values().next().value!,queue=[first];occupied.delete(first);const mask:Record<string,number[]>={},maskBricks=new Map<number,number[]>(),lower:Point3=[Infinity,Infinity,Infinity],upper:Point3=[-Infinity,-Infinity,-Infinity],points:Point3[]=[];
    const nativeLo=lo.map(v=>Math.floor(v*ratio/8)),nativeNx=Math.floor(hi[0]*ratio/8)-nativeLo[0]+2,nativeNy=Math.floor(hi[1]*ratio/8)-nativeLo[1]+2,nativePlane=nativeNx*nativeNy;
    for(let i=0;i<queue.length;i++){const key=queue[i],gx=key%nx,gy=Math.floor(key/nx)%ny,gz=Math.floor(key/plane),x=gx+lo[0],y=gy+lo[1],z=gz+lo[2];
      for(let direction=0;direction<6;direction++){if(direction===0&&gx===nx-1||direction===1&&!gx||direction===2&&gy===ny-1||direction===3&&!gy||direction===4&&gz===hi[2]-lo[2]||direction===5&&!gz)continue;const q=key+offsets[direction];if(occupied.delete(q))queue.push(q);}
      lower[0]=Math.min(lower[0],x*step);lower[1]=Math.min(lower[1],y*step);lower[2]=Math.min(lower[2],z*step);upper[0]=Math.max(upper[0],x*step);upper[1]=Math.max(upper[1],y*step);upper[2]=Math.max(upper[2],z*step);
      for(let dz=0;dz<ratio;dz++)for(let dy=0;dy<ratio;dy++)for(let dx=0;dx<ratio;dx++){const sx=x*ratio+dx,sy=y*ratio+dy,sz=z*ratio+dz,bx=Math.floor(sx/8),by=Math.floor(sy/8),bz=Math.floor(sz/8),brickId=(bz-nativeLo[2])*nativePlane+(by-nativeLo[1])*nativeNx+bx-nativeLo[0],index=(sz-bz*8)*64+(sy-by*8)*8+sx-bx*8;let values=maskBricks.get(brickId);if(!values){values=new Array(16).fill(0);maskBricks.set(brickId,values);mask[`${bx}:${by}:${bz}`]=values;}values[index>>>5]|=1<<(index&31);}
    }
    const stride=Math.max(1,Math.ceil(queue.length/2000));for(let i=0;i<queue.length;i+=stride){const key=queue[i];points.push([(key%nx+lo[0])*step,(Math.floor(key/nx)%ny+lo[1])*step,(Math.floor(key/plane)+lo[2])*step]);}
    components.push({mask,points,bounds:[lower,upper],count:queue.length});
  }
  return components.sort((a,b)=>b.count-a.count);
}
export function maskContains(component:SolidComponent,p:Point3){const q=p.map(v=>Math.round(v/VOXEL_SIZE)),b=q.map(v=>Math.floor(v/8)),index=(q[2]-b[2]*8)*64+(q[1]-b[1]*8)*8+q[0]-b[0]*8;return !!(component.mask[b.join(':')]?.[index>>>5]&(1<<(index&31)));}
