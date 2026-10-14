export type Stance='stand'|'crouch'|'crawl';
export const STANCE_HOLD_MS=500;
export function stanceAfterGesture(current:Stance,held:boolean):Stance {
  return held?(current==='crawl'?'stand':'crawl'):current==='crawl'?'crouch':current==='crouch'?'stand':'crouch';
}
