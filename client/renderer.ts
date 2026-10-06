import {capsuleGeometry} from './player-geometry';
import {naturalId,quaternion,worldPoint,destructionRule,type SolidRecord} from '../shared/destruction';
import {survivingFoliage} from './damaged-foliage';
import {meshVolumeRegion,mergeVolumeRegions,type VolumeMesh,type VolumeRegion} from '../shared/volume';
import { mat4 } from 'gl-matrix';
import type { WorldConfig } from '../shared/config';
import { BASE_CHUNK, VERTEX_FLOATS, type ChunkData } from '../shared/mesh';
import type { Prop } from '../shared/world';
import { WorldGenerator } from '../shared/world';
import {gradedChunk} from '../shared/build-terrain';
import { rockPoints, type Point3 } from '../shared/rocks';
import { surfaceOnMesh, surfaceFromTiles, orientation, embeddedRockHeight } from '../shared/placement';
import type { PlayerCamera } from './camera';
import type { CharacterCollider } from '../shared/character';
import type { MeshSurface } from '../shared/placement';
import { playerCollider } from './player-colliders';
import { grassMesh, oceanMesh, rockMesh,compactVertices,compactIndices, type GeometryData } from './geometry';
import { loadGLB } from './glb';
import { sceneShader,sceneryShader,predictedSceneryShader,impostorBakeShader, skyShader, waterShader, postShader,buildPreviewShader } from './shaders';
import {wallGeometry} from './wall-geometry';
import {torchGeometry} from './torch-geometry';
import {mergeGeometry,slabGeometry,wallTorchGeometry,campfireFlames} from './catalogue-geometry';
import {daylightLighting,shadowDirection} from '../shared/daylight';
import {LIGHTING_FLOATS,packLighting} from './lighting';
import {objectRegistry} from '../shared/object-registry';
import type {BuildScene} from '../shared/build-scene';
import type { TerrainStream } from './streaming';
import { FrameProfiler,GpuProfiler } from './performance';
import {TreeImpostors,impostorMesh,impostorShader,modelBounds,type ModelBounds} from './impostors';
import {frustumPlanes,sphereInFrustum} from './culling';
import {lodEntries,rangeFade,type LodBoundary} from './lod';
import {qualities,type Quality,type QualitySettings} from './quality';

