"""Derive a subtle normal/roughness data map from the shared linen albedo."""
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]
a=np.asarray(Image.open(root/'public/textures/linen-albedo.png').convert('RGB')).mean(axis=2)/255
x=(np.roll(a,-1,axis=1)-np.roll(a,1,axis=1))*.45
z=(np.roll(a,-1,axis=0)-np.roll(a,1,axis=0))*.45
n=np.stack((-x,-z,np.ones_like(a)),axis=2)
n/=np.linalg.norm(n,axis=2,keepdims=True)
data=np.zeros((*a.shape,4),dtype=np.uint8)
data[:,:,:3]=np.uint8(np.clip((n*.5+.5)*255,0,255));data[:,:,3]=240
Image.fromarray(data).save(root/'public/textures/linen-normal-roughness.png')
