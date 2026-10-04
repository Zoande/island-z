import { chromium } from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const label=process.argv[2]??'baseline';
const suite=process.argv[3]==='suite';
const movement=process.argv[3]==='movement';
const walk=process.argv[3]==='walk'||movement;
const compare=process.argv[3]==='compare';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  const began=Date.now();await page.goto('http://127.0.0.1:5173/?profile=1');
  await page.waitForTimeout(2000);
  await page.waitForFunction(()=>{const a=(window as any).__island;if(a?.failed||document.getElementById('overlay-title')?.textContent==='The viewer needs attention')throw new Error(document.getElementById('message')?.textContent??'Failed');return a?.player.ready&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});
  const gpu=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter(),i=a?.info;return {available:!!a,info:i?{vendor:i.vendor,architecture:i.architecture,device:i.device,description:i.description}:null,features:a?[...a.features]:[]};});console.log(JSON.stringify(gpu));
  const reports=[];
  mkdirSync('artifacts',{recursive:true});
  const startup={readySeconds:(Date.now()-began)/1000,...await page.evaluate(()=>{const s=(window as any).__island.stream;return {worldGenerationMs:s.worldGenerationMs,generationSamples:s.generationSamples};})};
  if(compare)await page.evaluate(()=>{const r=(window as any).__island.renderer,render=r.render.bind(r);r.render=(c:any,s:any)=>render(c,s,123);});
  const cases=movement?[]:compare?[{yaw:0,front:false,cache:false},{yaw:0,front:true,cache:false},{yaw:0,front:true,cache:true}]:[0,Math.PI,Math.PI/2].map(yaw=>({yaw,front:true,cache:true}));
  for(const state of cases) {
    await page.evaluate(state=>{const a=(window as any).__island;a.camera.yaw=state.yaw;a.renderer.frontToBack=state.front;a.renderer.cacheStaticShadows=state.cache;},state);
    await page.waitForTimeout(1000);await page.evaluate(()=>(window as any).__island.perf.reset());
    await page.waitForTimeout(10000);
    reports.push(await page.evaluate(()=>{const a=(window as any).__island;return {...a.perf.export(),position:[...a.camera.position],yaw:a.camera.yaw,frontToBack:a.renderer.frontToBack,cacheStaticShadows:a.renderer.cacheStaticShadows,rendererErrors:a.renderer.errors};}));
    await page.screenshot({path:`artifacts/performance-${label}-${reports.length}.png`});
  }
  let validation:unknown;
  if(suite||walk) {
    await page.evaluate(()=>{const a=(window as any).__island;a.camera.yaw=0;a.perf.reset();});
    await page.locator('#world').click({position:{x:800,y:450}});
    await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#world'));
    // Wait for pointerlockchange/focus events, which clear held input state.
    await page.waitForTimeout(500);
    await page.keyboard.down('w');await page.keyboard.down('Shift');
    await page.waitForFunction(()=>{const a=(window as any).__island;return a.camera.keys.has('KeyW')&&a.camera.keys.has('ShiftLeft');});
    await page.waitForTimeout(500);
    const startPosition=await page.evaluate(()=>{const a=(window as any).__island;a.perf.reset();return [...a.camera.position];});
    await page.waitForTimeout(15000);
    await page.keyboard.up('w');await page.keyboard.up('Shift');
    const measured=await page.evaluate(()=>{const a=(window as any).__island;return {performance:a.perf.export(),position:[...a.camera.position],grounded:a.player.grounded};});
    const walking={...measured,startPosition,distanceMeters:Math.hypot(measured.position[0]-startPosition[0],measured.position[2]-startPosition[2])};
    if(walking.distanceMeters<5)throw new Error(`Keyboard walking moved only ${walking.distanceMeters.toFixed(2)} m.`);
    await page.screenshot({path:`artifacts/performance-${label}-walking.png`});
    const travel=[];
    // Developer-only sampling of widely separated regions; no teleport UI.
    for(const [x,z]of suite?[[0,0],[-5000,0],[5000,-4000],[2457,10000]]:[]) {
      await page.evaluate(([x,z])=>{const a=(window as any).__island;document.exitPointerLock();a.camera.spawn(x,a.world.height(x,z),z);a.stream.update(x,z,a.renderer.distance);},[x,z]);
      await page.waitForFunction(()=>{const a=(window as any).__island;return a.player.ready&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});
      await page.waitForTimeout(3500);
      travel.push(await page.evaluate(()=>{const a=(window as any).__island;return {position:[...a.camera.position],resources:a.renderer.resources,estimatedGpuBytes:a.renderer.estimatedGpuBytes,pending:a.stream.loading};}));
      await page.screenshot({path:`artifacts/performance-${label}-travel-${travel.length}.png`});
    }
    await page.evaluate(()=>{const a=(window as any).__island;a.renderer.sunElevation=25;});await page.waitForTimeout(2000);
    for(const quality of ['low','high','medium']) {
      await page.evaluate(q=>{const a=(window as any).__island;a.renderer.quality=q;a.stream.update(a.camera.position[0],a.camera.position[2],a.renderer.distance);},quality);
      await page.waitForFunction(()=>{const a=(window as any).__island;return a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});
    }
    validation={walking,travel,final:await page.evaluate(()=>(window as any).__island.renderer.resources)};
  }
  mkdirSync('artifacts',{recursive:true});writeFileSync(`artifacts/performance-${label}.json`,JSON.stringify({gpu,errors,startup,reports,validation},null,2));
  await page.screenshot({path:`artifacts/performance-${label}.png`});console.log(JSON.stringify({label,errors,reports:reports.map(r=>({fps:r.fps,cpu:r.cpu,gpu:r.gpu,counters:r.counters}))}));
  if(errors.length)throw new Error(`Browser reported ${errors.length} errors: ${errors.join('\n')}`);
}finally {await browser.close();}
