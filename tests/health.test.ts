import {describe,it,expect} from 'vitest';
import {BODY_PARTS,healthyBody,validBodyHealth,applyDamage,advanceHealth,applyBandage,deriveHealthEffects} from '../shared/health';
import {Character,CHARACTER,idleInput,type CharacterCollider,type CharacterEnvironment} from '../shared/character';
import {validCharacterState,validInput} from '../shared/network';
const flat:CharacterEnvironment={surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[]};

describe('body health foundations',()=>{
  it('creates and validates six independent healthy parts',()=>{
    const body=healthyBody();expect(BODY_PARTS).toHaveLength(6);expect(BODY_PARTS.every(part=>body[part].hp===100&&body[part].bleeding==='none')).toBe(true);expect(validBodyHealth(body)).toBe(true);
    expect(validBodyHealth({...body,tail:body.head})).toBe(false);expect(validBodyHealth({...body,head:{hp:101,bleeding:'none'}})).toBe(false);
  });
  it('applies damage immutably, caps HP and bleeding, then heals after injury delay',()=>{
    const start=healthyBody(),hurt=applyDamage(start,{part:'leftArm',amount:140,bleeding:'moderate'});
    expect(start.leftArm.hp).toBe(100);expect(hurt.leftArm).toMatchObject({hp:0,bleeding:'moderate'});expect(hurt.leftArm.bleedingTime).toBeGreaterThan(0);
    const after=advanceHealth(hurt,125);expect(after.leftArm.bleeding).toBe('moderate');expect(after.leftArm.bleedingTime).toBe(0);expect(after.leftArm.healingCap).toBe(70);expect(after.leftArm.hp).toBeGreaterThan(0);
    expect(advanceHealth(after,3).leftArm.hp).toBeGreaterThan(0);
  });
  it('clots light/moderate bleeds at their exact times and leaves heavy bleeding indefinite',()=>{
    const light=applyDamage(healthyBody(),{part:'leftArm',amount:40,bleeding:'light'}),moderate=applyDamage(healthyBody(),{part:'rightArm',amount:40,bleeding:'moderate'}),heavy=applyDamage(healthyBody(),{part:'chest',amount:40,bleeding:'heavy'});
    expect(advanceHealth(light,20).leftArm.bleeding).toBe('none');expect(advanceHealth(light,20).leftArm.hp).toBeCloseTo(58.4,2);
    const clot=advanceHealth(moderate,120).rightArm;expect(clot.bleeding).toBe('moderate');expect(clot.bleedingTime).toBe(0);expect(clot.healingCap).toBe(70);expect(clot.hp).toBeCloseTo(26.4,2);
    expect(heavy.chest.bleedingTime).toBeUndefined();expect(advanceHealth(heavy,3600).chest.bleeding).toBe('heavy');
  });
  it('large and fixed-step health advances agree, including expiring bandage and cap windows',()=>{
    for(const initial of [applyBandage(applyDamage(healthyBody(),{part:'head',amount:40,bleeding:'heavy'}),'head'),applyBandage(applyDamage(healthyBody(),{part:'chest',amount:40,bleeding:'moderate'}),'chest')]){
      const large=advanceHealth(initial,190);let stepped=initial;for(let i=0;i<190*120;i++)stepped=advanceHealth(stepped,1/120);
      for(const part of BODY_PARTS){expect(large[part].hp).toBeCloseTo(stepped[part].hp,5);expect(large[part].bleeding).toBe(stepped[part].bleeding);expect(large[part].healingCap).toBe(stepped[part].healingCap);expect(large[part].healingCapTime??0).toBeCloseTo(stepped[part].healingCapTime??0,5);}
    }
  });
  it('bandages stop bleeding, accelerate healing and retain severe injury caps',()=>{
    const hurt=applyDamage(healthyBody(),{part:'rightLeg',amount:40,bleeding:'heavy'}),bandaged=applyBandage(hurt,'rightLeg');
    expect(hurt.rightLeg.bleedingTime).toBeUndefined();expect(advanceHealth(hurt,3600).rightLeg.bleeding).toBe('heavy');expect(advanceHealth(hurt,60).rightLeg.hp).toBeLessThan(60);expect(advanceHealth(bandaged,60).rightLeg.hp).toBe(70);
    expect(bandaged.rightLeg.bleeding).toBe('none');expect(bandaged.rightLeg.bandagedTime).toBeGreaterThan(0);
    expect(advanceHealth(bandaged,10).rightLeg.hp).toBe(70);expect(advanceHealth(bandaged,30).rightLeg.hp).toBe(70);expect(advanceHealth(bandaged,190).rightLeg.hp).toBeGreaterThan(70);
    const severe=advanceHealth(bandaged,60),rebandaged=applyBandage(severe,'rightLeg');expect(rebandaged.rightLeg.healingCap).toBe(70);expect(rebandaged.rightLeg.healingCapTime).toBeCloseTo(120);
    const moderate=applyBandage(applyDamage(healthyBody(),{part:'head',amount:50,bleeding:'moderate'}),'head');expect(moderate.head.healingCap).toBeUndefined();expect(advanceHealth(moderate,10).head.hp).toBeGreaterThan(50);
  });
  it('derives mobility, hand use, crutch and chest capacity limits',()=>{
    let body=healthyBody();body.leftLeg.hp=25;let effects=deriveHealthEffects(body);
    expect(effects.canWalk).toBe(false);expect(effects.crawling).toBe(true);expect(effects.speedMultiplier).toBeLessThan(1);
    body.rightLeg.hp=65;effects=deriveHealthEffects(body,{right:'crutches'});expect(effects.canWalk).toBe(false);expect(effects.canUseCrutches).toBe(false);
    body.rightLeg.hp=90;effects=deriveHealthEffects(body,{right:'crutches'});expect(effects.canWalk).toBe(true);expect(effects.canUseCrutches).toBe(true);
    body.rightArm.hp=20;effects=deriveHealthEffects(body,{right:'crutches'});expect(effects.rightArmUsable).toBe(false);expect(effects.canBuild).toBe(false);
    body.leftArm.hp=20;body.chest.hp=10;effects=deriveHealthEffects(body);expect(effects.crawlBlocked).toBe(true);expect(effects.crawling).toBe(true);expect(effects.oxygenCapacityMultiplier).toBeLessThan(1);
  });
});

