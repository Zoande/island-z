import {CHARACTER} from '../shared/character';
import type {GeometryData} from './geometry';
export function capsuleGeometry():GeometryData{
 const vertices:number[]=[],indices:number[]=[],segments=12,rings=12,r=CHARACTER.radius,half=CHARACTER.height/2-r;
 for(let j=0;j<=rings;j++){const a=j/rings*Math.PI,ny=Math.cos(a),radius=Math.sin(a)*r,y=CHARACTER.height/2+ny*r+(ny>=0?half:-half);for(let i=0;i<=segments;i++){const b=i/segments*Math.PI*2,nx=Math.cos(b)*Math.sin(a),nz=Math.sin(b)*Math.sin(a);vertices.push(Math.cos(b)*radius,y,Math.sin(b)*radius,nx,ny,nz,i/segments,j/rings,0,0,0,0,0,0,0,0);}}
 for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material:'stone'};
}
