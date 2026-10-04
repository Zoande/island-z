"""Render an asset inspection sheet from editable Blender sources; no source edits."""
import math
from pathlib import Path
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for filename,prefix,offset,target in [
    ('temperate-trees.blend','oak-3-lod0',66,8),('temperate-trees.blend','birch-2-lod0',194,30),
    ('coastal-palms.blend','palm-1-lod0',18,50),('temperate-bushes.blend','bush-3-lod0',15,65)]:
    with bpy.data.libraries.load(str(ROOT/'assets/sources'/filename),link=False) as (source,dest):dest.objects=[n for n in source.objects if n.startswith(prefix)]
    for obj in dest.objects:
        bpy.context.collection.objects.link(obj);obj.hide_render=False;obj.hide_set(False);obj.location.x+=target-offset
for image in bpy.data.images:
    if image.filepath:
        image.filepath=str(ROOT/'public/textures'/Path(image.filepath).name);image.reload()
bpy.ops.mesh.primitive_plane_add(size=300,location=(35,0,-.18))
floor=bpy.context.object;mat=bpy.data.materials.new('inspection-ground');mat.diffuse_color=(.21,.24,.19,1);floor.data.materials.append(mat)
world=bpy.context.scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.40,.52,.65,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.6
bpy.ops.object.light_add(type='SUN',location=(0,-20,40));bpy.context.object.rotation_euler=(math.radians(25),math.radians(-25),math.radians(-20));bpy.context.object.data.energy=2.3
bpy.ops.object.camera_add(location=(36,-85,30));camera=bpy.context.object
camera.rotation_euler=(Vector((36,0,12))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=80
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';(ROOT/'artifacts').mkdir(exist_ok=True)
scene.render.filepath=str(ROOT/'artifacts/vegetation-inspection.png');bpy.ops.render.render(write_still=True)
