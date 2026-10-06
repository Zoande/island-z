import {worldPoint} from '../shared/destruction';
import {objectRegistry} from '../shared/object-registry';
import type {BuildSolid} from '../shared/build-scene';
import type {DaylightLighting} from '../shared/daylight';
export const MAX_POINT_LIGHTS=24,MAX_LIGHT_WALLS=16,LIGHTING_FLOATS=36+MAX_POINT_LIGHTS*8+MAX_LIGHT_WALLS*8;
const fade=(distance:number)=>{const t=Math.max(0,Math.min(1,(distance-96)/32));return 1-t*t*(3-2*t);};
/** Fixed-size, camera-relative data. The registry owns light parameters; object
 * persistence and model geometry do not depend on the GPU light budget. */
export function packLighting(values:Float32Array,sky:DaylightLighting,camera:ArrayLike<number>,solids:BuildSolid[],budget:number,time:number) {
  values.fill(0);
  values.set([...sky.sun,sky.sunPower],0);values.set([...sky.sunColor,sky.sunPower>sky.moonPower?1:0],4);
  values.set([...sky.moon,sky.moonPower],8);values.set([...sky.moonColor,0],12);
  values.set([...sky.ambientSky,sky.daylight],16);values.set([...sky.ambientGround,sky.twilight],20);
  values.set([...sky.zenith,sky.stars],24);values.set([...sky.horizon,sky.exposure],28);
  const distance=(s:BuildSolid)=>{const p=s.record?.pose?.position??[s.prop.x,s.prop.y,s.prop.z];return Math.hypot(p[0]-camera[0],p[1]-camera[1],p[2]-camera[2]);};
  const lights=solids.filter(s=>!!objectRegistry.get(s.prop.kind)?.light&&distance(s)<128).sort((a,b)=>distance(a)-distance(b)).slice(0,Math.min(budget,MAX_POINT_LIGHTS));
  for(let i=0;i<lights.length;i++) {
    const p=lights[i].prop,l=objectRegistry.get(p.kind)!.light!,phase=p.x*.71+p.z*.37;
    const offset=l.offset??[0,0,0],c=Math.cos(p.rotation),s=Math.sin(p.rotation);
    const flicker=1+.055*Math.sin(time*9+phase)+.035*Math.sin(time*15.7+phase*1.3),at=36+i*8;
    const record=lights[i].record,point=record?.pose?worldPoint(record,[offset[0],l.height+offset[1],offset[2]]):[p.x+(offset[0]*c+offset[2]*s)*p.scale,p.y+(l.height+offset[1])*p.scale,p.z+(-offset[0]*s+offset[2]*c)*p.scale];values.set([point[0]-camera[0],point[1]-camera[1],point[2]-camera[2],l.radius*p.scale],at);
    values.set([...l.color,l.power*flicker*fade(distance(lights[i]))],at+4);
  }
  const walls=lights.length?solids.flatMap(s=>objectRegistry.get(s.prop.kind)?.light?[]:s.colliders.filter(c=>!!c.wall&&lights.some(l=>Math.hypot(c.x-l.prop.x,c.z-l.prop.z)<objectRegistry.get(l.prop.kind)!.light!.radius+c.radius))).sort((a,b)=>Math.hypot(a.x-camera[0],a.z-camera[2])-Math.hypot(b.x-camera[0],b.z-camera[2])).slice(0,MAX_LIGHT_WALLS):[];
  for(let i=0;i<walls.length;i++) {
    const c=walls[i],w=c.wall!,at=36+MAX_POINT_LIGHTS*8+i*8;
    values.set([c.x-camera[0],(c.bottom+c.top)/2-camera[1],c.z-camera[2],w.yaw],at);
    values.set([w.halfWidth,(c.top-c.bottom)/2,w.halfDepth,0],at+4);
  }
  values[32]=lights.length;values[33]=walls.length;return lights.length;
}
