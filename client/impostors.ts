import {mat4} from 'gl-matrix';
import {VERTEX_FLOATS} from '../shared/mesh';
import type {GeometryData} from './geometry';
import {common,lightingFunctions,octahedral} from './shaders';
import {lodShader,TREE_LOD} from './lod';

export interface ModelBounds {radius:number;bottom:number;top:number}
export function modelBounds(parts:GeometryData[]):ModelBounds {
  let radius=0,bottom=Infinity,top=-Infinity;
  for(const part of parts)for(let i=0;i<part.vertices.length;i+=VERTEX_FLOATS) {
    radius=Math.max(radius,Math.hypot(part.vertices[i],part.vertices[i+2]));
    bottom=Math.min(bottom,part.vertices[i+1]);top=Math.max(top,part.vertices[i+1]);
  }
  return {radius:radius*1.06,bottom:bottom-.25,top:top+.25};
}
export function impostorMesh(bounds:ModelBounds,material:string):GeometryData {
  const vertices:number[]=[];
  for(const [x,y,u,v]of [[-bounds.radius,bounds.bottom,0,1],[bounds.radius,bounds.bottom,1,1],[-bounds.radius,bounds.top,0,0],[bounds.radius,bounds.top,1,0]])
    vertices.push(x,y,0,0,0,1,u,v,0,0,0,0,0,0,0,0);
  return {vertices:new Float32Array(vertices),indices:new Uint32Array([0,1,2,1,3,2]),material};
}
export const impostorShader=/*wgsl*/`
${common}
${lodShader}
${octahedral}
@group(0) @binding(1) var shadowMap:texture_depth_2d;
@group(0) @binding(2) var shadowSampler:sampler_comparison;
${lightingFunctions}
@group(1) @binding(0) var atlas:texture_2d_array<f32>;
@group(1) @binding(1) var atlasSampler:sampler;
@group(1) @binding(2) var surfaces:texture_2d_array<f32>;
struct Material {tile:vec4f,flags:vec4f,tint:vec4f};
@group(1) @binding(3) var<uniform> material:Material;
@group(2) @binding(0) var<uniform> originRange:vec4f;
struct Vertex {@location(0) position:vec3f,@location(2) uv:vec2f,@location(4) instance:vec4f,@location(5) rotation:vec4f,@location(7) fade:vec3f};
struct Out {@builtin(position) clip:vec4f,@location(0) uv:vec2f,@location(1) position:vec3f,@location(2) @interpolate(flat) angle:f32,@location(3) @interpolate(flat) fade:vec3f,@location(4) @interpolate(flat) rotation:vec4f};
@vertex fn vertexMain(v:Vertex)->Out {
  let anchor=v.instance.xyz+originRange.xyz;
  let distance=length(anchor.xz);
  let toward=normalize(-anchor.xz);
  let right=vec3f(toward.y,0.0,-toward.x);
  let p=anchor+(right*v.position.x+vec3f(0.0,v.position.y,0.0))*v.instance.w;
  var o:Out;o.clip=frame.vp*vec4f(p,1.0);o.position=p;o.uv=v.uv;o.rotation=v.rotation;
  let transition=smoothstep(${TREE_LOD[2].distance-TREE_LOD[2].width/2}.0,${TREE_LOD[2].distance+TREE_LOD[2].width/2}.0,distance);
  let coverage=1.0-smoothstep(originRange.w*.65,originRange.w,distance);
  o.fade=vec3f(transition,0.0,coverage);
  if(distance<${TREE_LOD[2].distance-TREE_LOD[2].width/2}.0 || distance>originRange.w){o.clip=vec4f(2.0,2.0,2.0,1.0);}
  let yaw=2.0*atan2(v.rotation.y,v.rotation.w);
  o.angle=fract((atan2(toward.x,toward.y)-yaw)/6.283185307)*8.0;
  return o;
}
@fragment fn fragmentMain(o:Out)->@location(0) vec4f {
  let dx=dpdx(o.uv);let dy=dpdy(o.uv);
  if(!lodVisible(o.clip.xy,o.fade)){discard;}
  let first=i32(floor(o.angle));let next=(first+1)%8;
  let a=textureSampleGrad(atlas,atlasSampler,o.uv,i32(material.tile.x)+first,dx,dy);
  let b=textureSampleGrad(atlas,atlasSampler,o.uv,i32(material.tile.x)+next,dx,dy);
  let color=mix(a,b,fract(o.angle));
  if(color.a<.32){discard;}
  let surface=mix(textureSampleGrad(surfaces,atlasSampler,o.uv,i32(material.tile.x)+first,dx,dy),textureSampleGrad(surfaces,atlasSampler,o.uv,i32(material.tile.x)+next,dx,dy),fract(o.angle))/max(color.a,.001);
  var n=octDecode(surface.xy);let q=o.rotation;n+=2.0*cross(q.xyz,cross(q.xyz,n)+q.w*n);
  var visibility=1.0;if(dot(n,frame.sun.xyz)>0.0){visibility=shadow(o.position,n);}
  let light=pbr(color.rgb/max(color.a,.001),clamp(surface.z,.35,1.0),normalize(n),o.position,visibility,clamp(surface.w,0.0,1.0));
  return vec4f(fog(light,o.position),1.0);
}`;

interface BakePart {vertex:GPUBuffer;index:GPUBuffer;indexFormat:GPUIndexFormat;count:number;material:string}
export interface BakeModel {name:string;bounds:ModelBounds;parts:BakePart[]}
/** Bakes the actual shared-material models. Eight azimuths retain each variant's
 * silhouette, rather than introducing a generic tree sprite. Far LOD only. */
