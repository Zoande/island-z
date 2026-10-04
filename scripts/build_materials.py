"""Generate new normal/roughness maps from procedural surface relief in Blender.

The ImageGen base-color images are kept untouched. RGB encodes tangent-space
normals; alpha encodes roughness. Atlas layouts match the base-color catalog.
"""
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def launch():
    blender = os.environ.get('BLENDER_PATH', r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe')
    subprocess.run([blender, '--background', '--python', str(Path(__file__).resolve())], check=True)

def build():
    import bpy
    from mathutils import noise, Vector
    output = ROOT / 'public' / 'textures'
    output.mkdir(parents=True, exist_ok=True)
    def relief(u, v, kind):
        p = Vector((u, v, kind * 17.3))
        n = noise.noise_vector(p * 28.0, noise_basis='PERLIN_ORIGINAL').x
        fine = noise.noise_vector(p * 96.0, noise_basis='PERLIN_ORIGINAL').y
        if kind == 0: return n * 0.007 + fine * 0.003
        if kind == 1: return n * 0.015 + fine * 0.008
        if kind == 2: return n * 0.020 + fine * 0.007
        if kind == 3: return n * 0.025 + fine * 0.010
        if kind == 4: return (math.sin(u * 75 + n * 7) * 0.018 + fine * 0.005)
        if kind == 5: return math.sin(v * 80 + n * 2) * 0.004 + fine * 0.002
        if kind == 6: return n * .012 + fine * .003
        if kind == 7: return abs(n) * .034 + fine * .012
        if kind == 8: return n * .022 + fine * .007
        if kind == 10: return math.sin(v*90+n*3)*.013 + fine*.004
        if kind == 11: return math.sin(u*120+n*4)*.008 + fine*.005
        return n * .014 + fine * .009
    def image(name, width, height, columns, rows, first):
        pixels = []
        for y in range(height):
            # Blender image coordinates are bottom-up; the atlas catalog is top-down.
            row = rows - 1 - int(y / height * rows)
            for x in range(width):
                col = int(x / width * columns)
                kind = first + row * columns + col
                u, v = (x / width * columns) % 1, (y / height * rows) % 1
                e = 0.001
                dx = (relief(u + e, v, kind) - relief(u - e, v, kind)) / (2 * e)
                dy = (relief(u, v + e, kind) - relief(u, v - e, kind)) / (2 * e)
                length = math.sqrt(dx * dx + dy * dy + 1)
                roughness = [0.92, 0.90, 0.96, 0.81, 0.93, 0.85, .55, .88, .97, .94, .89, .93][kind]
                pixels.extend((0.5 - dx / length * 0.5, 0.5 - dy / length * 0.5, 0.5 + 0.5 / length, roughness))
        img = bpy.data.images.new(name, width=width, height=height, alpha=True)
        img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(pixels)
        img.filepath_raw = str(output / name)
        img.file_format = 'PNG'
        img.save()
    image('terrain-normal-roughness.png', 512, 512, 2, 2, 0)
    image('bark-normal-roughness.png', 512, 512, 2, 1, 4)
    image('ground-detail-normal-roughness.png', 512, 512, 2, 2, 6)
    image('palm-normal-roughness.png', 512, 512, 2, 1, 10)
    flat = bpy.data.images.new('foliage-normal-roughness.png', width=4, height=4, alpha=True)
    flat.colorspace_settings.name = 'Non-Color'
    flat.pixels.foreach_set([0.5, 0.5, 1, 0.85] * 16)
    flat.filepath_raw = str(output / flat.name)
    flat.file_format = 'PNG'
    flat.save()
    print('Generated normal/roughness material maps.')

if __name__ == '__main__':
    try:
        import bpy
    except ImportError:
        launch()
    else:
        build()
