import type {PlayerCamera} from './camera';
import {itemIcon} from './item-icons';
import {objectRegistry} from '../shared/object-registry';
import {craftRecipe,recipes as inventoryRecipes,type InventoryState,type ItemStack,type Recipe} from '../shared/inventory';
type InventorySlot=ItemStack;
type InventoryRecipe=Recipe;
export interface InventoryActions {
  getInventory:()=>InventoryState|undefined;
  getSelected:()=>number;
  select:(slot:number)=>void;
  craft:(recipeId:string,stationId?:string)=>Promise<unknown>;
  move:(from:number,to:number)=>Promise<unknown>;
  isConnected:()=>boolean;
  onOpenChange?:(open:boolean)=>void;
}

const itemNames:Record<string,string>={wood:'Wood',stone:'Stone',dirt:'Dirt',sand:'Sand',rock:'Rock',tree:'Tree'};
const label=(id:string)=>itemNames[id]??objectRegistry.get(id)?.label??id.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const icon=itemIcon;
const stateOf=(slots:(InventorySlot|null)[]):InventoryState=>({revision:0,slots});

const bodySvg=`<svg class="inv-body-svg" viewBox="0 0 180 300" role="img" aria-label="Player body health"><defs><linearGradient id="body-shade" x2="0" y2="1"><stop stop-color="#d4cdb9"/><stop offset="1" stop-color="#8d9e91"/></linearGradient></defs><circle class="body-part body-head" cx="90" cy="39" r="24"/><path class="body-part body-torso" d="M64 73 Q90 62 116 73 L123 157 Q90 173 57 157Z"/><path class="body-part body-arm" d="M59 77 43 83 24 151 Q21 162 30 165 Q39 168 43 157 L69 104Z"/><path class="body-part body-arm" d="m121 77 16 6 19 68q3 11-6 14-9 3-13-8l-26-53Z"/><path class="body-part body-leg" d="m63 157 27 7-3 82-10 39q-2 10-12 7-9-2-6-12l9-37Z"/><path class="body-part body-leg" d="m90 164 27-7 5 86 10 37q2 10-8 12-9 2-12-8l-19-38Z"/><path class="body-seam" d="M90 18v43M64 91q26 13 52 0M90 68v94M60 160q30 10 60 0"/></svg>`;

