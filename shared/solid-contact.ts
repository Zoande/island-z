import type {BuildSolid} from './build-scene';
import type {Point3} from './rocks';
import {localPoint} from './destruction';
import {SparseVolume,VOXEL_SIZE} from './volume';
export function materialNear(volume:SparseVolume,p:Point3,tolerance:number):boolean {
  if(!volume.state.mask)return volume.distance(p)<=tolerance;
  const q=p.map(v=>Math.round(v/VOXEL_SIZE)),surfaceTolerance=tolerance+VOXEL_SIZE*.8660254,r=Math.ceil(surfaceTolerance/VOXEL_SIZE);
  for(let z=-r;z<=r;z++)for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++)if(Math.hypot((q[0]+x)*VOXEL_SIZE-p[0],(q[1]+y)*VOXEL_SIZE-p[1],(q[2]+z)*VOXEL_SIZE-p[2])<=surfaceTolerance&&volume.sample(q[0]+x,q[1]+y,q[2]+z)<0)return true;return false;
}
export function pointInSolid(solid:BuildSolid,p:Point3):boolean {
  if(solid.record){return !solid.record.removed&&new SparseVolume(solid.record.source,solid.record.volume).distance(localPoint(solid.record,p))<-.001;}
  for(const c of solid.colliders){if(p[1]<=c.bottom+.001||p[1]>=c.top-.001)continue;const dx=p[0]-c.x,dz=p[2]-c.z;if(c.wall){const s=Math.sin(c.wall.yaw),co=Math.cos(c.wall.yaw);if(Math.abs(dx*co-dz*s)<c.wall.halfWidth-.001&&Math.abs(dx*s+dz*co)<c.wall.halfDepth-.001)return true;}else if(Math.hypot(dx,dz)<c.radius-.001)return true;}return false;
}
