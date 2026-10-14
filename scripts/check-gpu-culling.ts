import {chromium,type Browser} from 'playwright';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {
  GPU_SCENERY_INSTANCE_BYTES,GPU_SCENERY_SHADER,GpuSceneryCuller,createGpuSceneryFrameBuffer,
  gpuSceneryReference,writeGpuSceneryFrame,type GpuSceneryCandidate,
  type GpuSceneryConfig,type GpuSceneryFrame,
} from '../client/gpu-scenery';
const assert:(condition:unknown,message:string)=>asserts condition=(condition,message)=>{if(!condition)throw new Error(message);};
async function freePort():Promise<number>{
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Could not reserve a local port');const port=address.port;server.close();await once(server,'close');return port;
}

const port=await freePort(),origin=`http://127.0.0.1:${port}`;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
let viteOutput='';vite.stdout.on('data',b=>viteOutput+=b);vite.stderr.on('data',b=>viteOutput+=b);
let browser:Browser|undefined;
const errors:string[]=[];
async function ready(){for(let i=0;i<150;i++){if(vite.exitCode!==null)throw new Error(`Vite exited early:\n${viteOutput}`);try{const response=await fetch(origin);if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`Vite did not start:\n${viteOutput}`);}

const html=`<!doctype html><html><head><meta charset="utf-8"><title>GPU scenery culling check</title></head><body><script type="module">
import {GpuSceneryCuller,createGpuSceneryFrameBuffer,gpuSceneryReference,writeGpuSceneryFrame,GPU_SCENERY_INSTANCE_BYTES,GPU_SCENERY_SHADER} from '/client/gpu-scenery.ts';
const fail=(message)=>{throw new Error(message)};
const assert=(condition,message)=>{if(!condition)fail(message)};
const box=(minX=-1000,maxX=1000,minY=-1000,maxY=1000,minZ=-1000,maxZ=1000)=>new Float32Array([
  1,0,0,-minX, -1,0,0,maxX, 0,1,0,-minY, 0,-1,0,maxY, 0,0,1,-minZ, 0,0,-1,maxZ,
]);
const frame=(camera=[0,0,0],view=box(),light=box(),shadowCasterRange=60,naturalRange=1000)=>({camera,viewPlanes:view,lightPlanes:light,shadowCasterRange,naturalRange});
const candidate=(x,{y=0,z=0,range=500,maxRange=500,natural=false,radius=1,transformX=x,boundaries,chunk}={})=>({
  transform:[transformX,y,z,1,0,0,0,1],sphere:[x,y,z,radius],horizontal:[x,z],maxRange,natural,chunk,
  ...(range===undefined?{}:{range}),...(boundaries===undefined?{}:{boundaries}),
});
const config=(overrides={})=>({mode:'view',level:0,boundaries:[],range:500,tree:false,indexCount:6,...overrides});
const close=(a,b)=>Math.abs(a-b)<=0.0002;
function sortedRecords(records){return records.map(record=>Array.from(record)).sort((a,b)=>{for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i]}return 0;});}
function compare(actual,expected,label){const a=sortedRecords(actual),e=sortedRecords(expected);assert(a.length===e.length,label+': record count '+a.length+' did not match CPU reference '+e.length);for(let row=0;row<a.length;row++)for(let col=0;col<11;col++)assert(close(a[row][col],e[row][col]),label+': record '+row+' column '+col+' was '+a[row][col]+'; expected '+e[row][col]);}
async function readback(device,batch){
  const outputBytes=Math.max(4,batch.capacity*GPU_SCENERY_INSTANCE_BYTES),output=device.createBuffer({size:outputBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),args=device.createBuffer({size:20,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(batch.instances,0,output,0,outputBytes);encoder.copyBufferToBuffer(batch.indirect,0,args,0,20);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
  await Promise.all([output.mapAsync(GPUMapMode.READ),args.mapAsync(GPUMapMode.READ)]);
  const words=new Uint32Array(args.getMappedRange().slice(0)),count=words[1],floatWords=new Float32Array(output.getMappedRange().slice(0));
  output.unmap();args.unmap();output.destroy();args.destroy();
  assert(count<=batch.capacity,'indirect instance count exceeded output capacity');return {count,args:words,records:Array.from({length:count},(_,i)=>floatWords.slice(i*11,i*11+11))};
}
async function dispatch(device,batch,frameBuffer,f){writeGpuSceneryFrame(device,frameBuffer,f);const encoder=device.createCommandEncoder();batch.encode(encoder,frameBuffer);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();return readback(device,batch);}
async function run(){
  assert('gpu' in navigator,'Chromium does not expose navigator.gpu');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});assert(adapter,'No WebGPU adapter available in Chromium');
  const adapterInfo=typeof adapter.requestAdapterInfo==='function'?await adapter.requestAdapterInfo():(adapter.info??{});const device=await adapter.requestDevice();
  const validation=[];device.addEventListener('uncapturederror',event=>validation.push(event.error.message));
  device.pushErrorScope('validation');
  const shaderModule=device.createShaderModule({label:'Check scenery WGSL compilation',code:GPU_SCENERY_SHADER});
  const shaderInfo=await shaderModule.getCompilationInfo();assert(shaderInfo.messages.filter(message=>message.type==='error').length===0,'Scenery WGSL compilation failed: '+shaderInfo.messages.map(message=>message.message).join('; '));
  const culler=await GpuSceneryCuller.create(device);const pipelineError=await device.popErrorScope();assert(!pipelineError,'Scenery compute pipeline validation failed: '+pipelineError?.message);
  const frameBuffer=createGpuSceneryFrameBuffer(device);
  const observed=[];
  async function check(label,candidates,cfg,f){
    const batch=culler.createBatch(candidates,cfg);device.pushErrorScope('validation');const result=await dispatch(device,batch,frameBuffer,f);const validationError=await device.popErrorScope();assert(!validationError,label+' WebGPU validation error: '+validationError?.message);const expected=gpuSceneryReference(candidates,cfg,f).map(item=>item.record);compare(result.records,expected,label);assert(result.count===expected.length,label+': indirect count mismatch');observed.push({label,count:result.count,capacity:batch.capacity});return {batch,result,expected};
  }
  async function indirectDrawMatchesCpu(candidates,f){
    const drawConfig={mode:'view',level:0,boundaries:[],range:100,tree:false,indexCount:3};
    const shadowConfig={...drawConfig,mode:'shadow'},drawBatch=culler.createBatch(candidates,drawConfig),shadowBatch=culler.createBatch(candidates,shadowConfig);
    const expected=gpuSceneryReference(candidates,drawConfig,f).map(item=>item.record);
    const module=device.createShaderModule({label:'Indirect scenery comparison shader',code:'struct Input { @location(0) point:vec2f, @location(4) transform:vec4f, @location(5) rotation:vec4f, @location(7) fade:vec3f };\\nstruct VertexOut { @builtin(position) position:vec4f };\\n@vertex fn vertexMain(input:Input)->VertexOut { var out:VertexOut; let offset=input.transform.xz*0.025*input.transform.w; out.position=vec4f(input.point+offset,0.5,1.0); return out; }\\n@fragment fn depthFragment()->@location(0) vec4f { return vec4f(0.0,0.0,0.0,0.0); }\\n@fragment fn colorFragment()->@location(0) vec4f { return vec4f(0.18,0.82,0.31,1.0); }'});
    const moduleInfo=await module.getCompilationInfo();assert(moduleInfo.messages.every(message=>message.type!=='error'),'Indirect draw shader compilation failed: '+moduleInfo.messages.map(message=>message.message).join('; '));
    const vertexBuffers=[
      {arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
      {arrayStride:44,stepMode:'instance',attributes:[{shaderLocation:4,offset:0,format:'float32x4'},{shaderLocation:5,offset:16,format:'float32x4'},{shaderLocation:7,offset:32,format:'float32x3'}]},
    ];
    const pipelineLayout='auto',targetFormat='rgba8unorm',depthFormat='depth32float';
    device.pushErrorScope('validation');
    const depthPipeline=await device.createRenderPipelineAsync({label:'Scenery depth prepass',layout:pipelineLayout,vertex:{module,entryPoint:'vertexMain',buffers:vertexBuffers},fragment:{module,entryPoint:'depthFragment',targets:[{format:targetFormat,writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:depthFormat,depthWriteEnabled:true,depthCompare:'less-equal'}});
    const equalPipeline=await device.createRenderPipelineAsync({label:'Scenery equal depth shading',layout:pipelineLayout,vertex:{module,entryPoint:'vertexMain',buffers:vertexBuffers},fragment:{module,entryPoint:'colorFragment',targets:[{format:targetFormat}]},primitive:{topology:'triangle-list'},depthStencil:{format:depthFormat,depthWriteEnabled:false,depthCompare:'equal'}});
    const pipelineError=await device.popErrorScope();assert(!pipelineError,'Indirect draw pipeline validation failed: '+pipelineError?.message);
    const vertices=device.createBuffer({label:'Indirect draw triangle vertices',size:24,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(vertices,0,new Float32Array([-.12,-.1,.12,-.1,0,.16]));
    const indices=device.createBuffer({label:'Indirect draw triangle indices',size:8,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(indices,0,new Uint16Array([0,1,2,0]));
    const color=device.createTexture({size:[64,64,1],format:targetFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    const depth=device.createTexture({size:[64,64,1],format:depthFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT});
    function issueDraw(encoder,instanceBuffer,indirectBuffer,directCount){
      let pass=encoder.beginRenderPass({label:'Scenery depth prepass',colorAttachments:[{view:color.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:1},storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'store'}});
      pass.setPipeline(depthPipeline);pass.setVertexBuffer(0,vertices);pass.setVertexBuffer(1,instanceBuffer);pass.setIndexBuffer(indices,'uint16');
      if(indirectBuffer)pass.drawIndexedIndirect(indirectBuffer,0);else pass.drawIndexed(3,directCount);pass.end();
      pass=encoder.beginRenderPass({label:'Scenery equal depth shading',colorAttachments:[{view:color.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
      pass.setPipeline(equalPipeline);pass.setVertexBuffer(0,vertices);pass.setVertexBuffer(1,instanceBuffer);pass.setIndexBuffer(indices,'uint16');
      if(indirectBuffer)pass.drawIndexedIndirect(indirectBuffer,0);else pass.drawIndexed(3,directCount);pass.end();
    }
    async function pixels(){const rowBytes=64*4,staging=device.createBuffer({size:rowBytes*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:color},{buffer:staging,bytesPerRow:rowBytes,rowsPerImage:64},{width:64,height:64,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const result=new Uint8Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();return result;}
    device.pushErrorScope('validation');writeGpuSceneryFrame(device,frameBuffer,f);const gpuEncoder=device.createCommandEncoder();culler.encode(gpuEncoder,[drawBatch,shadowBatch],frameBuffer);issueDraw(gpuEncoder,drawBatch.instances,drawBatch.indirect,0);device.queue.submit([gpuEncoder.finish()]);await device.queue.onSubmittedWorkDone();const gpuValidation=await device.popErrorScope();assert(!gpuValidation,'Compute plus drawIndexedIndirect validation failed: '+gpuValidation?.message);
    const gpuPixels=await pixels(),gpuRows=await readback(device,drawBatch),cpuInstances=device.createBuffer({label:'CPU reference instances',size:Math.max(4,expected.length*GPU_SCENERY_INSTANCE_BYTES),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    if(expected.length)device.queue.writeBuffer(cpuInstances,0,Float32Array.from(expected.flatMap(record=>Array.from(record))));
    const cpuEncoder=device.createCommandEncoder();issueDraw(cpuEncoder,cpuInstances,undefined,expected.length);device.queue.submit([cpuEncoder.finish()]);await device.queue.onSubmittedWorkDone();const cpuPixels=await pixels();
    assert(gpuRows.count===expected.length,'Indirect depth/equal stages retained '+gpuRows.count+' instances, expected '+expected.length);
    compare(gpuRows.records,expected,'indirect render candidate compaction');
    assert(gpuPixels.length===cpuPixels.length&&gpuPixels.every((value,index)=>value===cpuPixels[index]),'drawIndexedIndirect depth-prepass/equal pixels differed from the CPU direct draw');
    observed.push({label:'same-encoder compute + indirect depth/equal draw',count:gpuRows.count,depthPrepassCount:gpuRows.args[1],equalShadingCount:gpuRows.args[1],pixelBytesCompared:gpuPixels.length});
    drawBatch.dispose();const surviving=await dispatch(device,shadowBatch,frameBuffer,f),shadowExpected=gpuSceneryReference(candidates,shadowConfig,f).map(item=>item.record);compare(surviving.records,shadowExpected,'shared candidate buffer after sibling disposal');assert(surviving.count===shadowExpected.length,'Disposing a batch invalidated another batch sharing its candidate input');
    observed.push({label:'shared input/all-batch dispatch and sibling disposal',count:surviving.count,candidateCount:candidates.length});shadowBatch.dispose();
    cpuInstances.destroy();vertices.destroy();indices.destroy();color.destroy();depth.destroy();
  }
  const empty=await check('empty candidate count',[],config(),frame());assert(empty.result.args[0]===6&&empty.result.count===0,'Empty batches must preserve index count and clear instance count');empty.batch.dispose();

  // Frustum and shadow selection use separate planes. This object is outside
  // the camera view, but remains in the light frustum as a valid caster.
  const view=box(-20,20,-20,20,-20,20),light=box(30,80,-20,20,-20,20),outside=candidate(40);
  const viewBatch=await check('view rejects offscreen candidate',[outside],config(),frame([0,0,0],view,light,60));assert(viewBatch.result.count===0,'Off-view scenery leaked into view output');viewBatch.batch.dispose();
  const shadowConfig=config({mode:'shadow'}),shadowBatch=await check('shadow keeps offscreen caster',[outside],shadowConfig,frame([0,0,0],view,light,60));assert(shadowBatch.result.count===1,'Off-view in-range caster was removed from shadow output');shadowBatch.batch.dispose();

  await indirectDrawMatchesCpu([],frame());
  const indirectCandidates=[-12,-6,0,6,12].map(x=>candidate(x,{range:100,maxRange:100}));
  await indirectDrawMatchesCpu(indirectCandidates,frame([0,0,0],box(-40,40,-20,20,-20,20),box(-40,40,-20,20,-20,20),60));

  const boundaries=[{distance:100,width:20},{distance:220,width:40}];
  const finalBoundaries=[...boundaries,{distance:400,width:160}];
  const lodCandidates=[89,90,91,99,100,109,110,111,199,200,220,239,240,241].map(x=>candidate(x,{range:400,maxRange:400}));
  for(const level of [0,1,2]){
    const cfg=config({level,boundaries,range:400}),lod=await check('LOD crossfade level '+level,lodCandidates,cfg,frame([0,0,0],box(0,300,-20,20,-20,20),box(),80));
    assert(lod.result.count>0,'LOD boundary fixture did not produce records');lod.batch.dispose();
  }
  const scaledProps=[candidate(85,{range:120,maxRange:500,boundaries:[{distance:100,width:40}]}),candidate(140,{range:300,maxRange:500,boundaries:[{distance:200,width:40},{distance:400,width:60}]})];
  const scaled=await check('per-candidate scaled scenery range and LOD overrides',scaledProps,config({level:0,boundaries:[{distance:20,width:10}],range:50}),frame([0,0,0],box(0,200,-10,10,-10,10),box(),60));
  assert(scaled.result.count===2,'Per-candidate ranges/boundaries were replaced by the batch defaults');
  assert(close(scaled.result.records.find(row=>close(row[0],85))?.[8],0.04296875),'Scaled prop did not use its candidate LOD boundary');
  assert(close(scaled.result.records.find(row=>close(row[0],85))?.[10],0.9259259),'Scaled prop did not use its candidate fade range');
  assert(scaled.result.records.some(row=>close(row[0],140)&&row[8]===1&&row[10]===1),'Second scaled prop did not use its own LOD/range pair');scaled.batch.dispose();

  const shadowBoundaries=[{distance:100,width:20}],shadowLodCandidates=[90,100,110].map(x=>candidate(x,{range:300,maxRange:300}));
  const shadowLod1=await check('shadow mesh LOD1 with offset1 selects source LOD0',shadowLodCandidates,config({mode:'shadow',level:1,boundaries:shadowBoundaries,shadowLodOffset:1,range:300}),frame([0,0,0],box(-20,20,-20,20,-20,20),box(0,200,-20,20,-20,20),200));
  const shadow1Rows=sortedRecords(shadowLod1.result.records);assert(shadow1Rows.length===2&&close(shadow1Rows[0][0],90)&&close(shadow1Rows[0][8],0)&&shadow1Rows[0][9]===1&&close(shadow1Rows[1][0],100)&&close(shadow1Rows[1][8],0.5)&&shadow1Rows[1][9]===1,'Shadow mesh LOD1 with offset1 must match source LOD0 outgoing coverage');shadowLod1.batch.dispose();
  const shadowLod2=await check('shadow mesh LOD2 with offset1 selects source LOD1',shadowLodCandidates,config({mode:'shadow',level:2,boundaries:shadowBoundaries,shadowLodOffset:1,range:300}),frame([0,0,0],box(-20,20,-20,20,-20,20),box(0,200,-20,20,-20,20),200));
  const shadow2Rows=sortedRecords(shadowLod2.result.records);assert(shadow2Rows.length===3&&close(shadow2Rows[0][0],90)&&shadow2Rows[0][9]===0&&close(shadow2Rows[1][0],100)&&close(shadow2Rows[1][8],0.5)&&shadow2Rows[1][9]===0&&close(shadow2Rows[2][0],110)&&shadow2Rows[2][8]===1,'Shadow mesh LOD2 with offset1 must match source LOD1 incoming coverage');shadowLod2.batch.dispose();

  const binCandidates=[99,100,249,250].map(x=>candidate(x,{range:300,maxRange:300}));
  const bins=await check('distance bins include min and exclude max',binCandidates,config({range:300,distanceMin:100,distanceMax:250}),frame([0,0,0],box(0,300,-10,10,-10,10),box(),60));
  assert(bins.result.records.map(row=>Math.round(row[0])).sort((a,b)=>a-b).join(',')==='100,249','GPU distance bins must be lower-inclusive and upper-exclusive');bins.batch.dispose();

  const builtTree=candidate(400,{range:500,maxRange:500,boundaries}),builtTreeDraw=await check('built tree config allows fading final LOD2', [builtTree],config({level:2,boundaries,range:500,tree:false}),frame([0,0,0],box(0,500,-10,10,-10,10),box(),60));
  assert(builtTreeDraw.result.count===1&&builtTreeDraw.result.records[0][8]===1&&builtTreeDraw.result.records[0][10]>0&&builtTreeDraw.result.records[0][10]<1,'Built tree LOD2 must remain and fade by range');builtTreeDraw.batch.dispose();
  const naturalTree=candidate(400,{range:500,maxRange:500,natural:true,boundaries:finalBoundaries}),naturalTreeDraw=await check('natural tree crossfade retains opaque incoming geometry',[naturalTree],config({level:2,boundaries:finalBoundaries,range:500,tree:true}),frame([0,0,0],box(0,500,-10,10,-10,10),box(),60));
  assert(naturalTreeDraw.result.count===1&&close(naturalTreeDraw.result.records[0][8],0.5)&&naturalTreeDraw.result.records[0][9]===1&&naturalTreeDraw.result.records[0][10]===1,'Natural tree LOD2 should keep full coverage while crossfading toward omitted LOD3');naturalTreeDraw.batch.dispose();

  const treeCandidates=[89,90,100,109,110,200,220,240,400].map(x=>candidate(x,{range:500,maxRange:500,natural:true}));
  const treeLod2=await check('tree LOD2 geometry retained',treeCandidates,config({level:2,boundaries,range:500,tree:true}),frame([0,0,0],box(0,450,-20,20,-20,20),box(),80));
  assert(treeLod2.result.count>0,'Built trees must retain their last geometry LOD');treeLod2.batch.dispose();
  const finalTree=candidate(500,{range:800,maxRange:800,natural:true,boundaries:finalBoundaries});
  const treeFinal=await check('tree final geometry LOD exclusion',[finalTree],config({level:3,boundaries:finalBoundaries,range:800,tree:true}),frame([0,0,0],box(0,900,-20,20,-20,20),box(),80));
  assert(treeFinal.result.count===0,'Trees must omit LOD3 geometry used for distant impostors');treeFinal.batch.dispose();

  const fadeCandidates=[250,300,325,349,350,351,400,500].map(x=>candidate(x,{range:500,maxRange:500}));
  const fade=await check('distance fade',fadeCandidates,config({range:500}),frame([0,0,0],box(0,520,-10,10,-10,10),box(),80));
  assert(fade.result.records.some(record=>record[10]>0&&record[10]<1),'Distance fade did not retain partial coverage values');assert(fade.result.records.some(record=>record[10]===0),'Range endpoint did not produce zero fade');fade.batch.dispose();

  // Coordinates are already rebased around a large world origin; GPU output
  // must retain the small local displacement rather than float32 global loss.
  const worldOrigin=1_000_000_000,worldProp=worldOrigin+123.456,worldCamera=worldOrigin+123.4;
  assert(!close(Math.fround(worldProp)-Math.fround(worldCamera),0.056),'Large-world fixture does not expose float32 global-coordinate precision loss');
  const localPosition=worldProp-worldOrigin,localCamera=worldCamera-worldOrigin;
  const local=candidate(localPosition,{transformX:localPosition,range:100,maxRange:100}),localFrame=frame([localCamera,0,0],box(-10,10,-10,10,-10,10),box(),20);
  const relative=await check('large world relative origin',[local],config({range:100}),localFrame);assert(close(relative.result.records[0][0],0.056),'Camera-relative transform lost precision for a large-world rebased position');relative.batch.dispose();

  // Each encode must clear the previous atomic count before dispatching again.
  const repeated=culler.createBatch([candidate(2),candidate(3),candidate(90)],config({range:20}));
  const first=await dispatch(device,repeated,frameBuffer,frame([0,0,0],box(-10,10,-10,10,-10,10),box(),20));assert(first.count===2,'First repeated dispatch count is incorrect');
  const second=await dispatch(device,repeated,frameBuffer,frame([100,0,0],box(-10,10,-10,10,-10,10),box(),20));assert(second.count===1,'Repeated dispatch retained the previous atomic instance count');
  repeated.replace([candidate(0)],config({range:20}));const third=await dispatch(device,repeated,frameBuffer,frame());assert(third.count===1,'Candidate removal did not rebuild the selected output');repeated.dispose();

  // Chunk culling preserves candidates in chunks visible to either camera or
  // light, while rejecting a chunk outside both frusta and natural range.
  const chunked=candidate(40,{natural:true,chunk:{x:30,z:-5,extent:20,sphere:[40,0,0,15]}}),chunkView=await check('chunk view or light visibility',[chunked],config(),frame([0,0,0],view,light,60));assert(chunkView.result.count===0,'Candidate sphere outside view should be culled even when its chunk can cast');chunkView.batch.dispose();
  const farChunk=candidate(1200,{natural:true,chunk:{x:1190,z:-5,extent:20,sphere:[1200,0,0,15]}}),natural=await check('natural distance and chunk range',[farChunk],config({range:2000}),frame([0,0,0],box(),box(),60,1000));assert(natural.result.count===0,'Natural scenery exceeded its camera-relative range cap');natural.batch.dispose();

  // A replacement cannot exceed allocated candidate capacity. A rebuild with
  // a larger high-quality set allocates the new capacity and disposes cleanly.
  const base=culler.createBatch([candidate(1)],config({range:100}));let growthRejected=false;try{base.replace(Array.from({length:8},(_,i)=>candidate(i)),config({range:100}));}catch{growthRejected=true;}assert(growthRejected,'Replacing beyond capacity must require a batch rebuild');base.dispose();
  const highBoundaries=[{distance:1000,width:20},{distance:1500,width:30}],highCandidates=Array.from({length:129},(_,i)=>candidate(i+1,{range:200,maxRange:200,boundaries:highBoundaries})),high=culler.createBatch(highCandidates,config({range:200,boundaries:highBoundaries}));
  assert(high.capacity>=129&&high.capacity>base.capacity&&high.estimatedBytes>base.estimatedBytes,'Rebuilt high-quality batch must account for its larger capacity');
  const highResult=await dispatch(device,high,frameBuffer,frame([0,0,0],box(0,300,-10,10,-10,10),box(),80));assert(highResult.count===129,'Rebuilt large candidate batch lost visible instances');
  const reducedConfig=config({range:30,boundaries:highBoundaries}),reducedCandidates=highCandidates.slice(0,12),reducedFrame=frame([0,0,0],box(0,300,-10,10,-10,10),box(),80);high.replace(reducedCandidates,reducedConfig);device.pushErrorScope('validation');const reduced=await dispatch(device,high,frameBuffer,reducedFrame),reducedError=await device.popErrorScope();assert(!reducedError,'Quality replacement generated a WebGPU validation error: '+reducedError?.message);const reducedExpected=gpuSceneryReference(reducedCandidates,reducedConfig,reducedFrame).map(item=>item.record);compare(reduced.records,reducedExpected,'quality/range change with removed candidates');assert(reduced.count===12,'Quality/range replacement did not update the retained candidate set');high.dispose();

  assert(validation.length===0,'WebGPU reported validation errors: '+validation.join('; '));
  frameBuffer.destroy();culler.dispose();device.destroy();
  return {adapterInfo,shaderCompilationMessages:shaderInfo.messages.map(message=>({type:message.type,message:message.message})),checks:observed,validationErrors:validation};
}
window.__gpuCullingResult=run().then(result=>({ok:true,...result})).catch(error=>({ok:false,error:String(error?.stack??error)}));
</script></body></html>`;

try{
  await ready();
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan','--disable-vulkan-surface']});
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/gpu-culling-harness',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto(`${origin}/gpu-culling-harness`);await page.waitForFunction(()=>window.__gpuCullingResult!==undefined,{timeout:60000});
  const result=await page.evaluate(()=>window.__gpuCullingResult);assert(result?.ok,`WebGPU culling harness failed: ${result?.error??'no result'}${errors.length?`; page errors: ${errors.join('; ')}`:''}`);
  assert(errors.length===0,`Browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({passed:true,backend:'Chromium WebGPU compute and readback',...result},null,2));
}finally{
  await browser?.close();vite.kill();await once(vite,'exit').catch(()=>{});
}

declare global{interface Window{__gpuCullingResult?:Promise<any>}}
