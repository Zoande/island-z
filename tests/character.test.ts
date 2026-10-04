import { describe,expect,it } from 'vitest';
import { Character,CHARACTER,characterInput,idleInput,type CharacterEnvironment,type CharacterInput,type CharacterCollider } from '../shared/character';
import { playerCollider } from '../client/player-colliders';
import { surfaceFromTiles } from '../shared/placement';
import { BASE_CHUNK,GRID,VERTEX_FLOATS,type ChunkData } from '../shared/mesh';
import { playerPriority,resolveDrawKeys,selectTiles } from '../client/streaming';
const flat:CharacterEnvironment={surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[]};
const input=(keys:string[],yaw=0)=>characterInput(new Set(keys),yaw);
function walk(environment=flat,keys=['KeyW'],fps=60,seconds=2,spawn=[0,0,0]) {
  const c=new Character(environment);c.spawn(...spawn as [number,number,number]);
  for(let i=0;i<fps*seconds;i++)c.update(1/fps,input(keys));return c;
}
describe('first-person character',()=>{
  it('maps WASD to facing-relative movement and cancels opposing keys',()=>{
    expect(input(['KeyW'])).toMatchObject({x:0,z:-1});expect(input(['KeyS'])).toMatchObject({x:0,z:1});
    expect(input(['KeyD'])).toMatchObject({x:1,z:0});expect(input(['KeyA'])).toMatchObject({x:-1,z:0});
    expect(input(['KeyW','KeyS','KeyA','KeyD'])).toMatchObject({x:0,z:0});
    expect(input(['KeyW'],Math.PI/2).x).toBeCloseTo(1);expect(input(['KeyD'],Math.PI/2).z).toBeCloseTo(1);
    expect(input(['KeyQ','KeyE'])).toMatchObject({x:0,z:0,jump:false});
  });
  it('keeps diagonal speed equal to straight movement and supports sprinting',()=>{
    const straight=walk(),diagonal=walk(flat,['KeyW','KeyD']),sprint=walk(flat,['KeyW','ShiftLeft']);
    expect(Math.hypot(diagonal.feet[0],diagonal.feet[2])).toBeCloseTo(Math.abs(straight.feet[2]),8);
    expect(straight.velocity[2]).toBeCloseTo(-CHARACTER.walkSpeed,5);
    expect(sprint.velocity[2]).toBeCloseTo(-CHARACTER.sprintSpeed,5);
    expect(straight.feet[1]).toBe(0);expect(straight.grounded).toBe(true);
  });
  it('produces matching movement at 15, 30, 60 and 144 fps',()=>{
    const reference=walk(flat,['KeyW','KeyD'],120);
    for(const fps of [15,30,60,144]) {
      const c=walk(flat,['KeyW','KeyD'],fps);expect([...c.feet]).toEqual([...reference.feet]);
    }
  });
  it('makes one small jump per press and lands without sinking or held-key hopping',()=>{
    const c=new Character(flat);c.spawn(0,0,0);let peak=0,landings=0,airborne=false;
    for(let i=0;i<180;i++) {
      c.update(1/60,{...idleInput,jump:true});peak=Math.max(peak,c.feet[1]);
      if(!c.grounded)airborne=true;else if(airborne) {landings++;airborne=false;}
      expect(c.feet[1]).toBeGreaterThanOrEqual(0);
    }
    expect(peak).toBeGreaterThan(.45);expect(peak).toBeLessThan(.6);expect(landings).toBe(1);
    c.update(1/60,idleInput);c.update(1/60,{...idleInput,jump:true});expect(c.feet[1]).toBeGreaterThan(0);
  });
  it('falls when leaving a ledge and cannot jump again in midair',()=>{
    const environment:CharacterEnvironment={...flat,surface:x=>({height:x<1?3:0,normal:[0,1,0]})};
    const c=new Character(environment);c.spawn(0,3,0);let airborne=false;
    for(let i=0;i<120;i++) {
      c.update(1/60,{x:1,z:0,sprint:false,jump:i===35});
      if(c.feet[0]>1.5&&c.feet[1]>0) {airborne=true;expect(c.velocity[1]).toBeLessThan(0);}
      expect(c.feet[1]).toBeGreaterThanOrEqual(0);
    }
    expect(airborne).toBe(true);expect(c.feet[1]).toBe(0);
  });
  it('sweeps against tree trunks at low frame rates and while jumping',()=>{
    const tree:CharacterCollider={x:0,z:-2,radius:.5,bottom:-.2,top:14,kind:'tree'};
    const environment={...flat,colliders:()=>[tree]};
    for(const fps of [10,60]) {
      const c=walk(environment,['KeyW','ShiftLeft','Space'],fps,3);
      expect(c.feet[2]).toBeGreaterThanOrEqual(-2+tree.radius+CHARACTER.radius-.001);
      expect(c.feet[1]).toBe(0);
    }
  });
  it('slides past trunks and resolves starting overlaps without nonfinite values',()=>{
    const tree:CharacterCollider={x:.65,z:-1.4,radius:.5,bottom:-.2,top:14,kind:'tree'};
    const environment={...flat,colliders:()=>[tree]};
    const c=walk(environment,['KeyW','KeyD'],60,2);
    expect(c.feet[2]).toBeLessThan(-3);expect(c.feet.every(Number.isFinite)).toBe(true);
    const inside=walk(environment,[],60,.1,[tree.x,0,tree.z]);
    expect(Math.hypot(inside.feet[0]-tree.x,inside.feet[2]-tree.z)).toBeGreaterThanOrEqual(tree.radius+CHARACTER.radius);
  });
  it('slows movement through foliage instead of making bushes solid',()=>{
    const bush:CharacterCollider={x:0,z:0,radius:100,bottom:0,top:3,kind:'bush'};
    const c=walk({...flat,colliders:()=>[bush]}),open=walk();
    expect(c.inBush).toBe(true);expect(c.feet[2]).toBeLessThan(-3);
    expect(c.feet[2]/open.feet[2]).toBeCloseTo(.65,7);
  });
  it('steps over small rises but blocks tall terrain walls',()=>{
    for(const [height,passes]of [[.18,true],[.8,false]]as const) {
      const c=walk({...flat,surface:(_x,z)=>({height:z<-1?height:0,normal:[0,1,0]})});
      if(passes) {expect(c.feet[2]).toBeLessThan(-5);expect(c.feet[1]).toBe(height);}
      else {expect(c.feet[2]).toBeGreaterThan(-1);expect(c.feet[1]).toBe(0);}
    }
  });
  it('blocks climbing steep slopes while allowing travel along a slope',()=>{
    const slope=2,normal:[number,number,number]=[-slope/Math.hypot(slope,1),1/Math.hypot(slope,1),0];
    const steep={...flat,surface:(x:number)=>({height:x*slope,normal})};
    const up=walk(steep,['KeyD']),along=walk(steep,['KeyW']);
    expect(up.feet[0]).toBeLessThan(.01);expect(along.feet[2]).toBeLessThan(-1);
  });
  it('waits for streamed collision terrain rather than falling through unloaded ground',()=>{
    let ready=false;const c=new Character({...flat,surface:()=>ready?{height:12,normal:[0,1,0]}:null});c.spawn(0,12,0);
    c.update(.1,input(['KeyW']));expect([...c.feet]).toEqual([0,12,0]);expect(c.ready).toBe(false);
    ready=true;c.update(.1,idleInput);expect(c.ready).toBe(true);expect(c.feet[1]).toBe(12);
    ready=false;const before=[...c.feet];c.update(.1,input(['KeyW']));expect([...c.feet]).toEqual(before);
  });
  it('walks continuously across rendered terrain triangles and chunk borders',()=>{
    const tiles=[0,64].map(x=>{
      const vertices=new Float32Array((GRID+1)**2*VERTEX_FLOATS);
      for(let z=0;z<=GRID;z++)for(let i=0;i<=GRID;i++) {
        const index=(z*(GRID+1)+i)*VERTEX_FLOATS;vertices.set([i*2,(x+i*2)*.15,z*2],index);
      }
      return {data:{x,z:0,level:0}as ChunkData,vertices};
    });
    const c=walk({...flat,surface:(x,z)=>surfaceFromTiles(tiles,x,z)},['KeyD'],60,3,[62,9.3,32]);
    expect(c.feet[0]).toBeGreaterThan(BASE_CHUNK+8);
    expect(c.feet[1]).toBeCloseTo(surfaceFromTiles(tiles,c.feet[0],c.feet[2])!.height,5);
    expect(c.grounded).toBe(true);
  });
  it('displays full-detail terrain around the player before the background finishes loading',()=>{
    const x=2457.6,z=9700,roots=selectTiles(x,z,30720,6500),priority=playerPriority(roots,x,z);
    const drawn=resolveDrawKeys(roots,priority),key=`${Math.floor(x/64)*64}:${Math.floor(z/64)*64}:0`;
    expect(drawn).toContain(key);expect(priority.size).toBeLessThan(180);
  });
  it('uses trunk colliders for oak, birch and palms, and soft scaled bushes',()=>{
    const base={x:10,y:2,z:20,rotation:0,scale:1,variant:0};
    for(const kind of ['oak','birch','palm']as const) {
      const c=playerCollider({...base,kind})!;expect(c.kind).toBe('tree');expect(c.top).toBeGreaterThan(10);expect(c.radius).toBeGreaterThan(.2);
    }
    const small=playerCollider({...base,kind:'bush'})!,large=playerCollider({...base,kind:'bush',scale:2})!;
    expect(large.radius).toBe(small.radius*2);expect(large.kind).toBe('bush');
    expect(playerCollider({...base,kind:'grass'})).toBeNull();
  });
});
