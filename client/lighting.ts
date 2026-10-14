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
  values.set(sky.sun,0);values[3]=sky.sunPower;values.set(sky.sunColor,4);values[7]=sky.sunPower>sky.moonPower?1:0;
  values.set(sky.moon,8);values[11]=sky.moonPower;values.set(sky.moonColor,12);values[15]=0;
  values.set(sky.ambientSky,16);values[19]=sky.daylight;values.set(sky.ambientGround,20);values[23]=sky.twilight;
  values.set(sky.zenith,24);values[27]=sky.stars;values.set(sky.horizon,28);values[31]=sky.exposure;
  const distance=(s:BuildSolid)=>{const p=s.record?.pose?.position??[s.prop.x,s.prop.y,s.prop.z];return Math.hypot(p[0]-camera[0],p[1]-camera[1],p[2]-camera[2]);};
  // Cache each score once. The prior comparator recomputed a 3D hypot many
  // times for the same candidate during sort.
  const lights:{solid:BuildSolid;distance:number;definition:ReturnType<typeof objectRegistry.get>}[]=[];
  for(const solid of solids) {
    const definition=objectRegistry.get(solid.prop.kind);
    if(!definition?.light)continue;
    const d=distance(solid);
    if(d<128)lights.push({solid,distance:d,definition});
  }
  lights.sort((a,b)=>a.distance-b.distance);
  lights.length=Math.min(lights.length,Math.max(0,Math.min(budget,MAX_POINT_LIGHTS)));
  for(let i=0;i<lights.length;i++) {
    const solid=lights[i].solid,p=solid.prop,l=lights[i].definition!.light!,phase=p.x*.71+p.z*.37;
    const offset=l.offset??[0,0,0],c=Math.cos(p.rotation),s=Math.sin(p.rotation);
    const flicker=1+.055*Math.sin(time*9+phase)+.035*Math.sin(time*15.7+phase*1.3),at=36+i*8;
    const record=solid.record,point=record?.pose?worldPoint(record,[offset[0],l.height+offset[1],offset[2]]):[p.x+(offset[0]*c+offset[2]*s)*p.scale,p.y+(l.height+offset[1])*p.scale,p.z+(-offset[0]*s+offset[2]*c)*p.scale];values.set([point[0]-camera[0],point[1]-camera[1],point[2]-camera[2],l.radius*p.scale],at);
    values.set(l.color,at+4);values[at+7]=l.power*flicker*fade(lights[i].distance);
  }
  const walls:{collider:BuildSolid['colliders'][number];distance:number}[]=[];
  if(lights.length)for(const solid of solids) {
    if(objectRegistry.get(solid.prop.kind)?.light)continue;
    for(const collider of solid.colliders) {
      if(!collider.wall)continue;
      let illuminated=false;
      for(const light of lights) {
        const radius=light.definition!.light!.radius+collider.radius;
        if(Math.hypot(collider.x-light.solid.prop.x,collider.z-light.solid.prop.z)<radius){illuminated=true;break;}
      }
      if(illuminated)walls.push({collider,distance:Math.hypot(collider.x-camera[0],collider.z-camera[2])});
    }
  }
  walls.sort((a,b)=>a.distance-b.distance);walls.length=Math.min(walls.length,MAX_LIGHT_WALLS);
  for(let i=0;i<walls.length;i++) {
    const c=walls[i].collider,w=c.wall!,at=36+MAX_POINT_LIGHTS*8+i*8;
    values.set([c.x-camera[0],(c.bottom+c.top)/2-camera[1],c.z-camera[2],w.yaw],at);
    values.set([w.halfWidth,(c.top-c.bottom)/2,w.halfDepth,0],at+4);
  }
  values[32]=lights.length;values[33]=walls.length;return lights.length;
}
