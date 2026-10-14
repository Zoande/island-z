import {advanceHealth,applyDamage,healthyBody} from '../shared/health';
import {Character,idleInput} from '../shared/character';

const healthy=healthyBody(),injured=applyDamage(healthy,{part:'leftArm',amount:60,bleeding:'moderate'});
const env={surface:()=>({height:0,normal:[0,1,0] as [number,number,number]}),colliders:()=>[]};
function measure(name:string,run:()=>unknown,iterations=120_000){
  for(let i=0;i<3_000;i++)run();
  const samples:number[]=[];
  for(let repeat=0;repeat<7;repeat++){const start=performance.now();for(let i=0;i<iterations;i++)run();samples.push((performance.now()-start)*1e6/iterations);}
  samples.sort((a,b)=>a-b);const median=samples[3];
  return {name,medianNsPerStep:+median.toFixed(1),stepsPerSecond:Math.round(1e9/median),samplesNs:samples.map(value=>+value.toFixed(1))};
}
const healthyCharacter=new Character(env),injuredCharacter=new Character(env);
healthyCharacter.spawn(0,0,0);injuredCharacter.spawn(0,0,0);injuredCharacter.damage('leftArm',60,'moderate');
const resetBleedingStep=()=>{injuredCharacter.health=injured;injuredCharacter.update(1/120,idleInput);};
const results=[
  measure('advanceHealth healthy 1/120s',()=>advanceHealth(healthy,1/120)),
  measure('advanceHealth moderate bleed 1/120s',()=>advanceHealth(injured,1/120)),
  measure('Character.update healthy 1/120s',()=>healthyCharacter.update(1/120,idleInput)),
  measure('Character.update fixed moderate bleed 1/120s (health reset each step)',resetBleedingStep),
];
console.log(JSON.stringify({benchmark:'Node.js Character and canonical health simulation',runtime:process.version,results},null,2));
