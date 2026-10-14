import {describe,it,expect} from 'vitest';
import {IslandRenderer} from '../client/renderer';
import {gpuSceneryReference,type GpuSceneryCandidate,type GpuSceneryConfig} from '../client/gpu-scenery';
import {lodEntries,rangeFade,type LodBoundary} from '../client/lod';
import {qualities,type QualitySettings} from '../client/quality';
import {naturalId} from '../shared/destruction';
import type {Prop} from '../shared/world';

type FakeSource={candidates:readonly GpuSceneryCandidate[];refs:number;destroyed:boolean};
type FakeBatch={id:number;capacity:number;candidateCount:number;candidates:readonly GpuSceneryCandidate[];config:GpuSceneryConfig;disposed:boolean;output:{id:number};source:FakeSource;replaceCount:number;dispose():void;replace(candidates:readonly GpuSceneryCandidate[],config:GpuSceneryConfig):void};
class FakeCuller {
  private next=1;private sources=new WeakMap<readonly GpuSceneryCandidate[],FakeSource>();
  readonly batches=new Set<FakeBatch>();readonly sourceList:FakeSource[]=[];candidateUploads=0;outputAllocations=0;outputDisposals=0;sourceDisposals=0;
  private acquire(candidates:readonly GpuSceneryCandidate[]):FakeSource {
    let source=this.sources.get(candidates);
    if(!source){source={candidates,refs:0,destroyed:false};this.sources.set(candidates,source);this.sourceList.push(source);this.candidateUploads++;}
    source.refs++;return source;
  }
  private release(source:FakeSource){if(--source.refs===0){source.destroyed=true;this.sourceDisposals++;}}
  createBatch(candidates:readonly GpuSceneryCandidate[],config:GpuSceneryConfig):FakeBatch {
    const source=this.acquire(candidates),batch:FakeBatch={id:this.next++,capacity:Math.ceil(candidates.length*1.2),candidateCount:candidates.length,candidates,config,disposed:false,output:{id:this.next++},source,replaceCount:0,
      replace:(next,settings)=>{if(batch.disposed)throw new Error('replace after dispose');if(next.length>batch.capacity)throw new Error('capacity exceeded');if(next!==batch.candidates){this.release(batch.source);batch.source=this.acquire(next);batch.candidates=next;}batch.candidateCount=next.length;batch.config=settings;batch.replaceCount++;},
      dispose:()=>{if(batch.disposed)return;batch.disposed=true;this.release(batch.source);this.outputDisposals++;this.batches.delete(batch);}};
    this.outputAllocations++;this.batches.add(batch);return batch;
  }
}

