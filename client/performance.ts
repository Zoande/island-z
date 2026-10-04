export interface PerformanceSample { id:number; intervalMs:number; cpu:Record<string,number>; gpu?:Record<string,number>; counters:Record<string,number> }
function distribution(values:number[]) {
  if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),n=values.length;
  return {samples:n,meanMs:values.reduce((a,b)=>a+b,0)/n,p50Ms:sorted[Math.floor((n-1)*.5)],p95Ms:sorted[Math.floor((n-1)*.95)],p99Ms:sorted[Math.floor((n-1)*.99)]};
}
/** Bounded, opt-in capture. CPU work and asynchronous GPU pass times are kept
 * separate: neither is confused with the browser's frame scheduling interval. */
export class FrameProfiler {
  enabled=false;gpuSupported=false;
  private samples=new Map<number,PerformanceSample>();
  private current?:PerformanceSample;private nextId=0;private started=0;private frameStart=0;
  readonly capacity=1200;
  constructor(readonly metadata:()=>Record<string,unknown>) {}
  start() {this.enabled=true;this.reset();}
  stop() {this.enabled=false;return this.summary();}
  reset() {this.samples.clear();this.current=undefined;this.started=performance.now();}
  begin(intervalMs:number) {
    if(!this.enabled)return;this.frameStart=performance.now();
    this.current={id:++this.nextId,intervalMs,cpu:{},counters:{}};
  }
  get frameId() {return this.enabled?this.current?.id:undefined;}
  mark() {return this.enabled?performance.now():0;}
  endStage(name:string,start:number) {if(this.enabled&&this.current)this.current.cpu[name]=(this.current.cpu[name]??0)+performance.now()-start;}
  gpu(id:number,times:Record<string,number>) {const sample=this.samples.get(id);if(sample)sample.gpu=times;}
  finish(counters:Record<string,number>) {
    if(!this.enabled||!this.current)return;
    this.current.cpu.total=performance.now()-this.frameStart;this.current.counters=counters;
    this.samples.set(this.current.id,this.current);if(this.samples.size>this.capacity)this.samples.delete(this.samples.keys().next().value!);
  }
  summary() {
    const frames=[...this.samples.values()],cpuNames=new Set(frames.flatMap(f=>Object.keys(f.cpu))),gpuNames=new Set(frames.flatMap(f=>Object.keys(f.gpu??{})));
    const interval=distribution(frames.map(f=>f.intervalMs));
    return {capturedSeconds:(performance.now()-this.started)/1000,frames:frames.length,metadata:this.metadata(),gpuSupported:this.gpuSupported,
      fps:interval?1000/interval.meanMs:null,frameInterval:interval,
      cpu:Object.fromEntries([...cpuNames].map(name=>[name,distribution(frames.map(f=>f.cpu[name]??0))])),
      gpu:Object.fromEntries([...gpuNames].map(name=>[name,distribution(frames.flatMap(f=>f.gpu?.[name]===undefined?[]:[f.gpu[name]]))])),
      counters:frames.at(-1)?.counters??{}};
  }
  export() {return {...this.summary(),samples:[...this.samples.values()]};}
  download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(this.export(),null,2)],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download='island-performance.json';a.click();URL.revokeObjectURL(url);
  }
}
interface Readback {buffer:GPUBuffer;busy:boolean}
export class GpuProfiler {
  private queries:GPUQuerySet;private resolve:GPUBuffer;private readbacks:Readback[];private active?:Readback;private id?:number;
  private disposed=false;
  constructor(private device:GPUDevice,private profiler:FrameProfiler) {
    this.queries=device.createQuerySet({type:'timestamp',count:12});
    this.resolve=device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
    this.readbacks=Array.from({length:3},()=>({buffer:device.createBuffer({size:96,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),busy:false}));
  }
  begin(frame:number) {
    this.active=undefined;this.id=undefined;
    if(!this.profiler.enabled||frame%6!==0)return;
    const slot=this.readbacks.find(r=>!r.busy);if(!slot||this.profiler.frameId===undefined)return;
    slot.busy=true;this.active=slot;this.id=this.profiler.frameId;
  }
  pass(index:number):GPURenderPassTimestampWrites|undefined {
    return this.active?{querySet:this.queries,beginningOfPassWriteIndex:index*2,endOfPassWriteIndex:index*2+1}:undefined;
  }
  get sampling() {return !!this.active;}
  resolveInto(encoder:GPUCommandEncoder) {
    if(!this.active)return;
    encoder.resolveQuerySet(this.queries,0,12,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,this.active.buffer,0,96);
  }
  submitted() {
    const slot=this.active,id=this.id;if(!slot||id===undefined)return;
    this.active=undefined;
    void slot.buffer.mapAsync(GPUMapMode.READ).then(()=>{
      if(this.disposed)return;
      const times=new BigUint64Array(slot.buffer.getMappedRange()),names=['staticShadow','movingShadow','terrain','scenery','water','post'];
      const result:Record<string,number>={};names.forEach((name,i)=>result[name]=Number(times[i*2+1]-times[i*2])/1e6);
      result.total=Object.values(result).reduce((a,b)=>a+b,0);slot.buffer.unmap();slot.busy=false;this.profiler.gpu(id,result);
    }).catch(()=>{slot.busy=false;});
  }
  dispose() {this.disposed=true;this.queries.destroy();this.resolve.destroy();this.readbacks.forEach(r=>r.buffer.destroy());}
}
