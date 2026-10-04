import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
import {qualities,type Quality} from '../client/quality';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors:string[]=[],reports:unknown[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  await page.goto('http://127.0.0.1:5173/?profile=1');await page.waitForTimeout(2000);
  await page.waitForFunction(()=>{const a=(window as any).__island;if(a?.failed)throw new Error('Viewer failed');return a?.player.ready&&a.stream.loading===0&&a.stream.pending.length===0;},{},{timeout:120000});
  await page.locator('.panel-head').click();
  mkdirSync('artifacts',{recursive:true});
  for(const quality of ['low','medium','high','low','medium']as Quality[]) {
    await page.locator('#quality').selectOption(quality);
    await page.waitForFunction(q=>{const a=(window as any).__island;return a.renderer.quality===q&&a.stream.loading===0&&a.stream.pending.length===0;},quality,{timeout:120000});
    await page.waitForTimeout(3500);await page.evaluate(()=>(window as any).__island.perf.reset());await page.waitForTimeout(2500);
    const result=await page.evaluate(async()=>{
      const a=(window as any).__island,r=a.renderer;
      const moduleUrl='/shared/character.ts',rockUrl='/shared/rock-collision.ts';
      const {Character}=await import(moduleUrl),{rockSurface}=await import(rockUrl);
      const rocks=[...r.chunks.values()].filter((c:any)=>c.data.level===0).flatMap((c:any)=>c.colliders??[]).filter((c:any)=>c.kind==='rock'&&c.top-c.bottom>1);
      const rock=rocks.find((c:any)=>r.collisionSurface(c.x,c.z+c.radius+2)&&r.collisionSurface(c.x,c.z-15));
      if(!rock)throw new Error('No loaded rock suitable for collision validation.');
      const character=new Character({surface(x:number,z:number){return r.collisionSurface(x,z);},colliders(x:number,z:number){return r.playerColliders(x,z);}});
      const startZ=rock.z+rock.radius+2;character.spawn(rock.x,r.collisionSurface(rock.x,startZ).height,startZ);
      let penetration=false;
      for(let i=0;i<360;i++) {
        character.update(1/120,{x:0,z:-1,sprint:true,jump:i===60});
        const roof=rockSurface(rock,character.feet[0],character.feet[2]);if(roof&&character.feet[1]<roof.height-.01)penetration=true;
      }
      if(penetration||!character.feet.every(Number.isFinite))throw new Error('Rock surface collision failed.');
      return {quality:r.quality,shadowSize:r.shadowSize,shadowTextureWidth:r.shadowTexture.width,retainedBytes:r.estimatedGpuBytes,performance:a.perf.summary(),
        rock:{x:rock.x,z:rock.z,radius:rock.radius,faces:rock.rock.faces.length,finalFeet:[...character.feet],penetration},rendererErrors:r.errors};
    });
    if(result.shadowSize!==qualities[quality].shadowSize||result.shadowTextureWidth!==result.shadowSize)throw new Error('Shadow preset did not apply.');
    reports.push(result);await page.screenshot({path:`artifacts/graphics-${quality}-${reports.length}.png`});
    console.log(JSON.stringify({quality,shadowSize:result.shadowSize,retainedMB:result.retainedBytes/1048576,rock:result.rock}));
  }
  writeFileSync('artifacts/graphics-validation.json',JSON.stringify({errors,reports},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
