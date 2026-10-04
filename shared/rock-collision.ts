import type {CharacterCollider} from './character';
import type {Prop} from './world';
import {orientation,rotate,type MeshSurface} from './placement';
import {ROCK_RINGS,ROCK_SEGMENTS,type Point3} from './rocks';
interface RockFace {
  a:Point3;b:Point3;c:Point3;normal:Point3;inverse:number;
  minX:number;maxX:number;minZ:number;maxZ:number;
}
export interface RockCollisionShape {baseY:number;faces:RockFace[]}
/** The LOD0 rock surface, transformed exactly like the renderer. Store local
 * coordinates so world-coordinate precision is independent of island size. */
export function rockCollider(prop:Prop,points:Point3[]):CharacterCollider {
  const q=orientation(prop.normal??[0,1,0],prop.rotation);
  const vertices=points.map(p=>rotate([p[0]*prop.scale,p[1]*prop.scale,p[2]*prop.scale],q));
  const faces:RockFace[]=[];
  const add=(ia:number,ib:number,ic:number)=>{
    const a=vertices[ia],b=vertices[ib],c=vertices[ic];
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    const n:Point3=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    // Lower/vertical faces cannot support a standing capsule. Steep upper
    // faces remain present and use the character's existing slope limit.
    if(n[1]<=1e-9)return;
    const length=Math.hypot(...n);
    faces.push({a,b,c,normal:n.map(t=>t/length)as Point3,inverse:-1/n[1],
      minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minZ:Math.min(a[2],b[2],c[2]),maxZ:Math.max(a[2],b[2],c[2])});
  };
  for(let r=0;r<ROCK_RINGS;r++)for(let j=0;j<ROCK_SEGMENTS;j++) {
    const a=r*(ROCK_SEGMENTS+1)+j,b=a+1,c=a+ROCK_SEGMENTS+1,d=c+1;
    add(a,b,c);add(b,d,c);
  }
  return {kind:'rock',x:prop.x,z:prop.z,radius:Math.max(...vertices.map(p=>Math.hypot(p[0],p[2]))),
    bottom:prop.y+Math.min(...vertices.map(p=>p[1])),top:prop.y+Math.max(...vertices.map(p=>p[1])),rock:{baseY:prop.y,faces}};
}
/** Vertical surface query for the existing step, slope, slide and jump solver. */
export function rockSurface(collider:CharacterCollider,x:number,z:number):MeshSurface|null {
  const shape=collider.rock;if(!shape)return null;
  x-=collider.x;z-=collider.z;
  if(x*x+z*z>collider.radius**2)return null;
  let result:MeshSurface|null=null;
  for(const f of shape.faces) {
    if(x<f.minX-1e-8||x>f.maxX+1e-8||z<f.minZ-1e-8||z>f.maxZ+1e-8)continue;
    const dx=x-f.a[0],dz=z-f.a[2],bx=f.b[0]-f.a[0],bz=f.b[2]-f.a[2],cx=f.c[0]-f.a[0],cz=f.c[2]-f.a[2];
    const u=(dx*cz-dz*cx)*f.inverse,v=(bx*dz-bz*dx)*f.inverse;
    if(u< -1e-8||v< -1e-8||u+v>1+1e-8)continue;
    const height=shape.baseY+f.a[1]+u*(f.b[1]-f.a[1])+v*(f.c[1]-f.a[1]);
    if(!result||height>result.height)result={height,normal:f.normal};
  }
  return result;
}
