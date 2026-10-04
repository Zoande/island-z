import {mkdirSync,writeFileSync} from 'node:fs';
import {WorldGenerator} from '../shared/world';
const world=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
const rivers=world.water.rivers.map((r,i)=>({id:i,kind:r.kind,parent:r.parent,joinIndex:r.joinIndex,length:Math.round(r.points.at(-1)!.distance),
  maxWidth:Math.round(Math.max(...r.points.map(p=>p.width))*2),startLevel:Math.round(r.points[0].level),endLevel:r.points.at(-1)!.level,
  maxFill:Math.round(Math.max(...r.points.map(p=>p.level-world.terrainHeight(p.x,p.z)))),mouth: r.points.at(-1)!.mouth}));
console.log(JSON.stringify({rivers,lakes:world.water.lakes.map(l=>({x:Math.round(l.x),z:Math.round(l.z),radius:Math.round(l.radius),level:Math.round(l.level)}))},null,2));
const n=180,size=30720,map:number[][]=[];
for(let j=0;j<n;j++) {const row:number[]=[];for(let i=0;i<n;i++) {const x=(i/(n-1)-.5)*size,z=(j/(n-1)-.5)*size,h=world.terrainHeight(x,z),water=world.water.sample(x,z);row.push(water&&water.level>h?water.level:h);}map.push(row);}
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/water-review.json',JSON.stringify({size,map,lakes:world.water.lakes,rivers:world.water.rivers}));
