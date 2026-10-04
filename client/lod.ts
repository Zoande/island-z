export interface LodEntry {level:number;threshold:number;outgoing:boolean}
export interface LodBoundary {distance:number;width:number}
export const TREE_LOD:LodBoundary[]=[{distance:80,width:30},{distance:210,width:60},{distance:400,width:160}];
export function lodEntries(distance:number,boundaries:LodBoundary[]):LodEntry[] {
  for(let level=0;level<boundaries.length;level++) {
    const b=boundaries[level],start=b.distance-b.width/2,end=b.distance+b.width/2;
    if(distance<start)return [{level,threshold:1,outgoing:false}];
    if(distance<end) {const t=(distance-start)/b.width,s=t*t*(3-2*t);return [{level,threshold:s,outgoing:true},{level:level+1,threshold:s,outgoing:false}];}
  }
  return [{level:boundaries.length,threshold:1,outgoing:false}];
}
export function rangeFade(distance:number,range:number) {
  const t=Math.max(0,Math.min(1,(range-distance)/(range*.35)));return t*t*(3-2*t);
}
// Complementary coverage across both models: the same pixel belongs to one LOD.
export const lodShader=/*wgsl*/`
fn lodNoise(pixel:vec2u,salt:u32)->f32 {
  var h=((pixel.x*374761393u) ^ (pixel.y*668265263u)) ^ salt;
  h=(h ^ (h>>16u))*2246822519u;
  h=(h ^ (h>>13u))*3266489917u;
  return (f32((h ^ (h>>16u))>>8u)+.5)/16777216.0;
}
fn lodVisible(pixel:vec2f,fade:vec3f)->bool {
  if(fade.x>=1.0 && fade.y<.5 && fade.z>=1.0){return true;}
  let p=vec2u(pixel);
  let sample=lodNoise(p,0u);
  let coverage=lodNoise(p,15485863u);
  return select((sample < fade.x),(sample >= fade.x),(fade.y > .5)) && (coverage < fade.z);
}`;
