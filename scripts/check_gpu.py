"""Compile actual WGSL and render pipelines on the PC GPU without a browser.

Optional developer tool: pip install wgpu; npx tsx scripts/export-shaders.ts.
Uses the wgpu-py API: https://wgpu-py.readthedocs.io/en/latest/
"""
import json
from pathlib import Path
import wgpu
import numpy as np
root=Path(__file__).resolve().parents[1]
adapter=wgpu.gpu.request_adapter_sync(power_preference='high-performance')
device=adapter.request_device_sync()
print(dict(adapter.info))
sources=json.loads((root/'artifacts/shaders.json').read_text())
vertex={'array_stride':64,'step_mode':'vertex','attributes':[
    {'shader_location':0,'offset':0,'format':'float32x3'}, {'shader_location':1,'offset':12,'format':'float32x3'},
    {'shader_location':2,'offset':24,'format':'float32x2'}, {'shader_location':3,'offset':32,'format':'float32x4'},
    {'shader_location':6,'offset':48,'format':'float32x4'}]}
instance={'array_stride':32,'step_mode':'instance','attributes':[
    {'shader_location':4,'offset':0,'format':'float32x4'}, {'shader_location':5,'offset':16,'format':'float32x4'}]}
compact={'array_stride':32,'step_mode':'vertex','attributes':[a for a in vertex['attributes'] if a['shader_location'] not in (3,6)]}
compact_instance={'array_stride':44,'step_mode':'instance','attributes':instance['attributes']+[{'shader_location':7,'offset':32,'format':'float32x3'}]}
for name,code in sources.items():
    module=device.create_shader_module(label=name,code=code)
    mesh_buffers=[compact,compact_instance] if name in ('sceneryShader','impostorShader','impostorBakeShader','buildPreviewShader') else [vertex,instance] if name in ('sceneShader','waterShader') else []
    pipeline=device.create_render_pipeline(label=name,layout='auto',
        vertex={'module':module,'entry_point':'vertexMain','buffers':mesh_buffers},
        fragment={'module':module,'entry_point':'fragmentMain','targets':[{'format':'rgba16float'}]*(2 if name=='impostorBakeShader' else 1)},
        primitive={'topology':'triangle-list'})
    if name in ('sceneShader','sceneryShader'):
        device.create_render_pipeline(label='shadow',layout='auto',vertex={'module':module,'entry_point':'shadowVertex','buffers':mesh_buffers},
            fragment={'module':module,'entry_point':'shadowFragment','targets':[]},depth_stencil={'format':'depth32float','depth_write_enabled':True,'depth_compare':'less'})
    print('Compiled',name)
coast=json.loads((root/'artifacts/coast-validation.json').read_text())
module=device.create_shader_module(code=coast['common']+'''
@group(0) @binding(1) var<storage,read> points:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> result:array<f32>;
@compute @workgroup_size(64) fn check(@builtin(global_invocation_id) id:vec3u) {
  if(id.x<arrayLength(&points)) {result[id.x]=oceanCoast(points[id.x]);}
}''')
pipeline=device.create_compute_pipeline(layout='auto',compute={'module':module,'entry_point':'check'})
frame=np.zeros(64,dtype=np.float32);frame[61]=coast['size'];frame.view(np.uint32)[63]=coast['seed']
buffers=[device.create_buffer_with_data(data=frame,usage=wgpu.BufferUsage.UNIFORM),
    device.create_buffer_with_data(data=np.array(coast['points'],dtype=np.float32),usage=wgpu.BufferUsage.STORAGE),
    device.create_buffer(size=len(coast['points'])*4,usage=wgpu.BufferUsage.STORAGE|wgpu.BufferUsage.COPY_SRC)]
group=device.create_bind_group(layout=pipeline.get_bind_group_layout(0),entries=[{'binding':i,'resource':{'buffer':b}} for i,b in enumerate(buffers)])
encoder=device.create_command_encoder();compute=encoder.begin_compute_pass();compute.set_pipeline(pipeline);compute.set_bind_group(0,group);compute.dispatch_workgroups(1);compute.end();device.queue.submit([encoder.finish()])
actual=np.frombuffer(device.queue.read_buffer(buffers[2]),dtype=np.float32)
error=np.max(np.abs(actual-np.array(coast['expected'])));assert error<.03,error
print('CPU/GPU coastline maximum difference:',round(float(error),5),'meters')
device.destroy()
