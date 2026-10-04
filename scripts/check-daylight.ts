import {chromium,type Route} from 'playwright';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createWorldServer} from '../server/app';
import {BuildStore} from '../server/build-store';
import {solvePlacement} from '../shared/build-placement';
import {CHARACTER} from '../shared/character';
import type {BuildRequest} from '../shared/object-registry';
mkdirSync('artifacts',{recursive:true});const prefix=resolve('artifacts/daylight-browser-save-'),directory=mkdtempSync(prefix);
const config=await(await fetch('http://127.0.0.1:5173/api/world')).json();let server=createWorldServer(config,{saveDirectory:directory});
async function listen(){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address()as AddressInfo).port}`;}
let serverUrl=await listen();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[],reports:unknown[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/api/builds**',async(route:Route)=>{const url=new URL(route.request().url()),response=await route.fetch({url:serverUrl+url.pathname+url.search});await route.fulfill({response});});
async function ready(){await page.waitForFunction(()=>{const a=(window as any).__island;if(a?.failed)throw new Error(document.getElementById('message')!.textContent!);return a?.player.ready&&a.building.connection==='Connected'&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});}
async function hour(value:number){await page.evaluate(value=>{const slider=document.getElementById('daylight-time')as HTMLInputElement;slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.waitForTimeout(450);}
async function state(label:string){const state=await page.evaluate(label=>{const a=(window as any).__island;return {label,hour:a.renderer.daylightHour,automatic:a.daylight.automatic,lights:a.renderer.activePointLights,lightWalls:a.renderer.lightingValues[33],objects:a.building.scene.placed.values().map((s:any)=>s.object),errors:a.renderer.errors,resources:a.renderer.resources,performance:a.perf.summary()};},label);reports.push(state);console.log(JSON.stringify({...state,performance:undefined}));return state;}
try {
  await page.goto('http://127.0.0.1:5173/?profile=1');await page.waitForTimeout(1500);await ready();
  await page.locator('.panel-head').click();await page.locator('#daylight-auto').uncheck();await page.locator('[data-hour="12"]').click();await page.waitForTimeout(400);
  if(!(await page.locator('#daylight-value').textContent())?.includes('12:00'))throw new Error('Noon control failed');await page.screenshot({path:'artifacts/daylight-settings.png'});
  await page.locator('.panel-head').click();await page.screenshot({path:'artifacts/daylight-noon.png'});await state('noon');
  await hour(18);await page.screenshot({path:'artifacts/daylight-dusk.png'});await state('dusk');
  await hour(0);await page.screenshot({path:'artifacts/daylight-night.png'});await state('night');
  // Actual torch hotbar/preview/placement input, backed by an isolated save server.
  await page.locator('#world').click({position:{x:800,y:400}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.keyboard.press('6');
  await page.evaluate(()=>{const a=(window as any).__island;a.camera.pitch=-.50;for(let i=0;i<36;i++){a.camera.yaw=i*Math.PI*2/36;a.building.update(0);if(a.building.preview?.valid)return;}throw new Error('No clear torch site');});await page.waitForTimeout(400);
  await page.screenshot({path:'artifacts/daylight-torch-preview.png'});await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>{const a=(window as any).__island;return a.building.pending.size===0&&a.building.scene.placed.size===1&&a.renderer.activePointLights===1;},{},{timeout:15000});
  await page.keyboard.press('9');const placed=await state('torch-confirmed'),torch=placed.objects[0];if(torch.definitionId!=='torch')throw new Error('Wrong object placed');
  await page.screenshot({path:'artifacts/daylight-torch-night.png'});await page.keyboard.press('Escape');
  await hour(12);await page.screenshot({path:'artifacts/daylight-torch-day.png'});await hour(0);
  // Add a nearby wall via the public protocol and exercise local wall shadows.
  const mirror=new BuildStore(config,directory);let wallRequest:BuildRequest|undefined;
  search:for(const dz of [-2.8,2.8,-4,4])for(const dx of [0,1.5,-1.5]) {
    const x=torch.position[0]+dx,z=torch.position[2]+dz,target:[number,number,number]=[x,mirror.scene.terrain(x,z).height,z];
    const feet:[number,number,number]=[x+3.5,mirror.scene.terrain(x+3.5,z+4).height,z+4],eye:[number,number,number]=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]],v=target.map((p,i)=>p-eye[i]),length=Math.hypot(...v);
    const request:BuildRequest={requestId:crypto.randomUUID(),worldKey:mirror.worldKey,definitionId:'wall-wood',variant:0,rotation:0,feet,eye,direction:v.map(p=>p/length)as [number,number,number],standing:true};
    if(solvePlacement(mirror.scene,request).valid){wallRequest=request;break search;}
  }
  if(!wallRequest)throw new Error('No valid wall near torch');const wallResult=await(await fetch(serverUrl+'/api/builds',{method:'POST',body:JSON.stringify(wallRequest)})).json();if(!wallResult.ok)throw new Error(wallResult.error);
  await page.waitForFunction(()=>{const a=(window as any).__island;return a.building.scene.placed.size===2&&a.renderer.lightingValues[33]>0;},{},{timeout:10000});
  await page.evaluate(t=>{const a=(window as any).__island,x=t.position[0]+4,z=t.position[2]+6;a.camera.spawn(x,a.building.scene.terrain(x,z).height,z);a.camera.yaw=Math.atan2(-4,6);a.camera.pitch=-.12;},torch);await page.waitForTimeout(500);
  await page.screenshot({path:'artifacts/daylight-torch-wall.png'});await state('wall-occlusion');
  for(const quality of ['low','high','medium']){await page.evaluate(quality=>{const select=document.getElementById('quality')as HTMLSelectElement;select.value=quality;select.dispatchEvent(new Event('change',{bubbles:true}));},quality);await ready();await page.waitForTimeout(250);}
  await page.evaluate(()=>{const a=(window as any).__island;a.camera.yaw=Math.PI;a.camera.pitch=-.04;});await page.waitForTimeout(400);await page.screenshot({path:'artifacts/daylight-ocean-night.png'});
  await hour(12);await page.screenshot({path:'artifacts/daylight-ocean-day.png'});await hour(0);
  await page.evaluate(()=>{const a=(window as any).__island;a.camera.yaw=0;a.camera.pitch=.85;});await page.waitForTimeout(400);await page.screenshot({path:'artifacts/daylight-moon-stars.png'});
  // Both the torch/save and paused manual clock survive independent restarts.
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));server=createWorldServer(config,{saveDirectory:directory});serverUrl=await listen();
  await page.reload();await ready();const restored=await state('restored');if(restored.automatic||Math.abs(restored.hour)>.001||restored.lights!==1||!restored.objects.some((o:any)=>o.id===torch.id))throw new Error('Torch or daylight settings did not restore');
  await page.locator('.panel-head').click();await page.locator('#daylight-auto').check();const before=await page.evaluate(()=>(window as any).__island.daylight.phase(Date.now()/1000));await page.waitForTimeout(600);
  if(await page.evaluate(()=>(window as any).__island.daylight.phase(Date.now()/1000))<=before)throw new Error('Natural cycle did not advance');
  if(errors.length)throw new Error(errors.join('\n'));writeFileSync('artifacts/daylight-validation.json',JSON.stringify({errors,reports},null,2));
}finally {
  await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(!resolve(directory).startsWith(prefix))throw new Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});
}
