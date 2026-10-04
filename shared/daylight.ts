export const DAYLIGHT={daySeconds:3*60*60,nightSeconds:1.5*60*60,startHour:9};
const wrap=(n:number,range:number)=>(n%range+range)%range;
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(a:number,b:number,n:number)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};
type Color=[number,number,number];
const mix=(a:Color,b:Color,t:number):Color=>a.map((n,i)=>n+(b[i]-n)*t)as Color;
const normalize=(v:Color):Color=>{const length=Math.hypot(...v);return v.map(n=>n/length)as Color;};
export interface DaylightSnapshot {phase:number;anchorSeconds:number;automatic:boolean}
/** Pure real-time clock. Unequal day/night durations do not distort solar motion
 * within either half of the cycle. Snapshots preserve time across reloads. */
export class DaylightClock {
  private anchorPhase:number;private anchorSeconds:number;automatic:boolean;
  constructor(now:number,saved?:unknown) {
    const s=saved as DaylightSnapshot|undefined,valid=s&&Number.isFinite(s.phase)&&s.phase>=0&&s.phase<1&&Number.isFinite(s.anchorSeconds)&&typeof s.automatic==='boolean';
    this.anchorPhase=valid?s.phase:hourPhase(DAYLIGHT.startHour);this.anchorSeconds=valid?s.anchorSeconds:now;this.automatic=valid?s.automatic:true;
  }
  phase(now:number){return wrap(this.anchorPhase+(this.automatic?Math.max(0,now-this.anchorSeconds)/(DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds):0),1);}
  hour(now:number){return phaseHour(this.phase(now));}
  setHour(hour:number,now:number){if(!Number.isFinite(hour)||!Number.isFinite(now))return;this.anchorPhase=hourPhase(hour);this.anchorSeconds=now;}
  setAutomatic(enabled:boolean,now:number){this.anchorPhase=this.phase(now);this.anchorSeconds=now;this.automatic=enabled;}
  snapshot(now:number):DaylightSnapshot{return {phase:this.phase(now),anchorSeconds:now,automatic:this.automatic};}
}
export function hourPhase(hour:number) {
  const h=wrap(hour-6,24),dayFraction=DAYLIGHT.daySeconds/(DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds);
  return h<12?h/12*dayFraction:dayFraction+(h-12)/12*(1-dayFraction);
}
export function phaseHour(phase:number) {
  const p=wrap(phase,1),dayFraction=DAYLIGHT.daySeconds/(DAYLIGHT.daySeconds+DAYLIGHT.nightSeconds);
  return wrap(p<dayFraction?6+p/dayFraction*12:18+(p-dayFraction)/(1-dayFraction)*12,24);
}
export interface DaylightLighting {
  hour:number;sun:Color;moon:Color;primary:Color;sunPower:number;moonPower:number;
  sunColor:Color;moonColor:Color;ambientSky:Color;ambientGround:Color;zenith:Color;horizon:Color;
  daylight:number;twilight:number;stars:number;exposure:number;label:string;
}
export function daylightLighting(hour:number):DaylightLighting {
  hour=wrap(hour,24);const angle=(hour-6)/12*Math.PI,sun=normalize([Math.cos(angle),Math.sin(angle)*.91,-Math.sin(angle)*.42]);
  const moon=sun.map(n=>-n)as Color,daylight=smooth(-.12,.20,sun[1]),twilight=Math.exp(-(((sun[1]-.02)/.15)**2));
  const sunPower=3.5*smooth(-.06,.16,sun[1]),moonPower=.16*(1-smooth(-.10,.08,sun[1]))*smooth(0,.25,moon[1]);
  return {hour,sun,moon,primary:sunPower>moonPower?sun:moon,sunPower,moonPower,
    sunColor:mix([1,.40,.14],[1,.94,.84],smooth(.02,.45,sun[1])),moonColor:[.43,.61,1],
    ambientSky:mix([.012,.020,.038],[.33,.43,.54],daylight),ambientGround:mix([.004,.006,.011],[.115,.12,.085],daylight),
    zenith:mix([.003,.007,.022],[.11,.30,.58],daylight),horizon:mix(mix([.013,.024,.052],[.64,.77,.86],daylight),[.75,.32,.17],twilight*.48),
    daylight,twilight,stars:1-smooth(-.18,-.02,sun[1]),exposure:1.08+(1-daylight)*.32,
    label:sun[1]>.18?'Daylight':sun[1]<-.18?'Night':hour<12?'Dawn':'Dusk'};
}
/** Tiny, shared increments retain static shadow caches as the sun moves. */
export function shadowDirection(direction:Color):Color {return normalize(direction.map(n=>Math.round(n*4096)/4096)as Color);}
