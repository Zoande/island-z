import type {GeometryData} from './geometry';
/** Shared timber/stone materials, with procedural flame cards. No model files. */
export function torchGeometry():GeometryData[] {
  const parts:GeometryData[]=[];
  const cylinder=(bottom:number,top:number,r0:number,r1:number,material:string)=>{
    const vertices:number[]=[],indices:number[]=[],sides=12;
    const vertex=(x:number,y:number,z:number,nx:number,ny:number,nz:number,u:number,v:number)=>vertices.push(x,y,z,nx,ny,nz,u,v,0,0,0,0,0,0,0,0);
    for(let i=0;i<sides;i++) {
      const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2,n=(a+b)/2,ny=(r0-r1)/(top-bottom),length=Math.hypot(1,ny),start=vertices.length/16;
      for(const [angle,y,r,u]of [[a,bottom,r0,i/sides],[b,bottom,r0,(i+1)/sides],[b,top,r1,(i+1)/sides],[a,top,r1,i/sides]])vertex(Math.cos(angle)*r,y,Math.sin(angle)*r,Math.cos(n)/length,ny/length,Math.sin(n)/length,u,y);
      indices.push(start,start+1,start+2,start,start+2,start+3);
      for(const [y,r,normal]of [[bottom,r0,-1],[top,r1,1]]){const at=vertices.length/16;vertex(0,y,0,0,normal,0,.5,.5);vertex(Math.cos(a)*r,y,Math.sin(a)*r,0,normal,0,0,0);vertex(Math.cos(b)*r,y,Math.sin(b)*r,0,normal,0,1,1);indices.push(at,at+1,at+2);}
    }
    parts.push({vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material});
  };
  cylinder(-.14,1.52,.035,.048,'torch-wood');
  cylinder(1.40,1.67,.07,.14,'torch-head');
  cylinder(1.35,1.41,.055,.055,'torch-head');
  const vertices:number[]=[],indices:number[]=[];
  for(let i=0;i<3;i++) {
    const angle=i*Math.PI/3,c=Math.cos(angle),s=Math.sin(angle),at=vertices.length/16;
    for(const [x,y,u,v]of [[-.24,1.60,0,0],[.24,1.60,1,0],[.24,2.14,1,1],[-.24,2.14,0,1]])vertices.push(x*c,y,x*s,-s,0,c,u,v,0,0,0,0,0,0,0,0);
    indices.push(at,at+1,at+2,at,at+2,at+3);
  }
  parts.push({vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material:'torch-flame'});return parts;
}
