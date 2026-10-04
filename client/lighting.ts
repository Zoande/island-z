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
  const distance=(s:BuildSolid)=>Math.hypot(s.prop.x-camera[0],s.prop.y-camera[1],s.prop.z-camera[2]);
  const lights=solids.filter(s=>!!objectRegistry.get(s.prop.kind)?.light&&distance(s)<128).sort((a,b)=>distance(a)-distance(b)).slice(0,Math.min(budget,MAX_POINT_LIGHTS));
  for(let i=0;i<lights.length;i++) {
    const p=lights[i].prop,l=objectRegistry.get(p.kind)!.light!,phase=p.x*.71+p.z*.37;
    const flicker=1+.055*Math.sin(time*9+phase)+.035*Math.sin(time*15.7+phase*1.3),at=36+i*8;
    values.set([p.x-camera[0],p.y+l.height*p.scale-camera[1],p.z-camera[2],l.radius*p.scale],at);
    values.set([...l.color,l.power*flicker*fade(distance(lights[i]))],at+4);
  }
  const walls=lights.length?solids.filter(s=>!!s.collider.wall&&lights.some(l=>Math.hypot(s.prop.x-l.prop.x,s.prop.z-l.prop.z)<objectRegistry.get(l.prop.kind)!.light!.radius+s.collider.radius)).sort((a,b)=>distance(a)-distance(b)).slice(0,MAX_LIGHT_WALLS):[];
  for(let i=0;i<walls.length;i++) {
    const s=walls[i],c=s.collider,w=c.wall!,at=36+MAX_POINT_LIGHTS*8+i*8;
    values.set([c.x-camera[0],(c.bottom+c.top)/2-camera[1],c.z-camera[2],w.yaw],at);
    values.set([w.halfWidth,(c.top-c.bottom)/2,w.halfDepth,0],at+4);
  }
  values[32]=lights.length;values[33]=walls.length;return lights.length;
}
