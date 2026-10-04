import { performance } from 'node:perf_hooks';
import {WorldGenerator} from '../shared/world';
for(const seed of ['island-z','silver-coast','test-42'])for(const size of [1024,30720,61440]) {
  const start=performance.now(),world=new WorldGenerator({seed,islandSizeMeters:size});
  const mismatches=[];let exposed=0,maxExposed=0;
  for(const river of world.water.rivers)for(let i=1;i<river.points.length-1;i++) {
    const p=river.points[i],a=river.points[i-1],b=river.points[i+1],length=Math.hypot(b.x-a.x,b.z-a.z);
    if((p.lake??0)>.9||world.coastDistance(p.x,p.z)<100)continue;
    for(const side of [-1,1]) {
      const x=p.x-(b.z-a.z)/length*p.width*1.2*side,z=p.z+(b.x-a.x)/length*p.width*1.2*side;
      const water=world.water.sample(x,z);if(water?.kind==='lake'&&water.level>=p.level-.1)continue;
      const above=p.level-world.terrainHeight(x,z);if(above>2) {exposed++;maxExposed=Math.max(maxExposed,above);}
    }
  }
  for(const [i,r]of world.water.rivers.entries())for(const [j,p]of r.points.entries())if((p.lake??0)>.999) {
    const lakes=world.water.lakes.filter(l=>Math.hypot(p.x-l.x,p.z-l.z)<world.water.lakeRadius(l,Math.atan2(p.z-l.z,p.x-l.x)));
    if(!lakes.some(l=>Math.abs(p.level-l.level)<.01))mismatches.push({river:i,point:j,level:p.level,lakeLevels:lakes.map(l=>l.level)});
  }
  console.log(JSON.stringify({seed,size,milliseconds:Math.round(performance.now()-start),...world.water.metadataSize,exposed,maxExposed:Math.round(maxExposed),mismatches:mismatches.slice(0,5),mismatchCount:mismatches.length}));
}