describe('character health integration',()=>{
  it('slows crawling with one unusable arm and collapses when both arms fail',()=>{
    const body=healthyBody();body.leftLeg.hp=10;body.leftArm.hp=20;let effects=deriveHealthEffects(body);expect(effects.crawling).toBe(true);expect(effects.crawlBlocked).toBe(false);expect(effects.speedMultiplier).toBeLessThan(.2);
    body.rightArm.hp=20;effects=deriveHealthEffects(body);expect(effects.crawling).toBe(true);expect(effects.crawlBlocked).toBe(true);expect(effects.speedMultiplier).toBe(0);
  });

  it('keeps walking with two injured arms, but stays finite and immobile when crawling is blocked',()=>{
    const walker=new Character(flat);walker.spawn(0,0,0);walker.damage('leftArm',80);walker.damage('rightArm',80);
    for(let i=0;i<120;i++)walker.update(1/60,{...idleInput,z:-1});expect(walker.feet[2]).toBeLessThan(-1);expect(walker.feet.every(Number.isFinite)).toBe(true);
    const blocked=new Character(flat);blocked.spawn(0,0,0);blocked.damage('leftLeg',80);blocked.damage('rightArm',80);blocked.damage('leftArm',80);
    for(let i=0;i<120;i++)blocked.update(1/60,{...idleInput,z:-1});expect(blocked.feet[2]).toBe(0);expect(blocked.velocity.every(Number.isFinite)).toBe(true);
  });
  it('uses offhand crutches only with a healthy support leg and head, and prevents jumping on them',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.damage('leftLeg',80);c.setHands(undefined,'crutches');expect(c.effects.canUseCrutches).toBe(true);
    for(let i=0;i<120;i++)c.update(1/60,{...idleInput,z:-1});expect(c.feet[2]).toBeLessThan(-1);
    c.restore(c.capture());c.feet.set([0,0,0]);c.velocity.fill(0);c.health.leftLeg.hp=20;c.health.rightLeg.hp=65;c.setHands(undefined,'crutches');expect(c.effects.canUseCrutches).toBe(false);expect(c.effects.canWalk).toBe(false);
    c.health.rightLeg.hp=100;c.damage('head',76);expect(c.effects.canUseCrutches).toBe(false);
    const jump=new Character(flat);jump.spawn(0,0,0);jump.damage('leftLeg',80);jump.setHands(undefined,'crutches');for(let i=0;i<40;i++)jump.update(1/60,{...idleInput,jump:true});expect(jump.feet[1]).toBe(0);
  });
  it('keeps the crawl capsule under a raised floor after healing, then stands after leaving',()=>{
    const roof:CharacterCollider={x:0,z:0,radius:0,bottom:1.3,top:1.5,kind:'wall',floorPlane:{point:[0,1.5,0],normal:[0,1,0],xAxis:[1,0,0],zAxis:[0,0,1],halfWidth:2,halfDepth:2,thickness:.2}};
    const env:CharacterEnvironment={...flat,colliders:()=>[roof]},c=new Character(env);c.spawn(0,0,0);c.damage('leftLeg',80);expect(c.height).toBeLessThan(CHARACTER.height);c.health=healthyBody();c.update(1/60,idleInput);expect(c.crawling).toBe(true);expect(c.height).toBeLessThan(CHARACTER.height);
    for(let i=0;i<120;i++)c.update(1/60,{...idleInput,x:1});expect(c.feet[0]).toBeGreaterThan(2.5);expect(c.crawling).toBe(false);expect(c.height).toBe(CHARACTER.height);
  });
  it('only cushions falls into deep water and keeps ordinary jumps safe',()=>{
    const fall=(waterLevel:number)=>{const env:CharacterEnvironment={...flat,water:()=>({level:waterLevel,kind:'lake'})},c=new Character(env);c.spawn(0,8,0);for(let i=0;i<240;i++)c.update(1/120,idleInput);return c;};
    const shallow=fall(.5),deep=fall(1.5);expect(shallow.health.leftLeg.hp).toBeLessThan(100);expect(deep.health.leftLeg.hp).toBe(100);
    const jump=new Character(flat);jump.spawn(0,0,0);for(let i=0;i<180;i++)jump.update(1/60,{...idleInput,jump:i<60});expect(jump.health.leftLeg.hp).toBe(100);expect(jump.health.rightLeg.hp).toBe(100);
  });
  it('captures health and migrates legacy snapshots without health',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.damage('head',12);const state=c.capture();expect(validCharacterState(state)).toBe(true);expect(state.health?.head.hp).toBe(88);
    const {health:_health,crawling:_crawling,lastDeathCause:_cause,fallStartY:_fy,fallStartX:_fx,fallStartZ:_fz,trustedFallStartY:_tf,drowningTime:_d,...legacy}=state;
    const old=new Character(flat);old.restore(legacy);expect(old.health.head.hp).toBe(100);
    expect(validCharacterState({...state,health:{...state.health,head:{hp:Infinity,bleeding:'none'}}})).toBe(false);
    expect(validCharacterState({...state,posture:'sit'})).toBe(false);
    const {stanceIntent:_intent,...olderLegacy}=legacy,oldCrawling={...olderLegacy,crawling:true};const oldPosture=new Character(flat);oldPosture.restore(oldCrawling);expect(oldPosture.posture).toBe('crawl');
  });
  it('accepts optional hotbar slots and bounds them',()=>{
    expect(validInput({seq:1,input:{x:0,z:0,sprint:false,jump:false}})).toBe(true);
    expect(validInput({seq:2,input:{x:0,z:0,sprint:false,jump:false,slot:8}})).toBe(true);
    expect(validInput({seq:3,input:{x:0,z:0,sprint:false,jump:false,slot:9}})).toBe(false);
    expect(validInput({seq:4,input:{x:0,z:0,sprint:false,jump:false,stance:'crawl'}})).toBe(true);
    expect(validInput({seq:5,input:{x:0,z:0,sprint:false,jump:false,stance:'sit'}})).toBe(false);
  });
  it('keeps manual stances through idle inputs and capture/restore, with posture-specific movement limits',()=>{
    const distance=(stance:'stand'|'crouch'|'crawl')=>{const c=new Character(flat);c.spawn(0,0,0);c.update(1/60,{...idleInput,stance,z:-1});for(let i=0;i<60;i++)c.update(1/60,{...idleInput,z:-1});return c;};
    const stand=distance('stand'),crouch=distance('crouch'),crawl=distance('crawl');
    expect(stand.posture).toBe('stand');expect(stand.stanceName).toBe('Standing');
    expect(crouch.posture).toBe('crouch');expect(crouch.crouching).toBe(true);expect(crouch.stanceName).toBe('Crouching');expect(crouch.height).toBe(1.5);expect(crouch.eyeHeight).toBe(1.25);expect(crouch.sprinting).toBe(false);
    expect(crawl.posture).toBe('crawl');expect(crawl.crawling).toBe(true);expect(crawl.stanceName).toBe('Crawling');expect(crawl.height).toBe(1.05);expect(crawl.eyeHeight).toBe(.82);expect(crawl.sprinting).toBe(false);
    expect(Math.abs(crouch.feet[2])).toBeGreaterThan(Math.abs(crawl.feet[2]));expect(Math.abs(stand.feet[2])).toBeGreaterThan(Math.abs(crouch.feet[2]));
    const sprint=new Character(flat);sprint.spawn(0,0,0);for(let i=0;i<60;i++)sprint.update(1/60,{...idleInput,z:-1,sprint:true});expect(sprint.sprinting).toBe(true);
    const noJump=new Character(flat);noJump.spawn(0,0,0);noJump.update(1/60,{...idleInput,stance:'crouch',jump:true});for(let i=0;i<20;i++)noJump.update(1/60,{...idleInput,jump:true});expect(noJump.feet[1]).toBe(0);
    const persisted=new Character(flat);persisted.restore(crawl.capture());persisted.update(1/60,idleInput);expect(persisted.posture).toBe('crawl');expect(persisted.capture().stanceIntent).toBe('crawl');
    expect(validCharacterState({...stand.capture(),stanceIntent:'sit'})).toBe(false);
  });
  it('enforces forced crawling, crutch posture limits, and blocked manual crawl without blocking walking',()=>{
    const forced=new Character(flat);forced.spawn(0,0,0);forced.damage('leftLeg',80);forced.update(1/60,{...idleInput,stance:'stand'});expect(forced.crawling).toBe(true);
    forced.update(1/60,{...idleInput,stance:'crouch'});expect(forced.crawling).toBe(true);
    const crutch=new Character(flat);crutch.spawn(0,0,0);crutch.setHands(undefined,'crutches');expect(crutch.crutchesEquipped).toBe(true);crutch.update(1/60,{...idleInput,stance:'crouch'});expect(crutch.posture).toBe('stand');expect(crutch.stanceIntent).toBe('stand');
    const blocked=new Character(flat);blocked.spawn(0,0,0);blocked.damage('leftArm',80);blocked.damage('rightArm',80);blocked.update(1/60,{...idleInput,stance:'crawl',z:-1});expect(blocked.posture).toBe('stand');expect(blocked.feet[2]).toBeLessThan(0);
  });
  it('keeps standing posture until the player chooses to duck, then restores stand after clearing the roof',()=>{
    const roof:CharacterCollider={x:0,z:0,radius:0,bottom:1.6,top:1.8,kind:'wall',floorPlane:{point:[0,1.8,0],normal:[0,1,0],xAxis:[1,0,0],zAxis:[0,0,1],halfWidth:1.5,halfDepth:1.5,thickness:.2}};
    const env:CharacterEnvironment={...flat,colliders:(x)=>Math.abs(x)<1.5?[roof]:[]},c=new Character(env);c.spawn(0,0,0);c.update(1/60,idleInput);expect(c.posture).toBe('stand');
    c.update(1/60,{...idleInput,stance:'crouch'});expect(c.posture).toBe('crouch');expect(c.height).toBe(1.5);
    c.update(1/60,{...idleInput,stance:'stand'});expect(c.posture).toBe('crouch');
    const restored=new Character(env);restored.restore(c.capture());expect(restored.stanceIntent).toBe('stand');expect(restored.posture).toBe('crouch');expect(restored.height).toBe(1.5);
    for(let i=0;i<60;i++)c.update(1/60,{...idleInput,x:1});expect(c.posture).toBe('stand');expect(c.height).toBe(CHARACTER.height);
  });
  it('lets an explicit crawl request pass beneath a roof too low for crouching',()=>{
    const roof:CharacterCollider={x:0,z:0,radius:0,bottom:1.2,top:1.4,kind:'wall',floorPlane:{point:[0,1.4,0],normal:[0,1,0],xAxis:[1,0,0],zAxis:[0,0,1],halfWidth:2,halfDepth:2,thickness:.2}};
    const env:CharacterEnvironment={...flat,colliders:()=>[roof]},c=new Character(env);c.spawn(0,0,0);c.update(1/60,{...idleInput,stance:'crawl'});expect(c.posture).toBe('crawl');
    for(let i=0;i<60;i++)c.update(1/60,{...idleInput,x:1});expect(c.feet[0]).toBeGreaterThan(2);expect(c.posture).toBe('crawl');
  });
  it('shortens its capsule and eye height while crawling and checks support server-side',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.update(1/60,idleInput);expect(c.isSupportedAtCurrentFeet()).toBe(true);c.feet[1]=3;expect(c.isSupportedAtCurrentFeet()).toBe(false);c.feet[1]=0;c.damage('leftLeg',80);expect(c.crawling).toBe(true);expect(c.height).toBeLessThan(CHARACTER.height);expect(c.eyeHeight).toBeLessThan(CHARACTER.eyeHeight);
  });
  it('respawns at the saved shore with healthy body and records fatal causes',()=>{
    const chest=new Character(flat);chest.spawn(4,2,6);chest.oxygen=15;chest.stamina=20;chest.damage('chest',100);chest.advanceVitals(.01);expect(chest.respawns).toBe(1);expect(chest.lastDeathCause).toBe('injury');expect(chest.health.chest.hp).toBe(100);expect(chest.oxygen).toBe(CHARACTER.oxygenSeconds);expect(chest.stamina).toBe(CHARACTER.staminaCapacity);expect([...chest.feet]).toEqual([4,2,6]);
    const bleeding=new Character(flat);bleeding.spawn(0,0,0);bleeding.damage('head',100,'heavy');bleeding.advanceVitals(.01);expect(bleeding.respawns).toBe(1);expect(bleeding.lastDeathCause).toBe('bleeding');
    const noHome=new Character(flat);noHome.damage('head',100);noHome.advanceVitals(.01);expect(noHome.health.head.hp).toBe(0);expect(noHome.feet.every(Number.isFinite)).toBe(true);
    const fall=new Character(flat);fall.spawn(0,0,0);fall.applyTrustedLanding([0,30,0],[0,0,0]);fall.advanceVitals(.01);expect(fall.respawns).toBe(1);expect(fall.lastDeathCause).toBe('fall');
  });
  it('damages legs after a meaningful fall consistently across frame rates',()=>{
    for(const fps of [15,30,60,144]){const falling=new Character(flat);falling.spawn(0,8,0);for(let i=0;i<fps*3;i++)falling.update(1/fps,idleInput);expect(falling.health.leftLeg.hp).toBeLessThan(100);expect(falling.health.leftLeg.hp).toBeCloseTo(65,0);}
  });
  it('limits water landings and reconciles trusted falls',()=>{
    const c=new Character(flat);c.spawn(0,0,0);c.applyTrustedLanding([0,8,0],[0,0,0]);expect(c.health.leftLeg.hp).toBeLessThan(100);expect(c.health.leftLeg.bleeding).toBe('light');
    const soft=new Character(flat);soft.spawn(0,0,0);soft.applyTrustedLanding([0,10,0],[0,0,0],true);expect(soft.health.leftLeg.hp).toBe(100);
    const falling=new Character(flat);falling.applyTrustedLanding([0,10,0],[0,8,0],false,false);falling.applyTrustedLanding([0,8,0],[0,0,0],false,true);expect(falling.health.leftLeg.hp).toBeLessThan(100);
  });
  it('scales fall bleeding severity by drop height while safe falls remain clean',()=>{
    const landing=(height:number)=>{const c=new Character(flat);c.applyTrustedLanding([0,height,0],[0,0,0]);return c.health;};
    expect(landing(3).leftLeg.bleeding).toBe('none');expect(landing(8).leftLeg.bleeding).toBe('light');expect(landing(8).chest.bleeding).toBe('light');
    const legModerate=landing(12);expect(legModerate.leftLeg.bleeding).toBe('moderate');
    const moderate=landing(14);expect(moderate.chest.bleeding).toBe('moderate');expect(moderate.head.bleeding).toBe('moderate');
    const heavy=landing(18);expect(heavy.leftLeg.bleeding).toBe('heavy');expect(heavy.chest.bleeding).toBe('heavy');expect(heavy.head.bleeding).toBe('heavy');expect(heavy.leftArm.bleeding).toBe('moderate');
  });
  it('scales oxygen capacity with chest damage and gives a full head ten seconds of rescue grace',()=>{
    let c!:Character;const underwater:CharacterEnvironment={...flat,water:(x)=>x<10?{level:20,kind:'lake'}:null};c=new Character(underwater);c.spawn(20,3,30);c.feet.set([0,0,0]);c.oxygen=0;c.update(1/60,idleInput);
    for(let i=0;i<9*120;i++)c.advanceVitals(1/120);expect(c.health.head.hp).toBeCloseTo(28,0);expect(c.respawns).toBe(0);
    for(let i=0;i<5*120;i++)c.advanceVitals(1/120);expect(c.health.head.hp).toBe(100);expect(c.lastDeathCause).toBe('drowning');expect(c.respawns).toBe(1);expect([...c.feet]).toEqual([20,3,30]);expect(c.oxygen).toBe(CHARACTER.oxygenSeconds);
    const injured=new Character(flat);injured.spawn(0,0,0);injured.damage('chest',50);injured.oxygen=60;injured.advanceVitals(.1);expect(injured.oxygen).toBeCloseTo(CHARACTER.oxygenSeconds*(.45+.0055*50));
  });
});
