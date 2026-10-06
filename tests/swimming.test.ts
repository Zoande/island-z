import {describe,it,expect} from 'vitest';
import {Character,CHARACTER,characterInput,idleInput,type CharacterEnvironment,type CharacterInput,type CharacterWater} from '../shared/character';
import {WorldGenerator} from '../shared/world';
import {selectTiles,playerPriority} from '../client/streaming';
const flat:CharacterEnvironment={surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[]};
const ocean:CharacterEnvironment={...flat,surface:()=>({height:-100,normal:[0,1,0]}),water:()=>({level:0,kind:'ocean'})};
const input=(keys:string[],pitch=0)=>characterInput(new Set(keys),0,pitch);
function advance(c:Character,seconds:number,controls:CharacterInput=idleInput,fps=60) {
  for(let i=0;i<Math.round(seconds*fps);i++)c.update(1/fps,controls);
}
function swimmer(environment=ocean,y=-5) {const c=new Character(environment);c.spawn(0,y,0);c.update(1/60,idleInput);return c;}
describe('movement and swimming',()=>{
  it('increases jump height by 30%, charges stamina once per takeoff and blocks exhausted jumps',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.stamina=50;let peak=0;
    for(let i=0;i<40;i++){c.update(1/120,{...idleInput,jump:true});peak=Math.max(peak,c.feet[1]);}
    expect(peak).toBeGreaterThan(.62);expect(peak).toBeLessThan(.7);expect(c.stamina).toBeCloseTo(46,2);
    const tired=new Character(flat);tired.spawn(0,0,0);tired.stamina=CHARACTER.jumpCost-.5;
    tired.update(.1,{...idleInput,jump:true});expect(tired.feet[1]).toBe(0);
  });
  it('raises eye height, walk speed and sprint speed, with a controlled sprint ramp',()=>{
    expect(CHARACTER.eyeHeight).toBeCloseTo(1.968);expect(CHARACTER.walkSpeed).toBeCloseTo(5.175);expect(CHARACTER.sprintSpeed).toBeCloseTo(10.465);
    const c=new Character(flat);c.spawn(0,0,0);advance(c,.5,input(['KeyW','ShiftLeft']));
    expect(-c.velocity[2]).toBeCloseTo(2.25);expect(c.accelerating).toBe(true);
    advance(c,2,input(['KeyW','ShiftLeft']));expect(-c.velocity[2]).toBeCloseTo(CHARACTER.sprintSpeed);
    advance(c,.8,input(['KeyS']));expect(c.velocity[2]).toBeCloseTo(CHARACTER.walkSpeed);
  });
  it('swims with look-relative WASD, Space up and Shift down, with normalized diagonal speed',()=>{
    const c=swimmer();advance(c,1,input(['KeyW'],.5));expect(c.velocity[1]).toBeGreaterThan(1);expect(c.feet[2]).toBeLessThan(-2);
    advance(c,1,input(['ShiftLeft']));expect(c.velocity[1]).toBeLessThan(-2);
    advance(c,1,input(['Space','KeyW','KeyD']));expect(c.velocity[1]).toBeGreaterThan(1);expect(Math.hypot(...c.velocity)).toBeLessThanOrEqual(CHARACTER.swimSpeed+.001);
    const idle=swimmer();advance(idle,2);expect(idle.velocity[1]).toBeCloseTo(-CHARACTER.idleSinkSpeed,3);
  });
  it('stays at the surface while ascending and recovers oxygen above the mean water plane',()=>{
    const c=swimmer();c.oxygen=30;advance(c,5,input(['Space']));
    expect(c.feet[1]+CHARACTER.eyeHeight).toBeCloseTo(.18,4);expect(c.underwater).toBe(false);expect(c.swimming).toBe(true);expect(c.oxygen).toBeGreaterThan(30);
    advance(c,3,input(['ShiftLeft']));expect(c.underwater).toBe(true);expect(c.feet[1]+CHARACTER.eyeHeight).toBeLessThan(-4);
  });
  it('uses elevated lake and river levels rather than sea level',()=>{
    for(const kind of ['lake','river']as const) {
      const c=swimmer({...ocean,surface:()=>({height:30,normal:[0,1,0]}),water:()=>({level:40,kind})},36);
      expect(c.waterLevel).toBe(40);expect(c.underwater).toBe(true);advance(c,3,input(['Space']));expect(c.feet[1]+CHARACTER.eyeHeight).toBeCloseTo(40.18,4);
    }
  });
  it('walks out of sloped water and keeps feet on the seabed while diving',()=>{
    const environment:CharacterEnvironment={...flat,surface:x=>({height:x-5,normal:[-Math.SQRT1_2,Math.SQRT1_2,0]}),water:x=>x<5?{level:0,kind:'lake'}:null};
    const c=swimmer(environment,-1.788);advance(c,3,input(['KeyD']));expect(c.feet[0]).toBeGreaterThan(5);expect(c.swimming).toBe(false);expect(c.grounded).toBe(true);
    const bed=swimmer({...ocean,surface:()=>({height:-7,normal:[0,1,0]})});advance(bed,5,input(['ShiftLeft']));expect(bed.feet[1]).toBe(-7);
  });
  it('resets to the original game spawn after exactly one minute submerged, including missing terrain',()=>{
    let loaded=true;const c=new Character({...ocean,surface:()=>loaded?{height:-100,normal:[0,1,0]}:null});
    c.spawn(20,3,30);c.spawn(0,-10,0);loaded=false;advanceVitals(c,59);expect(c.oxygen).toBeCloseTo(1,8);expect(c.respawns).toBe(0);
    advanceVitals(c,1);expect(c.respawns).toBe(1);expect([...c.feet]).toEqual([20,3,30]);expect(c.oxygen).toBe(60);expect(c.stamina).toBe(100);
  });
  it('keeps freshwater and near-shore oxygen gentle, then increases offshore drowning risk without a boundary',()=>{
    for(const [kind,distance,seconds]of [['lake',2000,60],['river',2000,60],['ocean',0,60],['ocean',50,60],['ocean',400,30],['ocean',750,12],['ocean',1450,60/17]]as const) {
      const c=new Character({...ocean,surface:()=>null,water:()=>({level:0,kind,offshoreMeters:distance})});c.spawn(0,3,0);c.spawn(0,-10,0);
      advanceVitals(c,seconds-.01);expect(c.respawns).toBe(0);expect(c.oxygen).toBeGreaterThan(0);
      advanceVitals(c,.02);expect(c.respawns).toBe(1);expect([...c.feet]).toEqual([0,3,0]);expect(c.oxygenDrainRate).toBe(1);
    }
  });
  it('updates drain when returning to shore or freshwater and keeps surface breathing and frame rates consistent',()=>{
    let water:CharacterWater={level:0,kind:'ocean',offshoreMeters:750};
    const environment={...ocean,water:()=>water};
    for(const fps of [15,60,144]){const c=swimmer(environment);c.oxygen=60;advance(c,2,idleInput,fps);expect(c.oxygen).toBeCloseTo(50,8);}
    const c=swimmer({...environment,surface:()=>null});c.oxygen=40;advanceVitals(c,1);expect(c.oxygen).toBeCloseTo(35,8);
    water={...water,offshoreMeters:25};advanceVitals(c,1);expect(c.oxygen).toBeCloseTo(34,8);
    water={...water,kind:'lake',offshoreMeters:2000};advanceVitals(c,1);expect(c.oxygen).toBeCloseTo(33,8);
    water={...water,kind:'ocean',offshoreMeters:2000};c.feet[1]=0;advanceVitals(c,1);expect(c.oxygen).toBeCloseTo(43,8);expect(c.respawns).toBe(0);
  });
  it('drains during acceleration, sprinting and swimming, and only recovers with gentle walking or water idling',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.stamina=50;
    advance(c,.1,input(['KeyW']));expect(c.stamina).toBeLessThan(50);
    advance(c,2,input(['KeyW']));expect(c.stamina).toBeGreaterThan(50);
    const before=c.stamina;advance(c,2,input(['KeyW','ShiftLeft']));expect(c.stamina).toBeLessThan(before);
    const w=swimmer();w.stamina=50;advance(w,2,input(['Space']));expect(w.stamina).toBeLessThan(50);
    const spent=w.stamina;advance(w,2);expect(w.stamina).toBeGreaterThan(spent);expect(w.velocity[1]).toBeLessThan(0);
  });
  it('gives lakes a generous swimming budget but makes ocean exhaustion lead to sinking and drowning',()=>{
    const lake=swimmer({...ocean,water:()=>({level:0,kind:'lake'})},-1.788);
    advance(lake,360,input(['KeyW','Space']),10);expect(lake.stamina).toBeGreaterThan(30);expect(lake.respawns).toBe(0);
    const sea=swimmer(ocean,-1.788);advance(sea,290,input(['KeyW','Space']),10);expect(sea.exhausted).toBe(true);expect(sea.velocity[1]).toBeLessThan(0);
    advance(sea,60,input(['Space']),10);expect(sea.respawns).toBe(1);
    const runner=new Character(flat);runner.spawn(0,0,0);runner.stamina=0;runner.exhausted=true;advance(runner,3,input(['KeyW','ShiftLeft']));expect(-runner.velocity[2]).toBeCloseTo(CHARACTER.walkSpeed);
  });
  it('keeps underwater tree collisions and simulation stable across frame rates',()=>{
    const environment:CharacterEnvironment={...ocean,colliders:()=>[{x:0,z:-3,radius:.5,bottom:-20,top:10,kind:'tree'}]};
    for(const fps of [15,60,144]){const c=swimmer(environment);advance(c,2,input(['KeyW']),fps);expect(c.feet[2]).toBeGreaterThanOrEqual(-3+.5+CHARACTER.radius);expect(c.feet.every(Number.isFinite)).toBe(true);}
  });
});
describe('underwater world',()=>{
  const world=new WorldGenerator({seed:'island-z',islandSizeMeters:30720});
  it('gets deeper beyond the shelf and streams offshore without growing the retained selection',()=>{
    const distances=[16000,18000,25000,40000],depths=distances.map(x=>world.height(x,0));
    for(let i=1;i<depths.length;i++)expect(depths[i]).toBeLessThan(depths[i-1]);expect(depths.at(-1)).toBeLessThan(-1000);
    for(const x of [18000,40000,100000]){const roots=selectTiles(x,0,30720,6500);expect(playerPriority(roots,x,0).size).toBeLessThan(180);expect(playerPriority(roots,x,0).has(`${Math.floor(x/64)*64}:0:0`)).toBe(true);expect(world.surfaceWater(x,0)).toEqual({level:0,kind:'ocean',offshoreMeters:-world.coastDistance(x,0)});}
  });
  it('places deterministic algae on submerged shallow beds, excluding distant scenery',()=>{
    const lake=world.water.lakes[0],x=Math.floor(lake.x/64)*64,z=Math.floor(lake.z/64)*64;
    const all=world.props(x-128,z-128,256).filter(p=>p.kind==='algae');expect(all.length).toBeGreaterThan(0);
    const pieces=[];for(let dz=-128;dz<128;dz+=64)for(let dx=-128;dx<128;dx+=64)pieces.push(...world.props(x+dx,z+dz,64).filter(p=>p.kind==='algae'));
    const order=(a:any,b:any)=>a.x-b.x||a.z-b.z;expect(pieces.sort(order)).toEqual(all.sort(order));
    for(const p of all){const water=world.surfaceWater(p.x,p.z)!;expect(water.level-world.height(p.x,p.z)).toBeGreaterThanOrEqual(.8);expect(world.sample(p.x,p.z).normal[1]).toBeGreaterThanOrEqual(.8);}
    expect(world.props(x-128,z-128,256,false).some(p=>p.kind==='algae')).toBe(false);
  });
});

function advanceVitals(c:Character,seconds:number){let elapsed=0;for(;elapsed+1/120<=seconds+1e-8;elapsed+=1/120)c.update(1/120,idleInput);if(seconds-elapsed>1e-8)c.update(seconds-elapsed,idleInput);}
