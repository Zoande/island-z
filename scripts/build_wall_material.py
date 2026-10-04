"""Generate a small technical normal/roughness texture; preserve ImageGen albedo."""
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]
n=256
y,x=np.mgrid[0:n,0:n]/n
# Periodic vertical timber fibers with very modest fine saw relief.
relief=.003*np.sin(x*2*np.pi*29+.28*np.sin(y*2*np.pi*3))+.0015*np.sin(x*2*np.pi*73)+.0004*np.sin(y*2*np.pi*53)
dx=(np.roll(relief,-1,axis=1)-np.roll(relief,1,axis=1))*n/2
dy=(np.roll(relief,-1,axis=0)-np.roll(relief,1,axis=0))*n/2
normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1)
normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
roughness=.90+.025*np.sin(x*2*np.pi*13)*np.sin(y*2*np.pi*7)
rgba=np.concatenate([normal*.5+.5,roughness[:,:,None]],axis=-1)
Image.fromarray(np.uint8(np.clip(rgba,0,1)*255)).save(root/'public/textures/wall-wood-normal-roughness.png')
