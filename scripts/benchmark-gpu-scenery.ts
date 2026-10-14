import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const iterations=Math.max(60,Math.min(1100,Number(process.env.GPU_SCENERY_ITERATIONS)||1000));
const profileUrl=new URL(process.env.PROFILE_URL??'http://127.0.0.1:5173/');profileUrl.searchParams.set('profile','1');
let browser:any;
let page:any;
const errors:string[]=[];
try{
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist'],channel:'chrome'}).catch(()=>chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist'],executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium'}));
  page=await browser.newPage({viewport:{width:1600,height:900}});
  page.on('dialog',(dialog:any)=>dialog.accept('GPU benchmark'));
  page.on('pageerror',(error:Error)=>errors.push(error.message));
  page.on('console',(message:any)=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(profileUrl.href);await page.waitForTimeout(1500);
  await page.waitForFunction(()=>{const app=(window as any).__island;if(app?.failed)throw new Error(document.getElementById('message')?.textContent??'Island startup failed');return app?.player.ready&&app.stream.loading===0&&app.stream.pending.length===0&&app.renderer.resources.gpuCulling===1;},{},{timeout:180000});
  const result=await page.evaluate(async(iterations:number)=>{
    const app=(window as any).__island,renderer=app.renderer,profiler=app.perf;
    const gpu=await navigator.gpu?.requestAdapter(),adapterInfo=gpu?(gpu as any).info:undefined;
    if(!gpu)throw new Error('WebGPU is unavailable in this browser.');
    const chunks=app.stream.revision,topology=renderer.topologyRevision,baseYaw=app.camera.yaw;
    const originalPrepare=renderer.prepareGpuScenery,prepareTimes:number[]=[];
    renderer.prepareGpuScenery=function(...args:any[]){const start=performance.now();try{return originalPrepare.apply(this,args);}finally{prepareTimes.push(performance.now()-start);}};
    const culler=renderer.gpuCuller,encodeTimes:number[]=[],originalEncode=culler.encode;
    culler.encode=function(...args:any[]){const start=performance.now();try{return originalEncode.apply(this,args);}finally{encodeTimes.push(performance.now()-start);}};
    const frameBuffer=renderer.gpuFrame,queue=renderer.device.queue,originalWrite=queue.writeBuffer.bind(queue),frameWrites:number[]=[];
    queue.writeBuffer=function(buffer:GPUBuffer,...args:any[]){if(buffer===frameBuffer){const start=performance.now();try{return originalWrite(buffer,...args);}finally{frameWrites.push(performance.now()-start);}}return originalWrite(buffer,...args);};
    async function sample(enabled:boolean){
      renderer.gpuCullingEnabled=enabled;profiler.reset();
      const rebuildStart=renderer.gpuRebuilds,streamStart=app.stream.revision,topologyStart=renderer.topologyRevision,first=prepareTimes.length,encodeFirst=encodeTimes.length,writeFirst=frameWrites.length;
      for(let i=0;i<iterations;i++){
        app.camera.yaw=baseYaw+i*.006;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      const report=profiler.export(),frames=report.samples;
      const mean=(name:string)=>{const values=frames.map((frame:any)=>frame.cpu[name]).filter((value:any)=>typeof value==='number');return values.length?values.reduce((a:number,b:number)=>a+b,0)/values.length:0;};
      const average=(name:string)=>{const values=frames.map((frame:any)=>frame.counters[name]).filter((value:any)=>typeof value==='number');return values.length?values.reduce((a:number,b:number)=>a+b,0)/values.length:0;};
      return {mode:enabled?'gpu':'exact CPU fallback',frames:frames.length,sceneryStageMeanMs:+mean('scenery').toFixed(4),instanceUploadStageMeanMs:+mean('instanceUpload').toFixed(4),cpuFallbackViewRecordsMean:enabled?null:+average('sceneryInstances').toFixed(1),cpuFallbackShadowRecordsMean:enabled?null:+average('shadowInstances').toFixed(1),gpuCandidateBatchSlots:[...renderer.gpuNaturalDraws,...renderer.gpuBuiltDraws].reduce((sum:number,draw:any)=>sum+draw.batch.candidateCount,0),gpuPersistentBytes:renderer.estimatedGpuBytes,gpuRebuilds:renderer.gpuRebuilds-rebuildStart,gpuRebuildsTotal:renderer.gpuRebuilds,prepareGpuSceneryCalls:prepareTimes.length-first,prepareGpuSceneryMeanMs:+(prepareTimes.slice(first).reduce((a,b)=>a+b,0)/Math.max(1,prepareTimes.length-first)).toFixed(4),computeEncodeCalls:encodeTimes.length-encodeFirst,computeEncodeMeanMs:+(encodeTimes.slice(encodeFirst).reduce((a,b)=>a+b,0)/Math.max(1,encodeTimes.length-encodeFirst)).toFixed(5),frameUniformWriteMeanMs:+(frameWrites.slice(writeFirst).reduce((a,b)=>a+b,0)/Math.max(1,frameWrites.length-writeFirst)).toFixed(5),streamRevisionDelta:app.stream.revision-streamStart,topologyRevisionDelta:renderer.topologyRevision-topologyStart};
    }
    const cpu=await sample(false),gpuResult=await sample(true);
    renderer.prepareGpuScenery=originalPrepare;culler.encode=originalEncode;queue.writeBuffer=originalWrite;
    return {adapterInfo,iterationsRequested:iterations,scene:{streamRevision:chunks,topologyRevision:topology,quality:renderer.quality,chunks:renderer.chunks.size},cpu,gpu:gpuResult,constantTopology:cpu.streamRevisionDelta===0&&cpu.topologyRevisionDelta===0&&gpuResult.streamRevisionDelta===0&&gpuResult.topologyRevisionDelta===0,viewOrPositionHeldFixed:true,onlyYawChanged:true,fpsClaim:false};
  },iterations);
  if(!result.constantTopology)throw new Error('Terrain stream or topology changed during the camera rotation benchmark.');
  if(errors.length)throw new Error(`Browser reported errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({benchmark:'actual renderer scenery preparation',url:profileUrl.href,errors,...result},null,2));
}catch(error){
  const failure={benchmark:'actual renderer scenery preparation',url:profileUrl.href,iterationsRequested:iterations,error:error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error),browserErrors:errors,fpsClaim:false,note:'No FPS result is available; the benchmark did not complete.'};
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/gpu-scenery-benchmark-failure.json',JSON.stringify(failure,null,2)+'\n');
  console.error(JSON.stringify(failure,null,2));
  throw error;
}finally{await browser?.close();}
