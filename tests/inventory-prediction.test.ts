import {it,expect} from 'vitest';
import {InventoryPrediction} from '../client/inventory-state';
import {emptyInventory,addItems,craftRecipe,countItem} from '../shared/inventory';

it('shows crafting immediately and reconciles without spending twice while another action is outstanding',()=>{
  const prediction=new InventoryPrediction(),inventory=addItems(emptyInventory(),'wood',18)!;
  prediction.accept(inventory);prediction.predict('craft',{requestId:'first',recipeId:'wall-wood'});
  prediction.predict('craft',{requestId:'second',recipeId:'crafting-desk'});
  expect(countItem(prediction.state,'wood')).toBe(0);expect(countItem(prediction.state,'wall-wood')).toBe(1);
  const accepted=craftRecipe(inventory,'wall-wood')!;prediction.accept(accepted,'first');
  expect(countItem(prediction.state,'wood')).toBe(0);expect(countItem(prediction.state,'crafting-desk')).toBe(1);
  prediction.settle('second');expect(countItem(prediction.state,'wood')).toBe(10);expect(countItem(prediction.state,'crafting-desk')).toBe(0);
  prediction.accept(inventory);expect(countItem(prediction.state,'wood')).toBe(10);
});

it('reserves placed items and restores them when placement is denied',()=>{
  const prediction=new InventoryPrediction(),inventory=addItems(emptyInventory(),'floor-wood',1)!;
  prediction.accept(inventory);prediction.predict('build',{requestId:'floor',definitionId:'floor-wood'});
  expect(countItem(prediction.state,'floor-wood')).toBe(0);prediction.settle('floor');expect(countItem(prediction.state,'floor-wood')).toBe(1);
  prediction.predict('build',{requestId:'door',action:'door'});expect(countItem(prediction.state,'floor-wood')).toBe(1);
});
