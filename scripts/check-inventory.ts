import {chromium,type Browser} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {once} from 'node:events';
import {addItems,craftRecipe,emptyInventory,moveInventory} from '../shared/inventory';

const port=4123,origin=`http://127.0.0.1:${port}`;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
let viteOutput='';vite.stdout.on('data',b=>viteOutput+=b);vite.stderr.on('data',b=>viteOutput+=b);
let browser:Browser|undefined;
const errors:string[]=[];
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const emptyFixture=emptyInventory();
const fullFixture=emptyInventory();for(let i=0;i<fullFixture.slots.length;i++)fullFixture.slots[i]={item:i===0?'wood':'stone',count:100};fullFixture.slots[0]!.count=40;fullFixture.revision++;
async function ready(){for(let i=0;i<100;i++){if(vite.exitCode!==null)throw new Error(`Vite exited early:\n${viteOutput}`);try{const response=await fetch(origin);if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`Vite did not start:\n${viteOutput}`);}

const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Inventory UI check</title></head><body><div id="app"><canvas id="world"></canvas><div class="building-hud"><nav id="hotbar" class="hotbar" aria-label="Hotbar"></nav></div></div><script type="module">
import '/client/style.css';
import {InventoryController} from '/client/inventory.ts';
import {emptyInventory,addItems,craftRecipe,moveInventory} from '/shared/inventory.ts';
const canvas=document.querySelector('#world');
let state=emptyInventory();state=addItems(state,'wood',30);state=addItems(state,'stone',8);state.slots[9]={item:'stone',count:4};
let selected=0,crafts=0,canvasClicks=0;
canvas.addEventListener('click',()=>canvasClicks++);
const camera={canvas};
const actions={getInventory:()=>state,getSelected:()=>selected,select(slot){selected=slot;ui.update(state,100);},isConnected:()=>true,
  async move(from,to){const next=moveInventory(state,from,to);if(!next)return {ok:false,error:'That move cannot fit.'};state=next;ui.update(state,100);return {ok:true};},
  async craft(id){const next=craftRecipe(state,id);if(!next)return {ok:false,error:'Missing materials or pack full.'};state=next;crafts++;ui.update(state,100);return {ok:true};}};
const ui=new InventoryController(camera,actions);ui.update(state,100);
window.__inventory={ui,get state(){return state;},set state(v){state=v;ui.update(state,100);},get selected(){return selected;},get crafts(){return crafts;},get canvasClicks(){return canvasClicks;},update(){ui.update(state,100);}};
</script></body></html>`;

try{
 await ready();
 try{browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});}
 catch{browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--disable-gpu']});}
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
 mkdirSync('artifacts',{recursive:true});
 await page.route('**/inventory-harness',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto(`${origin}/inventory-harness`);await page.waitForSelector('.hotbar-slot');
 const evaluate=(fn:()=>unknown)=>page.evaluate(fn);
 await page.evaluate(()=>window.__inventory.ui.open());await page.waitForSelector('.inventory-window:not([hidden])');
 assert(await page.locator('.hotbar-slot').count()===9,'Expected nine hotbar slots.');
 assert(await page.locator('.inventory-slot').count()===20,'Expected twenty pack slots.');
 assert(await page.locator('.inventory-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)===5,'Pack grid must have five columns.');
 const desktop=await page.locator('.inventory-window').boundingBox();assert(!!desktop&&desktop.x>=0&&desktop.y>=0&&desktop.x+desktop.width<=1280&&desktop.y+desktop.height<=900,'Desktop inventory dialog must stay in viewport.');
 assert(await page.locator('[role="tab"][data-tab="health"]').getAttribute('aria-selected')==='true','Inventory should open on Health.');
 assert(await page.locator('.body-head').count()===1&&await page.locator('.body-torso').count()===1&&await page.locator('.body-arm').count()===2&&await page.locator('.body-leg').count()===2,'Segmented health body diagram is incomplete.');
 assert(await page.getByText('Healthy',{exact:true}).count()===1,'Health panel should use the healthy default.');
 await page.waitForFunction(()=>document.querySelector('.inventory-window')!.getAnimations().every(a=>a.playState==='finished'));
 await page.screenshot({path:'artifacts/inventory-health.png'});
 await page.locator('.hotbar-slot[data-slot="8"]').focus();await page.keyboard.press('Tab');
 assert(await page.locator('.inventory-close').evaluate(el=>document.activeElement===el),'Tab must wrap from the modal hotbar into the dialog.');

 // Repeated snapshots with the same revision must not replace focused controls.
 await page.locator('.inventory-slot[data-slot="9"]').focus();
 await page.evaluate(()=>{const grid=document.querySelector('.inventory-grid')!;window.__inventory.mutations=0;new MutationObserver(()=>window.__inventory.mutations++).observe(grid,{childList:true,subtree:true,attributes:true,characterData:true});for(let i=0;i<20;i++)window.__inventory.update();});
 assert(await evaluate(()=>window.__inventory.mutations===0),'Stable inventory updates rewrote UI nodes.');
 assert(await page.evaluate(()=>document.activeElement?.getAttribute('data-slot'))==='9','Stable UI update lost focus from an inventory slot.');

 await page.getByRole('tab',{name:'Craft'}).click();
 assert(await page.locator('.recipe-card').count()>=1,'Hand recipes did not render.');
 assert(await page.locator('.recipe-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)===3,'Desktop craft recipes should use a three-column grid.');
 assert(await page.locator('[data-craft="torch"]').count()===1,'Torch recipe did not render.');
 assert(await page.locator('.recipe-cost').first().isVisible(),'Recipe costs should be visible.');
 await page.screenshot({path:'artifacts/inventory-craft.png'});
 await page.locator('[data-craft="torch"]').click();
 await page.waitForFunction(()=>window.__inventory.crafts===1);
 assert((await page.locator('.hotbar-slot[aria-label*="Wood"]').count())===1,'Craft should preserve the live hotbar inventory.');
 assert(await page.locator('.hotbar-slot[aria-label*="Torch"]').count()+await page.locator('.inventory-item-name').filter({hasText:'Torch'}).count()>=1,'Craft output should appear in inventory.');

 // Swap a hotbar stack into an occupied pack slot, then swap it back.
 await page.locator('.hotbar-slot[data-slot="0"]').click();await page.locator('.inventory-slot[data-slot="9"]').click();
 await page.waitForFunction(()=>window.__inventory.state.slots[0]?.item==='stone'&&window.__inventory.state.slots[9]?.item==='wood');
 await page.locator('.hotbar-slot[data-slot="0"]').click();await page.locator('.inventory-slot[data-slot="9"]').click();
 await page.waitForFunction(()=>window.__inventory.state.slots[0]?.item==='wood'&&window.__inventory.state.slots[9]?.item==='stone');

 // The workbench starts on Craft and includes both quick and station recipes.
 await page.evaluate(()=>window.__inventory.ui.open('desk-test-1'));
 assert(await page.locator('[role="tab"][data-tab="craft"]').getAttribute('aria-selected')==='true','Workbench should open on Craft.');
 assert(await page.locator('[data-craft]').count()>6,'Workbench should expose the expanded recipe list.');
 assert(await page.locator('.recipe-grid').evaluate(el=>el.scrollHeight>el.clientHeight),'Expanded recipe list should scroll.');

 // Missing materials and a full output inventory have distinct cues.
 await page.evaluate(inv=>{window.__inventory.state=inv;},emptyFixture);
 assert(await page.locator('.recipe-cost.short').count()>0,'Insufficient ingredients should be marked.');
 assert(await page.locator('.recipe-cost').filter({hasText:'Pack full'}).count()===0,'Empty inventory must not be labeled full.');
 await page.evaluate(inv=>{window.__inventory.state=inv;},fullFixture);
 assert(await page.locator('.recipe-cost').filter({hasText:'Pack full'}).count()>0,'A full pack with enough ingredients should show Pack full.');
 assert(await page.locator('[data-craft="wall-wood"]').isDisabled(),'Full output inventory should disable crafting.');

 await page.keyboard.press('Escape');await page.waitForSelector('.inventory-window-layer[hidden]',{state:'attached'});
 assert(await page.evaluate(()=>window.__inventory.ui.isOpen)===false,'Escape should close the inventory.');
 await page.evaluate(()=>window.__inventory.ui.open());
 await page.locator('.inventory-scrim').click({position:{x:4,y:4}});
 assert(await page.evaluate(()=>window.__inventory.ui.isOpen)===false,'Clicking outside should close the panel.');
 assert(await page.evaluate(()=>window.__inventory.canvasClicks)===0,'Clicking outside the dialog must not click the canvas.');

 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__inventory.ui.open('desk-mobile'));
 const mobile=await page.evaluate(()=>{const dialog=document.querySelector<HTMLElement>('.inventory-window')!.getBoundingClientRect(),slots=[...document.querySelectorAll<HTMLElement>('.inventory-slot')].map(el=>el.getBoundingClientRect()),grid=document.querySelector<HTMLElement>('.recipe-grid')!;return {dialog:{left:dialog.left,right:dialog.right,top:dialog.top,bottom:dialog.bottom},slots:slots.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height})),recipeScroll:grid.scrollHeight>grid.clientHeight,grid:{scrollHeight:grid.scrollHeight,clientHeight:grid.clientHeight}};});
 assert(mobile.dialog.left>=0&&mobile.dialog.right<=390&&mobile.dialog.top>=0&&mobile.dialog.bottom<=844,'Mobile dialog must stay in viewport.');
 assert(mobile.slots.length===20&&mobile.slots.every(r=>r.width>=35&&r.height>=35&&r.left>=0&&r.right<=390&&r.top>=0&&r.bottom<=844),'Mobile pack slots must remain visible and usable.');
 assert(mobile.recipeScroll,'Mobile expanded recipes should remain scrollable.');
 assert(errors.length===0,`Browser errors: ${errors.join('; ')}`);
 console.log(JSON.stringify({passed:true,hotbarSlots:9,packSlots:20,healthSegments:6,crafted:true,movedAndReturned:true,deskRecipes:await page.locator('[data-craft]').count(),mobile:{dialog:mobile.dialog,slotCount:mobile.slots.length,recipeScroll:mobile.recipeScroll,grid:mobile.grid},errors},null,2));
}finally{await browser?.close();vite.kill();await once(vite,'exit').catch(()=>{});mkdirSync('artifacts',{recursive:true});}

declare global{interface Window{__inventory:any}}