/** Owns the inventory window while leaving world input and inventory authority with the game controllers. */
export class InventoryController {
  private root:HTMLElement;
  private abort=new AbortController();
  private opened=false;
  private stationId?:string;
  private tab:'health'|'craft'='health';
  private moving:number|null=null;
  private busy=new Set<string>();
  private health=100;
  private signature='';
  private hotbarSignature='';
  private notice='';
  private readonly hotbar:HTMLElement;
  constructor(readonly camera:PlayerCamera,readonly actions:InventoryActions) {
    this.hotbar=document.getElementById('hotbar')!;
    if(!this.hotbar.querySelector('[data-slot]'))this.hotbar.innerHTML=Array.from({length:9},(_,i)=>`<button class="hotbar-slot" type="button" data-slot="${i}" aria-label="${i+1}: Empty slot" aria-pressed="false"><span class="slot-number">${i+1}</span><span class="slot-label">${i===8?'Hands':'Empty'}</span></button>`).join('');
    this.root=document.createElement('section');this.root.className='inventory-window-layer';this.root.hidden=true;
    this.root.innerHTML=`<div class="inventory-scrim"></div><section class="inventory-window" role="dialog" aria-modal="true" aria-labelledby="inventory-title" aria-describedby="inventory-help" tabindex="-1"><header class="inventory-header"><div><div class="inventory-eyebrow">FIELD KIT / PLAYER STORAGE</div><h2 id="inventory-title">Inventory</h2><p id="inventory-subtitle">Your essentials, ready at hand.</p></div><button class="inventory-close" type="button" aria-label="Close inventory" title="Close · Escape">×</button></header><div class="inventory-layout"><aside class="inventory-side"><div class="inventory-tabs" role="tablist" aria-label="Inventory sections"><button type="button" role="tab" data-tab="health" aria-selected="true">Health</button><button type="button" role="tab" data-tab="craft" aria-selected="false">Craft</button></div><div class="inventory-notice" role="status" aria-live="polite"></div><div class="inventory-side-content"></div></aside><main class="inventory-storage"><div class="storage-heading"><div><span class="section-kicker">CARRIED ITEMS</span><h3>Pack</h3></div><span class="storage-count"></span></div><div class="inventory-grid" role="grid" aria-label="Twenty pack slots"></div><p id="inventory-help" class="inventory-help">Select a slot, then another to move or swap items. Press Escape to close.</p></main></div></section>`;
    document.getElementById('app')!.append(this.root);
    const opts={signal:this.abort.signal};
    this.root.addEventListener('click',e=>this.handleClick(e),opts);
    this.root.addEventListener('keydown',e=>this.handleKey(e),opts);
    window.addEventListener('keydown',e=>{if(e.code==='Escape'&&this.opened){e.preventDefault();this.close();}},opts);
    this.hotbar.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-slot]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();const index=Number(button.dataset.slot);if(this.opened)void this.pick(index);else this.actions.select(index);}, {capture:true,signal:this.abort.signal});
    this.renderHotbar();
  }
  get isOpen(){return this.opened;}
  open(stationId?:string){if(this.opened){if(stationId!==undefined){this.stationId=stationId;this.tab='craft';this.signature='';}this.render();return;}this.opened=true;this.stationId=stationId;this.tab=stationId?'craft':'health';this.notice='';this.moving=null;this.signature='';if(document.pointerLockElement===this.camera.canvas)document.exitPointerLock();this.root.hidden=false;document.body.classList.add('inventory-open');this.actions.onOpenChange?.(true);this.render();requestAnimationFrame(()=>this.root.querySelector<HTMLElement>('.inventory-window')?.focus());}
  close(){if(!this.opened)return;this.opened=false;this.moving=null;this.root.hidden=true;document.body.classList.remove('inventory-open');this.actions.onOpenChange?.(false);this.hotbar.querySelector<HTMLElement>(`[data-slot="${this.actions.getSelected()}"]`)?.focus();}
  toggle(){this.opened?this.close():this.open();}
  update(state:InventoryState,health:number){this.health=Math.max(0,Math.min(100,Number.isFinite(health)?health:100));const selected=this.actions.getSelected(),barSig=`${state.revision}/${selected}/${JSON.stringify(state.slots.slice(0,9))}`;if(barSig!==this.hotbarSignature){this.hotbarSignature=barSig;this.renderHotbar(state,selected);}if(this.opened)this.render(state);}
  dispose(){this.close();this.abort.abort();this.root.remove();}
  private renderHotbar(state=this.actions.getInventory(),selected=this.actions.getSelected()) {
    this.hotbar.querySelectorAll<HTMLElement>('[data-slot]').forEach((el,i)=>{const slot=state?.slots[i]??null;let symbol=el.querySelector<HTMLElement>('.slot-label');if(!symbol)return;symbol.textContent=slot?label(slot.item):i===8?'Hands':'Empty';el.setAttribute('aria-label',`${i+1}: ${slot?`${label(slot.item)}, ${slot.count}`:i===8?'Hands':'Empty slot'}`);el.setAttribute('aria-pressed',String(i===selected));el.classList.toggle('selected',i===selected);let qty=el.querySelector<HTMLElement>('.slot-quantity');if(!qty){qty=document.createElement('span');qty.className='slot-quantity';el.append(qty);}qty.textContent=slot&&slot.count>1?String(slot.count):'';let glyph=el.querySelector<HTMLElement>('.slot-item-glyph');if(!glyph){glyph=document.createElement('span');glyph.className='slot-item-glyph';el.append(glyph);}glyph.innerHTML=slot?icon(slot.item):'';});
  }
  private render(state=this.actions.getInventory()){
    if(!this.opened)return;const slots=state?.slots??Array.from({length:29},()=>null),offset=9,pack=slots.slice(offset,offset+20);while(pack.length<20)pack.push(null);
    const mode=this.stationId?'Workbench':'Inventory';
    const sig=`${state?.revision}/${this.health}/${this.tab}/${this.stationId}/${this.moving}/${this.actions.isConnected()}/${this.busy.size}/${JSON.stringify(slots)}`;if(sig===this.signature)return;this.signature=sig;
    this.root.querySelector('#inventory-title')!.textContent=mode;this.root.querySelector('#inventory-subtitle')!.textContent=this.stationId?'A sturdy surface for useful work.':'Your essentials, ready at hand.';
    const side=this.root.querySelector<HTMLElement>('.inventory-side-content')!;
    this.root.querySelector<HTMLElement>('.inventory-notice')!.textContent=this.notice;
    if(this.tab==='health')side.innerHTML=`<div class="health-card"><div class="health-caption"><span class="section-kicker">CONDITION</span><strong>${Math.round(this.health)}<small> / 100</small></strong></div><div class="health-bar" role="progressbar" aria-label="Health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(this.health)}"><i style="width:${this.health}%"></i></div><div class="body-wrap">${bodySvg}<span class="body-health-note">Healthy</span></div><p class="side-note">Head · Torso · Arms · Legs</p></div>`;
    else this.renderRecipes(side,slots);
    const grid=this.root.querySelector<HTMLElement>('.inventory-grid')!;grid.innerHTML=pack.map((slot,i)=>this.slotMarkup(i+offset,slot)).join('');
    this.root.querySelector('.storage-count')!.textContent=`${pack.filter(Boolean).length} / 20 occupied`;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.tab===this.tab)));
    this.root.querySelector<HTMLElement>('.inventory-help')!.textContent=this.moving===null?'Select a slot, then another to move or swap items. Press Escape to close.':`Moving ${label(slots[this.moving]?.item??'item')} · choose a destination.`;
  }
  private slotMarkup(index:number,slot:InventorySlot|null){const selected=this.moving===index?' moving':'';return `<button class="inventory-slot${slot?' occupied':''}${selected}" type="button" role="gridcell" data-slot="${index}" aria-label="${index+1}: ${slot?`${label(slot.item)}, ${slot.count}`:'Empty'}${selected?' · selected to move':''}"><span class="inventory-slot-number">${String(index<9?index+1:index-8).padStart(2,'0')}</span>${slot?`<span class="inventory-item-icon" aria-hidden="true">${icon(slot.item)}</span><span class="inventory-item-name">${label(slot.item)}</span><span class="inventory-item-count">${slot.count}</span>`:''}</button>`;}
  private renderRecipes(side:HTMLElement,slots:(InventorySlot|null)[]){const recipes=inventoryRecipes.filter(r=>!this.stationId?r.station==='hand':r.station==='desk'||r.station==='hand');if(!recipes.length){side.innerHTML='<div class="recipe-empty"><span class="recipe-empty-icon">✳</span><h3>No recipes yet</h3><p>Gather materials to discover useful things to make.</p></div>';return;}
    const connected=this.actions.isConnected(),inventory=stateOf(slots);side.innerHTML=`<div class="recipe-heading"><span class="section-kicker">${this.stationId?'WORKBENCH RECIPES':'QUICK CRAFT'}</span><span>${recipes.length} available</span></div><div class="recipe-grid">${recipes.map(r=>{const counts=new Map<string,number>();for(const slot of slots)if(slot)counts.set(slot.item,(counts.get(slot.item)??0)+slot.count);const enough=Object.entries(r.cost).every(([id,n])=>(counts.get(id)??0)>=n),fits=!!craftRecipe(inventory,r.id),key=`${this.stationId??'hand'}:${r.id}`,busy=this.busy.has(key),cost=Object.entries(r.cost).map(([id,n])=>`<span class="recipe-cost${(counts.get(id)??0)<n?' short':''}">${icon(id)} ${label(id)} <b>${counts.get(id)??0}/${n}</b></span>`).join('');return `<article class="recipe-card"><div class="recipe-result"><span class="recipe-result-icon">${icon(r.output.item)}</span><div><h3>${r.label}</h3><p>Creates ${r.output.count} ${label(r.output.item)}</p></div></div><div class="recipe-costs">${cost}${enough&&!fits?'<span class="recipe-cost short">Pack full</span>':''}</div><button type="button" class="craft-button" data-craft="${r.id}" ${!enough||!fits||busy||!connected?'disabled':''}>${busy?'Making…':connected?'Craft':'Reconnecting'}</button></article>`;}).join('')}</div>`;
  }
  private handleClick(event:MouseEvent){const target=event.target as HTMLElement;if(target.closest('.inventory-close')||target.classList.contains('inventory-scrim')){this.close();return;}const tab=target.closest<HTMLElement>('[data-tab]');if(tab){this.tab=tab.dataset.tab as 'health'|'craft';this.signature='';this.render();return;}const craft=target.closest<HTMLElement>('[data-craft]');if(craft){void this.craft(craft.dataset.craft!);return;}const slot=target.closest<HTMLElement>('[data-slot]');if(slot){event.preventDefault();void this.pick(Number(slot.dataset.slot));}}
  private async pick(index:number){if(!Number.isInteger(index)||index<0||index>=29)return;const state=this.actions.getInventory();if(!state)return;if(this.moving===null){if(!state.slots[index]){this.actions.select(index);return;}this.moving=index;this.signature='';this.render(state);return;}if(this.moving===index){this.moving=null;this.signature='';this.render(state);return;}const from=this.moving;this.moving=null;this.signature='';this.render(state);try{const result=await this.actions.move(from,index);this.reportResult(result);}catch(error){this.showNotice(error instanceof Error?error.message:'Move failed');}}
  private async craft(id:string){const recipe=inventoryRecipes.find(r=>r.id===id);if(!recipe)return;const stationId=recipe.station==='desk'?this.stationId:undefined,key=`${this.stationId??'hand'}:${id}`;if(this.busy.has(key)||!this.actions.isConnected())return;this.busy.add(key);this.signature='';this.render();try{const result=await this.actions.craft(id,stationId);this.reportResult(result);}catch(error){this.showNotice(error instanceof Error?error.message:'Craft failed');}finally{this.busy.delete(key);this.signature='';this.render();}}
  private reportResult(result:unknown){if(result&&typeof result==='object'&&'ok'in result&&(result as {ok?:unknown}).ok===false){this.showNotice(String((result as {error?:unknown}).error??'The action could not be completed.'));return;}this.notice='';this.signature='';this.render();}
  private showNotice(message:string){this.notice=message;this.signature='';this.render();}
  private handleKey(event:KeyboardEvent){if(!this.opened)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}if(event.key==='Tab'){const items=[...this.root.querySelectorAll<HTMLElement>('button:not(:disabled)')],first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
}
