import {describe,expect,it} from 'vitest';
import {mayPredictDuringReconnect,RECONNECT_PREDICTION_GRACE_MS,trimAcknowledgedInputs} from '../client/reconnect-policy';

describe('reconnect policy',()=>{
 it('allows local prediction only during the short disconnect grace',()=>{
  expect(mayPredictDuringReconnect(undefined,1000)).toBe(false);
  expect(mayPredictDuringReconnect(1000,1000)).toBe(true);
  expect(mayPredictDuringReconnect(1000,1000+RECONNECT_PREDICTION_GRACE_MS-1)).toBe(true);
  expect(mayPredictDuringReconnect(1000,1000+RECONNECT_PREDICTION_GRACE_MS)).toBe(false);
  expect(mayPredictDuringReconnect(1000,999)).toBe(false);
 });

 it('drops only inputs confirmed by the server ack',()=>{
  const history=[1,2,3].map(seq=>({seq,input:{x:0,z:0,sprint:false,jump:false}}));
  expect(trimAcknowledgedInputs(history,2).map(step=>step.seq)).toEqual([3]);
 });
});
