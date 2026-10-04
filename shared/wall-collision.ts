import type {CharacterCollider} from './character';
import type {Point3} from './rocks';
export function wallLocal(c:CharacterCollider,x:number,z:number):[number,number] {
  const {yaw}=c.wall!,cos=Math.cos(yaw),sin=Math.sin(yaw),dx=x-c.x,dz=z-c.z;return [dx*cos-dz*sin,dx*sin+dz*cos];
}
export function wallContains(c:CharacterCollider,x:number,z:number,radius=0):boolean {
  const [lx,lz]=wallLocal(c,x,z),w=c.wall!;return Math.hypot(Math.max(0,Math.abs(lx)-w.halfWidth),Math.max(0,Math.abs(lz)-w.halfDepth))<=radius+1e-8;
}
export function wallPush(c:CharacterCollider,x:number,z:number,radius:number):[number,number] {
  const [lx,lz]=wallLocal(c,x,z),w=c.wall!,a=w.halfWidth+radius,b=w.halfDepth+radius;
  if(Math.abs(lx)>=a||Math.abs(lz)>=b)return [x,z];
  const dx=a-Math.abs(lx),dz=b-Math.abs(lz),px=dx<dz?(lx<0?-dx:dx):0,pz=dx<dz?0:(lz<0?-dz:dz);
  return [x+px*Math.cos(w.yaw)+pz*Math.sin(w.yaw),z-px*Math.sin(w.yaw)+pz*Math.cos(w.yaw)];
}
export function wallSweep(c:CharacterCollider,x:number,z:number,dx:number,dz:number,radius:number):{time:number;normal:[number,number]}|null {
  const [lx,lz]=wallLocal(c,x,z),w=c.wall!,cos=Math.cos(w.yaw),sin=Math.sin(w.yaw),vx=dx*cos-dz*sin,vz=dx*sin+dz*cos;
  let entry=0,exit=1,normal:[number,number]=[0,0];
  for(const [p,v,h,axis]of [[lx,vx,w.halfWidth+radius,0],[lz,vz,w.halfDepth+radius,1]]) {
    if(Math.abs(v)<1e-12){if(Math.abs(p)>h)return null;continue;}
    let near=(-h-p)/v,far=(h-p)/v;const sign=v>0?-1:1;if(near>far)[near,far]=[far,near];
    if(near>=entry){entry=near;normal=axis===0?[sign*cos,-sign*sin]:[sign*sin,sign*cos];}
    exit=Math.min(exit,far);if(entry>exit)return null;
  }
  if(entry<0||entry>1||dx*normal[0]+dz*normal[1]>=0)return null;return {time:entry,normal};
}
export function wallRay(c:CharacterCollider,origin:Point3,direction:Point3,limit:number):number|null {
  const [x,z]=wallLocal(c,origin[0],origin[2]),w=c.wall!,cos=Math.cos(w.yaw),sin=Math.sin(w.yaw);
  const p=[x,origin[1]-(c.top+c.bottom)/2,z],d=[direction[0]*cos-direction[2]*sin,direction[1],direction[0]*sin+direction[2]*cos],half=[w.halfWidth,(c.top-c.bottom)/2,w.halfDepth];
  let entry=0,exit=limit;
  for(let i=0;i<3;i++){if(Math.abs(d[i])<1e-12){if(Math.abs(p[i])>half[i])return null;continue;}let a=(-half[i]-p[i])/d[i],b=(half[i]-p[i])/d[i];if(a>b)[a,b]=[b,a];entry=Math.max(entry,a);exit=Math.min(exit,b);if(entry>exit)return null;}
  return entry;
}
