import type {PlayerCamera} from './camera';
import {itemIcon} from './item-icons';
import {objectRegistry} from '../shared/object-registry';
import {craftRecipe,recipes as inventoryRecipes,type InventoryState,type ItemStack,type Recipe} from '../shared/inventory';
import {BODY_PARTS, deriveHealthEffects, healthyBody, type BodyHealth, type BodyPart} from '../shared/health';
import {createBodyDiagram, createBodyHUD, type BodyDiagram, type BodyHUD} from './body-diagram';
import {getTooltipManager, type TooltipManager} from './tooltips';
type InventorySlot=ItemStack;
type InventoryRecipe=Recipe;
export interface InventoryActions {
  getInventory:()=>InventoryState|undefined;
  getSelected:()=>number;
  select:(slot:number)=>void;
  craft:(recipeId:string,stationId?:string)=>Promise<unknown>;
  move:(from:number,to:number)=>Promise<unknown>;
  bandage:(part:BodyPart,from:number)=>Promise<unknown>;
  isConnected:()=>boolean;
  onOpenChange?:(open:boolean)=>void;
}

const itemNames:Record<string,string>={wood:'Wood',stone:'Stone',dirt:'Dirt',sand:'Sand',rock:'Rock',tree:'Tree'};
const label=(id:string)=>itemNames[id]??objectRegistry.get(id)?.label??id.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const icon=itemIcon;
const stateOf=(slots:(InventorySlot|null)[]):InventoryState=>({revision:0,slots});