const planeBox=new Float32Array([0,0,0,1e6,0,0,0,1e6,0,0,0,1e6,0,0,0,1e6,0,0,0,1e6,0,0,0,1e6]);
const fullFrame={camera:[0,0,0] as [number,number,number],viewPlanes:planeBox,lightPlanes:planeBox,shadowCasterRange:10_000,naturalRange:1000};
const prop=(kind:Prop['kind'],x:number,z:number,scale=1,variant=0):Prop=>({kind,x,y:12,z,scale,variant,rotation:.35,normal:[0,1,0]});
const mesh=(key:string,count=60)=>({key,count,material:key.split('-')[0]});
const models=new Map<string,any[]>();
for(const kind of ['oak','rock','wall-wood'])models.set(kind,[0,1,2].map(level=>mesh(`${kind}-lod${level}`)));
const meshParts=(kind:string)=>kind==='wall-wood'?[models.get(kind)![0]]:models.get(kind)!;
function makeRenderer(naturalProps:Prop[]=[],builtProps:Prop[]=[]) {
  const instance=Object.create(IslandRenderer.prototype) as any, culler=new FakeCuller();
  const scene:any={revision:1,terrainRevision:1,miningRevision:0,edits:new Map(),placed:{values:()=>builtProps.map((value,index)=>({id:`built-${index}`,prop:value}))},groundDistance:()=>-1,terrain:()=>({height:0})};
  Object.assign(instance,{gpuCuller:culler,gpuNaturalDraws:[],gpuBuiltDraws:[],gpuDraws:[],gpuBatches:[],gpuOrigin:[NaN,0,NaN],gpuNaturalSignature:'',gpuBuiltSignature:'',gpuRebuilds:0,
    buildScene:scene,damaged:new Map(),quality:'medium',propInfoSignature:'900/medium',frontToBack:true,size:[1600,900],
    renderInfo:(p:Prop,settings:QualitySettings,built=false)=>{
      const tree=['oak','birch','palm'].includes(p.kind),rock=p.kind==='rock'||p.kind==='pebble',structure=p.kind==='wall-wood';
      const radius=tree?12*p.scale:rock?12*p.scale:structure?4:2;
      const boundaries=tree?(built?settings.treeLod.slice(0,2):settings.treeLod):rock?[{distance:radius*900/28*settings.rockDetail,width:radius*900/70*settings.rockDetail},{distance:radius*900/9*settings.rockDetail,width:radius*900/30*settings.rockDetail}]:[];
      const stem=tree?'oak':rock?'rock':p.kind;
      return {tree,radius,centerY:p.y+(tree?5:rock?0:2),range:structure||tree&&built?settings.trees:tree?settings.treeLod[2].distance+settings.treeLod[2].width/2:rock?p.scale>3.5?900:p.scale>1.6?520:280:settings.trees,
        boundaries,shadowBoundaries:tree?settings.treeLod.slice(settings.shadowLodOffset,2):boundaries,meshes:meshParts(stem).map((item:any)=>[item])};
    }});
  instance.buildScene.placed={values:()=>builtProps.map((value,index)=>({id:`built-${index}`,prop:value}))};
  return {instance,culler,scene,chunk:(props=naturalProps)=>[{data:{key:'fixture',x:0,z:0,level:0,minHeight:0,maxHeight:24},placedProps:props}] as any[]};
}
function invoke(renderer:any,drawn:any[],signature='topology:1',damage='removed:none',x=20,z=20){renderer.prepareGpuScenery(drawn,signature,damage,{position:[x,5,z],yaw:0});}
function find(renderer:any,key:string,shadow=false,level=0,bin=0){return [...renderer.gpuNaturalDraws,...renderer.gpuBuiltDraws].find((draw:any)=>draw.mesh.key===key&&draw.shadow===shadow&&draw.level===level&&draw.bin===bin);}
function recordsEqual(actual:readonly {record:Float32Array}[],expected:Float32Array[]){expect(actual.map(row=>Array.from(row.record))).toEqual(expected.map(row=>Array.from(row)));}
function legacyRecords(candidates:readonly GpuSceneryCandidate[],config:GpuSceneryConfig):Float32Array[]{
  const records:Float32Array[]=[];
  for(const candidate of candidates){
    const [x,y,z,scale,qx,qy,qz,qw]=candidate.transform,distance=Math.hypot(candidate.horizontal[0]-fullFrame.camera[0],candidate.horizontal[1]-fullFrame.camera[2]);
    const boundaries=candidate.boundaries??config.boundaries,offset=config.mode==='shadow'?config.shadowLodOffset??0:0,selector=config.level-offset;
    if(distance<(config.distanceMin??0)||distance>=(config.distanceMax??Infinity))continue;
    if(candidate.natural&&distance>(fullFrame.naturalRange??1000))continue;
    if(config.mode==='view'&&distance>Math.min(config.range,candidate.maxRange,candidate.range??Infinity))continue;
    if(config.mode==='shadow'&&distance>=fullFrame.shadowCasterRange+candidate.sphere[3])continue;
    const lod=lodEntries(distance,[...boundaries]).find(entry=>entry.level===selector);
    if(!lod||config.mode==='view'&&config.tree&&selector===3)continue;
    const propRange=candidate.range??config.range,fade=config.mode==='shadow'||config.tree?1:rangeFade(distance,propRange);
    records.push(new Float32Array([x-fullFrame.camera[0],y-fullFrame.camera[1],z-fullFrame.camera[2],scale,qx,qy,qz,qw,lod.threshold,lod.outgoing?1:0,fade]));
  }
  return records;
}
function compareBatchToLegacy(batch:FakeBatch){recordsEqual(gpuSceneryReference(batch.candidates,batch.config,fullFrame),legacyRecords(batch.candidates,batch.config));}

