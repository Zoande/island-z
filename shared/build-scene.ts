import {WorldGenerator,type Prop} from './world';
import {rockPoints,ROCK_RINGS,ROCK_SEGMENTS,type Point3} from './rocks';
import {orientation,rotate,embeddedRockHeight,type MeshSurface} from './placement';
import {playerCollider} from './object-colliders';
import {rockSurface} from './rock-collision';
import {wallContains,wallRay} from './wall-collision';
import type {CharacterCollider} from './character';
import {buildProp,objectDefinition,type BuildObject,BUILD_REACH} from './object-registry';
import {boxShape,type ConvexShape} from './convex';
import {SpatialIndex} from './spatial-index';
export interface BuildSolid {id:string;prop:Prop;collider:CharacterCollider;shape:ConvexShape;object?:BuildObject}
export interface BuildHit {point:Point3;distance:number;solid?:BuildSolid}
/** A renderer-independent canonical 2m terrain surface and bounded scenery cache.
 * Both previews and authoritative validation sample the same triangles. */
export class BuildScene {
  readonly placed=new SpatialIndex<BuildSolid>();revision=0;
  readonly rocks:Point3[][];
  private natural=new Map<string,BuildSolid[]>();private heights=new Map<string,number>();
  constructor(readonly world:WorldGenerator){this.rocks=Array.from({length:12},(_,i)=>rockPoints(world.config.seed,i));}
  terrain(x:number,z:number):MeshSurface {
    const cx=Math.floor(x/2)*2,cz=Math.floor(z/2)*2,u=(x-cx)/2,v=(z-cz)/2;
    const height=(x:number,z:number)=>{const key=`${x}:${z}`;let value=this.heights.get(key);if(value===undefined){value=this.world.height(x,z);this.heights.set(key,value);if(this.heights.size>32768)this.heights.delete(this.heights.keys().next().value!);}return value;};
    const a=height(cx,cz),b=height(cx+2,cz),c=height(cx,cz+2),d=height(cx+2,cz+2);
    const y=u+v<=1?a+(b-a)*u+(c-a)*v:b*(1-v)+d*(u+v-1)+c*(1-u);
    const dx=(u+v<=1?b-a:d-c)/2,dz=(u+v<=1?c-a:d-b)/2,length=Math.hypot(dx,1,dz);
    return {height:y,normal:[-dx/length,1/length,-dz/length]};
  }
  solid(prop:Prop,id:string,object?:BuildObject):BuildSolid {
    const collider=playerCollider(prop,this.rocks[prop.variant]);if(!collider)throw new Error('Object has no physical shape');
    let shape:ConvexShape;
    if(collider.wall){const w=collider.wall;shape=boxShape([prop.x,(collider.top+collider.bottom)/2,prop.z],[w.halfWidth,(collider.top-collider.bottom)/2,w.halfDepth],w.yaw);}
    else if(prop.kind==='rock') {
      const q=orientation(prop.normal??[0,1,0],prop.rotation),points=this.rocks[prop.variant].map(p=>{const v=rotate([p[0]*prop.scale,p[1]*prop.scale,p[2]*prop.scale],q);return [v[0]+prop.x,v[1]+prop.y,v[2]+prop.z] as Point3;});
      shape={kind:'hull',points,center:[prop.x,(collider.bottom+collider.top)/2,prop.z]};
    }else shape={kind:'cylinder',center:[prop.x,(collider.top+collider.bottom)/2,prop.z],radius:collider.radius,halfHeight:(collider.top-collider.bottom)/2};
    return {id,prop,collider,shape,object};
  }
  naturalAt(x:number,z:number,radius:number):BuildSolid[] {
    const result:BuildSolid[]=[];
    for(let tz=Math.floor((z-radius-20)/64)*64;tz<=z+radius+20;tz+=64)for(let tx=Math.floor((x-radius-20)/64)*64;tx<=x+radius+20;tx+=64) {
      const key=`${tx}:${tz}`;let solids=this.natural.get(key);
      if(!solids) {
        solids=this.world.props(tx,tz,64,false).map(prop=>{
          const surface=this.terrain(prop.x,prop.z),placed={...prop,y:surface.height-.20};
          if(prop.kind==='rock'){placed.normal=surface.normal;placed.y=embeddedRockHeight(this.rocks[prop.variant],prop.x,prop.z,prop.scale,orientation(surface.normal,prop.rotation),(x,z)=>this.terrain(x,z).height);}
          return this.solid(placed,`natural:${prop.kind}:${prop.x.toFixed(8)}:${prop.z.toFixed(8)}`);
        });
        this.natural.set(key,solids);if(this.natural.size>128)this.natural.delete(this.natural.keys().next().value!);
      }
      for(const solid of solids)if(Math.hypot(solid.prop.x-x,solid.prop.z-z)<=radius+solid.collider.radius)result.push(solid);
    }
    return result;
  }
  nearby(x:number,z:number,radius:number):BuildSolid[]{return [...this.naturalAt(x,z,radius),...this.placed.query(x,z,radius)];}
  add(object:BuildObject){const solid=this.solid(buildProp(object),object.id,object);this.placed.insert(object.id,solid,solid.prop.x,solid.prop.z,solid.collider.radius);this.revision++;return solid;}
  remove(id:string){if(this.placed.get(id)){this.placed.remove(id);this.revision++;}}
  colliders(x:number,z:number,radius=12):CharacterCollider[]{return this.placed.query(x,z,radius).map(s=>s.collider);}
  standingHeight(x:number,z:number):number {
    let height=this.terrain(x,z).height;
    for(const solid of this.nearby(x,z,1)) {
      const c=solid.collider;
      if(c.kind==='rock')height=Math.max(height,rockSurface(c,x,z)?.height??height);
      if(c.kind==='wall'&&wallContains(c,x,z,.32))height=Math.max(height,c.top);
    }
    return height;
  }
  raycast(eye:Point3,direction:Point3,limit=BUILD_REACH):BuildHit|null {
    let distance=limit+1,closest:BuildSolid|undefined;
    for(const solid of this.nearby(eye[0]+direction[0]*limit/2,eye[2]+direction[2]*limit/2,limit/2+1)) {
      const hit=solidRay(solid,eye,direction,limit);if(hit!==null&&hit<distance){distance=hit;closest=solid;}
    }
    const terrainDistance=(t:number)=>eye[1]+direction[1]*t-this.terrain(eye[0]+direction[0]*t,eye[2]+direction[2]*t).height;
    let previous=0;
    for(let t=0;t<=Math.min(limit,distance)+.0001;t+=.20) {
      if(terrainDistance(t)<=0){let low=previous,high=t;for(let i=0;i<16;i++){const mid=(low+high)/2;if(terrainDistance(mid)>0)low=mid;else high=mid;}distance=(low+high)/2;closest=undefined;break;}previous=t;
    }
    if(distance>limit)return null;
    return {point:[eye[0]+direction[0]*distance,eye[1]+direction[1]*distance,eye[2]+direction[2]*distance],distance,solid:closest};
  }
}
function cylinderRay(c:CharacterCollider,o:Point3,d:Point3,limit:number):number|null {
  const x=o[0]-c.x,z=o[2]-c.z,a=d[0]**2+d[2]**2,b=x*d[0]+z*d[2],constant=x*x+z*z-c.radius*c.radius;
  const candidates:number[]=[];
  if(a>1e-12){const discriminant=b*b-a*constant;if(discriminant>=0){const root=Math.sqrt(discriminant);candidates.push((-b-root)/a,(-b+root)/a);}}
  if(Math.abs(d[1])>1e-12)for(const y of [c.bottom,c.top]){const t=(y-o[1])/d[1];if((x+d[0]*t)**2+(z+d[2]*t)**2<=c.radius*c.radius)candidates.push(t);}
  if(constant<0&&o[1]>c.bottom&&o[1]<c.top)return 0;
  const hits=candidates.filter(t=>t>=0&&t<=limit&&o[1]+d[1]*t>=c.bottom-.00001&&o[1]+d[1]*t<=c.top+.00001);return hits.length?Math.min(...hits):null;
}
function triangleRay(o:Point3,d:Point3,a:Point3,b:Point3,c:Point3):number|null {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const px=d[1]*vz-d[2]*vy,py=d[2]*vx-d[0]*vz,pz=d[0]*vy-d[1]*vx,det=ux*px+uy*py+uz*pz;if(Math.abs(det)<1e-10)return null;
  const tx=o[0]-a[0],ty=o[1]-a[1],tz=o[2]-a[2],u=(tx*px+ty*py+tz*pz)/det;if(u<0||u>1)return null;
  const qx=ty*uz-tz*uy,qy=tz*ux-tx*uz,qz=tx*uy-ty*ux,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)return null;
  const t=(vx*qx+vy*qy+vz*qz)/det;return t>=0?t:null;
}
export function solidRay(s:BuildSolid,o:Point3,d:Point3,limit:number):number|null {
  if(s.collider.kind==='wall')return wallRay(s.collider,o,d,limit);
  if(s.collider.kind!=='rock')return cylinderRay(s.collider,o,d,limit);
  const points=(s.shape as Extract<ConvexShape,{kind:'hull'}>).points;let nearest=limit+1;
  for(let r=0;r<ROCK_RINGS;r++)for(let j=0;j<ROCK_SEGMENTS;j++) {
    const a=r*(ROCK_SEGMENTS+1)+j,b=a+1,c=a+ROCK_SEGMENTS+1,e=c+1;
    for(const indices of [[a,b,c],[b,e,c]]){const t=triangleRay(o,d,points[indices[0]],points[indices[1]],points[indices[2]]);if(t!==null&&t<nearest)nearest=t;}
  }
  return nearest<=limit?nearest:null;
}
