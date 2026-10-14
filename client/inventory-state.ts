import {emptyInventory,validateInventory,consumeItem,craftRecipe,moveInventory,type InventoryState} from '../shared/inventory';

type Operation={kind:string;request:any};
/** Replay outstanding local actions over each private authoritative snapshot. */
export class InventoryPrediction {
  private confirmed=emptyInventory();
  private pending=new Map<string,Operation>();
  state=this.confirmed;
  accept(value:unknown,requestId?:string){
    if(!validateInventory(value))return false;
    if(requestId)this.pending.delete(requestId);
    if(value.revision>=this.confirmed.revision)this.confirmed=value;
    this.replay();return true;
  }
  predict(kind:string,request:any){
    if(kind==='craft'||kind==='move'||kind==='build'&&request.action!=='door'){
      this.pending.set(request.requestId,{kind,request});this.replay();
    }
  }
  settle(requestId:string){this.pending.delete(requestId);this.replay();}
  private replay(){
    let next=this.confirmed;
    for(const {kind,request}of this.pending.values()){
      const result=kind==='craft'?craftRecipe(next,request.recipeId):kind==='move'?moveInventory(next,request.from,request.to,request.count):consumeItem(next,request.definitionId,1);
      if(result)next=result;
    }
    this.state=next;
  }
}