describe('renderer persistent GPU scenery cache',()=>{
  it('keeps the same candidate uploads and batches through 1000 camera moves inside one snapped origin',()=>{
    const {instance:renderer,culler,chunk}=makeRenderer([prop('oak',80,60),prop('rock',130,90,2)]);
    const drawn=chunk();invoke(renderer,drawn);
    const uploads=culler.candidateUploads,allocations=culler.outputAllocations,batches=[...renderer.gpuNaturalDraws],candidateLists=batches.map((draw:any)=>draw.batch.candidates),outputs=batches.map((draw:any)=>draw.batch.output);
    for(let i=1;i<=1000;i++)invoke(renderer,drawn,'topology:1','removed:none',i%1024,(i*13)%1024);
    expect(culler.candidateUploads).toBe(uploads);expect(culler.outputAllocations).toBe(allocations);
    expect(renderer.gpuNaturalDraws).toHaveLength(batches.length);
    renderer.gpuNaturalDraws.forEach((draw:any,index:number)=>{expect(draw.batch.candidates).toBe(candidateLists[index]);expect(draw.batch.output).toBe(outputs[index]);expect(draw.batch.disposed).toBe(false);});
    expect(renderer.gpuRebuilds).toBe(2);
  });

  it('rebuilds only the affected cache for terrain, removal, placed edits, quality, and origin changes',()=>{
    const oak=prop('oak',50,40),rock=prop('rock',90,40,2),built=prop('wall-wood',70,55),{instance:renderer,culler,scene,chunk}=makeRenderer([oak,rock],[built]);
    const drawn=chunk();invoke(renderer,drawn);let naturalRebuilds=renderer.gpuRebuilds;
    const originalNatural=renderer.gpuNaturalDraws[0].batch,originalBuilt=renderer.gpuBuiltDraws[0].batch;

    scene.terrainRevision++;invoke(renderer,drawn);expect(renderer.gpuRebuilds).toBe(naturalRebuilds+1);expect(renderer.gpuNaturalDraws[0].batch).toBe(originalNatural);expect(renderer.gpuBuiltDraws[0].batch).toBe(originalBuilt);naturalRebuilds++;
    scene.edits.set(naturalId(oak),{removed:true});invoke(renderer,drawn,'topology:1','removed:oak');
    expect(renderer.gpuRebuilds).toBe(naturalRebuilds+2);expect(renderer.gpuNaturalDraws.some((draw:any)=>draw.mesh.key.startsWith('oak-'))).toBe(false);expect(renderer.gpuBuiltDraws[0].batch).toBe(originalBuilt);naturalRebuilds+=2;

    const afterRemovalNatural=renderer.gpuNaturalDraws[0].batch;
    scene.revision++;invoke(renderer,drawn,'topology:1','removed:oak');expect(renderer.gpuRebuilds).toBe(naturalRebuilds+1);expect(renderer.gpuNaturalDraws[0].batch).toBe(afterRemovalNatural);naturalRebuilds++;
    const priorOrigin=renderer.gpuOrigin.slice();invoke(renderer,drawn,'topology:1','removed:oak',1025,30);
    expect(renderer.gpuOrigin).not.toEqual(priorOrigin);expect(renderer.gpuNaturalDraws[0].batch.candidates[0].transform[0]).toBe(rock.x-1024);expect(renderer.gpuBuiltDraws[0].batch.candidates[0].transform[0]).toBe(built.x-1024);naturalRebuilds+=2;

    renderer.quality='high';renderer.propInfoSignature='900/high';invoke(renderer,drawn,'topology:1','removed:oak',1025,30);
    expect(renderer.gpuRebuilds).toBe(naturalRebuilds+2);
    expect(renderer.gpuNaturalDraws.some((draw:any)=>draw.shadow&&draw.level===0)).toBe(true);
    expect(culler.candidateUploads).toBeGreaterThan(0);
  });

  it('keeps rocks and pebbles that share mesh assets in independent batches after rebuilding',()=>{
    const rock=prop('rock',20,25,2),pebble=prop('pebble',30,25,.1),{instance:renderer,scene,chunk}=makeRenderer([rock,pebble]);
    const drawn=chunk();invoke(renderer,drawn);
    const initial=renderer.gpuNaturalDraws.filter((draw:any)=>draw.mesh.key==='rock-lod0'&&!draw.shadow&&draw.bin===0);
    expect(initial).toHaveLength(2);expect(new Set(initial.map((draw:any)=>draw.batch)).size).toBe(2);
    scene.terrainRevision++;invoke(renderer,drawn);
    const rebuilt=renderer.gpuNaturalDraws.filter((draw:any)=>draw.mesh.key==='rock-lod0'&&!draw.shadow&&draw.bin===0);
    expect(rebuilt).toHaveLength(2);expect(new Set(rebuilt.map((draw:any)=>draw.batch)).size).toBe(2);
    expect(rebuilt.map((draw:any)=>draw.batch.candidates[0].transform[0]).sort((a:number,b:number)=>a-b)).toEqual([rock.x,pebble.x]);
    expect(new Set(renderer.gpuBatches).size).toBe(renderer.gpuBatches.length);
  });

  it('reuses output capacity for smaller sets, grows it for larger sets, and frees a removed chunk source',()=>{
    const rocks=Array.from({length:4},(_,i)=>prop('rock',20+i*8,25,1+i*.2)),{instance:renderer,culler,chunk}=makeRenderer(rocks);
    let drawn=chunk();invoke(renderer,drawn);const before=find(renderer,'rock-lod0');expect(before).toBeDefined();
    const reusable=before.batch,capacity=reusable.capacity,output=reusable.output,source=reusable.source;
    drawn=chunk(rocks.slice(0,2));invoke(renderer,drawn,'topology:2');
    const smaller=find(renderer,'rock-lod0');expect(smaller.batch).toBe(reusable);expect(smaller.batch.capacity).toBe(capacity);expect(smaller.batch.output).toBe(output);expect(smaller.batch.candidateCount).toBe(2);expect(source.destroyed).toBe(true);

    const largerProps=Array.from({length:16},(_,i)=>prop('rock',20+i*8,25,1+i*.1));drawn=chunk(largerProps);invoke(renderer,drawn,'topology:3');
    const grown=find(renderer,'rock-lod0');expect(grown.batch).not.toBe(reusable);expect(grown.batch.capacity).toBeGreaterThan(capacity);expect(reusable.disposed).toBe(true);
    const grownSource=grown.batch.source,liveBatches=[...renderer.gpuNaturalDraws].map((draw:any)=>draw.batch);drawn=chunk([]);invoke(renderer,drawn,'topology:4');
    expect(grownSource.destroyed).toBe(true);expect(liveBatches.every((batch:any)=>batch.disposed)).toBe(true);expect(renderer.gpuNaturalDraws).toHaveLength(0);expect(culler.batches.size).toBe(0);
  });

  it('keeps scaled rock LODs, quality shadow offsets, and built-tree fading equivalent to legacy selection',()=>{
    const rocks=[prop('rock',20,25,1),prop('rock',45,30,2),prop('rock',80,35,4)],tree=prop('oak',120,70),builtTree=prop('oak',2500,0),
      {instance:renderer,chunk}=makeRenderer([...rocks,tree],[builtTree]);
    invoke(renderer,chunk());
    const rockCandidates=find(renderer,'rock-lod0').batch.candidates as readonly GpuSceneryCandidate[];
    expect(rockCandidates.map(candidate=>candidate.boundaries?.map(boundary=>boundary.distance))).toEqual([1,2,4].map(scale=>{
      const radius=12*scale;return [radius*900/28*qualities.medium.rockDetail,radius*900/9*qualities.medium.rockDetail];
    }));
    for(const draw of renderer.gpuNaturalDraws)compareBatchToLegacy(draw.batch);
    const lowShadow=find(renderer,'oak-lod1',true,1);expect(lowShadow.batch.config.shadowLodOffset).toBe(0); // Medium quality starts from LOD 0.
    expect(find(renderer,'oak-lod0',true,0)).toBeDefined();
    const built=renderer.gpuBuiltDraws.find((draw:any)=>draw.mesh.key==='oak-lod2'&&!draw.shadow&&draw.level===2&&draw.bin===2);expect(built).toBeDefined();expect(built.batch.config.tree).toBe(false);
    const builtCandidate=built.batch.candidates[0],builtRecord=gpuSceneryReference([builtCandidate],built.batch.config,fullFrame)[0];
    expect(builtRecord.record[10]).toBeGreaterThan(0);expect(builtRecord.record[10]).toBeLessThan(1);
    compareBatchToLegacy(built.batch);

    renderer.quality='low';renderer.propInfoSignature='900/low';invoke(renderer,chunk());
    const low=find(renderer,'oak-lod1',true,1);expect(low.batch.config.shadowLodOffset).toBe(1);expect(find(renderer,'oak-lod0',true,0)).toBeUndefined();
    for(const draw of renderer.gpuNaturalDraws)if(draw.shadow&&draw.mesh.key.startsWith('oak-'))compareBatchToLegacy(draw.batch);
  });
});
