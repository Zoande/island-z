import earcut, {deviation} from 'earcut';
const planarCache=new Map<string,number[]>();
// Geometry arrays can exceed the engine's argument limit; never spread them
// into a function call (the limit differs between browsers and Node).
function append(target:number[],values:Iterable<number>){for(const value of values)target.push(value);}

/** Retriangulate only exactly planar, axis-normal patches. Boundary samples
 * are retained, including samples around holes, so adjacent curved cells and
 * Rapier surface colliders keep the same closed boundary. */
export function simplifyPlanar(vertices:number[],indices:number[]):number[]{
  const patches=new Map<string,{axis:number;sign:number;triangles:number[];edges:Map<string,[number,number]>}>(),rest:number[]=[];
  const pos=(id:number,k:number)=>vertices[id*16+k];
  for(let i=0;i<indices.length;i+=3){const ids=indices.slice(i,i+3),a=ids[0],axis=[0,1,2].find(k=>ids.every(id=>Math.abs(pos(id,k+3))>.999999)&&ids.every(id=>Math.abs(pos(id,k)-pos(a,k))<1e-7));
    if(axis===undefined){rest.push(...ids);continue;}
    const sign=Math.sign(pos(a,axis+3)),key=`${axis}:${sign}:${Math.round(pos(a,axis)*1e7)}`;let p=patches.get(key);if(!p){p={axis,sign,triangles:[],edges:new Map()};patches.set(key,p);}p.triangles.push(...ids);
    for(let j=0;j<3;j++){const x=ids[j],y=ids[(j+1)%3],reverse=`${y}:${x}`;if(p.edges.has(reverse))p.edges.delete(reverse);else p.edges.set(`${x}:${y}`,[x,y]);}
  }
  for(const p of patches.values()){
    if(p.triangles.length<60){append(rest,p.triangles);continue;}
    const next=new Map<number,number>(),incoming=new Set<number>();let valid=true;
    for(const [a,b]of p.edges.values()){if(next.has(a)||incoming.has(b)){valid=false;break;}next.set(a,b);incoming.add(b);}
    const rings:number[][]=[];
    while(valid&&next.size){const first=next.keys().next().value!,ring:number[]=[];let at=first;do{ring.push(at);const following=next.get(at);if(following===undefined){valid=false;break;}next.delete(at);at=following;}while(at!==first);if(ring.length<3)valid=false;rings.push(ring);}
    if(!valid){append(rest,p.triangles);continue;}
    const u=(p.axis+1)%3,v=(p.axis+2)%3,area=(r:number[])=>r.reduce((n,a,i)=>{const b=r[(i+1)%r.length];return n+pos(a,u)*pos(b,v)-pos(b,u)*pos(a,v);},0)/2;
    const inside=(id:number,r:number[])=>{let yes=false;const x=pos(id,u),y=pos(id,v);for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j],ay=pos(a,v),by=pos(b,v);if((ay>y)!==(by>y)&&x<(pos(b,u)-pos(a,u))*(y-ay)/(by-ay)+pos(a,u))yes=!yes;}return yes;};
    const boundaryIds=rings.flat(),cacheKey=`${p.sign}/${p.axis}/${rings.map(r=>r.map(id=>`${pos(id,u)},${pos(id,v)}`).join(';')).join('/')}`,cached=planarCache.get(cacheKey);if(cached){planarCache.delete(cacheKey);planarCache.set(cacheKey,cached);append(rest,cached.map(i=>boundaryIds[i]));continue;}
    const outer=rings.filter(r=>area(r)*p.sign>0),holes=rings.filter(r=>area(r)*p.sign<0),output:number[]=[];
    for(const r of outer){const owned=holes.filter(h=>inside(h[0],r)),ids=[...r,...owned.flat()],cuts:number[]=[];let count=r.length;for(const h of owned){cuts.push(count);count+=h.length;}const flat=ids.flatMap(id=>[pos(id,u),pos(id,v)]),tri=earcut(flat,cuts);if(deviation(flat,cuts,2,tri)>1e-6){valid=false;break;}
      const t:number[][]=[];for(let i=0;i<tri.length;i+=3){const a=ids[tri[i]],b=ids[tri[i+1]],c=ids[tri[i+2]],cross=(pos(b,u)-pos(a,u))*(pos(c,v)-pos(a,v))-(pos(b,v)-pos(a,v))*(pos(c,u)-pos(a,u));t.push(cross*p.sign>0?[a,b,c]:[a,c,b]);}
      // Earcut may discard collinear boundary vertices. Reinsert each into the
      // triangle edge that contains it, avoiding T junctions in the solid mesh.
      const outputEdges=new Set<string>();for(const tri of t)for(let j=0;j<3;j++)outputEdges.add([tri[j],tri[(j+1)%3]].sort((a,b)=>a-b).join(':'));const needs=new Set<number>();for(const ring of [r,...owned])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(!outputEdges.has([a,b].sort((a,b)=>a-b).join(':'))){needs.add(a);needs.add(b);}}
      const present=new Set(t.flat());for(const id of ids)if(!present.has(id)||needs.has(id)){let found=false;for(let i=0;i<t.length&&!found;i++)for(let j=0;j<3;j++){const a=t[i][j],b=t[i][(j+1)%3],c=t[i][(j+2)%3],dx=pos(b,u)-pos(a,u),dy=pos(b,v)-pos(a,v),px=pos(id,u)-pos(a,u),py=pos(id,v)-pos(a,v),dot=px*dx+py*dy,l=dx*dx+dy*dy;if(l>1e-12&&Math.abs(dx*py-dy*px)<1e-9&&dot>1e-10&&dot<l-1e-10){t[i]=[a,id,c];t.push([id,b,c]);present.add(id);found=true;break;}}if(!found&&!present.has(id)){valid=false;break;}}
      if(!valid)break;append(output,t.flat());
    }
    if(valid){const boundary=new Map<string,number>();for(let i=0;i<output.length;i+=3)for(let j=0;j<3;j++){const key=[output[i+j],output[i+(j+1)%3]].sort((a,b)=>a-b).join(':');boundary.set(key,(boundary.get(key)??0)+1);}const expected=new Set([...p.edges.values()].map(([a,b])=>[a,b].sort((a,b)=>a-b).join(':')));if([...boundary].some(([key,n])=>n!==(expected.has(key)?1:2))||[...expected].some(key=>boundary.get(key)!==1))valid=false;}
    if(valid&&outer.length){const lookup=new Map(boundaryIds.map((id,i)=>[id,i]));planarCache.set(cacheKey,output.map(id=>lookup.get(id)!));while(planarCache.size>32)planarCache.delete(planarCache.keys().next().value!);}
    append(rest,valid&&outer.length?output:p.triangles);
  }
  return rest;
}
