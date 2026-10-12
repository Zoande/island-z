export function parseAntiCheatEnabled(value:string|undefined):boolean {
  if(value===undefined)return true;
  const normalized=value.trim().toLowerCase();
  if(normalized==='true')return true;
  if(normalized==='false')return false;
  throw new Error('ANTI_CHEAT_ENABLED must be true or false.');
}
