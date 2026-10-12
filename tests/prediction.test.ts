import {it,expect} from 'vitest';
import {predictionDigest,predictionReply,sameSolidVolume,sameSolidSnapshot,recordFor,actionBrush,brushSeed,volumeRay,type WorldAction,type ActionResult} from '../shared/destruction';
import {SparseVolume} from '../shared/volume';
import {BuildStore} from '../server/build-store';
import {solvePlacement} from '../shared/build-placement';
import {createWorldServer} from '../server/app';
import {buildProp,type BuildRequest} from '../shared/object-registry';
import {WebSocket} from 'ws';
import type {AddressInfo} from 'node:net';

it('uses canonical prediction hints and returns corrections for differences and side effects',()=>{
  const r=recordFor('wall',{kind:'wall-wood',variant:0,x:0,y:0,z:0,scale:1,rotation:0},[]);
  r.volume.bricks={'1:0:0':new Int16Array([1,2]),'0:0:0':new Int16Array([3,4])};const reordered={...r,volume:{...r.volume,bricks:{'0:0:0':new Int16Array([3,4]),'1:0:0':new Int16Array([1,2])}}};
  expect(predictionDigest(r)).toBe(predictionDigest(reordered));
  expect(sameSolidVolume(r,reordered)).toBe(true);
  expect(sameSolidSnapshot(r,reordered)).toBe(true);
  const corrected={...r,volume:{...r.volume,bricks:{...r.volume.bricks,'2:0:0':new Int16Array([5])}}};
  expect(corrected.revision).toBe(r.revision);
  expect(sameSolidVolume(r,corrected)).toBe(false);
  expect(sameSolidSnapshot(r,corrected)).toBe(false);
  const result:ActionResult={ok:true,requestId:'action-one',patch:{revision:5,solids:[r],removedBuilds:[],leveling:[],openings:[]}};
  expect(predictionReply(result,predictionDigest(r))).toHaveProperty('ack.targetId','wall');
  expect(predictionReply(result,predictionDigest({...r,revision:1}))).toBe(result);
  result.patch.openings.push({id:'wall',kind:null});expect(predictionReply(result,predictionDigest(r))).toBe(result);
});
