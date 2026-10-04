import {chromium,type Route} from 'playwright';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {createWorldServer} from '../server/app';
import {BuildStore} from '../server/build-store';
import {CHARACTER} from '../shared/character';
import {solvePlacement} from '../shared/build-placement';
import type {BuildRequest} from '../shared/object-registry';
mkdirSync('artifacts',{recursive:true});const prefix=resolve('artifacts/build-browser-save-'),directory=mkdtempSync(prefix);
const config=await(await fetch('http://127.0.0.1:5173/api/world')).json();
let server=createWorldServer(config,{saveDirectory:directory});
async function listen(){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}
let serverUrl=await listen(),rejectNext=false,delayNext=false;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[],reports:unknown[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/409 \(Conflict\)/.test(m.text()))errors.push(m.text());});
await page.route('**/api/builds**',async(route:Route)=>{
  const request=route.request();if(request.method()==='POST') {
    if(rejectNext){rejectNext=false;await new Promise(resolve=>setTimeout(resolve,900));await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,code:'overlap',error:'Overlaps another build'})});return;}
    if(delayNext){delayNext=false;await new Promise(resolve=>setTimeout(resolve,900));}
  }
  const url=new URL(request.url());const response=await route.fetch({url:serverUrl+url.pathname+url.search});await route.fulfill({response});
});
async function ready(){await page.waitForFunction(()=>{const a=(window as any).__island;if(a?.failed)throw new Error(document.getElementById('message')!.textContent!);return a?.player.ready&&a.building.connection==='Connected'&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});}
async function state(label:string){const state=await page.evaluate(label=>{const a=(window as any).__island,b=a.building;return {label,selected:b.selected,variant:b.variant,rotation:b.rotation,preview:b.preview,objects:b.scene.placed.values().map((s:any)=>s.object),pending:b.pending.size,errors:a.renderer.errors,performance:a.perf.summary()};},label);reports.push(state);console.log(JSON.stringify({...state,performance:undefined}));return state;}
try {
  await page.goto('http://127.0.0.1:5173/?profile=1');await page.waitForTimeout(2000);await ready();
  if(await page.locator('.hotbar-slot').count()!==9)throw new Error('Missing hotbar slots');
  await page.screenshot({path:'artifacts/building-hotbar.png'});
  await page.locator('#world').click({position:{x:800,y:400}});await page.waitForFunction(()=>!!document.pointerLockElement);await page.waitForTimeout(300);
  await page.keyboard.press('1');const first=await page.evaluate(()=>(window as any).__island.building.variant);await page.keyboard.press('e');
  if(await page.evaluate(()=>(window as any).__island.building.variant)===first)throw new Error('Rock did not cycle');
  await page.mouse.wheel(0,100);await page.waitForTimeout(150);await page.keyboard.press('r');
  const rotation=await page.evaluate(()=>(window as any).__island.building.rotation);if(Math.abs(rotation-(Math.PI/2+Math.PI/180))>.0001)throw new Error('Rotation controls failed');
  await page.evaluate(()=>{const a=(window as any).__island;a.camera.pitch=-.35;});await page.waitForTimeout(500);await page.screenshot({path:'artifacts/building-rock-preview.png'});
  await page.keyboard.press('2');await page.waitForTimeout(500);await page.screenshot({path:'artifacts/building-tree-preview.png'});
  await page.keyboard.press('3');await page.evaluate(()=>{const a=(window as any).__island;a.camera.pitch=-.55;for(let i=0;i<36;i++){a.camera.yaw=i*Math.PI*2/36;a.building.update(0);if(a.building.preview?.valid)return;}throw new Error('No clear wall preview');});await page.waitForTimeout(550);
  await state('valid-preview');await page.screenshot({path:'artifacts/building-blue-preview.png'});
  rejectNext=true;await page.mouse.click(800,450);await page.waitForFunction(()=>(window as any).__island.building.pending.size===1);await state('optimistic-before-fail');await page.screenshot({path:'artifacts/building-pending.png'});
  await page.waitForFunction(()=>(window as any).__island.building.pending.size===0);if(await page.evaluate(()=>(window as any).__island.building.scene.placed.size)!==0)throw new Error('Rejected build was retained');await state('rolled-back');
  delayNext=true;await page.mouse.click(800,450);await page.waitForFunction(()=>(window as any).__island.building.pending.size===1);await page.waitForFunction(()=>{const b=(window as any).__island.building;return b.pending.size===0&&b.scene.placed.size===1;},{},{timeout:15000});
  const placed=await state('confirmed');const wall=placed.objects[0];await page.keyboard.press('9');await page.waitForTimeout(200);if(await page.evaluate(()=>(window as any).__island.renderer.buildPreview)!==null)throw new Error('Empty slot left a preview');await page.screenshot({path:'artifacts/building-wood-wall.png'});
  // Real wall collision: walk directly towards the newly placed face.
  await page.keyboard.down('w');await page.keyboard.down('Shift');await page.waitForTimeout(2200);await page.keyboard.up('w');await page.keyboard.up('Shift');
  const collision=await page.evaluate(()=>{const a=(window as any).__island,w=a.building.scene.placed.values()[0],p=a.player.feet,dx=p[0]-w.prop.x,dz=p[2]-w.prop.z,c=Math.cos(w.prop.rotation),s=Math.sin(w.prop.rotation),box=w.collider.wall;return {feet:[...p],wall:w.object,distanceToWall:Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-box.halfWidth),Math.max(0,Math.abs(dx*s+dz*c)-box.halfDepth)),height:p[1]};});
  if(collision.distanceToWall<.30)throw new Error('Player crossed the wall');reports.push({collision});
  await page.keyboard.press('Escape');
  // Place a remote snapped stone corner using the same public server protocol.
  const mirror=new BuildStore(config,directory),parent=mirror.scene.placed.get(wall.id)!,target:[number,number,number]=[parent.prop.x+1.49,parent.prop.y+.65,parent.prop.z];
  let remote:BuildRequest|undefined;
  search:for(const rotation of [Math.PI/2,-Math.PI/2,0])for(const offset of [4,-4]) {
    const feet:[number,number,number]=[target[0],mirror.scene.terrain(target[0],target[2]+offset).height,target[2]+offset],eye:[number,number,number]=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]],v=target.map((x,i)=>x-eye[i]),length=Math.hypot(...v);
    const r:BuildRequest={requestId:crypto.randomUUID(),worldKey:mirror.worldKey,definitionId:'wall-stone',variant:0,rotation,feet,eye,direction:v.map(v=>v/length)as [number,number,number],standing:true};
    if(solvePlacement(mirror.scene,r).valid){remote=r;break search;}
  }
  if(!remote)throw new Error('No valid stone wall corner');const remoteResult=await(await fetch(serverUrl+'/api/builds',{method:'POST',body:JSON.stringify(remote)})).json();if(!remoteResult.ok)throw new Error(remoteResult.error);
  await page.waitForFunction(()=>(window as any).__island.building.scene.placed.size===2,{},{timeout:10000});await state('remote-corner');
  await page.evaluate(w=>{const a=(window as any).__island,x=w.position[0]+4,z=w.position[2]+6;a.camera.spawn(x,a.building.scene.terrain(x,z).height,z);a.camera.yaw=Math.atan2(-4,6);a.camera.pitch=Math.atan2(w.position[1]+1.2-a.camera.position[1],Math.hypot(4,6));},wall);
  await page.waitForTimeout(500);await page.screenshot({path:'artifacts/building-snapped-corner.png'});
  // Stack through actual input. Top attachments must ignore both rotation controls.
  await page.locator('#world').click({position:{x:800,y:400}});await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.evaluate(w=>{const a=(window as any).__island,x=w.position[0],z=w.position[2]+5;a.camera.spawn(x,a.building.scene.terrain(x,z).height,z);a.camera.yaw=0;a.camera.pitch=Math.atan2(w.position[1]+2.2-a.camera.position[1],5);},wall);
  await page.keyboard.press('3');await page.keyboard.press('e');await page.waitForTimeout(300);
  const stack=await state('stack-preview');if(!stack.preview?.valid||stack.preview.object.support.socket!=='top')throw new Error('Missing valid top attachment');
  await page.keyboard.press('r');await page.mouse.wheel(0,100);await page.waitForTimeout(200);
  if(await page.evaluate(()=>(window as any).__island.building.preview.object.rotation)!==wall.rotation)throw new Error('Stack rotation changed');
  await page.screenshot({path:'artifacts/building-stacked-preview.png'});await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>{const b=(window as any).__island.building;return b.pending.size===0&&b.scene.placed.size===3;},{},{timeout:15000});await state('stack-confirmed');await page.keyboard.press('9');await page.keyboard.press('Escape');
  // Restart the isolated server and reload the browser. Real game saves are untouched.
  server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));server=createWorldServer(config,{saveDirectory:directory});serverUrl=await listen();
  await page.reload();await ready();const reloaded=await state('save-reloaded');if(reloaded.objects.length!==3||!reloaded.objects.some((o:any)=>o.id===wall.id))throw new Error('Saved builds did not reload');
  await page.screenshot({path:'artifacts/building-save-reloaded.png'});
  if(errors.length)throw new Error(errors.join('\n'));writeFileSync('artifacts/building-validation.json',JSON.stringify({errors,reports},null,2));
}finally {
  await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(!resolve(directory).startsWith(prefix))throw new Error('Unexpected browser save directory');rmSync(directory,{recursive:true,force:true});
}
