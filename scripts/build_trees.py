"""Reproducible Blender tree sources and static geometry-only GLB exports.

Models use named shared materials; images remain in the central texture catalog.
Run npm run assets:trees. BLENDER_PATH overrides the locally installed executable.
"""
import math
import json
import os
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def launch():
    blender = os.environ.get('BLENDER_PATH', r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe')
    subprocess.run([blender, '--background', '--python', str(Path(__file__).resolve())], check=True)

def build():
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    out = ROOT / 'public' / 'models'
    sources = ROOT / 'assets' / 'sources'
    out.mkdir(parents=True, exist_ok=True)
    sources.mkdir(parents=True, exist_ok=True)
    materials = {}
    for species in ('oak', 'birch'):
        for part in ('bark', 'foliage'):
            name = f'{species}-{part}'
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
            principled = mat.node_tree.nodes.get('Principled BSDF')
            principled.inputs['Base Color'].default_value = ((0.30, 0.24, 0.16, 1) if species == 'oak' else (0.75, 0.72, 0.65, 1)) if part == 'bark' else (0.18, 0.32, 0.07, 1)
            principled.inputs['Roughness'].default_value = 0.88
            if part == 'foliage':
                image_path = ROOT / 'public' / 'textures' / f'{species}-foliage.png'
                if image_path.exists():
                    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
                    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
                    mat.node_tree.links.new(tex.outputs['Color'], principled.inputs['Base Color'])
                    mat.node_tree.links.new(tex.outputs['Alpha'], principled.inputs['Alpha'])
                mat.surface_render_method = 'DITHERED'
                mat.use_backface_culling = False
            else:
                image_path = ROOT / 'public' / 'textures' / 'bark-albedo.png'
                if image_path.exists():
                    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
                    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
                    uv = mat.node_tree.nodes.new('ShaderNodeTexCoord')
                    mapping = mat.node_tree.nodes.new('ShaderNodeMapping')
                    mapping.inputs['Scale'].default_value = (0.5, 1, 1)
                    mapping.inputs['Location'].default_value = ((0.5 if species == 'birch' else 0), 0, 0)
                    mat.node_tree.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
                    mat.node_tree.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
                    mat.node_tree.links.new(tex.outputs['Color'], principled.inputs['Base Color'])
            materials[name] = mat

    def make_tree(species, variant, lod):
        rng = random.Random(4401 + variant * 431 + (101 if species == 'birch' else 0))
        height = ([14, 19, 23, 27, 18, 11] if species == 'oak' else [17, 21, 25, 29, 20, 13])[variant]
        trunk_radius = ([.42, .58, .70, .78, .55, .25] if species == 'oak' else [.19, .25, .29, .32, .22, .13])[variant]
        bark_verts, bark_faces, bark_uv = [], [], []
        leaf_verts, leaf_faces, leaf_uv = [], [], []
        sides = [9, 6, 5][lod]
        solid_tubes = []
        def tube(points, start_radius, end_radius):
            if max(start_radius, end_radius) > 0:
                for k in range(len(points)-1):
                    f0, f1 = k/(len(points)-1), (k+1)/(len(points)-1)
                    cv = lambda p: [p.x, p.z, -p.y]
                    solid_tubes.append(dict(type="capsule", a=cv(points[k]), b=cv(points[k+1]), r0=start_radius*(1-f0)+end_radius*f0, r1=start_radius*(1-f1)+end_radius*f1, material=f"{species}-bark"))
            start = len(bark_verts)
            length = 0
            for i, point in enumerate(points):
                direction = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
                tangent = direction.cross(Vector((0, 1, 0)))
                if tangent.length < 0.1: tangent = direction.cross(Vector((1, 0, 0)))
                tangent.normalize()
                bitangent = direction.cross(tangent).normalized()
                radius = start_radius * (1 - i / (len(points) - 1)) + end_radius * (i / (len(points) - 1))
                if i: length += (points[i] - points[i - 1]).length
                for j in range(sides + 1):
                    angle = j / sides * math.tau
                    rough = 1 + math.sin(j * 2.1 + i * 0.7) * 0.07
                    p = point + (tangent * math.cos(angle) + bitangent * math.sin(angle)) * radius * rough
                    bark_verts.append(tuple(p))
                    bark_uv.append((j / sides, length / 2.5))
            for i in range(len(points) - 1):
                for j in range(sides):
                    a = start + i * (sides + 1) + j
                    bark_faces.append((a, a + 1, a + sides + 2, a + sides + 1))

        lean_x, lean_y = rng.uniform(-1.3, 1.3), rng.uniform(-1.4, 1.4)
        trunk = [Vector((lean_x * t ** 1.5 + math.sin(t * 8) * 0.08, lean_y * t ** 1.5, height * t)) for t in [0, .025, .12, .26, .42, .58, .73, .86, 1]]
        tube(trunk, trunk_radius * 1.55, 0.025)
        # Root flares anchor the trunk rather than terminating it as a cylinder.
        # Consume the same random sequence at every LOD. Reduced detail must
        # simplify this tree, rather than generate a different branch layout.
        for i in range(5):
            a = i * math.tau / 5 + rng.random() * .3
            root = [Vector((math.cos(a) * trunk_radius * 2.6, math.sin(a) * trunk_radius * 2.6, -.10)), Vector((math.cos(a) * trunk_radius * .65, math.sin(a) * trunk_radius * .65, .13)), Vector((0, 0, trunk_radius * 1.7))]
            if lod < 2 or i < 3: tube(root, trunk_radius * .18, trunk_radius * .4)

        leaf_centers = []
        leaf_active = []
        main_count = 18 if species == 'oak' else 22
        for i in range(main_count):
            fraction = .34 + i / main_count * .58
            if species == 'birch': fraction = .30 + i / main_count * .65
            start = Vector((lean_x * fraction, lean_y * fraction, height * fraction))
            a = i * 2.399963 + rng.uniform(-.35, .35)
            crown = height * (.31 if species == 'oak' else .19) * (1 - (fraction - .55) ** 2 * 2)
            reach = crown * rng.uniform(.72, 1.18)
            direction = Vector((math.cos(a), math.sin(a), rng.uniform(.32, .75)))
            endpoint = start + direction * reach
            points = [start, start + direction * reach * .28 + Vector((0, 0, -.16)), start + direction * reach * .65, endpoint]
            tube(points, trunk_radius * (1 - fraction) * .68, .018)
            for j in range(4):
                f = .40 + j * .16
                anchor = start.lerp(endpoint, f)
                aa = a + rng.choice((-1, 1)) * rng.uniform(.40, 1.25)
                tip = anchor + Vector((math.cos(aa), math.sin(aa), rng.uniform(.45, 1.1))) * rng.uniform(.65, 1.35) * height / 14
                if lod < 2 or j % 2 == 0:
                    tube([anchor, anchor.lerp(tip, .5) + Vector((0, 0, .1)), tip], .045 * (1 - fraction) + .012, .008)
                leaf_centers.extend([tip, anchor.lerp(tip, .70)])
                leaf_active.extend([lod < 2 or j % 2 == 0] * 2)
            leaf_centers.extend([endpoint, endpoint - direction * .5])
            leaf_active.extend([True, True])
        leaf_centers.extend([trunk[-1], trunk[-2]])
        leaf_active.extend([True, True])
        for center, active in zip(leaf_centers, leaf_active):
            count = [5, 3, 2][lod]
            for j in range(5):
                position = center + Vector((rng.gauss(0, .44), rng.gauss(0, .44), rng.gauss(0, .36)))
                card_size = rng.uniform(1.15, 1.9) * ([1, 1.25, 1.7][lod]) * (1 if species == 'oak' else .87) * (height / 17) ** .45
                normal = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(.15, 1))).normalized()
                tangent = normal.cross(Vector((0, 0, 1)))
                if tangent.length < .1: tangent = normal.cross(Vector((1, 0, 0)))
                tangent.normalize()
                bitangent = normal.cross(tangent).normalized()
                angle = rng.uniform(0, math.tau)
                u = tangent * math.cos(angle) + bitangent * math.sin(angle)
                v = -tangent * math.sin(angle) + bitangent * math.cos(angle)
                if j >= count or not active: continue
                index = len(leaf_verts)
                for dx, dy, uv in [(-1, -1, (0, 0)), (1, -1, (1, 0)), (1, 1, (1, 1)), (-1, 1, (0, 1))]:
                    leaf_verts.append(tuple(position + (u * dx + v * dy) * card_size * .5))
                    leaf_uv.append(uv)
                leaf_faces.append((index, index + 1, index + 2, index + 3))

        if lod == 0:
            major=[]
            for cap in solid_tubes:
                if cap["r0"] < .06: continue
                if cap["r1"] < .06:
                    t=(cap["r0"]-.06)/(cap["r0"]-cap["r1"])
                    cap={**cap,"b":[a+(b-a)*t for a,b in zip(cap["a"],cap["b"])],"r1":.06}
                major.append(cap)
            (out / f"{species}-{variant}-solid.json").write_text(json.dumps(dict(version=1, primitives=major, visualPrimitives=solid_tubes, foliageAnchors=[[p.x,p.z,-p.y] for p in leaf_centers])))
        objects = []
        for part, verts, faces, uvs in [('bark', bark_verts, bark_faces, bark_uv), ('foliage', leaf_verts, leaf_faces, leaf_uv)]:
            name = f'{species}-{variant}-lod{lod}-{part}'
            mesh = bpy.data.meshes.new(name)
            mesh.from_pydata(verts, [], faces)
            mesh.update()
            uv_layer = mesh.uv_layers.new(name='UVMap')
            for polygon in mesh.polygons:
                polygon.use_smooth = part == 'bark'
                for loop_index in polygon.loop_indices:
                    uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(materials[f'{species}-{part}'])
            objects.append(obj)
        return objects

    for species in ('oak', 'birch'):
        for variant in range(6):
            for lod in range(3):
                objects = make_tree(species, variant, lod)
                bpy.ops.object.select_all(action='DESELECT')
                for obj in objects: obj.select_set(True)
                bpy.context.view_layer.objects.active = objects[0]
                bpy.ops.export_scene.gltf(filepath=str(out / f'{species}-{variant}-lod{lod}.glb'), export_format='GLB', use_selection=True,
                    export_image_format='NONE', export_materials='EXPORT', export_texcoords=True, export_normals=True,
                    export_animations=False, export_yup=True)
                for obj in objects:
                    obj.hide_render = lod != 0
                    obj.hide_set(lod != 0)
                    obj.location.x = variant * 22 + (150 if species == 'birch' else 0)
    # Sources have laid-out high-detail trees and hidden LODs for easy inspection.
    bpy.context.scene.world.color = (.25, .25, .25)
    for image in bpy.data.images:
        if image.filepath: image.filepath = bpy.path.relpath(image.filepath, start=str(sources))
    bpy.ops.wm.save_as_mainfile(filepath=str(sources / 'temperate-trees.blend'))
    print('Exported 12 trees x 3 LODs and editable Blender sources.')

if __name__ == '__main__':
    try:
        import bpy
    except ImportError:
        launch()
    else:
        build()
