import {it,expect} from 'vitest';
import {stanceAfterGesture} from '../client/stance-controls';
it('uses taps for each stance step and holds for entering crawl or standing directly',()=>{
  expect(stanceAfterGesture('stand',false)).toBe('crouch');expect(stanceAfterGesture('crouch',false)).toBe('stand');expect(stanceAfterGesture('crawl',false)).toBe('crouch');
  expect(stanceAfterGesture('stand',true)).toBe('crawl');expect(stanceAfterGesture('crouch',true)).toBe('crawl');expect(stanceAfterGesture('crawl',true)).toBe('stand');
});
