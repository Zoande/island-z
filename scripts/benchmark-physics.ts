import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {recordFor} from '../shared/destruction';
const {SolidPhysics,initializePhysics}=await import(pathToFileURL(resolve(process.env.PHYSICS_MODULE??'shared/solid-physics.ts')).href);
await initializePhysics();
const physics=new SolidPhysics();
try{
 for(let i=0;i<200;i++)physics.add(recordFor('wall-'+i,{kind:'wall-wood',x:i===0?0:50+i*4,y:0,z:0,rotation:0,variant:0,scale:1},[]),[{center:[0,1,0],half:[1,1,.1]}],undefined,false);
 const run=()=>physics.movement([0,0,5],[0,0,-.08],.32,2.16,.28,.3);
 for(let i=0;i<1000;i++)run();
 const samples:number[]=[];let result;
 for(let trial=0;trial<5;trial++){const begin=performance.now();for(let i=0;i<5000;i++)result=run();samples.push((performance.now()-begin)/5000);}
 const output={solids:physics.solids.size,callsPerTrial:5000,msPerCall:samples,medianMs:[...samples].sort((a,b)=>a-b)[2],result,hash:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
 mkdirSync('artifacts',{recursive:true});writeFileSync(`artifacts/physics-${process.argv[2]??'current'}.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{physics.dispose();}
