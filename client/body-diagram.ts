import {BODY_PARTS, deriveHealthEffects, type BodyHealth, type BodyPart, type Bleeding} from '../shared/health';
import {getTooltipManager, type TooltipManager} from './tooltips';

const partNames: Record<BodyPart, string> = {
  head: 'Head', chest: 'Chest', leftArm: 'Left arm', rightArm: 'Right arm', leftLeg: 'Left leg', rightLeg: 'Right leg',
};
const regionShape: Record<BodyPart, string> = {
  head: '<circle class="body-shape" cx="90" cy="39" r="24"/>',
  chest: '<path class="body-shape" d="M64 73 Q90 62 116 73 L123 157 Q90 173 57 157Z"/>',
  leftArm: '<path class="body-shape" d="M59 77 43 83 24 151 Q21 162 30 165 Q39 168 43 157 L69 104Z"/>',
  rightArm: '<path class="body-shape" d="m121 77 16 6 19 68q3 11-6 14-9 3-13-8l-26-53Z"/>',
  leftLeg: '<path class="body-shape" d="m63 157 27 7-3 82-10 39q-2 10-12 7-9-2-6-12l9-37Z"/>',
  rightLeg: '<path class="body-shape" d="m90 164 27-7 5 86 10 37q2 10-8 12-9 2-12-8l-19-38Z"/>',
};
const bleedLabel: Record<Bleeding, string> = {none: 'No bleeding', light: 'Light bleeding', moderate: 'Moderate bleeding', heavy: 'Heavy bleeding'};
const timerLabel = (seconds?: number) => seconds === undefined ? '' : `about ${Math.ceil(seconds)} seconds`;
const restrictions = (part: BodyPart, health: BodyHealth, effects: ReturnType<typeof deriveHealthEffects>): string[] => {
  if ((part === 'head' || part === 'chest') && health[part].hp <= 0) return ['Fatal injury.'];
  if (part === 'head' && health.head.hp <= 25) return ['Severe head injury prevents building and using crutches.'];
  if (part === 'chest' && health.chest.hp <= 20) return ['Critical chest injury forces crawling and reduces oxygen capacity.'];
  if ((part === 'leftArm' && !effects.leftArmUsable) || (part === 'rightArm' && !effects.rightArmUsable)) return ['Severe arm injury prevents using this hand.'];
  if ((part === 'leftLeg' || part === 'rightLeg') && health[part].hp <= 30) return [effects.canWalk?'Crutches are supporting movement despite this severe leg injury.':'Severe leg injury limits walking; crutches help only when usable.'];
  if ((part === 'leftLeg' || part === 'rightLeg') && health[part].hp < 70) return ['Leg injury slows movement.'];
  return [];
};

export interface BodyDiagramOptions {
  className?: string;
  interactive?: boolean;
  onPartActivate?: (part: BodyPart) => void;
  tooltipManager?: TooltipManager;
}

export interface BodyDiagram {
  readonly element: HTMLElement;
  update(health: BodyHealth, hands?: {right?:string;left?:string}): void;
  dispose(): void;
}

let diagramId = 0;

