import {objectDefinition} from '../shared/object-registry';
import type {GeometryData} from './geometry';
import {objectBoxes} from '../shared/build-parts';
/** Small static meshes share the ImageGen timber and existing rock materials. */
export function wallGeometry(id:string,aperture?:'door'|'window'):GeometryData {
  const wall=objectDefinition(id).wall!,vertices:number[]=[],indices:number[]=[];
  const rawBox=(x:number,y:number,z:number,w:number,h:number,d:number,uvOffset=0)=>{
    const faces=[
      {n:[0,0,1],p:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],u:w,v:h},
      {n:[0,0,-1],p:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],u:w,v:h},
      {n:[1,0,0],p:[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]],u:d,v:h},
      {n:[-1,0,0],p:[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]],u:d,v:h},
      {n:[0,1,0],p:[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]],u:w,v:d},
      {n:[0,-1,0],p:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]],u:w,v:d},
    ];
    for(const face of faces){const start=vertices.length/16;face.p.forEach((p,i)=>vertices.push(x+p[0]*w/2,y+p[1]*h/2,z+p[2]*d/2,...face.n,(i===1||i===2?face.u:0)+uvOffset,i>1?0:face.v,0,0,0,0,0,0,0,0));indices.push(start,start+1,start+2,start,start+2,start+3);}
  };
  const boxes=objectBoxes({kind:id as any,x:0,y:0,z:0,rotation:0,scale:1,variant:0,aperture})!;
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,uvOffset=0)=>{
    for(const region of boxes){const a=Math.max(x-w/2,region.center[0]-region.size[0]/2),b=Math.min(x+w/2,region.center[0]+region.size[0]/2),low=Math.max(y-h/2,region.center[1]-region.size[1]/2),high=Math.min(y+h/2,region.center[1]+region.size[1]/2);if(b-a>.001&&high-low>.001)rawBox((a+b)/2,(low+high)/2,z,b-a,high-low,d,uvOffset);}
  };
  if(id==='wall-wood') {
    const count=12,width=wall.width/count;
    for(let i=0;i<count;i++)box(-wall.width/2+(i+.5)*width,wall.height/2,0,width-.004,wall.height,.16,i*.173);
    for(const y of [.25,wall.height/2,wall.height-.25])box(0,y,-.09,wall.width,.12,.04);
  }else {
    const rows=id==='wall-brick'?10:5,unit=id==='wall-brick'?.50:.75,h=wall.height/rows;
    for(let row=0;row<rows;row++) {
      const shift=row%2?unit/2:0;
      for(let left=-wall.width/2-shift;left<wall.width/2;left+=unit) {
        const a=Math.max(-wall.width/2,left),b=Math.min(wall.width/2,left+unit);if(b-a<.01)continue;
        box((a+b)/2,(row+.5)*h,Math.sin(left*17+row)*.006,b-a-.006,h-.006,wall.depth-.018,left*3.17+row*.41);
      }
    }
  }
  return {vertices:new Float32Array(vertices),indices:new Uint32Array(indices),material:objectDefinition(id).material??id};
}
