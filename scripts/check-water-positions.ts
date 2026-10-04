import {WorldGenerator} from '../shared/world';
const w=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
for(const [x,z]of [[524,817],[7568,197],[7552,566]]) {
  const hits=[];
  for(const [index,r]of w.water.rivers.entries())for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
    const distance=Math.hypot(x-a.x-dx*t,z-a.z-dz*t),width=a.width*(1-t)+b.width*t;
    if(distance<width*1.5)hits.push({river:index,i,distance:Math.round(distance),width:Math.round(width),level:a.level*(1-t)+b.level*t,parent:r.parent});
  }
  console.log(JSON.stringify({x,z,ground:w.terrainHeight(x,z),bed:w.height(x,z),hits,lakes:w.water.lakes.filter(l=>Math.hypot(x-l.x,z-l.z)<w.water.lakeRadius(l,Math.atan2(z-l.z,x-l.x))).map(l=>({x:l.x,z:l.z,level:l.level}))}));
}
