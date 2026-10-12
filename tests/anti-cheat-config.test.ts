import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseAntiCheatEnabled} from '../server/anti-cheat-config';

it('defaults anti-cheat to enabled and accepts only explicit true or false values',()=>{
  expect(parseAntiCheatEnabled(undefined)).toBe(true);
  expect(parseAntiCheatEnabled('true')).toBe(true);
  expect(parseAntiCheatEnabled(' FALSE ')).toBe(false);
  expect(()=>parseAntiCheatEnabled('0')).toThrow('ANTI_CHEAT_ENABLED must be true or false.');
});

it('loads local environment values without replacing variables already supplied by the process',()=>{
  const key='ISLAND_Z_TEST_ANTI_CHEAT',previous=process.env[key],directory=mkdtempSync(join(tmpdir(),'island-env-'));
  try{writeFileSync(join(directory,'.env'),'ISLAND_Z_TEST_ANTI_CHEAT=false\n');process.env[key]='true';process.loadEnvFile(join(directory,'.env'));expect(process.env[key]).toBe('true');}
  finally{if(previous===undefined)delete process.env[key];else process.env[key]=previous;rmSync(directory,{recursive:true,force:true});}
});