/** Owns the inventory window while leaving world input and inventory authority with the game controllers. */
export class InventoryController {
  private root:HTMLElement;
  private abort=new AbortController();
  private opened=false;
  private stationId?:string;
  private tab:'health'|'craft'='health';
  private moving:number|null=null;
  private busy=new Set<string>();
  private health:BodyHealth=healthyBody();
  private hands:{right?:string;left?:string}={};
  private healthDiagram:BodyDiagram;
  private bodyHUD:BodyHUD;
  private readonly tooltipManager:TooltipManager;
  private bandageSource:number|null=null;
  private bandaging=new Set<BodyPart>();
  private signature='';
  private hotbarSignature='';
  private notice='';
  private readonly hotbar:HTMLElement;
  constructor(readonly camera:PlayerCamera,readonly actions:InventoryActions) {
    this.hotbar=document.getElementById('hotbar')!;
    if(!this.hotbar.querySelector('[data-slot]'))this.hotbar.innerHTML=Array.from({length:9},(_,i)=>`<button class="hotbar-slot" type="button" data-slot="${i}" aria-label="${i+1}: Empty slot" aria-pressed="false"><span class="slot-number">${i+1}</span><span class="slot-label">${i===8?'Hands':'Empty'}</span></button>`).join('');
    this.tooltipManager=getTooltipManager();
    this.bodyHUD=createBodyHUD(document.getElementById('app')??undefined);
    this.bodyHUD.update(this.health);
    this.healthDiagram=createBodyDiagram({interactive:true,onPartActivate:part=>void this.applyBandage(part),tooltipManager:this.tooltipManager});
    this.root=document.createElement('section');this.root.className='inventory-window-layer';this.root.hidden=true;
    this.root.innerHTML=`<div class="inventory-scrim"></div><section class="inventory-window" role="dialog" aria-modal="true" aria-labelledby="inventory-title" aria-describedby="inventory-help" aria-owns="hotbar" tabindex="-1"><header class="inventory-header"><div><div class="inventory-eyebrow">FIELD KIT / PLAYER STORAGE</div><h2 id="inventory-title">Inventory</h2><p id="inventory-subtitle">Your essentials, ready at hand.</p></div><button class="inventory-close" type="button" aria-label="Close inventory" title="Close · Escape">×</button></header><div class="inventory-layout"><aside class="inventory-side"><div class="inventory-tabs" role="tablist" aria-label="Inventory sections"><button type="button" role="tab" data-tab="health" aria-selected="true">Health</button><button type="button" role="tab" data-tab="craft" aria-selected="false">Craft</button></div><div class="inventory-notice" role="status" aria-live="polite"></div><div class="inventory-side-content"></div></aside><main class="inventory-storage"><div class="storage-heading"><div><span class="section-kicker">CARRIED ITEMS</span><h3>Pack</h3></div><span class="storage-count"></span></div><div class="inventory-grid" role="grid" aria-label="Twenty pack slots"></div><p id="inventory-help" class="inventory-help">Select a slot, then another to move or swap items. Press Escape to close.</p></main></div></section>`;
    document.getElementById('app')!.append(this.root);
    let offhand=document.getElementById('offhand-slot') as HTMLButtonElement|null;
    if(!offhand){offhand=document.createElement('button');offhand.id='offhand-slot';offhand.className='offhand-slot';offhand.type='button';offhand.dataset.offhand='true';offhand.setAttribute('aria-label','Offhand: Empty');offhand.innerHTML='<span class="offhand-kicker">OFF</span><span class="offhand-glyph"></span><span class="offhand-label">Empty</span>';this.hotbar.prepend(offhand);}
    const opts={signal:this.abort.signal};
    this.root.addEventListener('click',e=>this.handleClick(e),opts);
    window.addEventListener('keydown',e=>{if(this.opened&&(e.key==='Escape'||e.key==='Tab'))this.handleKey(e);},opts);
    this.hotbar.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-slot]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();const index=Number(button.dataset.slot);if(this.opened)void this.pick(index);else if(deriveHealthEffects(this.health,this.hands).rightArmUsable)this.actions.select(index);}, {capture:true,signal:this.abort.signal});
    offhand.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(this.opened)void this.pick(29);}, {capture:true,signal:this.abort.signal});
    this.root.addEventListener('dragstart',e=>this.handleDragStart(e),opts);
    this.hotbar.addEventListener('dragstart',e=>this.handleDragStart(e),opts);
    this.root.addEventListener('dragover',e=>{if((e.target as HTMLElement).closest('[data-slot],[data-offhand],[data-part]'))e.preventDefault();},opts);
    this.root.addEventListener('drop',e=>this.handleDrop(e),opts);
    this.renderHotbar();
  }
  get isOpen(){return this.opened;}
  open(stationId?:string){if(this.opened){if(stationId!==undefined){this.stationId=stationId;this.tab='craft';this.signature='';}this.render();return;}this.opened=true;this.stationId=stationId;this.tab=stationId?'craft':'health';this.notice='';this.moving=null;this.signature='';this.setHotbarDraggable(true);if(document.pointerLockElement===this.camera.canvas)document.exitPointerLock();this.root.hidden=false;document.body.classList.add('inventory-open');this.actions.onOpenChange?.(true);this.render();requestAnimationFrame(()=>this.root.querySelector<HTMLElement>('.inventory-window')?.focus());}
  close(){if(!this.opened)return;this.opened=false;this.moving=null;this.bandageSource=null;this.setHotbarDraggable(false);this.hotbar.querySelectorAll('.moving').forEach(el=>el.classList.remove('moving'));this.root.hidden=true;document.body.classList.remove('inventory-open');this.actions.onOpenChange?.(false);this.hotbar.querySelector<HTMLElement>(`[data-slot="${this.actions.getSelected()}"]`)?.focus();this.tooltipManager.hide();}
  toggle(){this.opened?this.close():this.open();}
  update(state:InventoryState,health:BodyHealth){this.health=health??healthyBody();const selected=this.actions.getSelected();this.hands={right:state.slots[selected]?.item,left:state.offhand?.item};this.bodyHUD.update(this.health,this.hands);this.healthDiagram.update(this.health,this.hands);const panel=this.root?.querySelector<HTMLElement>('.health-card');if(panel)this.refreshHealthPanel(panel);const effects=deriveHealthEffects(this.health,this.hands),barSig=`${state.revision}/${selected}/${JSON.stringify(state.slots.slice(0,9))}/${JSON.stringify(state.offhand??null)}/${effects.rightArmUsable}/${effects.offhandUsable}`;if(barSig!==this.hotbarSignature){this.hotbarSignature=barSig;this.renderHotbar(state,selected);}if(this.opened)this.render(state);this.tooltipManager.refresh();}
  dispose(){this.close();this.abort.abort();this.bodyHUD.dispose();this.healthDiagram.dispose();this.root.remove();}
  private renderHotbar(state=this.actions.getInventory(),selected=this.actions.getSelected()) {
    const effects=deriveHealthEffects(this.health,this.hands);
    this.hotbar.querySelectorAll<HTMLElement>('[data-slot]').forEach((el,i)=>{const slot=state?.slots[i]??null,usable=effects.rightArmUsable;let symbol=el.querySelector<HTMLElement>('.slot-label');if(!symbol)return;symbol.textContent=slot?label(slot.item):i===8?'Hands':'Empty';el.setAttribute('aria-label',`${i+1}: ${slot?`${label(slot.item)}, ${slot.count}`:i===8?'Hands':'Empty slot'}`);el.setAttribute('aria-pressed',String(i===selected));el.setAttribute('aria-disabled',String(!!slot&&!usable));el.classList.toggle('unusable',!!slot&&!usable);el.classList.toggle('selected',i===selected);let qty=el.querySelector<HTMLElement>('.slot-quantity');if(!qty){qty=document.createElement('span');qty.className='slot-quantity';el.append(qty);}qty.textContent=slot&&slot.count>1?String(slot.count):'';let glyph=el.querySelector<HTMLElement>('.slot-item-glyph');if(!glyph){glyph=document.createElement('span');glyph.className='slot-item-glyph';el.append(glyph);}glyph.innerHTML=slot?icon(slot.item):'';this.decorateHandTooltip(el,slot,usable?'Right hand ready':'Right hand unusable');el.setAttribute('draggable',String(this.opened&&!!slot));});
    const offhand=this.hotbar.querySelector<HTMLElement>('[data-offhand]');if(offhand){const slot=state?.offhand??null,usable=effects.offhandUsable;offhand.setAttribute('aria-label',`Offhand: ${slot?`${label(slot.item)}, ${slot.count}`:'Empty'}`);offhand.setAttribute('aria-disabled',String(!!slot&&!usable));offhand.classList.toggle('occupied',!!slot);offhand.classList.toggle('unusable',!!slot&&!usable);offhand.querySelector<HTMLElement>('.offhand-label')!.textContent=slot?label(slot.item):'Empty';offhand.querySelector<HTMLElement>('.offhand-glyph')!.innerHTML=slot?icon(slot.item):'';this.decorateHandTooltip(offhand,slot,usable?'Offhand ready':'Offhand unusable');}
  }
  private render(state=this.actions.getInventory()){
    if(!this.opened)return;const slots=state?.slots??Array.from({length:29},()=>null),offset=9,pack=slots.slice(offset,offset+20);while(pack.length<20)pack.push(null);
    const mode=this.stationId?'Workbench':'Inventory';
    const sig=`${state?.revision}/${this.tab}/${this.stationId}/${this.moving}/${this.bandageSource}/${[...this.bandaging].join(',')}/${this.actions.isConnected()}/${this.busy.size}/${JSON.stringify(slots)}/${JSON.stringify(state?.offhand??null)}`;if(sig===this.signature)return;this.signature=sig;
    this.root.querySelector('#inventory-title')!.textContent=mode;this.root.querySelector('#inventory-subtitle')!.textContent=this.stationId?'A sturdy surface for useful work.':'Your essentials, ready at hand.';
    this.hotbar.querySelectorAll<HTMLElement>('[data-slot]').forEach(el=>el.classList.toggle('moving',Number(el.dataset.slot)===this.moving));
    const side=this.root.querySelector<HTMLElement>('.inventory-side-content')!;
    this.root.querySelector<HTMLElement>('.inventory-notice')!.textContent=this.notice;
    if(this.tab==='health')this.renderHealthPanel(side);
    else this.renderRecipes(side,slots);
    const grid=this.root.querySelector<HTMLElement>('.inventory-grid')!;grid.innerHTML=pack.map((slot,i)=>this.slotMarkup(i+offset,slot)).join('');
    for(const button of grid.querySelectorAll<HTMLElement>('[data-slot]'))this.decorateTooltip(button,state?.slots[Number(button.dataset.slot)]??null);
    const offhand=this.hotbar.querySelector<HTMLElement>('[data-offhand]');if(offhand){offhand.classList.toggle('moving',this.moving===29);this.decorateHandTooltip(offhand,state?.offhand??null,deriveHealthEffects(this.health,this.hands).offhandUsable?'Offhand ready':'Offhand unusable');}
    this.root.querySelector('.storage-count')!.textContent=`${pack.filter(Boolean).length} / 20 occupied`;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.tab===this.tab)));
    this.root.querySelector<HTMLElement>('.inventory-help')!.textContent=this.bandaging.size?'Applying bandage…':this.bandageSource!==null?`Select a body region to apply this ${label((state?.slots[this.bandageSource]??state?.offhand)?.item??'bandage').toLowerCase()}.`:this.moving===null?'Select a slot, then another to move or swap items. Press Escape to close.':`Moving ${label(this.moving===29?state?.offhand?.item??'item':slots[this.moving]?.item??'item')} · choose a destination.`;
  }
  private slotMarkup(index:number,slot:InventorySlot|null){const selected=this.moving===index?' moving':'';return `<button class="inventory-slot${slot?' occupied':''}${selected}" type="button" role="gridcell" data-slot="${index}" draggable="${!!slot}" aria-label="${index+1}: ${slot?`${label(slot.item)}, ${slot.count}`:'Empty'}${selected?' · selected to move':''}"><span class="inventory-slot-number">${String(index<9?index+1:index-8).padStart(2,'0')}</span>${slot?`<span class="inventory-item-icon" aria-hidden="true">${icon(slot.item)}</span><span class="inventory-item-name"></span><span class="inventory-item-count">${slot.count}</span>`:''}</button>`;}
  private renderHealthPanel(side:HTMLElement){
    let card=side.querySelector<HTMLElement>('.health-card');
    if(!card){
      card=document.createElement('div');card.className='health-card';
      const caption=document.createElement('div');caption.className='health-caption';const kicker=document.createElement('span');kicker.className='section-kicker';kicker.textContent='CONDITION';const total=document.createElement('strong');total.className='health-total';caption.append(kicker,total);
      const bar=document.createElement('div');bar.className='health-bar';bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','Overall body health');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');const fill=document.createElement('i');bar.append(fill);
      const wrap=document.createElement('div');wrap.className='body-wrap health-equipment-layout';wrap.append(this.healthDiagram.element);
      const offhand=document.createElement('button');offhand.type='button';offhand.className='offhand-slot health-offhand-slot';offhand.dataset.slot='29';offhand.dataset.offhand='true';offhand.innerHTML='<span class="offhand-kicker">LEFT HAND</span><span class="offhand-glyph"></span><span class="offhand-label">Empty</span><span class="slot-quantity"></span>';wrap.append(offhand);
      const note=document.createElement('span');note.className='body-health-note';wrap.append(note);
      const status=document.createElement('p');status.className='body-status-note';
      const help=document.createElement('p');help.className='side-note';help.textContent='Focus or point to a region for details. Select a bandage, then a region to treat it.';
      card.append(caption,bar,wrap,status,help);side.replaceChildren(card);
    }
    this.refreshHealthPanel(card);
  }
  private refreshHealthPanel(card:HTMLElement){
    const offhand=card.querySelector<HTMLElement>('.health-offhand-slot')!,stack=this.actions.getInventory()?.offhand??null;
    const signature=`${JSON.stringify(stack)}/${this.health.leftArm.hp<=30}/${this.health.head.hp<=25}/${this.moving===29}`;
    if(offhand.dataset.signature!==signature){offhand.dataset.signature=signature;offhand.setAttribute('aria-label',`Offhand: ${stack?`${label(stack.item)}, ${stack.count}`:'Empty'}`);offhand.querySelector<HTMLElement>('.offhand-label')!.textContent=stack?label(stack.item):'Empty';offhand.querySelector<HTMLElement>('.offhand-glyph')!.innerHTML=stack?icon(stack.item):'';offhand.querySelector<HTMLElement>('.slot-quantity')!.textContent=stack&&stack.count>1?String(stack.count):'';offhand.classList.toggle('moving',this.moving===29);offhand.classList.toggle('occupied',!!stack);offhand.classList.toggle('unusable',!!stack&&(this.health.leftArm.hp<=30||this.health.head.hp<=25));offhand.draggable=!!stack;this.decorateTooltip(offhand,stack);}
    const points=BODY_PARTS.reduce((sum,part)=>sum+this.health[part].hp,0),average=points/BODY_PARTS.length,rounded=Math.round(average),fill=card.querySelector<HTMLElement>('.health-bar i')!;
    const total=card.querySelector<HTMLElement>('.health-total')!;if(total.dataset.value!==String(rounded)){total.dataset.value=String(rounded);total.replaceChildren(document.createTextNode(String(rounded)));const small=document.createElement('small');small.textContent=' / 100';total.append(small);}
    const bar=card.querySelector<HTMLElement>('.health-bar')!;if(bar.getAttribute('aria-valuenow')!==String(rounded))bar.setAttribute('aria-valuenow',String(rounded));fill.style.width=`${average}%`;
    const note=card.querySelector<HTMLElement>('.body-health-note')!,worst=Math.min(...BODY_PARTS.map(part=>this.health[part].hp));
    const noteText=worst>=100?'Healthy':worst>70?'Minor injuries':worst>30?'Injured':'Critical injuries';if(note.textContent!==noteText)note.textContent=noteText;
    const status=card.querySelector<HTMLElement>('.body-status-note')!,statusText=this.bandageSource===null?'Six body regions · HP shown on each region':`Bandage selected · choose ${this.bandaging.size?'another ':''}region`;if(status.textContent!==statusText)status.textContent=statusText;
  }
  private decorateTooltip(button:HTMLElement,slot:InventorySlot|null){
    button.dataset.tooltip=' ';button.dataset.tooltipTitle=slot?label(slot.item):'Empty slot';
    const lines:string[]=[];
    if(slot){lines.push(`Quantity: ${slot.count}`);if(slot.item==='bandage')lines.push('Select this stack, then choose a body region to stop bleeding.');if(slot.item==='crutches')lines.push('Can support walking when a leg is severely injured, if both arms are usable.');}
    else lines.push('Select a filled slot, then this slot to move an item.');
    button.dataset.tooltipDetail=lines.join('\n');
    const name=button.querySelector<HTMLElement>('.inventory-item-name');if(name&&slot)name.textContent=label(slot.item);
  }
  private decorateHandTooltip(button:HTMLElement,slot:InventorySlot|null,status:string){
    button.dataset.tooltip=' ';button.dataset.tooltipTitle=slot?label(slot.item):status;
    const lines:string[]=[];
    if(slot)lines.push(`Quantity: ${slot.count}`);
    if(status.toLowerCase().includes('unusable'))lines.push('This hand cannot wield items while injured; carried items can still be moved in the open inventory.');
    else if(!slot)lines.push('No item in this hand.');
    button.dataset.tooltipDetail=lines.join('\n');
  }
  private setHotbarDraggable(enabled:boolean){
    const state=this.actions.getInventory();
    this.hotbar.querySelectorAll<HTMLElement>('[data-slot]').forEach((el,index)=>el.setAttribute('draggable',String(enabled&&!!state?.slots[index])));
    const offhand=this.hotbar.querySelector<HTMLElement>('[data-offhand]');if(offhand)offhand.setAttribute('draggable',String(enabled&&!!state?.offhand));
  }
  private renderRecipes(side:HTMLElement,slots:(InventorySlot|null)[]){const recipes=inventoryRecipes.filter(r=>!this.stationId?r.station==='hand':r.station==='desk'||r.station==='hand');if(!recipes.length){side.innerHTML='<div class="recipe-empty"><span class="recipe-empty-icon">✳</span><h3>No recipes yet</h3><p>Gather materials to discover useful things to make.</p></div>';return;}
    const connected=this.actions.isConnected(),inventory=stateOf(slots);side.innerHTML=`<div class="recipe-heading"><span class="section-kicker">${this.stationId?'WORKBENCH RECIPES':'QUICK CRAFT'}</span><span>${recipes.length} available</span></div><div class="recipe-grid">${recipes.map(r=>{const counts=new Map<string,number>();for(const slot of slots)if(slot)counts.set(slot.item,(counts.get(slot.item)??0)+slot.count);const enough=Object.entries(r.cost).every(([id,n])=>(counts.get(id)??0)>=n),fits=!!craftRecipe(inventory,r.id),key=`${this.stationId??'hand'}:${r.id}`,busy=this.busy.has(key),cost=Object.entries(r.cost).map(([id,n])=>`<span class="recipe-cost${(counts.get(id)??0)<n?' short':''}">${icon(id)} ${label(id)} <b>${counts.get(id)??0}/${n}</b></span>`).join('');return `<article class="recipe-card"><div class="recipe-result"><span class="recipe-result-icon">${icon(r.output.item)}</span><div><h3>${r.label}</h3><p>× ${r.output.count}</p></div></div><div class="recipe-costs">${cost}${enough&&!fits?'<span class="recipe-cost short">Pack full</span>':''}</div><button type="button" class="craft-button" data-craft="${r.id}" ${!enough||!fits||busy||!connected?'disabled':''}>${busy?'Making…':connected?'Craft':'Reconnecting'}</button></article>`;}).join('')}</div>`;
  }
  private handleClick(event:MouseEvent){const target=event.target as HTMLElement;if(target.closest('.inventory-close')||target.classList.contains('inventory-scrim')){this.close();return;}const tab=target.closest<HTMLElement>('[data-tab]');if(tab){this.bandageSource=null;this.tab=tab.dataset.tab as 'health'|'craft';this.signature='';this.render();return;}const craft=target.closest<HTMLElement>('[data-craft]');if(craft){void this.craft(craft.dataset.craft!);return;}const part=target.closest<HTMLElement>('[data-part]');if(part&&this.opened){void this.applyBandage(part.dataset.part as BodyPart);return;}const slot=target.closest<HTMLElement>('[data-slot]');if(slot){event.preventDefault();void this.pick(Number(slot.dataset.slot));}}
  private async pick(index:number){if(!Number.isInteger(index)||index<0||index>29)return;const state=this.actions.getInventory();if(!state)return;const stack=index===29?state.offhand??null:state.slots[index]??null;if(this.moving===null){if(!stack){if(index<29)this.actions.select(index);return;}if(stack.item==='bandage'){this.bandageSource=index;this.signature='';this.render(state);return;}this.bandageSource=null;this.moving=index;this.signature='';this.render(state);return;}if(this.moving===index){this.moving=null;this.signature='';this.render(state);return;}const from=this.moving;this.moving=null;this.signature='';this.render(state);try{const result=await this.actions.move(from,index);this.reportResult(result);}catch(error){this.showNotice(error instanceof Error?error.message:'Move failed');}}
  private async applyBandage(part:BodyPart){
    const source=this.bandageSource,state=this.actions.getInventory();if(source===null||!state)return;if(this.bandaging.has(part))return;
    const stack=source===29?state.offhand??null:state.slots[source]??null;
    if(stack?.item!=='bandage'){this.bandageSource=null;this.showNotice('Select a bandage before choosing a body region.');return;}
    if(!this.actions.isConnected()){this.showNotice('Reconnect before treating an injury.');return;}
    this.bandaging.add(part);this.signature='';this.render(state);
    try{const result=await this.actions.bandage(part,source);if(this.isFailure(result)){this.reportResult(result);}else if(!this.isConfirmed(result)){this.showNotice('Bandage could not be applied.');}else{this.bandageSource=null;this.notice='Bandage applied.';this.signature='';this.render();}}
    catch(error){this.showNotice(error instanceof Error?error.message:'Bandage treatment failed.');}
    finally{this.bandaging.delete(part);this.signature='';this.render();}
  }
  private isFailure(result:unknown){return !!result&&typeof result==='object'&&'ok'in result&&(result as {ok?:unknown}).ok===false;}
  private isConfirmed(result:unknown){return result===true||!!result&&typeof result==='object'&&'ok'in result&&(result as {ok?:unknown}).ok===true;}
  private handleDragStart(event:DragEvent){const target=event.target as HTMLElement,slot=target.closest<HTMLElement>('[data-slot]'),offhand=target.closest<HTMLElement>('[data-offhand]');if(!slot&&!offhand)return;if(!this.opened){event.preventDefault();return;}const index=offhand?29:Number(slot?.dataset.slot),state=this.actions.getInventory(),stack=index===29?state?.offhand:state?.slots[index];if(!stack){event.preventDefault();return;}event.dataTransfer?.setData('text/plain',String(index));if(event.dataTransfer)event.dataTransfer.effectAllowed='move';if(stack.item==='bandage')this.bandageSource=index;else this.moving=index;}
  private handleDrop(event:DragEvent){const target=event.target as HTMLElement,part=target.closest<HTMLElement>('[data-part]');if(part){event.preventDefault();const source=Number(event.dataTransfer?.getData('text/plain'));const state=this.actions.getInventory(),stack=source===29?state?.offhand:state?.slots[source];if(stack?.item==='bandage'){this.bandageSource=source;void this.applyBandage(part.dataset.part as BodyPart);}return;}const slot=target.closest<HTMLElement>('[data-slot],[data-offhand]');if(!slot)return;event.preventDefault();const source=Number(event.dataTransfer?.getData('text/plain'));const destination=slot.hasAttribute('data-offhand')?29:Number(slot.dataset.slot);if(source===destination)return;this.moving=source;void this.pick(destination);}
  private async craft(id:string){const recipe=inventoryRecipes.find(r=>r.id===id);if(!recipe)return;const stationId=recipe.station==='desk'?this.stationId:undefined,key=`${this.stationId??'hand'}:${id}`;if(this.busy.has(key)||!this.actions.isConnected())return;this.busy.add(key);this.signature='';this.render();try{const result=await this.actions.craft(id,stationId);this.reportResult(result);}catch(error){this.showNotice(error instanceof Error?error.message:'Craft failed');}finally{this.busy.delete(key);this.signature='';this.render();}}
  private reportResult(result:unknown){if(result&&typeof result==='object'&&'ok'in result&&(result as {ok?:unknown}).ok===false){this.showNotice(String((result as {error?:unknown}).error??'The action could not be completed.'));return;}this.notice='';this.signature='';this.render();}
  private showNotice(message:string){this.notice=message;this.signature='';this.render();}
  private handleKey(event:KeyboardEvent){if(!this.opened)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}if(event.key==='Tab'){const items=[...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), [data-part][tabindex="0"]'),...this.hotbar.querySelectorAll<HTMLElement>('button:not(:disabled)')],first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
}
