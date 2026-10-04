"""Three curved coconut palms with actual fruit clusters and three LODs."""
import math
import os
import random
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def build():
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    materials={}
    for name in ('palm-bark','coconut','palm-foliage','palm-dry-foliage'):
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        node=mat.node_tree.nodes.get('Principled BSDF');node.inputs['Roughness'].default_value=.9
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
        foliage='foliage' in name
        tex.image=bpy.data.images.load(str(ROOT/'public/textures'/('palm-foliage.png' if foliage else 'palm-albedo.png')),check_existing=True)
        mat.node_tree.links.new(tex.outputs['Color'],node.inputs['Base Color'])
        if foliage:
            mat.node_tree.links.new(tex.outputs['Alpha'],node.inputs['Alpha']);mat.surface_render_method='DITHERED'
            if name=='palm-dry-foliage':
                mix=mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(.8,.58,.3,1)
                mat.node_tree.links.new(tex.outputs['Color'],mix.inputs[1]);mat.node_tree.links.new(mix.outputs[0],node.inputs['Base Color'])
        else:
            coord=mat.node_tree.nodes.new('ShaderNodeTexCoord');mapping=mat.node_tree.nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value=(.5,1,1);mapping.inputs['Location'].default_value=((.5 if name=='coconut' else 0),0,0)
            mat.node_tree.links.new(coord.outputs['UV'],mapping.inputs['Vector']);mat.node_tree.links.new(mapping.outputs['Vector'],tex.inputs['Vector'])
        materials[name]=mat
    def object_mesh(name,verts,faces,uv,material):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();layer=mesh.uv_layers.new(name='UVMap')
        for polygon in mesh.polygons:
            polygon.use_smooth=True
            for loop in polygon.loop_indices:layer.data[loop].uv=uv[mesh.loops[loop].vertex_index]
        obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(materials[material]);return obj
    for variant in range(3):
        for lod in range(3):
            rng=random.Random(9027+variant*47);height=[12,17,14][variant];lean=[2.1,3.5,-2.5][variant]
            objects=[];verts=[];faces=[];uv=[];sides=[10,7,5][lod];rings=12
            def trunk(t):return Vector((lean*t*t,.4*math.sin(t*2.2)*variant,height*t))
            for i in range(rings+1):
                t=i/rings;p=trunk(t);direction=(trunk(min(1,t+.01))-trunk(max(0,t-.01))).normalized()
                u=direction.cross(Vector((0,1,0))).normalized();v=direction.cross(u)
                radius=(.30*(1-t)+.15*t)*(1+.2*math.exp(-t*24))
                for j in range(sides+1):
                    a=j/sides*math.tau;verts.append(tuple(p+(u*math.cos(a)+v*math.sin(a))*radius));uv.append((j/sides,t*height/2))
            for i in range(rings):
                for j in range(sides):a=i*(sides+1)+j;faces.append((a,a+1,a+sides+2,a+sides+1))
            objects.append(object_mesh(f'palm-{variant}-lod{lod}-trunk',verts,faces,uv,'palm-bark'))
            crown=trunk(1)
            for dry in (False,True):
                verts=[];faces=[];uv=[]
                count=([14,10,7][lod] if not dry else [3,2,1][lod]);steps=[8,5,3][lod]
                for i in range(count):
                    angle=i*2.399963+(1.1 if dry else 0)+rng.uniform(-.15,.15)
                    direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
                    length=rng.uniform(3.8,5.4)*(height/14)**.3;rise=rng.uniform(.6,2.2) if not dry else -.9
                    start=len(verts)
                    for a in range(steps+1):
                        for b in range(steps+1):
                            u=a/steps;v=b/steps;t=(u+v)*.5;lateral=(u-v)*1.3
                            p=crown+direction*(t*length)+side*lateral+Vector((0,0,math.sin(t*math.pi)*rise-t*t*(1.6 if not dry else 3.8)))
                            verts.append(tuple(p));uv.append((u,v))
                    for a in range(steps):
                        for b in range(steps):j=start+a*(steps+1)+b;faces.append((j,j+1,j+steps+2,j+steps+1))
                objects.append(object_mesh(f'palm-{variant}-lod{lod}-'+('dry' if dry else 'fronds'),verts,faces,uv,'palm-dry-foliage' if dry else 'palm-foliage'))
            for i in range([9,7,4][lod]):
                angle=i*2.399963
                location=crown+Vector((math.cos(angle)*.40,math.sin(angle)*.40,-.38-(i%3)*.19))
                bpy.ops.mesh.primitive_uv_sphere_add(segments=[10,8,6][lod],ring_count=[7,5,4][lod],radius=1,location=location)
                fruit=bpy.context.object;fruit.name=f'palm-{variant}-lod{lod}-coconut-{i}';fruit.scale=(.22,.24,.30);fruit.data.materials.append(materials['coconut'])
                for p in fruit.data.polygons:p.use_smooth=True
                objects.append(fruit)
            bpy.ops.object.select_all(action='DESELECT')
            # One fruit mesh per palm allows a coconut cluster to share an instance batch.
            for fruit in objects[3:]: fruit.select_set(True)
            bpy.context.view_layer.objects.active=objects[3]
            bpy.ops.object.join()
            objects=objects[:3]+[bpy.context.object]
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:obj.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/palm-{variant}-lod{lod}.glb'),export_format='GLB',use_selection=True,
                export_image_format='NONE',export_materials='EXPORT',export_animations=False,export_yup=True)
            for obj in objects:obj.location.x+=variant*18;obj.hide_render=lod!=0;obj.hide_set(lod!=0)
    for image in bpy.data.images:
        if image.filepath:image.filepath=bpy.path.relpath(image.filepath,start=str(ROOT/'assets/sources'))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/sources/coastal-palms.blend'))
    print('Exported three coconut palms with three LODs each.')
if __name__=='__main__':
    try:import bpy
    except ImportError:subprocess.run([os.environ.get('BLENDER_PATH',r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'),'--background','--python',str(Path(__file__).resolve())],check=True)
    else:build()
