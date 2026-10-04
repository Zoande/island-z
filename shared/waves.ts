/** Matches geometric ocean waves in waterShader.waveAt. Inland levels stay still. */
const WAVES=[[.92,.38,.085,.48],[.67,.74,.17,.21],[-.38,.92,.37,.065],[.85,-.53,.81,.024]];
export function oceanWaveHeight(x:number,z:number,time:number):number {
  let height=0;
  for(const [dx,dz,frequency,amplitude]of WAVES) {
    const length=Math.hypot(dx,dz),phase=(x*dx/length+z*dz/length)*frequency-time*Math.sqrt(9.81*frequency);
    height+=Math.sin(phase)*amplitude;
  }
  return height;
}
