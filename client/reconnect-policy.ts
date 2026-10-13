import type {InputStep} from '../shared/network';

export const RECONNECT_PREDICTION_GRACE_MS=2000;
export function mayPredictDuringReconnect(disconnectedAt:number|undefined,now:number){return disconnectedAt!==undefined&&now-disconnectedAt>=0&&now-disconnectedAt<RECONNECT_PREDICTION_GRACE_MS;}
export function trimAcknowledgedInputs(history:InputStep[],ack:number){return history.filter(step=>step.seq>ack);}
