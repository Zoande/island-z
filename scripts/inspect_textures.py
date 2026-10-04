"""Read-only alpha and atlas checks for generated foliage and ground materials."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
for name, cols, rows in [('ground-detail-albedo.png',2,2),('grass-v2.png',2,2),('bush-foliage.png',1,1),('palm-foliage.png',1,1),('palm-albedo.png',2,1)]:
    image = Image.open(root/'public/textures'/name).convert('RGBA')
    assert image.width % cols == 0 and image.height % rows == 0
    print(name, image.size)
    for row in range(rows):
        for col in range(cols):
            tile = image.crop((col*image.width//cols,row*image.height//rows,(col+1)*image.width//cols,(row+1)*image.height//rows))
            pixels = list(tile.getdata())
            opaque = [p for p in pixels if p[3] >= 102]
            red = sum(1 for r,g,b,a in opaque if r>170 and g<75 and b<75)
            yellow = sum(1 for r,g,b,a in opaque if r>220 and g>220 and b<30)
            print(' tile',row*cols+col,'alpha coverage',round(len(opaque)/len(pixels),3),'red/yellow',red,yellow)
            if name in ('grass-v2.png','bush-foliage.png','palm-foliage.png'):
                assert len(opaque)/len(pixels) < .8
                assert (red+yellow)/max(1,len(opaque)) < .0001, 'Significant colored fringe at render alpha threshold'
