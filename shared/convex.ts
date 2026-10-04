import type {Point3} from './rocks';
export type ConvexShape={kind:'hull';points:Point3[];center:Point3}|{kind:'cylinder';center:Point3;radius:number;halfHeight:number};
const add=(a:Point3,b:Point3):Point3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:Point3,b:Point3):Point3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a:Point3,s:number):Point3=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:Point3,b:Point3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Point3,b:Point3):Point3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const boundsCache=new WeakMap<ConvexShape,{min:Point3;max:Point3}>();
function bounds(shape:ConvexShape) {
  let result=boundsCache.get(shape);if(result)return result;
  const min:Point3=[Infinity,Infinity,Infinity],max:Point3=[-Infinity,-Infinity,-Infinity];
  if(shape.kind==='cylinder')for(let i=0;i<3;i++){const extent=i===1?shape.halfHeight:shape.radius;min[i]=shape.center[i]-extent;max[i]=shape.center[i]+extent;}
  else for(const p of shape.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  result={min,max};boundsCache.set(shape,result);return result;
}
function support(shape:ConvexShape,d:Point3):Point3 {
  if(shape.kind==='cylinder'){const length=Math.hypot(d[0],d[2]);return add(shape.center,[length?shape.radius*d[0]/length:0,d[1]>=0?shape.halfHeight:-shape.halfHeight,length?shape.radius*d[2]/length:0]);}
  let result=shape.points[0],maximum=-Infinity;for(const p of shape.points){const value=dot(p,d);if(value>maximum){result=p;maximum=value;}}return result;
}
function lineDirection(ab:Point3,ao:Point3):Point3 {const d=cross(cross(ab,ao),ab);return Math.hypot(...d)>1e-10?d:cross(ab,Math.abs(ab[1])<.9*Math.hypot(...ab)?[0,1,0]:[1,0,0]);}
/** GJK tests full convex rock hulls, thin rotated walls, trunks and bush volumes. */
export function intersects(a:ConvexShape,b:ConvexShape,tolerance=.012):boolean {
  // Shapes are immutable. Cached bounds reject separated/contact-only volumes
  // before GJK, including offset walls resting on an adjacent wall's top.
  const aa=bounds(a),bb=bounds(b);
  for(let i=0;i<3;i++)if(Math.min(aa.max[i],bb.max[i])-Math.max(aa.min[i],bb.min[i])<=tolerance)return false;
  const point=(d:Point3)=>sub(support(a,d),support(b,scale(d,-1)));
  let direction=sub(b.center,a.center);if(Math.hypot(...direction)<1e-9)direction=[1,0,0];
  direction=scale(direction,1/Math.hypot(...direction));
  const initial=point(direction);if(dot(initial,direction)<=tolerance)return false;
  const simplex:Point3[]=[initial];direction=scale(simplex[0],-1);
  for(let iteration=0;iteration<48;iteration++) {
    const length=Math.hypot(...direction);if(length<1e-10)return true;direction=scale(direction,1/length);
    const p=point(direction);if(dot(p,direction)<=tolerance)return false;
    simplex.unshift(p);const ao=scale(p,-1),ab=sub(simplex[1],p);
    if(simplex.length===2){if(dot(ab,ao)>0)direction=lineDirection(ab,ao);else{simplex.splice(1);direction=ao;}continue;}
    const ac=sub(simplex[2],p),abc=cross(ab,ac);
    if(simplex.length===3) {
      if(dot(cross(abc,ac),ao)>0) {
        if(dot(ac,ao)>0){simplex.splice(1,1);direction=lineDirection(ac,ao);}
        else if(dot(ab,ao)>0){simplex.splice(2);direction=lineDirection(ab,ao);}
        else{simplex.splice(1);direction=ao;}
      }else if(dot(cross(ab,abc),ao)>0) {
        if(dot(ab,ao)>0){simplex.splice(2);direction=lineDirection(ab,ao);}else{simplex.splice(1);direction=ao;}
      }else if(dot(abc,ao)>0)direction=abc;else{[simplex[1],simplex[2]]=[simplex[2],simplex[1]];direction=scale(abc,-1);}
      continue;
    }
    const ad=sub(simplex[3],p);
    let outside=false;
    for(const [i,j,k]of [[1,2,3],[2,3,1],[3,1,2]]) {
      const u=sub(simplex[i],p),v=sub(simplex[j],p),opposite=sub(simplex[k],p);let n=cross(u,v);
      if(dot(n,opposite)>0)n=scale(n,-1);
      if(dot(n,ao)>1e-10){const first=simplex[i],second=simplex[j];simplex.splice(1,3,first,second);direction=n;outside=true;break;}
    }
    if(!outside)return true;
  }
  // Fail closed on numerical degeneracy; never accept an uncertain penetration.
  return true;
}
export function boxShape(center:Point3,half:Point3,yaw:number):ConvexShape {
  const c=Math.cos(yaw),s=Math.sin(yaw),points:Point3[]=[];
  for(const x of [-half[0],half[0]])for(const y of [-half[1],half[1]])for(const z of [-half[2],half[2]])points.push([center[0]+x*c+z*s,center[1]+y,center[2]-x*s+z*c]);
  return {kind:'hull',center,points};
}
