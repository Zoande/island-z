import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[],reports:unknown[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function ready() {
  await page.waitForFunction(()=>{const a=(window as any).__island;if(a?.failed)throw new Error(document.getElementById('message')!.textContent!);return (a?.player.ready||a?.camera.savedUpdate)&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});
}
async function pause(){await page.evaluate('const a=window.__island;a.camera.savedUpdate=a.camera.update.bind(a.camera);a.camera.update=()=>{};');}
async function resume(){await page.evaluate(()=>{const a=(window as any).__island;a.camera.update=a.camera.savedUpdate;delete a.camera.savedUpdate;a.camera.update(1/60);});}
async function state(label:string) {
  const result=await page.evaluate(label=>{const a=(window as any).__island,p=a.player;return {label,position:[...a.camera.position],velocity:[...p.velocity],swimming:p.swimming,underwater:p.underwater,oxygen:p.oxygen,stamina:p.stamina,respawns:p.respawns,resources:a.renderer.resources,errors:a.renderer.errors,performance:a.perf.summary()};},label);
  reports.push(result);console.log(JSON.stringify({...result,performance:undefined}));return result;
}
try {
  await page.goto('http://127.0.0.1:5173/?profile=1');await page.waitForTimeout(2000);await ready();mkdirSync('artifacts',{recursive:true});
  const home=await page.evaluate(()=>[...(window as any).__island.player.feet]);
  await page.screenshot({path:'artifacts/swimming-land.png'});
  await page.locator('#world').click({position:{x:800,y:450}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.waitForTimeout(300);
  await page.keyboard.down('w');await page.keyboard.down('Shift');await page.waitForTimeout(500);
  const ramp=await state('sprint-ramp');await page.waitForTimeout(2400);const sprint=await state('sprint-full');
  if(Math.hypot(...sprint.velocity.filter((_:number,i:number)=>i!==1))<9.5||Math.hypot(ramp.velocity[0],ramp.velocity[2])>6)throw new Error('Sprint acceleration failed.');
  await page.keyboard.up('w');await page.keyboard.up('Shift');await page.keyboard.press('Escape');
  // Visit shallow seabed using developer diagnostics; game UI has no teleport tool.
  await pause();await page.evaluate(()=>{
    const a=(window as any).__island,w=a.world,x=a.camera.position[0];let low=a.camera.position[2],high=17000;
    for(let i=0;i<30;i++){const z=(low+high)/2;if(w.height(x,z)>-7)low=z;else high=z;}
    const z=(low+high)/2;a.camera.spawn(x,-4.5,z);a.camera.yaw=0;a.camera.pitch=-.35;a.stream.update(x,z,a.renderer.distance);
  });await ready();await resume();await page.waitForTimeout(1000);const sea=await state('ocean-underwater');
  if(!sea.swimming||!sea.underwater)throw new Error('Ocean did not activate swimming.');
  await page.screenshot({path:'artifacts/swimming-ocean.png'});
  await page.locator('#world').click({position:{x:800,y:450}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.waitForTimeout(300);
  await page.keyboard.down('Space');await page.waitForTimeout(3400);await page.keyboard.up('Space');const surface=await state('ocean-surface');
  if(surface.underwater||surface.position[1]>1)throw new Error('Surface ascent failed.');await page.screenshot({path:'artifacts/swimming-surface.png'});
  await page.keyboard.down('Shift');await page.waitForTimeout(2000);await page.keyboard.up('Shift');const dive=await state('ocean-dive');if(!dive.underwater||dive.velocity[1]>-1)throw new Error('Shift dive failed.');
  await page.keyboard.press('Escape');
  await pause();for(const quality of ['low','high','medium']) {
    await page.evaluate(quality=>{const a=(window as any).__island;a.renderer.quality=quality;},quality);await ready();await page.waitForTimeout(500);
  }
  // Use an actual elevated lake, with a shallow bed and nearby algae.
  await page.evaluate(()=>{
    const a=(window as any).__island,w=a.world,l=w.water.lakes.find((l:any)=>l.depth>3),props=w.props(l.x-64,l.z-64,128),algae=props.find((p:any)=>p.kind==='algae');
    const x=algae?.x??l.x,z=algae?.z??l.z,water=w.surfaceWater(x,z);if(!water)throw new Error('No wet lake sample');
    a.camera.spawn(x,water.level-3.5,z);a.camera.yaw=.4;a.camera.pitch=-.4;a.stream.update(x,z,a.renderer.distance);
  });await ready();await resume();await page.waitForTimeout(1000);const lake=await state('lake-underwater');
  if(!lake.underwater||lake.position[1]<1)throw new Error('Elevated lake swimming failed.');await page.screenshot({path:'artifacts/swimming-lake.png'});
  await page.evaluate(()=>{const a=(window as any).__island;a.player.oxygen=30;a.player.stamina=35;});await page.waitForTimeout(300);await page.screenshot({path:'artifacts/swimming-meters.png'});
  // Advance only the oxygen clock; this checks the integrated camera reset without a 60s pause.
  await page.evaluate(()=>{const a=(window as any).__island;a.camera.keys.add('KeyW');a.camera.update(31);});
  await ready();const reset=await state('drowned-home');
  if(reset.respawns!==1||reset.underwater||Math.hypot(reset.position[0]-home[0],reset.position[2]-home[2])>.01)throw new Error('Drowning did not reset to initial spawn.');
  await page.screenshot({path:'artifacts/swimming-respawn.png'});
  if(errors.length)throw new Error(errors.join('\n'));
  writeFileSync('artifacts/swimming-validation.json',JSON.stringify({errors,reports},null,2));
}finally {await browser.close();}