/** Stable six-part SVG diagram shared by the inventory and compact health HUD. */
export function createBodyDiagram(options: BodyDiagramOptions = {}): BodyDiagram {
  const doc = document;
  const manager = options.tooltipManager ?? getTooltipManager(doc);
  const instance = ++diagramId;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `body-diagram inv-body-svg${options.className ? ` ${options.className}` : ''}`);
  svg.setAttribute('viewBox', '0 0 180 300');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Body health by region');
  svg.innerHTML = `<defs><linearGradient id="body-shade-${instance}" x2="0" y2="1"><stop stop-color="#d4cdb9"/><stop offset="1" stop-color="#8d9e91"/></linearGradient></defs>`;
  for (const part of BODY_PARTS) {
    const group = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('body-region', `body-${part}`);
    if (part === 'chest') group.classList.add('body-torso');
    if (part === 'leftArm' || part === 'rightArm') group.classList.add('body-arm');
    if (part === 'leftLeg' || part === 'rightLeg') group.classList.add('body-leg');
    group.dataset.part = part;
    group.setAttribute('role', options.interactive ? 'button' : 'img');
    group.setAttribute('tabindex', options.interactive ? '0' : '-1');
    group.setAttribute('aria-label', `${partNames[part]}: 100 of 100 health. No bleeding.`);
    group.innerHTML = regionShape[part].replace('class="body-shape"', `class="body-shape" fill="url(#body-shade-${instance})"`);
    const hp = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    hp.classList.add('body-hp');
    hp.setAttribute('text-anchor', 'middle');
    const coords: Record<BodyPart, [number, number]> = {head:[90,43],chest:[90,118],leftArm:[37,125],rightArm:[143,125],leftLeg:[68,218],rightLeg:[112,218]};
    hp.setAttribute('x', String(coords[part][0])); hp.setAttribute('y', String(coords[part][1])); hp.textContent = '100';
    const badge = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    badge.classList.add('body-bleed-badge'); badge.setAttribute('text-anchor', 'middle');
    const badgeCoords: Record<BodyPart, [number, number]> = {head:[110,23],chest:[110,84],leftArm:[39,98],rightArm:[141,98],leftLeg:[78,182],rightLeg:[103,182]};
    badge.setAttribute('x', String(badgeCoords[part][0])); badge.setAttribute('y', String(badgeCoords[part][1]));
    group.append(hp, badge);
    svg.append(group);
    manager.bind(group as unknown as HTMLElement, () => {
      const health = latest;
      if (!health) return null;
      const region = health[part], lines = [`${Math.round(region.hp)} / 100 health`, bleedLabel[region.bleeding]];
      if (region.bleeding === 'moderate' && region.bleedingTime === 0) lines.push('Bleeding has stopped.');
      else if (region.bleeding === 'heavy') lines.push(region.bleedingTime ? `Heavy bleeding continues for ${timerLabel(region.bleedingTime)}.` : 'Heavy bleeding will not stop naturally.');
      else if (region.bleedingTime !== undefined) lines.push(`Bleeding may stop in ${timerLabel(region.bleedingTime)}.`);
      if (region.injuryTime !== undefined) lines.push(`Injury recovery starts in ${timerLabel(region.injuryTime)}.`);
      if (region.bandagedTime !== undefined) lines.push(`Faster healing lasts ${timerLabel(region.bandagedTime)}.`);
      if (region.healingCap !== undefined) lines.push(`Healing is limited to ${Math.round(region.healingCap)} HP${region.healingCapTime === undefined ? '' : ` for ${timerLabel(region.healingCapTime)}`}.`);
      const effects=deriveHealthEffects(health,latestHands),hints = restrictions(part, health,effects);
      if (part === 'head' && health.head.hp < 45) hints.push('Head injury can blur vision.');
      if (part === 'chest') hints.push(`Oxygen capacity: ${Math.round(effects.oxygenCapacityMultiplier * 100)}%.`);
      if (effects.crawling && !effects.crawlBlocked) hints.push('Your injuries force crawling; you cannot stand until they recover.');
      else if (effects.crawlBlocked && !effects.canWalk) hints.push('Your injuries prevent standing and crawling until they recover.');
      else if (effects.canWalk && (part === 'leftLeg' || part === 'rightLeg' || part === 'chest')) hints.push('C lets you choose a crouch or crawl stance when injuries allow standing.');
      if ((part === 'leftArm' && !effects.leftArmUsable) || (part === 'rightArm' && !effects.rightArmUsable)) hints.push('This hand cannot wield items while injured; carried items can still be moved.');
      if (part === 'leftArm' && !effects.offhandUsable) hints.push('Offhand items cannot be used until your left arm recovers.');
      lines.push(...hints);
      return {title: partNames[part], lines};
    });
    if (options.interactive && options.onPartActivate) {
      group.addEventListener('click', () => options.onPartActivate?.(part));
      group.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); options.onPartActivate?.(part); } });
    }
  }
  const seam = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  seam.classList.add('body-seam'); seam.setAttribute('d', 'M90 18v43M64 91q26 13 52 0M90 68v94M60 160q30 10 60 0'); svg.append(seam);
  let latest: BodyHealth | undefined;
  let latestHands:{right?:string;left?:string}={};
  const update = (health: BodyHealth, hands:{right?:string;left?:string}={}) => {
    latest = health;latestHands=hands;
    for (const part of BODY_PARTS) {
      const region = health[part], group = svg.querySelector<SVGGElement>(`[data-part="${part}"]`)!;
      group.classList.toggle('injured', region.hp < 70);
      const activeBleeding=region.bleeding==='heavy'||region.bleeding!=='none'&&(region.bleedingTime??0)>0;
      group.classList.toggle('bleeding', activeBleeding);
      group.classList.toggle('critical', region.hp <= 30);
      const hpText=String(Math.round(region.hp)),hpNode=group.querySelector<SVGTextElement>('.body-hp')!;if(hpNode.textContent!==hpText)hpNode.textContent=hpText;
      const badgeText=!activeBleeding ? '' : region.bleeding === 'light' ? '!' : region.bleeding === 'moderate' ? '!!' : '!!!',badgeNode=group.querySelector<SVGTextElement>('.body-bleed-badge')!;if(badgeNode.textContent!==badgeText)badgeNode.textContent=badgeText;
      let label = `${partNames[part]}: ${Math.round(region.hp)} of 100 health. ${bleedLabel[region.bleeding]}.`;
      if (region.bleeding === 'moderate' && region.bleedingTime === 0) label += ' Bleeding has stopped.';
      else if (region.bleeding === 'heavy' && region.bleedingTime === 0) label += ' Heavy bleeding will not stop naturally.';
      else if (region.bleedingTime !== undefined) label += ` Bleeding may stop in ${timerLabel(region.bleedingTime)}.`;
      if (region.injuryTime !== undefined) label += ` Injury recovery starts in ${timerLabel(region.injuryTime)}.`;
      if (region.bandagedTime !== undefined) label += ` Faster healing lasts ${timerLabel(region.bandagedTime)}.`;
      if (region.healingCap !== undefined) label += ` Healing limited to ${Math.round(region.healingCap)} HP.`;
      if(group.getAttribute('aria-label')!==label)group.setAttribute('aria-label', label);
    }
    manager.refresh();
  };
  const dispose = () => { for (const group of svg.querySelectorAll<SVGGElement>('.body-region')) manager.bind(group as unknown as HTMLElement, () => null)(); };
  return {element: svg as unknown as HTMLElement, update, dispose};
}

