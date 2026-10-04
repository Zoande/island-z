"""Editable Blender catalogue; named shared materials, static untextured GLBs.
Run with Python, or inside Blender using --background --python this_file.
Game coordinates are x/right, y/up, z/front; helpers convert to Blender Z-up.
"""
import math
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def build():
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    mats={}
    for name,texture in [('wall-wood','wall-wood-albedo.png'),('oak-bark','bark-albedo.png'),('wall-stone','terrain-albedo.png'),('linen','linen-albedo.png'),('iron',None),('ember',None)]:
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.8
        bsdf.inputs['Base Color'].default_value=(.08,.07,.06,1) if name=='iron' else (.38,.09,.015,1) if name=='ember' else (.5,.4,.28,1)
        if texture:
            tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'public/textures'/texture));mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
        mats[name]=mat
    models=[];active=[]
    def finish(obj,name,material):
        obj.name=name;obj.data.materials.append(mats[material]);active.append(obj)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        # Box projection in real metres, compatible across all models.
        uv=obj.data.uv_layers.new(name='UVMap') if not obj.data.uv_layers else obj.data.uv_layers.active
        for face in obj.data.polygons:
            n=face.normal;axis=max(range(3),key=lambda i:abs(n[i]));axes=[i for i in range(3) if i!=axis]
            for loop in face.loop_indices:
                p=obj.data.vertices[obj.data.loops[loop].vertex_index].co;uv.data[loop].uv=(p[axes[0]]*2,p[axes[1]]*2)
        return obj
    def box(name,center,size,mat='wall-wood',bevel=.015):
        bpy.ops.mesh.primitive_cube_add(size=1,location=(center[0],-center[2],center[1]));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);finish(o,name,mat)
        if bevel:
            m=o.modifiers.new('Soft worn edges','BEVEL');m.width=bevel;m.segments=2
            bpy.ops.object.modifier_apply(modifier=m.name)
        return o
    def beam(name,a,b,r,mat='oak-bark',sides=12):
        aa=Vector((a[0],-a[2],a[1]));bb=Vector((b[0],-b[2],b[1]));d=bb-aa
        bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=d.length,location=(aa+bb)/2);o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return finish(o,name,mat)
    def export(name):
        bpy.ops.object.select_all(action='DESELECT')
        for obj in active:obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models'/f'{name}-0-lod0.glb'),export_format='GLB',use_selection=True,export_image_format='NONE',export_materials='EXPORT',export_animations=False,export_yup=True)
        models.append((name,list(active)));active.clear()
    # Solid-log modules, including automatically cut opening versions.
    for aperture in ('','-door','-window'):
        # A thin timber infill closes the daylight gaps between round logs.
        regions=[(0,1.25,3,2.5)] if not aperture else [(-1.04,1.25,.92,2.5),(1.04,1.25,.92,2.5),(0,2.41,1.16,.18)] if aperture=='-door' else [(-1.075,1.25,.85,2.5),(1.075,1.25,.85,2.5),(0,.525,1.3,1.05),(0,2.3,1.3,.4)]
        for x,y,w,h in regions:box('Log infill',(x,y,0),(w,h,.12),bevel=0)
        for row in range(10):
            y=(row+.5)*.25
            intervals=[(-1.5,1.5)]
            if aperture=='-door' and y-.125<2.32:intervals=[(-1.5,-.58),(.58,1.5)]
            if aperture=='-window' and y+.125>1.05 and y-.125<2.1:intervals=[(-1.5,-.65),(.65,1.5)]
            for left,right in intervals:beam('Hewn stacked log',(left,y,0),(right,y,0),.125)
        export('wall-log'+aperture)
    # A framed cot: planks, legs, filled linen mattress and pillow.
    for x in (-.56,.56):
        for z in (-.90,.90):box('Bed leg',(x,.20,z),(.12,.40,.12))
        box('Bed rail',(x,.38,0),(.13,.18,2.02))
    for i in range(9):box('Bed slat',(0,.40,-.85+i*.21),(1.12,.075,.19))
    box('Linen mattress',(0,.58,0),(1.19,.28,1.98),'linen',.09)
    box('Linen pillow',(0,.76,-.68),(.75,.16,.43),'linen',.08)
    for x in (-.61,.61):box('Headboard post',(x,.68,-1),(.12,1.36,.13))
    for y in (.70,.95,1.22):box('Headboard',(0,y,-1),(1.24,.14,.11))
    export('bed')
    for i in range(4):box('Table plank',(0,.76,-.31875+i*.2125),(1.6,.12,.207))
    for x in (-.65,.65):
        for z in (-.30,.30):box('Table leg',(x,.36,z),(.13,.72,.13))
    for z in (-.3,.3):box('Table apron',(0,.62,z),(1.45,.17,.08))
    for x in (-.65,.65):box('Table apron',(x,.62,0),(.08,.17,.64))
    export('table')
    for x in (-.21,.21):
        for z in (-.21,.21):box('Chair leg',(x,.22,z),(.09,.44,.09))
        box('Back post',(x,.66,-.24),(.09,.54,.10))
    for i in range(3):box('Seat plank',(0,.43,-.18+i*.18),(.54,.07,.174))
    for y in (.63,.81,.91):box('Back rail',(0,y,-.24),(.56,.075,.10))
    export('chair')
    for variant in ('door-wood','door-reinforced'):
        for i in range(6):box('Door plank',(-.55+(i+.5)*1.10/6,1.14,0),(1.10/6-.003,2.28,.065),bevel=.005)
        for y in (.22,1.14,2.04):box('Door brace',(0,y,.037),(1.07,.10,.012), 'iron' if variant=='door-reinforced' else 'wall-wood',.002)
        for y in (.35,1.9):box('Forged hinge',(-.45,y,.045),(.20,.075,.015),'iron',.003)
        beam('Latch',(.43,.96,.055),(.43,1.13,.055),.018,'iron',8)
        export(variant)
    for x in (-.60,.60):box('Window jamb',(x,.525,0),(.10,1.05,.14))
    for y in (.05,1.):box('Window sill',(0,y,0),(1.3,.10,.14))
    box('Window mullion',(0,.525,0),(.045,.95,.07))
    export('window')
    for i in range(11):
        a=i/11*math.tau;x=math.cos(a)*.55;z=math.sin(a)*.55
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,-z,.11));o=bpy.context.object;o.scale=(.14,.12,.10);finish(o,'Angular hearth stone','wall-stone')
    for i in range(5):
        a=i/5*math.tau;beam('Charred log',(-math.cos(a)*.34,.12,-math.sin(a)*.34),(math.cos(a)*.34,.22,math.sin(a)*.34),.075)
    for x,z in [(-.12,0),(.1,.1),(.05,-.14)]:box('Hot ember',(x,.16,z),(.12,.05,.09),'ember',.01)
    export('campfire')
    # Arrange the editable source collection for convenient inspection.
    for index,(name,objects) in enumerate(models):
        collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
        for o in objects:
            for c in list(o.users_collection):c.objects.unlink(o)
            collection.objects.link(o);o.location.x+=(index%4)*4;o.location.y-=(index//4)*4
    for image in bpy.data.images:
        if image.filepath:image.filepath=bpy.path.relpath(image.filepath,start=str(ROOT/'assets/sources'))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/sources/building-catalogue.blend'))
    print('Catalogue models complete')

if __name__=='__main__':
    try:import bpy
    except ImportError:subprocess.run([r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe','--background','--python',str(Path(__file__).resolve())],check=True)
    else:build()