interface Mesh { vertex: GPUBuffer; index: GPUBuffer; indexFormat:GPUIndexFormat; count: number; material: string;borrowed?:boolean;clipGroup?:GPUBindGroup }
interface DamageDraw {record:SolidRecord;meshes:Mesh[];lods:Mesh[][];owns:boolean;prediction?:{base?:DamageDraw;regions:VolumeRegion[];signature:string;buffer:GPUBuffer}}
interface Resident { data: ChunkData; mesh: Mesh; water?: Mesh; instance: GPUBuffer; lastUsed: number; seam?: string; placedProps?: Prop[]; colliders?:CharacterCollider[]; surfaceVertices?: Float32Array; support?: string;renderBounds?:[number,number] }
interface Batch { mesh: Mesh; buffer: GPUBuffer; capacity: number; instances: Float32Array; count:number; shadow:boolean;nearest:number }
interface PropRenderInfo {tree:boolean;radius:number;centerY:number;range:number;boundaries:LodBoundary[];shadowBoundaries:LodBoundary[];meshes:Mesh[][]}
const vertexLayout: GPUVertexBufferLayout = { arrayStride: VERTEX_FLOATS * 4, attributes: [
  { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
  { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32x4' },
  { shaderLocation: 6, offset: 48, format: 'float32x4' },
] };
const instanceLayout: GPUVertexBufferLayout = { arrayStride: 32, stepMode: 'instance', attributes: [
  { shaderLocation: 4, offset: 0, format: 'float32x4' }, { shaderLocation: 5, offset: 16, format: 'float32x4' },
] };
const sceneryLayout:GPUVertexBufferLayout={arrayStride:32,attributes:[...vertexLayout.attributes].filter(a=>a.shaderLocation!==3&&a.shaderLocation!==6)};
const sceneryInstanceLayout:GPUVertexBufferLayout={arrayStride:44,stepMode:'instance',attributes:[...instanceLayout.attributes,{shaderLocation:7,offset:32,format:'float32x3'}]};

export class IslandRenderer {
  readonly profiler=new FrameProfiler(()=>({quality:this.quality,width:this.size[0],height:this.size[1],estimatedGpuBytes:this.estimatedGpuBytes,...this.resources}));
  private gpuProfiler?:GpuProfiler;
  readonly chunks = new Map<string, Resident>();
  readonly errors: string[] = [];
  readonly textures: GPUTexture[] = [];
  readonly materials = new Map<string, GPUBindGroup>();
  readonly meshes = new Map<string, Mesh[]>();
  readonly batches = new Map<Mesh, Batch>();
  private nearBatches=new Map<Mesh,Batch>();
  private middleBatches=new Map<Mesh,Batch>();
  frontToBack=true;
  private viewBatchGroups=[this.nearBatches,this.middleBatches,this.batches];
  private farBatches=new Map<Mesh,Batch>();
  private farChunks=new WeakMap<Prop[],Map<Mesh,{props:Prop[];values:Float32Array}>>();
  private farSignature='';
  private farOrigin=[0,0];
  private farUniform!:GPUBuffer;
  private farGroup!:GPUBindGroup;
  private shadowBatches=new Map<Mesh,Batch>();
  private propInstances=new WeakMap<Prop,Float32Array>();
  private propRenderInfo=new WeakMap<Prop,PropRenderInfo>();
  private propInfoSignature='';
  private modelBounds=new Map<string,ModelBounds>();
  private impostors!:TreeImpostors;
  private impostorPipeline!:GPURenderPipeline;
  private frameLayout!:GPUBindGroupLayout;
  private damaged=new Map<string,DamageDraw>();private treeGeometry=new Map<string,GeometryData[]>();private damageVisibility='';private damageGeometryRevision=0;
  private scenerySignature='';
  private visibleBatches:Batch[]=[];
  remotePlayers:{id:string;nickname:string;feet:[number,number,number]}[]=[];private labels=new Map<string,HTMLElement>();
  buildScene?:BuildScene;
  buildPreview:{prop:Prop;valid:boolean;motion:number}|null=null;
  private previewPipeline!:GPURenderPipeline;
  private previewInstance!:GPUBuffer;private previewUniform!:GPUBuffer;private previewGroup!:GPUBindGroup;
  private casterBatches:Batch[]=[];
  quality: Quality = 'medium'; daylightHour = 9;
  private lightingUniform!:GPUBuffer;private lightingValues=new Float32Array(LIGHTING_FLOATS);
  activePointLights=0;
  drawCalls = 0; triangles = 0; frameNumber = 0;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private uniform!: GPUBuffer;
  private postUniform!:GPUBuffer;
  private uniformValues = new Float32Array(64);
  private frameGroup!: GPUBindGroup;
  private frameOnly!: GPUBindGroup;
  private materialLayout!: GPUBindGroupLayout;
  private scenePipeline!: GPURenderPipeline;
  private sceneryPipeline!:GPURenderPipeline;
  private editLayout!:GPUBindGroupLayout;private editPipelines!:Record<string,GPURenderPipeline>;
  readonly predictionTimings:{id:string;revision:number;milliseconds:number;meshMs:number;uploadMs:number;stages:number[];frame:number}[]=[];
  private sceneryDepthPipeline!:GPURenderPipeline;
  private sceneryEqualPipeline!:GPURenderPipeline;
  depthPrepass=true;
  private sceneryShadowPipeline!:GPURenderPipeline;
  private shadowPipeline!: GPURenderPipeline;
  private skyPipeline!: GPURenderPipeline;
  private waterPipeline!: GPURenderPipeline;
  private postPipeline!: GPURenderPipeline;
  private shadowTexture!: GPUTexture;
  private staticShadowTexture!:GPUTexture;
  private staticShadowSignature='';
  private shadowSize=0;
  cacheStaticShadows=true;
  private drawKeyRevision='';
  private cachedDrawKeys:string[]=[];
  private targets: GPUTexture[] = [];
  private opaque!: GPUTexture;
  private depth!: GPUTexture;
  private waterDepth!: GPUTexture;
  private composite!: GPUTexture;
  private waterGroup!: GPUBindGroup;
  private postGroup!: GPUBindGroup;
  private waterLayout!: GPUBindGroupLayout;
  private postLayout!: GPUBindGroupLayout;
  private waterMesh!: Mesh;
  private oceanInstance!: GPUBuffer;
  private size = [0, 0];
  private materialUniforms: GPUBuffer[] = [];
  private disposed = false;
  private world: WorldGenerator;
  private rockShapes: Point3[][];
  private collisionTiles=new Map<string,Resident>();
  private topologySignature='';
  private topologyRevision=0;
  private instancePosition=[NaN,NaN,NaN];
  onFatal: (message: string) => void = () => {};
  constructor(readonly canvas: HTMLCanvasElement, readonly config: WorldConfig,world?:WorldGenerator) {
    this.world = world??new WorldGenerator(config); this.rockShapes = Array.from({ length: 12 }, (_, i) => rockPoints(config.seed, i));
  }
  get distance() { return qualities[this.quality].distance; }
  collisionSurface(x:number,z:number):MeshSurface|null {
    const key=`${Math.floor(x/BASE_CHUNK)*BASE_CHUNK}:${Math.floor(z/BASE_CHUNK)*BASE_CHUNK}:0`;
    const tile=this.collisionTiles.get(key);
    return tile?.surfaceVertices?surfaceOnMesh(tile.data,tile.surfaceVertices,x,z):null;
  }
  playerColliders(x:number,z:number):CharacterCollider[] {
    const result:CharacterCollider[]=[];
    for(const tile of this.collisionTiles.values()) {
      if(tile.data.x>x+32||tile.data.x+BASE_CHUNK<x-32||tile.data.z>z+32||tile.data.z+BASE_CHUNK<z-32)continue;
      for(const collider of tile.colliders??[])if(!(collider as CharacterCollider&{solidId?:string}).solidId||!this.buildScene?.edits.get((collider as CharacterCollider&{solidId?:string}).solidId!)?.removed&&!this.buildScene?.editedCollisionReady.has((collider as CharacterCollider&{solidId?:string}).solidId!))if(Math.hypot(collider.x-x,collider.z-z)<12+collider.radius)result.push(collider);
    }
    result.push(...this.buildScene?.colliders(x,z)??[]);
    return result;
  }
  get resources() { return { chunks: this.chunks.size, textures: this.textures.length + this.targets.length + 2+(this.impostors?2:0), instanceBatches: this.viewBatchGroups.reduce((n,m)=>n+m.size,0)+this.shadowBatches.size+this.farBatches.size, drawCalls: this.drawCalls, triangles: this.triangles,
    sceneryInstances:this.visibleBatches.reduce((n,b)=>n+b.count,0),distantTreeInstances:[...this.farBatches.values()].reduce((n,b)=>n+b.count,0),shadowInstances:this.casterBatches.reduce((n,b)=>n+b.count,0),
    sceneSceneryTriangles:this.visibleBatches.reduce((n,b)=>n+b.count*b.mesh.count/3,0),shadowSceneryTriangles:this.casterBatches.reduce((n,b)=>n+b.count*b.mesh.count/3,0),pointLights:this.activePointLights,damagedObjects:this.damaged.size }; }
  get estimatedGpuBytes() {
    const buffers=new Set<GPUBuffer>([this.uniform,this.lightingUniform,this.postUniform,this.farUniform,this.oceanInstance,this.previewInstance,this.previewUniform,...this.materialUniforms].filter(Boolean));
    const add=(mesh?:Mesh)=>{if(mesh){buffers.add(mesh.vertex);buffers.add(mesh.index);}};
    this.chunks.forEach(c=>{add(c.mesh);add(c.water);buffers.add(c.instance);});this.meshes.forEach(parts=>parts.forEach(add));this.damaged.forEach(d=>[d.meshes,...d.lods].flat().forEach(add));add(this.waterMesh);
    [...this.viewBatchGroups.flatMap(m=>[...m.values()]),...this.shadowBatches.values(),...this.farBatches.values()].forEach(b=>buffers.add(b.buffer));
    const textures=[...this.textures,...this.targets,this.shadowTexture,this.staticShadowTexture,this.impostors?.texture,this.impostors?.surfaceTexture].filter(Boolean);
    let bytes=[...buffers].reduce((n,b)=>n+b.size,0);
    for(const t of textures)for(let level=0;level<t.mipLevelCount;level++)bytes+=Math.max(1,t.width>>level)*Math.max(1,t.height>>level)*t.depthOrArrayLayers*(t.format==='rgba16float'?8:4);
    return bytes;
  }
  private assertActive() {if(this.disposed)throw new DOMException('Renderer initialization was cancelled.','AbortError');}
  private upload(data: Float32Array | Uint32Array | Uint16Array, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
    const buffer = this.device.createBuffer({ label, size: Math.max(4, Math.ceil(data.byteLength/4)*4), usage, mappedAtCreation: true });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer.unmap(); return buffer;
  }
  private write(buffer: GPUBuffer, data: Float32Array) {
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }
  private mesh(data: GeometryData): Mesh {
    const vertices=['terrain','water','ocean'].includes(data.material)?data.vertices:compactVertices(data.vertices);
    const indices=compactIndices(data.indices);
    return { vertex: this.upload(vertices, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, data.material + ' vertices'), index: this.upload(indices, GPUBufferUsage.INDEX, data.material + ' indices'), indexFormat:indices instanceof Uint16Array?'uint16':'uint32',count: data.indices.length, material: data.material };
  }
  async initialize(progress: (message: string) => void) {
    this.assertActive();
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open this viewer in a WebGPU-capable desktop browser on localhost.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    this.assertActive();
    if (!adapter) throw new Error('No WebGPU adapter was available. Check browser hardware acceleration and graphics-driver support.');
    const timestamp=adapter.features.has('timestamp-query');
    this.device = await adapter.requestDevice({requiredFeatures:timestamp?['timestamp-query']:[]});
    if(this.disposed){this.device.destroy();this.assertActive();}
    this.profiler.gpuSupported=timestamp;if(timestamp)this.gpuProfiler=new GpuProfiler(this.device,this.profiler);
    this.device.addEventListener('uncapturederror', event => { if(this.disposed)return;const message = event.error.message; this.errors.push(message); console.error('WebGPU:', message); this.onFatal(`Rendering failed: ${message}`); });
    void this.device.lost.then(info => { if (!this.disposed) this.onFatal(`Graphics device lost: ${info.message || info.reason}. Retry to rebuild the viewer.`); });
    const context = this.canvas.getContext('webgpu'); if (!context) throw new Error('Cannot create a WebGPU canvas.');
    this.context = context; this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.uniform = this.device.createBuffer({ label: 'Frame', size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lightingUniform=this.device.createBuffer({label:'Daylight and local lights',size:this.lightingValues.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } };
    const lightingEntry:GPUBindGroupLayoutEntry={binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}};
    const frameLayout = this.device.createBindGroupLayout({ entries: [uniformEntry,
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      lightingEntry,
    ] });
    const frameOnlyLayout = this.device.createBindGroupLayout({ entries: [uniformEntry,lightingEntry] });
    this.frameLayout=frameLayout;
    this.materialLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } },
    ] });
    this.updateShadows();
    this.frameOnly = this.device.createBindGroup({ layout: frameOnlyLayout, entries: [{ binding: 0, resource: { buffer: this.uniform } },{binding:3,resource:{buffer:this.lightingUniform}}] });
    progress('Compiling WebGPU pipelines');
    const createModule = async (code: string, label: string) => {
      this.assertActive();
      const module = this.device.createShaderModule({ label, code });
      const messages = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      this.assertActive();
      if (messages.length) throw new Error(`${label}: ${messages.map(m => `line ${m.lineNum}: ${m.message}`).join('\n')}`);
      return module;
    };
    const sceneModule = await createModule(sceneShader, 'Terrain and scenery WGSL');
    const sceneLayout = this.device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.materialLayout] });
    const shadowLayout = this.device.createPipelineLayout({ bindGroupLayouts: [frameOnlyLayout, this.materialLayout] });
    const depthStencil: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    this.device.pushErrorScope('validation');
    this.scenePipeline = await this.device.createRenderPipelineAsync({ label: 'Opaque scene', layout: sceneLayout,
      vertex: { module: sceneModule, entryPoint: 'vertexMain', buffers: [vertexLayout, instanceLayout] },
      fragment: { module: sceneModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
    });
    const sceneryModule=await createModule(sceneryShader,'Compact scenery WGSL');
    this.sceneryPipeline=await this.device.createRenderPipelineAsync({label:'Compact scenery',layout:sceneLayout,vertex:{module:sceneryModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:sceneryModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil});
    this.sceneryDepthPipeline=await this.device.createRenderPipelineAsync({label:'Scenery depth coverage',layout:sceneLayout,vertex:{module:sceneryModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:sceneryModule,entryPoint:'depthFragment',targets:[{format:'rgba16float',writeMask:0}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil});
    this.sceneryEqualPipeline=await this.device.createRenderPipelineAsync({label:'Visible scenery shading',layout:sceneLayout,vertex:{module:sceneryModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:sceneryModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{...depthStencil,depthWriteEnabled:false,depthCompare:'equal'}});
    this.editLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
    const editModule=await createModule(predictedSceneryShader,'Immediate local destruction WGSL'),editLayout=this.device.createPipelineLayout({bindGroupLayouts:[frameLayout,this.materialLayout,this.editLayout]}),editShadowLayout=this.device.createPipelineLayout({bindGroupLayouts:[frameOnlyLayout,this.materialLayout,this.editLayout]});
    this.editPipelines={};for(const mode of ['shade','equal','depth','shadow'])this.editPipelines[mode]=await this.device.createRenderPipelineAsync({label:'Predicted solid '+mode,layout:mode==='shadow'?editShadowLayout:editLayout,vertex:{module:editModule,entryPoint:mode==='shadow'?'shadowVertex':'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:editModule,entryPoint:mode==='shadow'?'shadowFragment':mode==='depth'?'depthFragment':'fragmentMain',targets:mode==='shadow'?[]:[{format:'rgba16float',writeMask:mode==='depth'?0:GPUColorWrite.ALL}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:mode==='shadow'?{...depthStencil,depthBias:2,depthBiasSlopeScale:2}:mode==='equal'?{...depthStencil,depthWriteEnabled:false,depthCompare:'equal'}:depthStencil});
    const previewModule=await createModule(buildPreviewShader,'Building preview WGSL');
    const previewLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    this.previewUniform=this.device.createBuffer({label:'Build preview tint',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.previewInstance=this.device.createBuffer({label:'Build preview transform',size:44,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.previewGroup=this.device.createBindGroup({layout:previewLayout,entries:[{binding:0,resource:{buffer:this.previewUniform}}]});
    this.previewPipeline=await this.device.createRenderPipelineAsync({label:'Translucent building preview',layout:this.device.createPipelineLayout({bindGroupLayouts:[frameLayout,this.materialLayout,previewLayout]}),vertex:{module:previewModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:previewModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less-equal'}});
    this.shadowPipeline = await this.device.createRenderPipelineAsync({ label: 'Alpha-tested shadows', layout: shadowLayout,
      vertex: { module: sceneModule, entryPoint: 'shadowVertex', buffers: [vertexLayout, instanceLayout] },
      fragment: { module: sceneModule, entryPoint: 'shadowFragment', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { ...depthStencil, depthBias: 2, depthBiasSlopeScale: 2 },
    });
    this.sceneryShadowPipeline=await this.device.createRenderPipelineAsync({label:'Compact scenery shadows',layout:shadowLayout,vertex:{module:sceneryModule,entryPoint:'shadowVertex',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:sceneryModule,entryPoint:'shadowFragment',targets:[]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{...depthStencil,depthBias:2,depthBiasSlopeScale:2}});
    const impostorModule=await createModule(impostorShader,'Distant tree views WGSL');
    const farLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
    this.farUniform=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.farGroup=this.device.createBindGroup({layout:farLayout,entries:[{binding:0,resource:{buffer:this.farUniform}}]});
    this.impostorPipeline=await this.device.createRenderPipelineAsync({label:'Distant tree views',layout:this.device.createPipelineLayout({bindGroupLayouts:[frameLayout,this.materialLayout,farLayout]}),vertex:{module:impostorModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:impostorModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil});
    const sky = await createModule(skyShader, 'Sky WGSL');
    this.skyPipeline = await this.device.createRenderPipelineAsync({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [frameOnlyLayout] }),
      vertex: { module: sky, entryPoint: 'vertexMain' }, fragment: { module: sky, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' },
    });
    this.waterLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ] });
    const water = await createModule(waterShader, 'Ocean WGSL');
    this.waterPipeline = await this.device.createRenderPipelineAsync({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [frameOnlyLayout, this.waterLayout] }),
      vertex: { module: water, entryPoint: 'vertexMain', buffers: [vertexLayout, instanceLayout] },
      fragment: { module: water, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float' }] },
      depthStencil: {format:'depth32float',depthWriteEnabled:true,depthCompare:'less'},
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    this.postLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {type:'uniform'} },
    ] });
    this.postUniform=this.device.createBuffer({label:'Underwater view',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const post = await createModule(postShader, 'Tone mapping and antialiasing WGSL');
    this.postPipeline = await this.device.createRenderPipelineAsync({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.postLayout] }),
      vertex: { module: post, entryPoint: 'vertexMain' }, fragment: { module: post, entryPoint: 'fragmentMain', targets: [{ format: this.format }] },
    });
    const pipelineError = await this.device.popErrorScope(); if (pipelineError) throw new Error(pipelineError.message);
    progress('Loading shared surface materials');
    await this.loadMaterials();
    this.assertActive();
    progress('Loading oak and birch models');
    const modelNames: string[] = [];
    for (const species of ['oak', 'birch']) for (let variant = 0; variant < 6; variant++) for (let lod = 0; lod < 3; lod++) modelNames.push(`${species}-${variant}-lod${lod}`);
    for (let variant = 0; variant < 4; variant++) for (let lod = 0; lod < 2; lod++) modelNames.push(`bush-${variant}-lod${lod}`);
    for (let variant = 0; variant < 3; variant++) for (let lod = 0; lod < 3; lod++) modelNames.push(`palm-${variant}-lod${lod}`);
    for(const d of objectRegistry.values())if(d.asset==='blender'){modelNames.push(`${d.id}-0-lod0`);if(d.wall)for(const opening of ['door','window'])modelNames.push(`${d.id}-${opening}-0-lod0`);}
    // Small batches avoid a serial request waterfall without decoding everything at once.
    for (let i = 0; i < modelNames.length; i += 6) await Promise.all(modelNames.slice(i, i + 6).map(async name => {
      let data=mergeGeometry(await loadGLB(`/models/${name}.glb`));if(name==='campfire-0-lod0')data.push(...campfireFlames());
      this.assertActive();
      if(/^(oak|birch|palm)-\d+-lod[012]$/.test(name))this.treeGeometry.set(name,data);
      this.meshes.set(name,data.map(data=>this.mesh(data)));this.modelBounds.set(name,modelBounds(data));
    }));
    this.assertActive();
    for (let i = 0; i < 12; i++)for(let lod=0;lod<3;lod++) this.meshes.set(`rock-${i}-lod${lod}`, [this.mesh(rockMesh(this.config.seed, i,lod))]);
    for (let i = 0; i < 4; i++)for(let lod=0;lod<3;lod++) this.meshes.set(`grass-${i}-lod${lod}`, [this.mesh(grassMesh(i,lod))]);
    for(let lod=0;lod<3;lod++)this.meshes.set(`algae-0-lod${lod}`,[this.mesh({...grassMesh(0,lod),material:'algae'})]);
    for(const definition of objectRegistry.values()){
      if(definition.wall&&definition.asset!=='blender')for(const opening of [undefined,'door','window']as const){const stem=`${definition.id}${opening?'-'+opening:''}-0-lod0`,data=[wallGeometry(definition.id,opening)];this.meshes.set(stem,data.map(d=>this.mesh(d)));this.modelBounds.set(stem,modelBounds(data));}
      if(definition.slab){const data=slabGeometry(definition.id);this.meshes.set(`${definition.id}-0-lod0`,data.map(d=>this.mesh(d)));this.modelBounds.set(`${definition.id}-0-lod0`,modelBounds(data));}
    }
    this.meshes.set('torch-0-lod0',torchGeometry().map(data=>this.mesh(data)));
    this.meshes.set('torch-wall-0-lod0',wallTorchGeometry().map(data=>this.mesh(data)));
    progress('Preparing distant forest views');
    const treeNames=modelNames.filter(n=>/^(oak|birch|palm)-/.test(n)&&n.endsWith('lod2'));
    for(const name of treeNames) {
      const bounds=[0,1,2].map(lod=>this.modelBounds.get(name.replace('lod2',`lod${lod}`))!);
      this.modelBounds.set(name.replace('lod2','lod0'),{radius:Math.max(...bounds.map(b=>b.radius)),bottom:Math.min(...bounds.map(b=>b.bottom)),top:Math.max(...bounds.map(b=>b.top))});
    }
    this.impostors=new TreeImpostors(this.device,treeNames.map(name=>({name:name.replace('lod2','lod3'),bounds:this.modelBounds.get(name)!,parts:this.meshes.get(name)!})),this.materialLayout);
    for(const model of this.impostors.models) {
      this.meshes.set(model.name,[this.mesh(impostorMesh(model.bounds,model.name))]);
      this.materials.set(model.name,this.impostors.groups.get(model.name)!);
    }
    const bakeModule=await createModule(impostorBakeShader,'Distant tree surface bake WGSL');
    const bakePipeline=await this.device.createRenderPipelineAsync({label:'Bake distant tree surfaces',layout:sceneLayout,vertex:{module:bakeModule,entryPoint:'vertexMain',buffers:[sceneryLayout,sceneryInstanceLayout]},fragment:{module:bakeModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float'},{format:'rgba16float'}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil});
    await this.impostors.bake(48,bakePipeline,this.frameLayout,this.shadowTexture,this.materials,this.lightingUniform);
    this.assertActive();
    this.meshes.set('player-capsule',[this.mesh(capsuleGeometry())]);
    this.waterMesh = this.mesh(oceanMesh());
    this.oceanInstance = this.upload(new Float32Array([0,0,0,1,0,0,0,1]),GPUBufferUsage.VERTEX,'Ocean anchor');
    this.resize();
  }
  private async loadTexture(url: string, srgb: boolean, columns = 1, rows = 1, cutout = false): Promise<GPUTexture> {
    const response = await fetch(url);
    this.assertActive();
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Missing texture: ${url}. Refresh after the assets are available.`);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
    catch { throw new Error(`The texture could not be decoded: ${url}. Check this file and retry.`); }
    if(this.disposed){bitmap.close();this.assertActive();}
    const width = bitmap.width / columns, height = bitmap.height / rows, layers = columns * rows;
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const format = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const source = this.device.createTexture({ label: url + ' source atlas', size: [bitmap.width, bitmap.height], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
    // Premultiplied cutouts keep invisible RGB from bleeding into filtered leaf edges.
    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: source, premultipliedAlpha: cutout }, [bitmap.width, bitmap.height]); bitmap.close();
    const texture = this.device.createTexture({ label: url + ' independent material layers', size: [width, height, layers], mipLevelCount: levels, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const module = this.device.createShaderModule({ code: `
      @group(0) @binding(0) var img: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
      struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32)->O { let a = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); var o:O; o.p=vec4f(a[i],0,1); o.uv=vec2f(a[i].x*.5+.5,.5-a[i].y*.5); return o; }
      @fragment fn fs(o:O)->@location(0) vec4f { return textureSample(img,s,o.uv); }
    ` });
    const pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
    const sampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const encoder = this.device.createCommandEncoder();
    for (let layer = 0; layer < layers; layer++) {
      encoder.copyTextureToTexture({ texture: source, origin: [(layer % columns) * width, Math.floor(layer / columns) * height] }, { texture, origin: [0, 0, layer] }, [width, height]);
      for (let level = 1; level < levels; level++) {
        const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level - 1, mipLevelCount: 1 }) }, { binding: 1, resource: sampler }] });
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
      }
    }
    this.device.queue.submit([encoder.finish()]); source.destroy(); this.textures.push(texture); return texture;
  }
  private async loadMaterials() {
    const [terrain, terrainNormal, bark, barkNormal, oak, birch, grass, flat, ground, groundNormal, bush, palm, palmNormal, frond,wood,woodNormal,linen,linenNormal] = await Promise.all([
      this.loadTexture('/textures/terrain-albedo.png', true, 2, 2), this.loadTexture('/textures/terrain-normal-roughness.png', false, 2, 2),
      this.loadTexture('/textures/bark-albedo.png', true, 2, 1), this.loadTexture('/textures/bark-normal-roughness.png', false, 2, 1),
      this.loadTexture('/textures/oak-foliage.png', true, 1, 1, true), this.loadTexture('/textures/birch-foliage.png', true, 1, 1, true),
      this.loadTexture('/textures/grass-v2.png', true, 2, 2, true), this.loadTexture('/textures/foliage-normal-roughness.png', false),
      this.loadTexture('/textures/ground-detail-albedo.png', true, 2, 2), this.loadTexture('/textures/ground-detail-normal-roughness.png', false, 2, 2),
      this.loadTexture('/textures/bush-foliage.png', true, 1, 1, true),
      this.loadTexture('/textures/palm-albedo.png', true, 2, 1), this.loadTexture('/textures/palm-normal-roughness.png', false, 2, 1),
      this.loadTexture('/textures/palm-foliage.png', true, 1, 1, true),
      this.loadTexture('/textures/wall-wood-albedo.png',true),this.loadTexture('/textures/wall-wood-normal-roughness.png',false),
      this.loadTexture('/textures/linen-albedo.png',true),this.loadTexture('/textures/linen-normal-roughness.png',false),
    ]);
    const sampler = this.device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 4 });
    const add = (name: string, color: GPUTexture, normal: GPUTexture, tile: number[], flags: number[], tint = [1, 1, 1, 1]) => {
      const buffer = this.upload(new Float32Array([...tile, ...flags, ...tint]), GPUBufferUsage.UNIFORM, name + ' shared material'); this.materialUniforms.push(buffer);
      this.materials.set(name, this.device.createBindGroup({ layout: this.materialLayout, entries: [
        { binding: 0, resource: color.createView({ dimension: '2d-array' }) }, { binding: 1, resource: sampler }, { binding: 2, resource: normal.createView({ dimension: '2d-array' }) }, { binding: 3, resource: { buffer } },
        { binding: 4, resource: (name === 'terrain' ? ground : color).createView({ dimension: '2d-array' }) },
        { binding: 5, resource: (name === 'terrain' ? groundNormal : normal).createView({ dimension: '2d-array' }) },
      ] }));
    };
    add('terrain', terrain, terrainNormal, [0, 0, 1, 1], [0, 1, 0, 0]);
    add('rock', terrain, terrainNormal, [3, 0, 1, 1], [3, 1, 0, 0]);
    add('oak-bark', bark, barkNormal, [0, 0, 1, 1], [1, 1, 0, 0]);
    add('birch-bark', bark, barkNormal, [1, 0, 1, 1], [1, 1, 0, 0]);
    add('oak-foliage', oak, flat, [0, 0, 1, 1], [2, 1, .8, .42]);
    add('birch-foliage', birch, flat, [0, 0, 1, 1], [2, 1, 1, .42]);
    add('bush-foliage', bush, flat, [0, 0, 1, 1], [2, 1, 1.2, .42]);
    add('palm-bark', palm, palmNormal, [0,0,1,1], [1,1,.12,0]);
    add('coconut', palm, palmNormal, [1,0,1,1], [1,1,.12,0]);
    add('palm-foliage', frond, flat, [0,0,1,1], [2,1,.30,.38]);
    add('palm-dry-foliage', frond, flat, [0,0,1,1], [2,1,.30,.38], [.85,.65,.38,1]);
    for (let i = 0; i < 4; i++) add(`grass-${i}`, grass, flat, [i, 0, 1, 1], [4, 1, 1.7, .36]);
    add('algae',grass,flat,[0,0,1,1],[4,1,1.1,.36],[.42,.70,.34,1]);
    add('wood-interior',wood,woodNormal,[0,0,1,1],[1,1,0,0],[1.05,.78,.51,1]);
    add('wall-wood',wood,woodNormal,[0,0,1,1],[1,1,0,0],[.90,.87,.80,1]);
    add('wall-stone',terrain,terrainNormal,[3,0,1,1],[3,1,0,0],[.86,.89,.90,1]);
    add('torch-wood',wood,woodNormal,[0,0,1,1],[1,1,0,0],[.52,.40,.28,1]);
    add('torch-head',terrain,terrainNormal,[3,0,1,1],[3,.7,0,0],[.20,.14,.10,1]);
    add('torch-flame',wood,flat,[0,0,1,1],[6,1,1,0]);
    add('linen',linen,linenNormal,[0,0,1,1],[1,1,0,0],[.90,.93,.94,1]);
    add('iron',terrain,terrainNormal,[3,0,1,1],[3,.45,0,0],[.12,.13,.14,1]);
    add('ember',wood,flat,[0,0,1,1],[1,1,0,0],[.22,.06,.02,1]);
    add('brick',terrain,terrainNormal,[3,0,1,1],[3,1,0,0],[.85,.43,.29,1]);
  }
  private updateShadows() {
    const size=qualities[this.quality].shadowSize;
    if(this.shadowSize===size)return;
    this.shadowTexture?.destroy();this.staticShadowTexture?.destroy();this.shadowSize=size;
    this.shadowTexture=this.device.createTexture({label:'Sun shadow',size:[size,size],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    this.staticShadowTexture=this.device.createTexture({label:'Unchanged shadow casters',size:[size,size],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    this.frameGroup=this.device.createBindGroup({layout:this.frameLayout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:this.shadowTexture.createView()},{binding:2,resource:this.device.createSampler({compare:'less-equal',magFilter:'linear',minFilter:'linear'})},{binding:3,resource:{buffer:this.lightingUniform}}]});
    this.staticShadowSignature='';
  }
  private resize() {
    const scale = qualities[this.quality].scale, ratio = Math.min(devicePixelRatio, 1.5);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio * scale)), height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio * scale));
    if (this.size[0] === width && this.size[1] === height) return;
    this.targets.forEach(t => t.destroy()); this.size = [width, height]; this.canvas.width = width; this.canvas.height = height;
    const make = (format: GPUTextureFormat, usage: GPUTextureUsageFlags) => this.device.createTexture({ size: [width, height], format, usage });
    this.opaque = make('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC);
    this.depth = make('depth32float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
    this.waterDepth = make('depth32float',GPUTextureUsage.RENDER_ATTACHMENT);
    this.composite = make('rgba16float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    this.targets = [this.opaque, this.depth, this.composite, this.waterDepth];
    const sampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.waterGroup = this.device.createBindGroup({ layout: this.waterLayout, entries: [{ binding: 0, resource: this.opaque.createView() }, { binding: 1, resource: this.depth.createView() }, { binding: 2, resource: sampler }] });
    this.postGroup = this.device.createBindGroup({ layout: this.postLayout, entries: [{ binding: 0, resource: this.composite.createView() }, { binding: 1, resource: sampler },{binding:2,resource:{buffer:this.postUniform}}] });
  }
  private ingest(stream: TerrainStream) {
    for (let i = 0; i < 4 && stream.pending.length; i++) {
      const data = stream.pending.shift()!;
      if (!stream.desired.has(data.key)) { stream.forget(data.key); continue; }
      const previous = this.chunks.get(data.key); if (previous) this.destroyChunk(previous);
      this.chunks.set(data.key, { data, mesh: this.mesh({ ...data, material: 'terrain' }), water: data.water.indices.length ? this.mesh({...data.water,material:'water'}) : undefined,
        instance: this.device.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }), lastUsed: this.frameNumber });
      this.topologyRevision++;
    }
    for (const [key, chunk] of this.chunks) if (!stream.desired.has(key) && (this.frameNumber - chunk.lastUsed > 180 || this.chunks.size > 640)) {
      this.destroyChunk(chunk); this.chunks.delete(key); stream.forget(key);this.topologyRevision++;
    }
  }
  private destroyChunk(chunk: Resident) { chunk.mesh.vertex.destroy(); chunk.mesh.index.destroy(); chunk.instance.destroy(); chunk.water?.vertex.destroy(); chunk.water?.index.destroy(); }
  private instance(prop: Prop, camera: PlayerCamera) {
    let values=this.propInstances.get(prop);
    if(!values) {values=new Float32Array([0,0,0,prop.scale,...orientation(prop.normal??[0,1,0],prop.rotation),1,0,1]);this.propInstances.set(prop,values);}
    values[0]=prop.x-camera.position[0];values[1]=prop.y-camera.position[1];values[2]=prop.z-camera.position[2];return values;
  }
  private renderInfo(prop:Prop,settings:QualitySettings,built=false):PropRenderInfo {
    const cached=this.propRenderInfo.get(prop);if(cached)return cached;
    const tree=prop.kind==='oak'||prop.kind==='birch'||prop.kind==='palm';
    const definition=objectRegistry.get(prop.kind),structure=definition&&definition.family!=='tree'&&definition.family!=='rock';
    const wall=definition?.wall;
    const fixture=definition?.fixture;
    const bounds=this.modelBounds.get(`${prop.kind}-${prop.variant}-lod0`);
    const radius=wall?Math.hypot(wall.width/2,wall.height/2,wall.depth/2):fixture?1.15:bounds?Math.hypot(bounds.radius,(bounds.top-bounds.bottom)/2)*prop.scale+.8:prop.kind==='rock'?12*prop.scale:prop.kind==='bush'?4*prop.scale:2*prop.scale;
    const rockDistance=prop.scale>3.5?900:prop.scale>1.6?520:280;
    const boundaries=structure?[]:tree?built?settings.treeLod.slice(0,2):settings.treeLod:prop.kind==='bush'?settings.shrubLod:prop.kind==='rock'||prop.kind==='pebble'?[{distance:radius*this.size[1]/28*settings.rockDetail,width:radius*this.size[1]/70*settings.rockDetail},{distance:radius*this.size[1]/9*settings.rockDetail,width:radius*this.size[1]/30*settings.rockDetail}]:settings.grassLod;
    const stem=structure?`${prop.kind}${prop.aperture?'-'+prop.aperture:''}-0`:tree?`${prop.kind}-${prop.variant}`:prop.kind==='bush'?`bush-${prop.variant}`:prop.kind==='rock'||prop.kind==='pebble'?`rock-${prop.variant}`:prop.kind==='algae'?'algae-0':`grass-${prop.variant}`;
    const info:PropRenderInfo={tree,radius,centerY:prop.y+(wall?wall.height/2:fixture?1:bounds?(bounds.top+bounds.bottom)/2:prop.kind==='bush'?1.5:.6)*prop.scale,
      range:structure||tree&&built?settings.trees:tree?settings.treeLod[2].distance+settings.treeLod[2].width/2:prop.kind==='bush'?520:prop.kind==='rock'?rockDistance:prop.kind==='algae'?60:settings.grass,
      boundaries,shadowBoundaries:tree?settings.treeLod.slice(settings.shadowLodOffset,2):boundaries,meshes:Array.from({length:tree?3:boundaries.length+1},(_,i)=>this.meshes.get(`${stem}-lod${i}`)!)};
    this.propRenderInfo.set(prop,info);return info;
  }
  /** Visible local geometry is committed synchronously, before the action is
   * sent. Baseline skins are clipped only inside these small surface regions. */
  predictSolid(record:SolidRecord,additional:VolumeRegion[]=[],geometry?:VolumeMesh[]){
    const previous=this.damaged.get(record.id);if(!additional.length&&!previous?.prediction)return;
    const regions=mergeVolumeRegions([...(previous?.prediction?.regions??[]),...additional]),signature=JSON.stringify([record.revision,regions,geometry?.length]);if(previous?.prediction?.signature===signature){previous.record=record;return;}
    const start=performance.now(),base=previous?.prediction?previous.prediction.base:previous;
    const stages:number[]=[],patchGeometry=geometry??regions.flatMap(region=>meshVolumeRegion(record.source,record.volume,region,stages));
    const meshMs=performance.now()-start;
    const values=new Float32Array(regions.length*8);regions.forEach((r,i)=>{values.set([...r[0],i===0?regions.length:0,...r[1],0],i*8);});
    const buffer=this.upload(values,GPUBufferUsage.STORAGE,'Immediate cut regions'),clipGroup=this.device.createBindGroup({layout:this.editLayout,entries:[{binding:0,resource:{buffer}}]});
    const intact=this.meshes.get(`${record.prop.kind}${record.prop.aperture?'-'+record.prop.aperture:''}-${record.prop.variant}-lod0`)??[];
    const skin=(base?.meshes??intact).map(mesh=>({...mesh,borrowed:true,clipGroup:mesh.material.includes('foliage')||mesh.material==='coconut'?undefined:clipGroup}));
    if(previous?.prediction)this.disposeDamage(previous,false);
    this.damaged.set(record.id,{record,owns:true,meshes:[...skin,...patchGeometry.map(m=>this.mesh(m))],lods:[],prediction:{base,regions,signature,buffer}});this.damageGeometryRevision++;this.scenerySignature='';
    const milliseconds=performance.now()-start;this.predictionTimings.push({id:record.id,revision:record.revision,milliseconds,meshMs,uploadMs:milliseconds-meshMs,stages,frame:this.frameNumber});if(this.predictionTimings.length>300)this.predictionTimings.shift();return milliseconds;
  }
  private disposeDamage(d:DamageDraw,baseline=true){for(const mesh of [d.meshes,...d.lods].flat()){for(const map of [...this.viewBatchGroups,this.shadowBatches]){map.get(mesh)?.buffer.destroy();map.delete(mesh);}if(d.owns&&!mesh.borrowed){mesh.vertex.destroy();mesh.index.destroy();}}d.prediction?.buffer.destroy();if(baseline&&d.prediction?.base)this.disposeDamage(d.prediction.base);}
  setDamagedMesh(record:SolidRecord,geometry:VolumeMesh[],geometryLods:VolumeMesh[][]=[]){
    this.removeDamagedMesh(record.id);const owns=destructionRule(record.prop)?.mode!=='whole';
    const meshes=owns?[...geometry,...survivingFoliage(record,this.treeGeometry.get(`${record.prop.kind}-${record.prop.variant}-lod0`)??[])].map(g=>this.mesh(g)):this.meshes.get(`${record.prop.kind}-${record.prop.variant}-lod0`)??[];
    const lods=owns?geometryLods.map((level,i)=>[...level,...survivingFoliage(record,this.treeGeometry.get(`${record.prop.kind}-${record.prop.variant}-lod${Math.min(i+1,2)}`)??[])].map(g=>this.mesh(g))):[];
    this.damaged.set(record.id,{record,owns,meshes,lods});this.damageGeometryRevision++;this.scenerySignature='';
  }
  updateDamagedPose(record:SolidRecord){const d=this.damaged.get(record.id);if(d){d.record=record;this.scenerySignature='';}}
  removeDamagedMesh(id:string){const d=this.damaged.get(id);if(!d)return;this.disposeDamage(d);this.damaged.delete(id);this.damageGeometryRevision++;this.scenerySignature='';}
  private append(mesh:Mesh,values:Float32Array,shadow=false,distance=Infinity,target?:Map<Mesh,Batch>) {
    const collection=target??(shadow?this.shadowBatches:this.frontToBack&&distance<100?this.nearBatches:this.frontToBack&&distance<250?this.middleBatches:this.batches);
    let batch=collection.get(mesh);
    if(!batch) {batch={mesh,shadow,nearest:Infinity,buffer:this.device.createBuffer({size:44*256,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),capacity:256,instances:new Float32Array(256*11),count:0};collection.set(mesh,batch);}
    if(batch.count===batch.capacity) {
      batch.capacity*=2;const instances=new Float32Array(batch.capacity*11);instances.set(batch.instances);batch.instances=instances;
      batch.buffer.destroy();batch.buffer=this.device.createBuffer({size:batch.capacity*44,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    }
    batch.instances.set(values,batch.count*11);batch.count++;batch.nearest=Math.min(batch.nearest,distance);
  }
  render(camera: PlayerCamera, stream: TerrainStream, time: number) {
    if (this.disposed) return;
    let stage=this.profiler.mark();
    this.frameNumber++; this.resize(); this.updateShadows(); this.ingest(stream); this.drawCalls = 0; this.triangles = 0;
    this.profiler.endStage('ingest',stage);stage=this.profiler.mark();
    const matrices = camera.matrices(this.size[0] / this.size[1], Math.max(this.distance * 1.5, 5500));
    const daylight=daylightLighting(this.daylightHour),sun=shadowDirection(daylight.primary);
    const forward = camera.forward, center: [number, number, number] = [forward[0] * 75, -30, forward[2] * 75];
    const eye: [number, number, number] = [center[0] + sun[0] * 600, center[1] + sun[1] * 600, center[2] + sun[2] * 600];
    const quality=qualities[this.quality],shadowRadius=quality.shadowRadius;
    const light = mat4.multiply(mat4.create(), mat4.orthoZO(mat4.create(), -shadowRadius, shadowRadius, -shadowRadius, shadowRadius, 1, 1200), mat4.lookAt(mat4.create(), eye, center, [0, 1, 0]));
    const lightPlanes=frustumPlanes(light),viewPlanes=frustumPlanes(matrices.vp);
    this.uniformValues.set(matrices.vp, 0); this.uniformValues.set(matrices.inverse, 16); this.uniformValues.set(light, 32);
    const waterDepth=Math.max(0,(camera.character.waterLevel??camera.position[1])-camera.position[1]);
    this.uniformValues.set([camera.position[0], camera.position[1], camera.position[2], waterDepth], 48);
    this.write(this.postUniform,new Float32Array([waterDepth,time,daylight.exposure,0]));
    this.activePointLights=packLighting(this.lightingValues,daylight,camera.position,this.buildScene?[...this.buildScene.placed.query(camera.position[0],camera.position[2],128),...[...this.buildScene.edits.values()].filter(r=>r.fall&&!r.removed&&['torch','torch-wall','campfire'].includes(r.prop.kind)).map(r=>this.buildScene!.solid(r.prop,r.id))]:[],quality.pointLights,time);
    this.write(this.lightingUniform,this.lightingValues);
    this.uniformValues.set([...sun, 1], 52); this.uniformValues.set([time, this.distance, ...this.size], 56);
    this.uniformValues.set([quality.shadowFilter, this.config.islandSizeMeters, 0, 0], 60);
    new Uint32Array(this.uniformValues.buffer)[63] = this.world.seed;
    this.write(this.uniform, this.uniformValues);
    this.profiler.endStage('frameSetup',stage);stage=this.profiler.mark();
    const drawKeyRevision=`${this.topologyRevision}/${stream.revision}`;
    if(drawKeyRevision!==this.drawKeyRevision) {this.drawKeyRevision=drawKeyRevision;this.cachedDrawKeys=stream.drawKeys(new Set(this.chunks.keys()));}
    const drawKeys=this.cachedDrawKeys;
    const drawn = drawKeys.map(key => this.chunks.get(key)!);
    const gradeRevision=this.buildScene?.terrainRevision??0;
    const signature=`${this.topologyRevision}/${drawKeys.join('|')}/${gradeRevision}`;
    const topologyChanged=signature!==this.topologySignature;
    this.topologySignature=signature;
    if(topologyChanged) {
    for (const chunk of drawn) {
      const d = chunk.data, extent = BASE_CHUNK * 2 ** d.level, neighbors = [d.level, d.level, d.level, d.level];
      for (const other of drawn) {
        const b = other.data, e = BASE_CHUNK * 2 ** b.level;
        if (b.level <= d.level) continue;
        const overlapX = b.x < d.x + extent && b.x + e > d.x, overlapZ = b.z < d.z + extent && b.z + e > d.z;
        if (overlapX && b.z + e === d.z) neighbors[0] = Math.max(neighbors[0], b.level);
        if (overlapZ && b.x === d.x + extent) neighbors[1] = Math.max(neighbors[1], b.level);
        if (overlapX && b.z === d.z + extent) neighbors[2] = Math.max(neighbors[2], b.level);
        if (overlapZ && b.x + e === d.x) neighbors[3] = Math.max(neighbors[3], b.level);
      }
      const floorSignature=this.buildScene?.gradingSignature(d.x,d.z,extent)??'';
      const signature = `${neighbors.join(':')}/${floorSignature}`;
      if (signature !== chunk.seam) {
        const vertices = gradedChunk(this.buildScene,this.world,d,neighbors);
        this.write(chunk.mesh.vertex, vertices); chunk.seam = signature; chunk.surfaceVertices = vertices;
        let min=Infinity,max=-Infinity;for(let i=1;i<vertices.length;i+=VERTEX_FLOATS){min=Math.min(min,vertices[i]);max=Math.max(max,vertices[i]);}chunk.renderBounds=[min,max];
      }
    }
    }
    this.profiler.endStage('seams',stage);stage=this.profiler.mark();
    // Finish all seams before fitting footprints; big outcrops can span neighboring tiles.
    if(topologyChanged)for (const chunk of drawn) {
      if (!chunk.data.props.length) continue;
      const d = chunk.data, extent = BASE_CHUNK * 2 ** d.level;
      const nearby = drawn.filter(other => {
        const b = other.data, e = BASE_CHUNK * 2 ** b.level;
        return b.x < d.x + extent + 32 && b.x + e > d.x - 32 && b.z < d.z + extent + 32 && b.z + e > d.z - 32;
      });
      const signature = nearby.map(other => `${other.data.key}/${other.seam}`).join('|');
      if (signature === chunk.support) continue;
      chunk.support = signature;
      const tiles = [chunk, ...nearby.filter(other => other !== chunk)].map(other => ({ data: other.data, vertices: other.surfaceVertices ?? other.data.vertices }));
      chunk.placedProps = d.props.filter(prop=>!['grass','pebble','algae'].includes(prop.kind)||!this.buildScene?.floorAt(prop.x,prop.z)).map(prop => {
        const surface = surfaceOnMesh(d, chunk.surfaceVertices!, prop.x, prop.z);
        if (prop.kind === 'pebble') return { ...prop, y: surface.height - .08 * prop.scale, normal: surface.normal };
        if (prop.kind !== 'rock') return { ...prop, y: surface.height - (prop.kind === 'grass'||prop.kind==='algae' ? .04 : .20) };
        const rotation = orientation(surface.normal, prop.rotation);
        const y = embeddedRockHeight(this.rockShapes[prop.variant], prop.x, prop.z, prop.scale, rotation,
          (x, z) => surfaceFromTiles(tiles, x, z)?.height ?? this.world.height(x, z));
        return { ...prop, y, normal: surface.normal };
      });
      chunk.colliders=d.level===0?chunk.placedProps.flatMap(prop=>{const collider=playerCollider(prop,this.rockShapes[prop.variant]);return collider?[Object.assign(collider,{solidId:naturalId(prop)})]:[];}):[];
    }
    if(topologyChanged) {
      this.collisionTiles.clear();
      for(const chunk of drawn)if(chunk.data.level===0)this.collisionTiles.set(chunk.data.key,chunk);
    }
    this.profiler.endStage('placement',stage);stage=this.profiler.mark();
    const visible: Resident[] = [], shadowChunks: Resident[] = [];
    const positionChanged=topologyChanged||camera.position.some((v,i)=>v!==this.instancePosition[i]);
    this.instancePosition=[...camera.position];
    for (const key of drawKeys) {
      const chunk = this.chunks.get(key)!; chunk.lastUsed = this.frameNumber;
      const e = BASE_CHUNK * 2 ** chunk.data.level, cx = chunk.data.x + e / 2, cz = chunk.data.z + e / 2;
      const [min,max]=chunk.renderBounds??[chunk.data.minHeight,chunk.data.maxHeight];
      const cy = (min + max) / 2;
      const radius = Math.hypot(e / 2, e / 2, (max - min) / 2);
      if(positionChanged)this.write(chunk.instance, new Float32Array([chunk.data.x - camera.position[0], -camera.position[1], chunk.data.z - camera.position[2], 1, 0, 0, 0, 1]));
      if (Math.hypot(cx-camera.position[0],cy-camera.position[1],cz-camera.position[2])<=this.distance+radius&&sphereInFrustum(viewPlanes,cx-camera.position[0],cy-camera.position[1],cz-camera.position[2],radius)) visible.push(chunk);
      if (sphereInFrustum(lightPlanes,cx-camera.position[0],cy-camera.position[1],cz-camera.position[2],radius)) shadowChunks.push(chunk);
    }
    // Opaque terrain writes depth first, rejecting hidden fragments in farther tiles.
    visible.sort((a,b)=>Math.hypot(a.data.x-camera.position[0],a.data.z-camera.position[2])-Math.hypot(b.data.x-camera.position[0],b.data.z-camera.position[2]));
    this.profiler.endStage('terrainCull',stage);stage=this.profiler.mark();
    const origin=[Math.floor(camera.position[0]/1024)*1024,Math.floor(camera.position[2]/1024)*1024];
    const damageVisibility=[...this.buildScene?.edits.values()??[]].filter(r=>r.removed).map(r=>r.id).sort().join('|')+'/'+[...this.damaged.keys()].sort().join('|');if(damageVisibility!==this.damageVisibility){this.damageVisibility=damageVisibility;this.farChunks=new WeakMap();this.farSignature='';}
    const farSignature=`${signature}/${origin.join(',')}/${damageVisibility}`;
    if(farSignature!==this.farSignature) {
      this.farSignature=farSignature;this.farOrigin=origin;
      for(const batch of this.farBatches.values())batch.count=0;
      for(const chunk of drawn) {
        const props=chunk.placedProps;if(!props)continue;
        let packed=this.farChunks.get(props);
        if(!packed) {
          packed=new Map();
          for(const prop of props)if(!this.buildScene?.edits.get(naturalId(prop))?.removed&&!this.damaged.has(naturalId(prop)))if(prop.kind==='oak'||prop.kind==='birch'||prop.kind==='palm')for(const mesh of this.meshes.get(`${prop.kind}-${prop.variant}-lod3`)!) {
            let group=packed.get(mesh);if(!group){group={props:[],values:new Float32Array()};packed.set(mesh,group);}group.props.push(prop);
          }
          for(const group of packed.values()) {
            group.values=new Float32Array(group.props.length*11);
            for(let i=0;i<group.props.length;i++) {
              group.values.set(this.instance(group.props[i],camera),i*11);
              group.values[i*11+8]=1;group.values[i*11+9]=0;group.values[i*11+10]=1;
            }
          }
          this.farChunks.set(props,packed);
        }
        // Reuse unchanged tile transforms and bulk-copy each model group. Coordinates
        // still derive from the original doubles, retaining camera-relative precision.
        for(const [mesh,group]of packed) {
          let batch=this.farBatches.get(mesh);
          if(!batch) {batch={mesh,shadow:false,nearest:Infinity,buffer:this.device.createBuffer({size:44*256,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),capacity:256,instances:new Float32Array(256*11),count:0};this.farBatches.set(mesh,batch);}
          const required=batch.count+group.props.length;
          if(required>batch.capacity) {
            while(batch.capacity<required)batch.capacity*=2;
            const values=new Float32Array(batch.capacity*11);values.set(batch.instances);batch.instances=values;
            batch.buffer.destroy();batch.buffer=this.device.createBuffer({size:batch.capacity*44,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
          }
          const offset=batch.count*11;batch.instances.set(group.values,offset);
          for(let i=0;i<group.props.length;i++) {
            const prop=group.props[i],at=offset+i*11;
            batch.instances[at]=prop.x-origin[0];batch.instances[at+1]=prop.y;batch.instances[at+2]=prop.z-origin[1];
          }
          batch.count=required;
        }
      }
      for(const batch of this.farBatches.values())if(batch.count)this.write(batch.buffer,batch.instances.subarray(0,batch.count*11));
    }
    const handoff=quality.treeLod[2];
    this.write(this.farUniform,new Float32Array([this.farOrigin[0]-camera.position[0],-camera.position[1],this.farOrigin[1]-camera.position[2],quality.trees,handoff.distance-handoff.width/2,handoff.distance+handoff.width/2,0,0]));
    this.profiler.endStage('distantScenery',stage);stage=this.profiler.mark();
    const scenerySignature=`${signature}/${camera.position.join(',')}/${camera.yaw}/${camera.pitch}/${this.quality}/${sun.join(',')}/${this.size.join(',')}/${this.frontToBack}/${this.buildScene?.revision??0}/${this.damageGeometryRevision}/${this.remotePlayers.map(p=>p.id+':'+p.feet.join(',')).join(';')}`;
    const sceneryChanged=scenerySignature!==this.scenerySignature;
    this.scenerySignature=scenerySignature;
    if(sceneryChanged) {
    for (const batch of [...this.viewBatchGroups.flatMap(m=>[...m.values()]),...this.shadowBatches.values()]) {batch.count=0;batch.nearest=Infinity;}
    const settings = qualities[this.quality];
    const propInfoSignature=`${this.size[1]}/${this.quality}`;
    if(propInfoSignature!==this.propInfoSignature){this.propInfoSignature=propInfoSignature;this.propRenderInfo=new WeakMap();}
    const sceneryChunks = drawn.filter(c => c.data.level <= 4);
    if(this.frontToBack)sceneryChunks.sort((a,b)=>Math.hypot(a.data.x-camera.position[0],a.data.z-camera.position[2])-Math.hypot(b.data.x-camera.position[0],b.data.z-camera.position[2]));
    for (const chunk of sceneryChunks) {
      const d=chunk.data,e=BASE_CHUNK*2**d.level,cx=d.x+e/2-camera.position[0],cz=d.z+e/2-camera.position[2],cy=(d.minHeight+d.maxHeight)/2+40-camera.position[1];
      const chunkRadius=Math.hypot(e/2+40,e/2+40,(d.maxHeight-d.minHeight)/2+80);
      if(!sphereInFrustum(viewPlanes,cx,cy,cz,chunkRadius)&&!sphereInFrustum(lightPlanes,cx,cy,cz,chunkRadius))continue;
      if(Math.hypot(Math.max(d.x-camera.position[0],0,camera.position[0]-d.x-e),Math.max(d.z-camera.position[2],0,camera.position[2]-d.z-e))>1000)continue;
      for (const prop of chunk.placedProps ?? []) {
      if((prop.kind==='rock'||prop.kind==='oak'||prop.kind==='birch'||prop.kind==='palm')&&(this.buildScene?.edits.get(naturalId(prop))?.removed||this.damaged.has(naturalId(prop))))continue;
      const distance = Math.hypot(prop.x - camera.position[0], prop.z - camera.position[2]);
      if(distance>1000)continue;
      const info=this.renderInfo(prop,settings),{tree,radius,range,boundaries}=info;
      const x=prop.x-camera.position[0],y=info.centerY-camera.position[1],z=prop.z-camera.position[2];
      const caster=prop.kind!=='grass'&&prop.kind!=='algae'&&distance<settings.shadowCasterRange+radius&&sphereInFrustum(lightPlanes,x,y,z,radius);
      const inView=distance<=range&&sphereInFrustum(viewPlanes,x,y,z,radius);
      if(!inView&&!caster)continue;
      const values=this.instance(prop,camera);
      if(inView)for(const entry of lodEntries(distance,boundaries)) {
        if(tree&&entry.level===3)continue;
        values[8]=entry.threshold;values[9]=entry.outgoing?1:0;values[10]=tree?1:rangeFade(distance,range);
        for(const mesh of info.meshes[entry.level])this.append(mesh,values,false,distance);
      }
      // Use geometry for the nearby sun map, including casters outside the camera.
      if(caster)for(const entry of lodEntries(distance,info.shadowBoundaries)) {
        values[8]=entry.threshold;values[9]=entry.outgoing?1:0;values[10]=1;
        for(const mesh of info.meshes[entry.level+(tree?settings.shadowLodOffset:0)])this.append(mesh,values,true);
      }
    }
    }
    for(const player of this.remotePlayers){const [x,y,z]=player.feet,distance=Math.hypot(x-camera.position[0],z-camera.position[2]);if(camera.visible(x,y+1,z,2,256)){const values=new Float32Array([x-camera.position[0],y-camera.position[1],z-camera.position[2],1,0,0,0,1,1,0,1]);for(const mesh of this.meshes.get('player-capsule')??[])this.append(mesh,values,false,distance);}}
    for(const solid of this.buildScene?.placed.query(camera.position[0],camera.position[2],settings.trees)??[]) {
      if(this.buildScene?.edits.get(solid.id)?.removed||this.damaged.has(solid.id))continue;
      const prop=solid.prop,distance=Math.hypot(prop.x-camera.position[0],prop.z-camera.position[2]),info=this.renderInfo(prop,settings,true),x=prop.x-camera.position[0],y=info.centerY-camera.position[1],z=prop.z-camera.position[2];
      const inView=distance<=info.range&&sphereInFrustum(viewPlanes,x,y,z,info.radius),caster=distance<settings.shadowCasterRange+info.radius&&sphereInFrustum(lightPlanes,x,y,z,info.radius);
      if(!inView&&!caster)continue;const values=this.instance(prop,camera);
      if(inView)for(const entry of lodEntries(distance,info.boundaries)){values[8]=entry.threshold;values[9]=entry.outgoing?1:0;values[10]=rangeFade(distance,info.range);for(const mesh of info.meshes[entry.level])this.append(mesh,values,false,distance);}
      if(caster)for(const entry of lodEntries(distance,info.shadowBoundaries)){values[8]=entry.threshold;values[9]=entry.outgoing?1:0;values[10]=1;for(const mesh of info.meshes[entry.level+(info.tree?settings.shadowLodOffset:0)])this.append(mesh,values,true);}
    }
    for(const {record,meshes,lods}of this.damaged.values()){if(record.removed)continue;const p=record.pose?.position??[record.prop.x,record.prop.y,record.prop.z],distance=Math.hypot(p[0]-camera.position[0],p[2]-camera.position[2]);if(distance>settings.trees)continue;const bounds=record.fragmentBounds??record.source.bounds,center=worldPoint(record,bounds[0].map((v,k)=>(v+bounds[1][k])/2)as [number,number,number]),radius=Math.hypot(...bounds[1].map((v,k)=>(v-bounds[0][k])/2))*record.prop.scale+3,inView=sphereInFrustum(viewPlanes,center[0]-camera.position[0],center[1]-camera.position[1],center[2]-camera.position[2],radius),caster=distance<settings.shadowCasterRange+radius&&sphereInFrustum(lightPlanes,center[0]-camera.position[0],center[1]-camera.position[1],center[2]-camera.position[2],radius);if(!inView&&!caster)continue;const q=quaternion(record),values=new Float32Array([p[0]-camera.position[0],p[1]-camera.position[1],p[2]-camera.position[2],record.prop.scale,...q,1,0,rangeFade(distance,settings.trees)]);const levels=[meshes,...lods],entries=lodEntries(distance,lods.length?settings.treeLod.slice(0,lods.length):[]);for(const entry of entries){values[8]=entry.threshold;values[9]=entry.outgoing?1:0;for(const mesh of levels[entry.level]){if(inView)this.append(mesh,values,false,distance);if(caster)this.append(mesh,values,true);}}}
    this.visibleBatches=this.viewBatchGroups.flatMap(m=>[...m.values()].filter(b=>b.count).sort((a,b)=>this.frontToBack?a.nearest-b.nearest:0));
    this.casterBatches=[...this.shadowBatches.values()].filter(b=>b.count);
    }
    const ids=new Set(this.remotePlayers.map(p=>p.id));for(const [id,label]of this.labels)if(!ids.has(id)){label.remove();this.labels.delete(id);}
    const vp=camera.matrices(this.size[0]/this.size[1],this.distance).vp;for(const player of this.remotePlayers){let label=this.labels.get(player.id);if(!label){label=document.createElement('span');label.className='player-nickname';document.body.append(label);this.labels.set(player.id,label);}label.textContent=player.nickname;const p=[player.feet[0]-camera.position[0],player.feet[1]+2.45-camera.position[1],player.feet[2]-camera.position[2]],w=vp[3]*p[0]+vp[7]*p[1]+vp[11]*p[2]+vp[15],x=vp[0]*p[0]+vp[4]*p[1]+vp[8]*p[2]+vp[12],y=vp[1]*p[0]+vp[5]*p[1]+vp[9]*p[2]+vp[13];label.hidden=w<=0||Math.abs(x)>w||Math.abs(y)>w;label.style.left=(x/w*.5+.5)*innerWidth+'px';label.style.top=(-y/w*.5+.5)*innerHeight+'px';}
    this.profiler.endStage('scenery',stage);stage=this.profiler.mark();
    if(sceneryChanged)for (const batch of [...this.visibleBatches,...this.casterBatches])this.write(batch.buffer,batch.instances.subarray(0,batch.count*11));
    this.profiler.endStage('instanceUpload',stage);stage=this.profiler.mark();
    const encoder = this.device.createCommandEncoder();this.gpuProfiler?.begin(this.frameNumber);
    const draw = (pass: GPURenderPassEncoder, mesh: Mesh, instances: GPUBuffer, count = 1,mode?:'shade'|'equal'|'depth'|'shadow') => {
      const material = this.materials.get(mesh.material); if (!material) throw new Error(`Unknown model material ${mesh.material}`);
      if(mesh.clipGroup&&mode){pass.setPipeline(this.editPipelines[mode]);pass.setBindGroup(2,mesh.clipGroup);}
      pass.setBindGroup(1, material); pass.setVertexBuffer(0, mesh.vertex); pass.setVertexBuffer(1, instances); pass.setIndexBuffer(mesh.index, mesh.indexFormat); pass.drawIndexed(mesh.count, count);
      if(mesh.clipGroup&&mode)pass.setPipeline(mode==='shadow'?this.sceneryShadowPipeline:mode==='depth'?this.sceneryDepthPipeline:mode==='equal'?this.sceneryEqualPipeline:this.sceneryPipeline);
      this.drawCalls++; this.triangles += mesh.count / 3 * count;
    };
    const staticChanged=!this.cacheStaticShadows||scenerySignature!==this.staticShadowSignature;
    this.staticShadowSignature=scenerySignature;
    const staticCaster=(batch:Batch)=>batch.mesh.material==='oak-bark'||batch.mesh.material==='birch-bark'||batch.mesh.material==='rock'||batch.mesh.material.startsWith('wall-')||['torch-wood','torch-head','linen','iron','brick','ember'].includes(batch.mesh.material);
    if(staticChanged||this.gpuProfiler?.sampling) {
      const pass=encoder.beginRenderPass({label:'Static sun casters',timestampWrites:this.gpuProfiler?.pass(0),colorAttachments:[],depthStencilAttachment:{view:this.staticShadowTexture.createView(),depthClearValue:1,depthLoadOp:staticChanged?'clear':'load',depthStoreOp:'store'}});
      if(staticChanged) {
        pass.setPipeline(this.shadowPipeline);pass.setBindGroup(0,this.frameOnly);
        for(const chunk of shadowChunks)draw(pass,chunk.mesh,chunk.instance);
        pass.setPipeline(this.sceneryShadowPipeline);
        for(const batch of this.casterBatches)if(staticCaster(batch))draw(pass,batch.mesh,batch.buffer,batch.count,'shadow');
      }
      pass.end();
    }
    encoder.copyTextureToTexture({texture:this.staticShadowTexture},{texture:this.shadowTexture},[this.shadowSize,this.shadowSize]);
    const shadow = encoder.beginRenderPass({ label: 'Moving sun casters', timestampWrites:this.gpuProfiler?.pass(1),colorAttachments: [], depthStencilAttachment: { view: this.shadowTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } });
    shadow.setPipeline(this.shadowPipeline); shadow.setBindGroup(0, this.frameOnly);
    shadow.setPipeline(this.sceneryShadowPipeline);
    for (const batch of this.casterBatches)if(!staticCaster(batch))draw(shadow, batch.mesh, batch.buffer, batch.count,'shadow');
    shadow.end();
    let opaque = encoder.beginRenderPass({ label: 'Terrain, vegetation and sky', timestampWrites:this.gpuProfiler?.pass(2),colorAttachments: [{ view: this.opaque.createView(), clearValue: { r: .5, g: .7, b: .8, a: 1 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    opaque.setPipeline(this.scenePipeline); opaque.setBindGroup(0, this.frameGroup);
    for (const chunk of visible) draw(opaque, chunk.mesh, chunk.instance);
    // Only profiling splits the pass, to identify terrain vs vegetation cost.
    if(this.gpuProfiler?.sampling) {
      opaque.end();opaque=encoder.beginRenderPass({label:'Profile scenery and sky',timestampWrites:this.gpuProfiler?.pass(3),colorAttachments:[{view:this.opaque.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
      opaque.setBindGroup(0,this.frameGroup);
    }
    if(this.depthPrepass){
      opaque.setPipeline(this.sceneryDepthPipeline);
      for(const batch of this.visibleBatches)if(batch.mesh.material!=='torch-flame'&&!batch.mesh.material.endsWith('lod3'))draw(opaque,batch.mesh,batch.buffer,batch.count,'depth');
    }
    opaque.setPipeline(this.depthPrepass?this.sceneryEqualPipeline:this.sceneryPipeline);
    for(const batch of this.visibleBatches)if(batch.mesh.material!=='torch-flame'&&!batch.mesh.material.endsWith('lod3'))draw(opaque,batch.mesh,batch.buffer,batch.count,this.depthPrepass?'equal':'shade');
    opaque.setPipeline(this.sceneryPipeline);for(const batch of this.visibleBatches)if(batch.mesh.material==='torch-flame')draw(opaque,batch.mesh,batch.buffer,batch.count,this.depthPrepass?'equal':'shade');
    opaque.setPipeline(this.impostorPipeline);opaque.setBindGroup(0,this.frameGroup);
    opaque.setBindGroup(2,this.farGroup);
    for(const batch of this.farBatches.values())if(batch.count)draw(opaque,batch.mesh,batch.buffer,batch.count,this.depthPrepass?'equal':'shade');
    opaque.setPipeline(this.skyPipeline); opaque.setBindGroup(0, this.frameOnly); opaque.draw(3);
    opaque.end();
    encoder.copyTextureToTexture({ texture: this.opaque }, { texture: this.composite }, { width: this.size[0], height: this.size[1] });
    // Manual depth rejection avoids sampling a simultaneously attached depth texture.
    const water = encoder.beginRenderPass({ label: 'Ocean, lakes and rivers', timestampWrites:this.gpuProfiler?.pass(4),colorAttachments: [{ view: this.composite.createView(), loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment:{view:this.waterDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'} });
    water.setPipeline(this.waterPipeline); water.setBindGroup(0, this.frameOnly); water.setBindGroup(1, this.waterGroup);
    water.setVertexBuffer(0, this.waterMesh.vertex); water.setVertexBuffer(1,this.oceanInstance); water.setIndexBuffer(this.waterMesh.index, this.waterMesh.indexFormat); water.drawIndexed(this.waterMesh.count);
    for(const chunk of visible) if(chunk.water) {
      water.setVertexBuffer(0,chunk.water.vertex);water.setVertexBuffer(1,chunk.instance);water.setIndexBuffer(chunk.water.index,chunk.water.indexFormat);water.drawIndexed(chunk.water.count);
    }
    water.end();
    if(this.buildPreview) {
      const p=this.buildPreview,prop=p.prop,stem=`${prop.kind}-${prop.variant}`,parts=this.meshes.get(`${stem}-lod0`)!;
      const values=this.instance(prop,camera);values[8]=1;values[9]=0;values[10]=1;this.write(this.previewInstance,values);
      const brightness=p.valid?1-p.motion*.3:1;this.write(this.previewUniform,new Float32Array(p.valid?[.10*brightness,.62*brightness,1.7*brightness,1]:[1.8,.075,.045,1]));
      const pass=encoder.beginRenderPass({label:'Building ghost',colorAttachments:[{view:this.composite.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
      pass.setPipeline(this.previewPipeline);pass.setBindGroup(0,this.frameGroup);pass.setBindGroup(2,this.previewGroup);for(const mesh of parts)draw(pass,mesh,this.previewInstance);pass.end();
    }
    const post = encoder.beginRenderPass({ timestampWrites:this.gpuProfiler?.pass(5),colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
    post.setPipeline(this.postPipeline); post.setBindGroup(0, this.postGroup); post.draw(3); post.end();
    this.gpuProfiler?.resolveInto(encoder);this.device.queue.submit([encoder.finish()]);this.gpuProfiler?.submitted();
    this.profiler.endStage('encodeSubmit',stage);
  }
  dispose() {for(const label of this.labels.values())label.remove();this.labels.clear();
    this.disposed = true;
    this.gpuProfiler?.dispose();
    this.impostors?.dispose();
    this.collisionTiles.clear();
    for(const id of this.damaged.keys())this.removeDamagedMesh(id);this.treeGeometry.clear();
    this.chunks.forEach(c => this.destroyChunk(c)); this.chunks.clear();
    this.meshes.forEach(parts => parts.forEach(m => { m.vertex.destroy(); m.index.destroy(); }));
    if (this.waterMesh) { this.waterMesh.vertex.destroy(); this.waterMesh.index.destroy(); }
    this.oceanInstance?.destroy();
    this.previewInstance?.destroy();this.previewUniform?.destroy();
    this.viewBatchGroups.forEach(m=>m.forEach(b=>b.buffer.destroy()));this.shadowBatches.forEach(b=>b.buffer.destroy());this.farBatches.forEach(b=>b.buffer.destroy());this.farUniform?.destroy(); this.materialUniforms.forEach(b => b.destroy());
    this.textures.forEach(t => t.destroy()); this.targets.forEach(t => t.destroy());
    this.shadowTexture?.destroy();this.staticShadowTexture?.destroy(); this.uniform?.destroy();this.lightingUniform?.destroy();this.postUniform?.destroy(); this.context?.unconfigure(); this.device?.destroy();
  }
}
