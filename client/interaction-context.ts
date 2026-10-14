export interface TargetSampleState {
  position: ArrayLike<number>;
  yaw: number;
  pitch: number;
  sceneRevision: number;
  repair: boolean;
  rightArmUsable: boolean;
  canBuild?: boolean;
  ready: boolean;
  menuOpen: boolean;
  pointerLocked: boolean;
  worldIdentity: string;
  connectionState: string;
}

/** Includes state that can change while the player and camera remain still. */
export function targetSampleKey(state: TargetSampleState): string {
  return `${Array.from(state.position, n => Number(n).toFixed(3)).join(',')}/${state.yaw.toFixed(3)}/${state.pitch.toFixed(3)}/${state.sceneRevision}/${state.repair}/${state.rightArmUsable}/${state.canBuild}/${state.ready}/${state.menuOpen}/${state.pointerLocked}/${state.worldIdentity}/${state.connectionState}`;
}

export function shouldSampleTarget(now: number, lastSample: number, key: string, previousKey: string): boolean {
  return key !== previousKey && now - lastSample >= 100;
}

export function itemDisplayName(item?: string, buildableLabel?: string, inventoryLabel?: string): string {
  if (buildableLabel) return buildableLabel;
  if (inventoryLabel) return inventoryLabel;
  if (item) return item.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  return 'Hands';
}

export interface TargetDescription {
  name: string;
  kind: 'terrain' | 'rock' | 'tree' | 'solid';
  mode?: 'whole' | 'voxel';
  repairable?: boolean;
  desk?: boolean;
  doorOpen?: boolean;
  interactionOutOfReach?: boolean;
}

export interface TargetActionState {
  repair: boolean;
  rightArmUsable: boolean;
  canBuild?: boolean;
  worldIdentity: string;
  connectionState: string;
}

export function describeTargetAction(target: TargetDescription, state: TargetActionState): string {
  const primary = state.repair ? 'Hold R repair' : target.desk ? 'E use' : target.doorOpen !== undefined ? `F ${target.doorOpen ? 'close' : 'open'}` : !target.mode ? 'No gathering action' : target.kind === 'terrain' || target.kind === 'rock' ? 'Right-click mine' : target.kind === 'tree' ? 'Right-click cut' : target.mode === 'whole' ? 'Right-click dismantle' : 'Right-click cut';
  const secondary = !state.repair && (target.desk || target.doorOpen !== undefined) && target.mode ? ` · Right-click ${target.mode === 'whole' ? 'dismantle' : 'cut'}` : '';
  let blocked = '';
  if (state.repair && !target.repairable) blocked = 'Repair built walls and roofs';
  else if (!state.worldIdentity) blocked = 'Waiting for the world';
  else if (state.connectionState !== 'Connected') blocked = state.connectionState === 'Connecting' ? 'Waiting for the world' : 'Reconnecting';
  else if (!state.repair && target.interactionOutOfReach) blocked = 'Move within 3 m to interact';
  else if (!state.repair && target.doorOpen !== undefined && state.canBuild === false) blocked = 'Your injuries prevent using this door';
  else if (!state.rightArmUsable) blocked = !state.repair && target.desk ? 'Right-click actions need a usable right hand' : 'Your right hand is injured';

  return `${target.name} · ${primary}${secondary}${blocked ? ` · ${blocked}` : ''}`;
}

export function describeHud(input: {
  itemName: string;
  placementReason?: string;
  notice?: string;
  pending: boolean;
  buildControls?: string;
  target?: string;
  interaction?: string;
}): { hint: string; controls: string } {
  const hint = input.notice || `${input.itemName}${input.placementReason ? ` · ${input.placementReason}` : ''}${input.pending ? ' · Saving…' : ''}`;
  const controls = input.target
    ? `${input.target} · ${input.buildControls ? `${input.buildControls} · Hold R repair` : 'Hold R repair · E inventory · 1–9 select'}`
    : input.buildControls
      ? `${input.buildControls} · Right-click gather/cut/dismantle · Hold R repair`
      : 'Right-click gather · Hold R repair · E inventory · 1–9 select';
  if (input.interaction) return {hint: `${hint} · ${input.interaction}`, controls};
  return {hint, controls};
}
