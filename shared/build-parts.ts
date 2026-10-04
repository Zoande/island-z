import type {Prop} from './world';
import {objectRegistry,type ObjectBox} from './object-registry';
import type {CharacterCollider} from './character';
/** Actual opening dimensions are shared by geometry, ray casts and collision. */
export const OPENINGS={door:{width:1.16,bottom:0,height:2.32},window:{width:1.3,bottom:1.05,height:1.05}};
export function objectBoxes(prop:Prop):readonly ObjectBox[]|undefined {
  const definition=objectRegistry.get(prop.kind);if(!definition)return;
  const w=definition.wall;
  if(w) {
    if(!prop.aperture)return [{center:[0,w.height/2,0],size:[w.width,w.height,w.depth]}];
    const o=OPENINGS[prop.aperture],side=(w.width-o.width)/2,boxes:ObjectBox[]=[
      {center:[-(o.width+side)/2,w.height/2,0],size:[side,w.height,w.depth]},
      {center:[(o.width+side)/2,w.height/2,0],size:[side,w.height,w.depth]},
      {center:[0,(w.height+o.bottom+o.height)/2,0],size:[o.width,w.height-o.bottom-o.height,w.depth]},
    ];
    if(o.bottom>0)boxes.push({center:[0,o.bottom/2,0],size:[o.width,o.bottom,w.depth]});return boxes;
  }
  const slab=definition.slab;if(slab)return [{center:[0,slab.height/2,0],size:[slab.width,slab.height,slab.depth]}];
  return definition.boxes;
}
export function boxColliders(prop:Prop):CharacterCollider[]|undefined {
  const boxes=objectBoxes(prop);if(!boxes)return;
  const c=Math.cos(prop.rotation),s=Math.sin(prop.rotation);
  return boxes.map(b=>({kind:'wall',x:prop.x+(b.center[0]*c+b.center[2]*s)*prop.scale,z:prop.z+(-b.center[0]*s+b.center[2]*c)*prop.scale,
    bottom:prop.y+(b.center[1]-b.size[1]/2)*prop.scale,top:prop.y+(b.center[1]+b.size[1]/2)*prop.scale,
    radius:Math.hypot(b.size[0],b.size[2])/2*prop.scale,wall:{halfWidth:b.size[0]/2*prop.scale,halfDepth:b.size[2]/2*prop.scale,yaw:prop.rotation}}));
}
