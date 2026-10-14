import {describe,expect,it} from 'vitest';
import {describeHud,describeTargetAction,itemDisplayName,shouldSampleTarget,targetSampleKey,type TargetSampleState} from '../client/interaction-context';

const sampleState=(overrides:Partial<TargetSampleState>={}):TargetSampleState=>({position:[1,2,3],yaw:.2,pitch:-.1,sceneRevision:4,repair:false,rightArmUsable:true,ready:true,menuOpen:false,pointerLocked:true,worldIdentity:'world-a',connectionState:'Connected',...overrides});

describe('interaction HUD context',()=>{
  it('keeps a 10 Hz target refresh rate while re-keying stationary health changes',()=>{
    const healthy=targetSampleKey(sampleState()),injured=targetSampleKey(sampleState({rightArmUsable:false}));
    expect(healthy).not.toBe(injured);
    expect(shouldSampleTarget(1000,900,healthy,healthy)).toBe(false);
    expect(shouldSampleTarget(1000,950,injured,healthy)).toBe(false);
    expect(shouldSampleTarget(1050,950,injured,healthy)).toBe(true);
    expect(shouldSampleTarget(1050,950,injured,injured)).toBe(false);
  });

  it('uses item names and gather controls when no buildable item is selected',()=>{
    expect(itemDisplayName('wood')).toBe('Wood');
    expect(itemDisplayName('bandage',undefined,'Bandage')).toBe('Bandage');
    expect(itemDisplayName('crutches',undefined,'Crutches')).toBe('Crutches');
    expect(describeHud({itemName:'Hands',pending:false})).toEqual({hint:'Hands',controls:'Right-click gather · Hold R repair · E inventory · 1–9 select'});
  });

  it('keeps placement rejection reasons visible beside build controls',()=>{
    expect(describeHud({itemName:'Wood floor',placementReason:'The ground is too steep',pending:false,buildControls:'Click place · T / Wheel tilt'})).toEqual({hint:'Wood floor · The ground is too steep',controls:'Click place · T / Wheel tilt · Right-click gather/cut/dismantle · Hold R repair'});
  });

  it('puts door and desk actions ahead of placement controls',()=>{
    expect(describeHud({itemName:'Wall',pending:false,buildControls:'Click place · T turn',target:'Crafting desk · E use'}).controls).toBe('Crafting desk · E use · Click place · T turn · Hold R repair');
  });

  it('names resource actions and gives doors and desks their primary key action',()=>{
    const ready={repair:false,rightArmUsable:true,worldIdentity:'world-a',connectionState:'Connected'};
    expect(describeTargetAction({name:'Ground',kind:'terrain',mode:'voxel'},ready)).toBe('Ground · Right-click mine');
    expect(describeTargetAction({name:'Oak',kind:'tree',mode:'voxel'},ready)).toBe('Oak · Right-click cut');
    expect(describeTargetAction({name:'Crafting desk',kind:'solid',mode:'whole',desk:true},ready)).toBe('Crafting desk · E use · Right-click dismantle');
    expect(describeTargetAction({name:'Wood door',kind:'solid',mode:'whole',doorOpen:false},ready)).toBe('Wood door · F open · Right-click dismantle');
  });
  it('permits repairable walls and explains interaction reach and injury limits',()=>{
    const ready={repair:false,rightArmUsable:true,canBuild:true,worldIdentity:'world-a',connectionState:'Connected'};
    expect(describeTargetAction({name:'Wood wall',kind:'solid',mode:'voxel',repairable:true},{...ready,repair:true})).toBe('Wood wall · Hold R repair');
    expect(describeTargetAction({name:'Rock',kind:'rock',mode:'voxel'},{...ready,repair:true})).toContain('Repair built walls and roofs');
    expect(describeTargetAction({name:'Desk',kind:'solid',mode:'whole',desk:true,interactionOutOfReach:true},ready)).toContain('Move within 3 m to interact');
    expect(describeTargetAction({name:'Door',kind:'solid',mode:'whole',doorOpen:false},{...ready,canBuild:false})).toContain('Your injuries prevent using this door');
    expect(describeTargetAction({name:'Grass',kind:'solid'},ready)).toBe('Grass · No gathering action');
  });

});