export class TreeImpostors {
  readonly texture:GPUTexture;
  readonly surfaceTexture:GPUTexture;
  readonly groups=new Map<string,GPUBindGroup>();
  private uniforms:GPUBuffer[]=[];
  private sampler:GPUSampler;
  private mipPipeline:GPURenderPipeline;
  private disposed=false;
  readonly resolution=128;
  constructor(private device:GPUDevice,readonly models:BakeModel[],materialLayout:GPUBindGroupLayout) {
    this.texture=device.createTexture({label:'Distant tree views',size:[128,128,models.length*8],format:'rgba16float',mipLevelCount:8,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.surfaceTexture=device.createTexture({label:'Distant tree normals and roughness',size:[128,128,models.length*8],format:'rgba16float',mipLevelCount:8,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'});
    models.forEach((model,i)=>{
      const buffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});
      new Float32Array(buffer.getMappedRange()).set([i*8,0,0,0,5,1,0,.32,1,1,1,1]);buffer.unmap();this.uniforms.push(buffer);
      const view=this.texture.createView({dimension:'2d-array'});
      this.groups.set(model.name,device.createBindGroup({layout:materialLayout,entries:[{binding:0,resource:view},{binding:1,resource:this.sampler},{binding:2,resource:this.surfaceTexture.createView({dimension:'2d-array'})},{binding:3,resource:{buffer}},{binding:4,resource:view},{binding:5,resource:view}]}));
    });
    const module=device.createShaderModule({code:`
      @group(0) @binding(0) var img:texture_2d<f32>;@group(0) @binding(1) var s:sampler;
      struct O {@builtin(position) p:vec4f,@location(0) uv:vec2f};
      @vertex fn vs(@builtin(vertex_index) i:u32)->O{let a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:O;o.p=vec4f(a[i],0,1);o.uv=vec2f(a[i].x*.5+.5,.5-a[i].y*.5);return o;}
      @fragment fn fs(o:O)->@location(0) vec4f{return textureSample(img,s,o.uv);}`});
    this.mipPipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]}});
  }
  async bake(elevation:number,pipeline:GPURenderPipeline,frameLayout:GPUBindGroupLayout,shadow:GPUTexture,materials:Map<string,GPUBindGroup>) {
    if(this.disposed)return;
    const encoder=this.device.createCommandEncoder({label:'Bake distant trees'}),buffers:GPUBuffer[]=[];
    const depth=this.device.createTexture({size:[128,128],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const angle=elevation*Math.PI/180,sun=[.55*Math.cos(angle),Math.sin(angle),-.835*Math.cos(angle)],len=Math.hypot(...sun);
    for(let i=0;i<this.models.length;i++)for(let view=0;view<8;view++) {
      const model=this.models[i],b=model.bounds,center=(b.top+b.bottom)/2,a=view*Math.PI/4;
      const eye:[number,number,number]=[Math.sin(a)*60,center,Math.cos(a)*60];
      const vp=mat4.multiply(mat4.create(),mat4.orthoZO(mat4.create(),-b.radius,b.radius,-(b.top-b.bottom)/2,(b.top-b.bottom)/2,.1,200),mat4.lookAt(mat4.create(),[0,0,0],[-eye[0],center-eye[1],-eye[2]],[0,1,0]));
      const instance=this.device.createBuffer({size:44,usage:GPUBufferUsage.VERTEX,mappedAtCreation:true});new Float32Array(instance.getMappedRange()).set([-eye[0],-eye[1],-eye[2],1,0,0,0,1,1,0,1]);instance.unmap();buffers.push(instance);
      const values=new Float32Array(64);values.set(vp);values.set(mat4.invert(mat4.create(),vp)!,16);values.set(mat4.create(),32);values.set([...eye,0],48);values.set([...sun.map(v=>v/len),1],52);values.set([0,0,1,0],60);
      const uniform=this.device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Float32Array(uniform.getMappedRange()).set(values);uniform.unmap();buffers.push(uniform);
      const frame=this.device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:shadow.createView()},{binding:2,resource:this.device.createSampler({compare:'less-equal'})}]});
      const pass=encoder.beginRenderPass({colorAttachments:[this.texture,this.surfaceTexture].map(texture=>({view:texture.createView({dimension:'2d',baseArrayLayer:i*8+view,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1}),clearValue:[0,0,0,0],loadOp:'clear' as const,storeOp:'store' as const})),depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
      pass.setPipeline(pipeline);pass.setBindGroup(0,frame);pass.setVertexBuffer(1,instance);
      for(const part of model.parts) {pass.setBindGroup(1,materials.get(part.material)!);pass.setVertexBuffer(0,part.vertex);pass.setIndexBuffer(part.index,part.indexFormat);pass.drawIndexed(part.count);}
      pass.end();
    }
    for(const texture of [this.texture,this.surfaceTexture])for(let layer=0;layer<this.models.length*8;layer++)for(let mip=1;mip<8;mip++) {
      const group=this.device.createBindGroup({layout:this.mipPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:mip-1,mipLevelCount:1})},{binding:1,resource:this.sampler}]});
      const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:mip,mipLevelCount:1}),loadOp:'clear',storeOp:'store'}]});pass.setPipeline(this.mipPipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
    }
    this.device.queue.submit([encoder.finish()]);await this.device.queue.onSubmittedWorkDone();buffers.forEach(b=>b.destroy());depth.destroy();
  }
  dispose() {this.disposed=true;this.texture.destroy();this.surfaceTexture.destroy();this.uniforms.forEach(b=>b.destroy());}
}
