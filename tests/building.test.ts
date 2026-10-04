import {describe,it,expect} from 'vitest';
import {objectRegistry,hotbarSlots,objectDefinition,buildProp,type BuildObject,type BuildRequest} from '../shared/object-registry';
import {BuildScene} from '../shared/build-scene';
import {solvePlacement,validBuildRequest} from '../shared/build-placement';
import {boxShape,intersects,type ConvexShape} from '../shared/convex';
import {Character,CHARACTER,characterInput,idleInput} from '../shared/character';
import {playerCollider} from '../shared/object-colliders';
import {rockSurface} from '../shared/rock-collision';
import {wallGeometry} from '../client/wall-geometry';
import type {WorldGenerator,Prop} from '../shared/world';
import type {Point3} from '../shared/rocks';
function scene(height=(x:number,z:number)=>0,props:Prop[]=[],water:((x:number,z:number)=>any)=()=>null) {
  return new BuildScene({config:{seed:'build-test',islandSizeMeters:1024},height,props(x:number,z:number,e:number){return props.filter(p=>p.x>=x&&p.x<x+e&&p.z>=z&&p.z<z+e);},surfaceWater:water}as unknown as WorldGenerator);
}
function request(id='request-0001',definitionId='wall-wood',target:Point3=[0,0,0],feet:Point3=[0,0,4],rotation=0):BuildRequest {
  const eye:Point3=[feet[0],feet[1]+CHARACTER.eyeHeight,feet[2]],v=target.map((p,i)=>p-eye[i]),length=Math.hypot(...v);
  return {requestId:id,definitionId,variant:0,eye,feet,direction:v.map(v=>v/length)as Point3,rotation,standing:true};
}
const wall=(id:string,position:Point3=[0,-.1,0],rotation=0):BuildObject=>({id,definitionId:'wall-wood',variant:0,position,rotation,normal:[0,1,0],support:{kind:'terrain'}});
describe('object registry and collision geometry',()=>{
  it('has nine slots, separate wall IDs, valid reused variants and empty unequip slots',()=>{
    expect(hotbarSlots).toHaveLength(9);expect(hotbarSlots[8]).toBeNull();expect(objectDefinition('rock').variants).toHaveLength(24);expect(objectDefinition('tree').variants).toHaveLength(15);
    for(const d of objectRegistry.values()){expect(d.id).toBeTruthy();if(d.wall)expect(d.variants).toHaveLength(1);}
    for(const id of ['wall-wood','wall-stone']){const m=wallGeometry(id),w=objectDefinition(id).wall!;expect(m.material).toBe(id);for(let i=0;i<m.vertices.length;i+=16){expect(Math.abs(m.vertices[i])).toBeLessThanOrEqual(w.width/2+.0001);expect(m.vertices[i+1]).toBeGreaterThanOrEqual(0);expect(m.vertices[i+1]).toBeLessThanOrEqual(w.height+.0001);expect(Math.abs(m.vertices[i+2])).toBeLessThanOrEqual(w.depth/2+.0001);}}
  });
  it('distinguishes touching and penetrating convex boxes and cylinders',()=>{
    const a=boxShape([0,1,0],[1,1,.1],0);
    expect(intersects(a,boxShape([0,1,.18],[1,1,.1],0))).toBe(true);
    expect(intersects(a,boxShape([0,1,.21],[1,1,.1],0))).toBe(false);
    expect(intersects(a,boxShape([0,3,0],[1,1,.1],0))).toBe(false);
    expect(intersects(a,boxShape([.8,3,.05],[1,1,.1],.4))).toBe(false);
    expect(intersects(a,boxShape([0,2.95,0],[1,1,.1],Math.PI/2))).toBe(true);
    const cylinder:ConvexShape={kind:'cylinder',center:[0,1,.35],radius:.3,halfHeight:1};expect(intersects(a,cylinder)).toBe(true);expect(intersects(a,{...cylinder,center:[0,1,.5]})).toBe(false);
    expect(intersects(cylinder,{...cylinder,center:[.2,1,.35]})).toBe(true);expect(intersects(cylinder,{...cylinder,center:[1,1,.35]})).toBe(false);
  });
  it('matches an independent 2D separating-axis test for hundreds of rotated thin walls',()=>{
    for(let i=0;i<300;i++) {
      const ax=(i*17%37)/10-1.8,az=(i*13%31)/10-1.5,angle=i*.271,bx=(i*11%29)/10-1.4,bz=(i*7%23)/10-1.1,bangle=i*.419;
      let separated=false;
      for(const axis of [angle,angle+Math.PI/2,bangle,bangle+Math.PI/2]) {
        const dx=Math.cos(axis),dz=-Math.sin(axis),distance=Math.abs((bx-ax)*dx+(bz-az)*dz);
        const ra=1.5*Math.abs(Math.cos(angle-axis))+.12*Math.abs(Math.sin(angle-axis)),rb=1.5*Math.abs(Math.cos(bangle-axis))+.12*Math.abs(Math.sin(bangle-axis));
        if(distance>=ra+rb)separated=true;
      }
      expect(intersects(boxShape([ax,1,az],[1.5,1,.12],angle),boxShape([bx,1,bz],[1.5,1,.12],bangle),0)).toBe(!separated);
    }
  });
});
describe('shared authoritative placement',()=>{
  it('accepts clear ground and rejects unsupported, out-of-reach and malformed actions',()=>{
    const s=scene(),r=request(),p=solvePlacement(s,r);expect(p.valid).toBe(true);expect(p.object.position[1]).toBeCloseTo(-.1);
    expect(validBuildRequest(r)).toBe(true);expect(validBuildRequest({...r,variant:999})).toBe(false);expect(validBuildRequest({...r,direction:[NaN,0,1]})).toBe(false);
    expect(solvePlacement(s,{...r,standing:false}).code).toBe('standing');expect(solvePlacement(s,request('request-far','wall-wood',[0,0,-20])).code).toBe('reach');
    expect(solvePlacement(s,{...r,expected:{position:[0,8,0],rotation:0,support:{kind:'terrain'}}}).code).toBe('changed');
  });
  it('rejects ground cliffs, underwater walls and buried endpoint snaps',()=>{
    expect(solvePlacement(scene((x,z)=>x*.5),request()).code).toBe('ground');
    expect(solvePlacement(scene(undefined,[],()=>({level:1,kind:'lake'})),request()).code).toBe('water');
    const s=scene((x,z)=>x>2?.8:0);s.add(wall('parent-wall'));const p=solvePlacement(s,request('next-wall','wall-wood',[1.5,.8,0]));expect(p.valid).toBe(false);
  });
  it('blocks bushes, trunks, rocks, existing builds and the player while allowing foliage overlap',()=>{
    const props:Prop[]=[{kind:'bush',x:1.3,y:0,z:0,scale:1,rotation:0,variant:1}];expect(solvePlacement(scene(undefined,props),request()).code).toBe('overlap');
    props[0]={...props[0],kind:'oak',x:1.3,variant:0};expect(solvePlacement(scene(undefined,props),request()).code).toBe('overlap');
    props[0]={...props[0],x:3};expect(solvePlacement(scene(undefined,props),request()).valid).toBe(true);
    const s=scene();s.add(wall('existing-wall'));expect(solvePlacement(s,request()).valid).toBe(false);
    expect(solvePlacement(scene(),request('self-wall','wall-wood',[0,0,3.6])).code).toBe('player');
  });
  it('keeps a wall endpoint fixed through 90-degree and fine rotations, supports corners, and rejects folding back',()=>{
    const s=scene();s.add(wall('parent-wall'));const target:Point3=[1.49,.6,0];
    for(const angle of [0,Math.PI/2,Math.PI/2+.035]) {
      const p=solvePlacement(s,request('next-wall','wall-stone',target,[1.5,0,4],angle));expect(p.valid).toBe(true);expect(p.object.support).toEqual({kind:'wall',id:'parent-wall',socket:'right'});
      const [x,,z]=p.object.position;expect(x-Math.cos(p.object.rotation)*1.5).toBeCloseTo(1.5);expect(z+Math.sin(p.object.rotation)*1.5).toBeCloseTo(0);
    }
    expect(solvePlacement(s,request('next-wall','wall-wood',target,[1.5,0,4],Math.PI)).code).toBe('overlap');
  });
  it('stacks walls directly with the rotation of their support and includes placed wall collisions',()=>{
    const s=scene(),parent=wall('parent-wall',[0,-.1,0],.4);s.add(parent);
    const p=solvePlacement(s,request('top-wall','wall-stone',[0,2.2,0],[0,0,4],2));expect(p.valid).toBe(true);expect(p.object.support).toEqual({kind:'wall',id:'parent-wall',socket:'top'});expect(p.object.rotation).toBe(.4);expect(p.object.position).toEqual([0,2.4,0]);
    s.add(p.object);expect(s.colliders(0,0).filter(c=>c.kind==='wall')).toHaveLength(2);
    const corner=wall('adjacent-wall',[Math.cos(.4)*1.5+Math.sin(.4)*1.5,-.1,-Math.sin(.4)*1.5+Math.cos(.4)*1.5],.4-Math.PI/2);
    s.add(corner);s.remove(p.object.id);
    expect(solvePlacement(s,request('top-wall','wall-stone',[0,2.2,0],[0,0,4],2)).valid).toBe(true);
  });
  it('requires a whole broad rock top rather than accepting a center-only contact',()=>{
    let supported=false,rejected=false;
    for(const variant of [1,7,13,19]) {
      const s=scene(),rock:BuildObject={id:'support-rock',definitionId:'rock',variant,position:[0,0,0],rotation:0,normal:[0,1,0],support:{kind:'terrain'}};
      const solid=s.add(rock),height=rockSurface(solid.collider,0,0)!.height;
      const p=solvePlacement(s,request('rock-wall','wall-wood',[0,height,0],[0,0,5]));if(p.valid){supported=true;expect(p.object.support).toEqual({kind:'rock',id:'support-rock'});}else rejected=true;
    }
    expect(supported).toBe(true);expect(rejected).toBe(true);
  });
  it('does not place through a blocking trunk and samples exact global terrain triangles',()=>{
    const s=scene((x,z)=>x*.1+z*.2,[{kind:'oak',x:0,y:0,z:2,variant:0,scale:1,rotation:0}]);expect(solvePlacement(s,request()).valid).toBe(false);
    for(const [x,z]of [[-.2,-.8],[63.9,63.9],[64.1,64.1]]){expect(s.terrain(x,z).height).toBeCloseTo(x*.1+z*.2,9);expect(Math.hypot(...s.terrain(x,z).normal)).toBeCloseTo(1);}
  });
});
describe('placed wall movement collisions',()=>{
  it('blocks thin rotated walls at low frame rates, allows sliding, and supports standing on top',()=>{
    for(const angle of [0,.6,Math.PI/2])for(const fps of [10,60]) {
      const object=wall('physical-wall',[0,0,0],angle),collider=playerCollider(buildProp(object))!,s=scene();s.add(object);
      const c=new Character({surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[collider]});c.spawn(Math.sin(angle)*4,0,Math.cos(angle)*4);
      for(let i=0;i<3*fps;i++)c.update(1/fps,characterInput(new Set(['KeyW','ShiftLeft']),-angle));
      const front=c.feet[0]*Math.sin(angle)+c.feet[2]*Math.cos(angle);expect(front).toBeGreaterThanOrEqual(.11+CHARACTER.radius-.01);
      const top=new Character({surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[collider]});top.spawn(0,2.5,0);top.update(.1,idleInput);expect(top.feet[1]).toBe(2.5);expect(top.grounded).toBe(true);
    }
  });
});
