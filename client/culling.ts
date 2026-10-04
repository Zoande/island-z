/** WebGPU's clip depth is [0,1]. All tests include the complete bounding sphere. */
export function frustumPlanes(m:ArrayLike<number>):Float32Array[] {
  const rows=[0,1,2,3].map(r=>[m[r],m[r+4],m[r+8],m[r+12]]);
  const planes=[rows[3].map((v,i)=>v+rows[0][i]),rows[3].map((v,i)=>v-rows[0][i]),rows[3].map((v,i)=>v+rows[1][i]),rows[3].map((v,i)=>v-rows[1][i]),rows[2],rows[3].map((v,i)=>v-rows[2][i])];
  return planes.map(p=>{const len=Math.hypot(p[0],p[1],p[2]);return Float32Array.from(p,v=>v/len);});
}
export function sphereInFrustum(planes:Float32Array[],x:number,y:number,z:number,r:number) {
  return planes.every(p=>p[0]*x+p[1]*y+p[2]*z+p[3]>=-r);
}
