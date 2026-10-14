export const BODY_PARTS = ['head', 'chest', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type BodyPart = typeof BODY_PARTS[number];
export type Bleeding = 'none' | 'light' | 'moderate' | 'heavy';
export interface PartHealth {
  hp: number;
  bleeding: Bleeding;
  /** Seconds until this bleed naturally clots. */
  bleedingTime?: number;
  /** Seconds until passive healing may start. */
  injuryTime?: number;
  /** Seconds of accelerated healing remaining from a bandage. */
  bandagedTime?: number;
  /** Temporary or dormant injury ceiling; bandaging or its timer may lift it. */
  healingCap?: number;
  healingCapTime?: number;
}
export type BodyHealth = Record<BodyPart, PartHealth>;
export interface Damage { part: BodyPart; amount: number; bleeding?: Bleeding }
export interface HealthEffects {
  speedMultiplier: number;
  crawling: boolean;
  crawlBlocked: boolean;
  canWalk: boolean;
  canBuild: boolean;
  canUseCrutches: boolean;
  rightArmUsable: boolean;
  leftArmUsable: boolean;
  offhandUsable: boolean;
  oxygenCapacityMultiplier: number;
}
const BLEED_RATE: Record<Bleeding, number> = {none:0,light:.08,moderate:.28,heavy:.72};
const BLEED_DURATION: Record<Bleeding, number> = {none:0,light:20,moderate:120,heavy:0};
export const cloneBodyHealth = (body:BodyHealth):BodyHealth => Object.fromEntries(BODY_PARTS.map(part=>[part,{...body[part]}])) as BodyHealth;
const clone=cloneBodyHealth;
export function healthyBody():BodyHealth {
  return Object.fromEntries(BODY_PARTS.map(part=>[part,{hp:100,bleeding:'none'}])) as BodyHealth;
}
export function validBodyHealth(value:unknown):value is BodyHealth {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==BODY_PARTS.length||BODY_PARTS.some(p=>!Object.hasOwn(v,p)))return false;
  for(const part of BODY_PARTS) {
    const p=v[part] as PartHealth;
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['hp','bleeding','bleedingTime','injuryTime','bandagedTime','healingCap','healingCapTime'].includes(k)))return false;
    if(!Number.isFinite(p.hp)||p.hp<0||p.hp>100||!['none','light','moderate','heavy'].includes(p.bleeding))return false;
    for(const timer of ['bleedingTime','injuryTime','bandagedTime','healingCapTime'] as const)if(p[timer]!==undefined&&(!Number.isFinite(p[timer])||p[timer]<0||p[timer]>3600))return false;
    if(p.bleeding==='none'&&(p.bleedingTime??0)>0)return false;
    if(p.healingCap!==undefined&&(!Number.isFinite(p.healingCap)||p.healingCap<0||p.healingCap>100))return false;
    if(p.healingCapTime!==undefined&&p.healingCap===undefined)return false;
  }
  return true;
}
export function applyDamage(body:BodyHealth,damage:Damage):BodyHealth {
  if(!validBodyHealth(body)||!BODY_PARTS.includes(damage.part)||!Number.isFinite(damage.amount)||damage.amount<0)return clone(body);
  const result=clone(body),part=result[damage.part],amount=Math.min(100,damage.amount);
  part.hp=Math.max(0,part.hp-amount);part.injuryTime=Math.max(part.injuryTime??0,8);
  if(damage.bleeding&&damage.bleeding!=='none') {
    const rank={none:0,light:1,moderate:2,heavy:3};
    if(rank[damage.bleeding]>rank[part.bleeding])part.bleeding=damage.bleeding;
    if(part.bleeding==='heavy'){delete part.bleedingTime;part.healingCap=70;delete part.healingCapTime;}
    else part.bleedingTime=Math.max(part.bleedingTime??0,BLEED_DURATION[part.bleeding]);
  }
  return result;
}
export function advanceHealth(body:BodyHealth,dt:number,options:{allowNaturalHealing?:boolean}={}):BodyHealth {
  if(!validBodyHealth(body))return healthyBody();
  if(!Number.isFinite(dt)||dt<=0)return clone(body);
  const result=clone(body),seconds=Math.min(dt,3600);
  for(const part of BODY_PARTS) {
    const p=result[part];let remaining=seconds;
    while(remaining>1e-9) {
      let step=remaining;
      for(const timer of ['injuryTime','bandagedTime','healingCapTime'] as const) {
        const t=p[timer];if(t!==undefined&&t>1e-9)step=Math.min(step,t);
      }
      if(p.bleeding!=='heavy'&&(p.bleedingTime??0)>1e-9)step=Math.min(step,p.bleedingTime!);
      if(p.bleeding==='heavy'||(p.bleedingTime??0)>1e-9) {
        p.hp=Math.max(0,p.hp-BLEED_RATE[p.bleeding]*step);
      } else if(options.allowNaturalHealing!==false&&(p.injuryTime??0)<=1e-9&&p.hp<100) {
        const rate=(p.bandagedTime??0)>1e-9?1.2:.22,cap=p.healingCap??100;
        if(p.hp<cap)p.hp=Math.min(cap,p.hp+rate*step);
      }
      for(const timer of ['injuryTime','bandagedTime','healingCapTime'] as const) {
        if(p[timer]!==undefined){p[timer]=Math.max(0,p[timer]!-step);if(p[timer]===0){delete p[timer];if(timer==='healingCapTime')delete p.healingCap;}}
      }
      if(p.bleeding!=='heavy'&&p.bleedingTime!==undefined){p.bleedingTime=Math.max(0,p.bleedingTime-step);if(p.bleedingTime===0){if(p.bleeding==='light'){p.bleeding='none';delete p.bleedingTime;}else if(p.bleeding==='moderate')p.healingCap=70;}}
      remaining-=step;
    }
  }
  return result;
}
export function applyBandage(body:BodyHealth,part:BodyPart):BodyHealth {
  if(!validBodyHealth(body)||!BODY_PARTS.includes(part))return clone(body);
  const result=clone(body),p=result[part],wasHeavy=p.bleeding==='heavy';p.bleeding='none';delete p.bleedingTime;p.injuryTime=Math.min(p.injuryTime??0,1);p.bandagedTime=Math.max(p.bandagedTime??0,60);
  if(wasHeavy){p.healingCap=70;p.healingCapTime=p.healingCapTime??180;}else if(p.healingCap===70&&p.healingCapTime!==undefined){/* Keep an existing heavy-wound cap until its timer expires. */}else{delete p.healingCap;delete p.healingCapTime;}
  return result;
}
export function deriveHealthEffects(body:BodyHealth,hands:{right?:string;left?:string}={}):HealthEffects {
  const hp=(part:BodyPart)=>body[part]?.hp??100,head=hp('head'),chest=hp('chest'),leftLeg=hp('leftLeg'),rightLeg=hp('rightLeg'),leftArm=hp('leftArm'),rightArm=hp('rightArm');
  const crutches=(hands.right==='crutches'||hands.left==='crutches');
  const canUseCrutches=crutches&&head>25&&chest>20&&leftArm>30&&rightArm>30&&(leftLeg>=70||rightLeg>=70);
  const badlyHurtLeg=leftLeg<=30||rightLeg<=30;
  const fatal=head<=0||chest<=0,criticalChest=chest<=20;
  const canWalk=!fatal&&!criticalChest&&(!badlyHurtLeg||canUseCrutches);
  const crawlBlocked=fatal||leftArm<=30&&rightArm<=30;
  const crawling=!canWalk||criticalChest;
  const worstLeg=Math.min(leftLeg,rightLeg);
  const speedMultiplier=canWalk?Math.max(.32,.55+.0045*worstLeg):crawlBlocked?0:Math.max(.08,.12+.003*Math.min(leftArm,rightArm));
  const rightArmUsable=rightArm>30&&head>25,leftArmUsable=leftArm>30&&head>25;
  const offhandUsable=leftArmUsable;
  return {speedMultiplier,crawling,crawlBlocked,canWalk,canBuild:!fatal&&head>25&&chest>20&&rightArmUsable,canUseCrutches,rightArmUsable,leftArmUsable,offhandUsable,oxygenCapacityMultiplier:Math.max(.45,.45+.0055*chest)};
}