export interface BodyHUD {
  readonly element: HTMLElement;
  update(health: BodyHealth, hands?: {right?:string;left?:string}): void;
  dispose(): void;
}

export function createBodyHUD(container?: HTMLElement): BodyHUD {
  const root = document.createElement('section');
  root.className = 'body-health-hud';
  root.setAttribute('aria-label', 'Current body health');
  const title = document.createElement('span'); title.className = 'body-hud-title'; title.textContent = 'BODY';
  const diagram = createBodyDiagram({className:'body-hud-diagram'});
  const list = document.createElement('div'); list.className = 'body-hud-regions';
  for (const part of BODY_PARTS) {
    const item = document.createElement('span'); item.className = 'body-hud-region'; item.dataset.part = part;
    item.setAttribute('aria-label', partNames[part]);
    const abbrev = document.createElement('b'); abbrev.textContent = ({head:'HD',chest:'CH',leftArm:'LA',rightArm:'RA',leftLeg:'LL',rightLeg:'RL'} as const)[part];
    const value = document.createElement('span'); value.className = 'body-hud-hp'; value.textContent = '100';
    item.append(abbrev, value); list.append(item);
  }
  root.append(title, diagram.element, list);
  container?.append(root);
  const update = (health: BodyHealth, hands:{right?:string;left?:string}={}) => {
    diagram.update(health,hands);
    for (const part of BODY_PARTS) {
      const item = list.querySelector<HTMLElement>(`[data-part="${part}"]`)!;
      const region = health[part],value=item.querySelector<HTMLElement>('.body-hud-hp')!,hp=String(Math.round(region.hp));if(value.textContent!==hp)value.textContent=hp;
      item.classList.toggle('injured', region.hp < 70); item.classList.toggle('bleeding', region.bleeding==='heavy'||region.bleeding!=='none'&&(region.bleedingTime??0)>0);
      const label=`${partNames[part]} ${Math.round(region.hp)} health, ${bleedLabel[region.bleeding]}`;if(item.getAttribute('aria-label')!==label)item.setAttribute('aria-label',label);
    }
  };
  const dispose = () => { diagram.dispose(); root.remove(); };
  return {element: root, update, dispose};
}
