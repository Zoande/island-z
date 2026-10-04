"""Build four hazel/bramble shrubs with two LODs and shared named materials."""
import math
import os
import random
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def build():
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    mats = {}
    for name in ('oak-bark', 'bush-foliage'):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        node = mat.node_tree.nodes.get('Principled BSDF')
        node.inputs['Roughness'].default_value = .9
        node.inputs['Base Color'].default_value = (.24, .18, .1, 1)
        if name == 'bush-foliage':
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(str(ROOT / 'public/textures/bush-foliage.png'))
            mat.node_tree.links.new(tex.outputs['Color'], node.inputs['Base Color'])
            mat.node_tree.links.new(tex.outputs['Alpha'], node.inputs['Alpha'])
            mat.surface_render_method = 'DITHERED'
        mats[name] = mat
    for variant in range(4):
        for lod in range(2):
            rng = random.Random(15091 + variant * 37)
            height = [1.2, 1.8, 2.4, 3.1][variant]
            verts, faces, uv = [], [], []
            leaves, leaf_faces, leaf_uv = [], [], []
            def branch(a, b, radius):
                d = (b - a).normalized()
                u = d.cross(Vector((0, 1, 0))).normalized()
                v = d.cross(u).normalized()
                start = len(verts)
                for k, p in enumerate((a, b)):
                    for j in range(6):
                        angle = j / 5 * math.tau
                        verts.append(tuple(p + (u * math.cos(angle) + v * math.sin(angle)) * radius * (1 if k == 0 else .25)))
                        uv.append((j / 5, k * (b - a).length))
                for j in range(5): faces.append((start+j, start+j+1, start+j+7, start+j+6))
            def spray(p, scale):
                for _ in range(4 if lod == 0 else 2):
                    normal = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(.2, 1))).normalized()
                    u = normal.cross(Vector((0, 0, 1))).normalized()
                    v = normal.cross(u)
                    center = p + Vector((rng.uniform(-.15, .15), rng.uniform(-.15, .15), rng.uniform(-.1, .1)))
                    index = len(leaves)
                    for x, y, tex in ((-1,-1,(0,0)),(1,-1,(1,0)),(1,1,(1,1)),(-1,1,(0,1))):
                        leaves.append(tuple(center + (u*x+v*y)*scale*.5))
                        leaf_uv.append(tex)
                    leaf_faces.append(tuple(index+i for i in range(4)))
            for i in range(9 if lod == 0 else 6):
                angle = i * 2.399963 + rng.uniform(-.2,.2)
                base = Vector((rng.uniform(-.18,.18),rng.uniform(-.18,.18),-.08))
                reach = height * rng.uniform(.35,.55)
                end = Vector((math.cos(angle)*reach, math.sin(angle)*reach, height*rng.uniform(.70,1)))
                middle = base.lerp(end,.45)
                branch(base,middle,.035 * height)
                branch(middle,end,.025 * height)
                for j in range(6 if lod == 0 else 4):
                    anchor = base.lerp(end,.35+j*.11)
                    aa = angle + (1 if j%2 else -1)*rng.uniform(.4,1.4)
                    tip = anchor + Vector((math.cos(aa),math.sin(aa),rng.uniform(.2,.8))) * height*.25
                    branch(anchor,tip,.008*height)
                    spray(tip, rng.uniform(.45,.7) * (height/1.8)**.5 * (1 if lod==0 else 1.3))
                spray(end,.65 * (height/1.8)**.5)
            objects = []
            for name, points, polygons, coords in (('oak-bark',verts,faces,uv),('bush-foliage',leaves,leaf_faces,leaf_uv)):
                mesh = bpy.data.meshes.new(f'bush-{variant}-lod{lod}-{name}')
                mesh.from_pydata(points,[],polygons)
                mesh.update()
                layer = mesh.uv_layers.new(name='UVMap')
                for polygon in mesh.polygons:
                    polygon.use_smooth = name == 'oak-bark'
                    for loop in polygon.loop_indices: layer.data[loop].uv = coords[mesh.loops[loop].vertex_index]
                obj = bpy.data.objects.new(mesh.name,mesh)
                bpy.context.collection.objects.link(obj)
                mesh.materials.append(mats[name])
                objects.append(obj)
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects: obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/bush-{variant}-lod{lod}.glb'),export_format='GLB',use_selection=True,
                export_image_format='NONE',export_materials='EXPORT',export_animations=False,export_yup=True)
            for obj in objects:
                obj.location.x = variant*5
                obj.hide_render = lod != 0
                obj.hide_set(lod != 0)
    for image in bpy.data.images:
        if image.filepath:image.filepath=bpy.path.relpath(image.filepath,start=str(ROOT/'assets/sources'))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/sources/temperate-bushes.blend'))
    print('Exported four shrubs with two LODs each.')

if __name__ == '__main__':
    try: import bpy
    except ImportError:
        subprocess.run([os.environ.get('BLENDER_PATH',r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe'),'--background','--python',str(Path(__file__).resolve())],check=True)
    else: build()
