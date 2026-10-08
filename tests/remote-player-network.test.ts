import {describe,expect,it,vi} from 'vitest';
import {capsuleGeometry} from '../client/player-geometry';
import {closeForReconnect,RECONNECT_CLOSE_CODE} from '../client/socket-close';

describe('remote multiplayer client',()=>{
  it('uses a material registered by the renderer for remote player capsules',()=>{
    const capsule=capsuleGeometry();
    expect(capsule.material).toBe('rock');
    expect(capsule.indices.length).toBeGreaterThan(0);
  });
  it('uses a browser-valid private WebSocket close code for resynchronization',()=>{
    expect(RECONNECT_CLOSE_CODE).toBeGreaterThanOrEqual(3000);
    expect(RECONNECT_CLOSE_CODE).toBeLessThanOrEqual(4999);
    const close=vi.fn();
    for(const reason of ['Send queue full','Region replay queue exceeded','Prediction queue exceeded']){
      closeForReconnect({close},reason);
      expect(close).toHaveBeenLastCalledWith(RECONNECT_CLOSE_CODE,reason);
    }
    expect(close).toHaveBeenCalledTimes(3);
  });
  it('does not fail when a socket has not been created',()=>{
    expect(()=>closeForReconnect(undefined,'Prediction queue exceeded')).not.toThrow();
  });
});
