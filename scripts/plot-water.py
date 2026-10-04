"""Offline generation review only; no map is added to the viewer."""
import json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'artifacts/water-review.json').read_text())
height=np.array(data['map']);size=data['size'];extent=[-size/2000,size/2000,-size/2000,size/2000]
fig,ax=plt.subplots(figsize=(10,10))
shaded=LightSource(315,50).shade(height,cmap=plt.get_cmap('terrain'),vert_exag=1,dx=size/(len(height)-1),dy=size/(len(height)-1))
ax.imshow(shaded,extent=extent,origin='lower')
for lake in data['lakes']:
    angles=np.linspace(0,2*np.pi,len(lake['radii'])+1);r=np.array(lake['radii']+[lake['radii'][0]])
    ax.fill((lake['x']+np.cos(angles)*r)/1000,(lake['z']+np.sin(angles)*r)/1000,color='#297ea3',alpha=.8)
for river in data['rivers']:
    p=river['points'];ax.plot([v['x']/1000 for v in p],[v['z']/1000 for v in p],color='#205a9e' if river['kind']=='main' else '#389ac5',linewidth=2 if river['kind']=='main' else 1)
ax.set(xlim=extent[:2],ylim=extent[2:],xlabel='X (km)',ylabel='Z (km)',title='Island Z: catchments, ocean outlets and basin lakes')
ax.set_aspect('equal');fig.tight_layout();fig.savefig(root/'artifacts/water-generation-review.png',dpi=130);plt.close(fig)
