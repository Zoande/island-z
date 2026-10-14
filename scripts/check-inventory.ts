import {chromium,type Browser} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {once} from 'node:events';
import {addItems,consumeInventorySlot,craftRecipe,emptyInventory,moveInventory} from '../shared/inventory';
import {applyBandage,applyDamage,healthyBody} from '../shared/health';

const port=4123,origin=`http://127.0.0.1:${port}`;
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe'});
let viteOutput='';vite.stdout.on('data',b=>viteOutput+=b);vite.stderr.on('data',b=>viteOutput+=b);
let browser:Browser|undefined;
const errors:string[]=[];
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const emptyFixture=emptyInventory();
const fullFixture=emptyInventory();for(let i=0;i<fullFixture.slots.length;i++)fullFixture.slots[i]={item:i===0?'wood':'stone',count:100};fullFixture.slots[0]!.count=40;fullFixture.revision++;
const injuredBody=applyDamage(healthyBody(),{part:'head',amount:80,bleeding:'moderate'});
const forcedCrawlBody=applyDamage(healthyBody(),{part:'leftLeg',amount:75});
const unusableRightArm=applyDamage(healthyBody(),{part:'rightArm',amount:75});
const unusableLeftArm=applyDamage(healthyBody(),{part:'leftArm',amount:75});
async function ready(){for(let i=0;i<100;i++){if(vite.exitCode!==null)throw new Error(`Vite exited early:\n${viteOutput}`);try{const response=await fetch(origin);if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error(`Vite did not start:\n${viteOutput}`);}

const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Inventory UI check</title></head><body><div id="app"><canvas id="world"></canvas><div class="building-hud"><nav id="hotbar" class="hotbar" aria-label="Hotbar"></nav></div></div><script type="module">
import '/client/style.css';
import {InventoryController} from '/client/inventory.ts';
import {emptyInventory,addItems,consumeInventorySlot,craftRecipe,moveInventory} from '/shared/inventory.ts';
import {applyBandage,applyDamage,healthyBody} from '/shared/health.ts';
const canvas=document.querySelector('#world');
let state=emptyInventory();state=addItems(state,'wood',30);state=addItems(state,'stone',8);state.slots[2]={item:'bandage',count:1};state.slots[9]={item:'stone',count:4};state.slots[10]={item:'bandage',count:2};state.slots[11]={item:'crutches',count:1};
let health=healthyBody(),selected=0,crafts=0,canvasClicks=0,bandages=0;
canvas.addEventListener('click',()=>canvasClicks++);
const camera={canvas};
const actions={getInventory:()=>state,getSelected:()=>selected,select(slot){selected=slot;ui.update(state,health);},isConnected:()=>true,
  async move(from,to){const next=moveInventory(state,from,to);if(!next)return {ok:false,error:'That move cannot fit.'};state=next;ui.update(state,health);return {ok:true};},
  async bandage(part,from){const next=consumeInventorySlot(state,from,'bandage',1);if(!next)return {ok:false,error:'No bandage in that slot.'};state=next;health=applyBandage(health,part);bandages++;ui.update(state,health);return {ok:true};},
  async craft(id){const next=craftRecipe(state,id);if(!next)return {ok:false,error:'Missing materials or pack full.'};state=next;crafts++;ui.update(state,health);return {ok:true};}};
const ui=new InventoryController(camera,actions);ui.update(state,health);
window.__inventory={ui,get state(){return state;},set state(v){state=v;ui.update(state,health);},get health(){return health;},set health(v){health=v;ui.update(state,health);},get selected(){return selected;},get crafts(){return crafts;},get bandages(){return bandages;},get canvasClicks(){return canvasClicks;},update(){ui.update(state,health);}};
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
 await page.locator('#offhand-slot').click();
 assert(await evaluate(()=>window.__inventory.selected===0),'Clicking offhand outside inventory must not change the selected hotbar slot.');
 await page.evaluate(()=>window.__inventory.ui.open());await page.waitForSelector('.inventory-window:not([hidden])');
 assert(await page.locator('.hotbar-slot').count()===9,'Expected nine hotbar slots.');
 assert(await page.locator('.inventory-slot').count()===20,'Expected twenty pack slots.');
 assert(await page.locator('.inventory-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)===5,'Pack grid must have five columns.');
 const desktop=await page.locator('.inventory-window').boundingBox();assert(!!desktop&&desktop.x>=0&&desktop.y>=0&&desktop.x+desktop.width<=1280&&desktop.y+desktop.height<=900,'Desktop inventory dialog must stay in viewport.');
 assert(await page.locator('[role="tab"][data-tab="health"]').getAttribute('aria-selected')==='true','Inventory should open on Health.');
 assert(await page.locator('.inventory-window .body-head').count()===1&&await page.locator('.inventory-window .body-torso').count()===1&&await page.locator('.inventory-window .body-arm').count()===2&&await page.locator('.inventory-window .body-leg').count()===2,'Segmented health body diagram is incomplete.');
 assert(await page.locator('.body-health-hud .body-hud-region').count()===6,'Compact health HUD must always show six regions.');
 assert(await page.locator('.body-hud-hp').filter({hasText:'100'}).count()===6,'Compact health HUD should show each region HP.');
 assert(await page.getByText('Healthy',{exact:true}).count()===1,'Health panel should use the healthy default.');
 assert(await page.locator('#offhand-slot').count()===1,'Dedicated offhand slot should be visible beside the hotbar.');
 assert(await page.locator('.health-offhand-slot').count()===1,'Health panel should expose the same offhand beside the body.');
 await page.evaluate(()=>{const test=document.createElement('button');test.id='tooltip-safety-test';test.dataset.tooltip='detail';test.dataset.tooltipTitle='<script>unsafe</script>';test.dataset.tooltipDetail='Detail <b>stays text</b>';test.style.cssText='position:fixed;right:2px;bottom:2px;z-index:100';document.body.append(test);test.focus();});
 await page.waitForSelector('.game-tooltip:not([hidden])');
 assert((await page.locator('.game-tooltip').innerText()).includes('<script>unsafe</script>'),'Tooltip strings should remain literal text.');
 assert(await page.locator('.game-tooltip script,.game-tooltip b').count()===0,'Tooltip content must not be parsed as HTML.');
 const tipBox=await page.locator('.game-tooltip').boundingBox();assert(!!tipBox&&tipBox.x>=0&&tipBox.y>=0&&tipBox.x+tipBox.width<=1280&&tipBox.y+tipBox.height<=900,'Tooltip should stay within the viewport.');
 await page.evaluate(()=>{const button=document.querySelector<HTMLButtonElement>('#tooltip-safety-test')!;button.blur();button.remove();});
 await page.evaluate(body=>{window.__inventory.health=body;},injuredBody);
 assert((await page.locator('.inventory-window .body-region[data-part="head"]').getAttribute('aria-label'))?.includes('20 of 100'),'Body diagram should display per-region health.');
 await page.locator('.inventory-window .body-region[data-part="head"]').focus();
 await page.waitForSelector('.game-tooltip:not([hidden])');
 const headTooltip=await page.locator('.game-tooltip').innerText();assert(headTooltip.includes('Head')&&headTooltip.includes('20 / 100')&&headTooltip.includes('Moderate bleeding')&&headTooltip.includes('Injury recovery starts')&&headTooltip.includes('blur vision'),'Health tooltip should show HP, bleeding, injury timing, and head effects.');
 const describedBy=await page.locator('.inventory-window .body-region[data-part="head"]').getAttribute('aria-describedby');
 assert(!!describedBy&&await page.locator(`#${describedBy}`).getAttribute('role')==='tooltip','Focused region should reference its accessible tooltip.');
 await page.locator('.inventory-window .body-region[data-part="head"]').blur();
 await page.locator('.inventory-window .body-region[data-part="chest"]').hover();
 await page.waitForSelector('.game-tooltip:not([hidden])');
 assert((await page.locator('.game-tooltip').innerText()).includes('Oxygen capacity'),'Hover tooltip should describe chest oxygen effects.');
 await page.locator('.inventory-window .body-region[data-part="chest"]').focus();await page.locator('.inventory-window .body-region[data-part="chest"]').blur();
 await page.evaluate(body=>{window.__inventory.health=body;},forcedCrawlBody);
 await page.locator('.inventory-window .body-region[data-part="leftLeg"]').focus();await page.waitForSelector('.game-tooltip:not([hidden])');
 assert((await page.locator('.game-tooltip').innerText()).includes('Your injuries force crawling'),'Severe leg injury tooltip should explain forced crawling.');
 await page.locator('.inventory-window .body-region[data-part="leftLeg"]').blur();
 await page.evaluate(body=>{window.__inventory.health=body;},healthyBody());
 await page.locator('.inventory-window .body-region[data-part="chest"]').focus();await page.waitForSelector('.game-tooltip:not([hidden])');
 assert((await page.locator('.game-tooltip').innerText()).includes('C lets you choose a crouch or crawl stance'),'Healthy posture tooltip should explain optional C stance.');
 await page.keyboard.press('Tab');
 assert(await page.locator('.inventory-window .body-region[data-part="leftArm"]').evaluate(el=>document.activeElement===el),'Tab from a body region should continue through the body controls.');
 await page.locator('.inventory-window .body-region[data-part="leftArm"]').blur();
 await page.waitForFunction(()=>document.querySelector('.inventory-window')!.getAnimations().every(a=>a.playState==='finished'));
 await page.screenshot({path:'artifacts/inventory-health.png'});
 const stableBodyRegion=await page.locator('.inventory-window .body-region[data-part="head"]').elementHandle();
 await page.locator('.hotbar-slot[data-slot="2"]').dragTo(page.locator('.inventory-window .body-region[data-part="chest"]'));
 await page.waitForFunction(()=>window.__inventory.bandages===1);
 assert(await evaluate(()=>window.__inventory.state.slots[2]===null),'Dragging a hotbar bandage onto a body region should consume the confirmed source.');
 await page.evaluate(()=>{window.__inventory.health={...window.__inventory.health,leftArm:{hp:75,bleeding:'light',bleedingTime:20}};});
 await page.locator('.inventory-slot[data-slot="10"]').click();
 await page.locator('.inventory-window .body-region[data-part="leftArm"]').click();
 await page.waitForFunction(()=>window.__inventory.bandages===2);
 assert(await evaluate(()=>window.__inventory.state.slots[10]?.count===1),'Confirmed click treatment should consume exactly one bandage.');
 assert(await evaluate(()=>window.__inventory.health.leftArm.bleeding==='none'&&window.__inventory.health.leftArm.hp===75),'Bandaging should stop bleeding without restoring HP.');
 await page.locator('.inventory-slot[data-slot="10"]').dragTo(page.locator('.inventory-window .body-region[data-part="rightLeg"]'));
 await page.waitForFunction(()=>window.__inventory.bandages===3);
 assert(await evaluate(()=>window.__inventory.state.slots[10]===null),'Confirmed drag treatment should consume its source stack.');
 assert(await stableBodyRegion!.evaluate(el=>el===document.querySelector('.inventory-window .body-region[data-part="head"]')),'Health region controls should remain stable across health updates.');
 await page.evaluate(body=>{window.__inventory.health=body;},healthyBody());
 await page.locator('.hotbar-slot[data-slot="8"]').focus();await page.keyboard.press('Tab');
 assert(await page.locator('.inventory-close').evaluate(el=>document.activeElement===el),'Tab must wrap from the modal hotbar into the dialog.');

 // Repeated snapshots with the same revision must not replace focused controls.
 await page.locator('.inventory-slot[data-slot="9"]').focus();
 await page.evaluate(()=>{const grid=document.querySelector('.inventory-grid')!;window.__inventory.mutations=0;new MutationObserver(()=>window.__inventory.mutations++).observe(grid,{childList:true,subtree:true,attributes:true,characterData:true});for(let i=0;i<20;i++){const body=window.__inventory.health;window.__inventory.health={...body,head:{...body.head,hp:100-i*.1,injuryTime:20-i*.5}};window.__inventory.update();}});
 assert(await evaluate(()=>window.__inventory.mutations===0),'Health timer and HP updates should not rewrite pack slot nodes.');
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

 // The dedicated offhand accepts and returns registered crutches through the same inventory move action.
 await page.getByRole('tab',{name:'Health'}).click();
 await page.locator('.inventory-slot[data-slot="11"]').click();await page.locator('.health-offhand-slot').click();
 await page.waitForFunction(()=>window.__inventory.state.offhand?.item==='crutches');
 await page.evaluate(body=>{window.__inventory.health=body;},unusableLeftArm);
 await page.locator('#offhand-slot').focus();await page.waitForSelector('.game-tooltip:not([hidden])');
 assert(await page.locator('#offhand-slot').getAttribute('aria-disabled')==='true','A severely injured left arm should mark the offhand unusable.');
 assert((await page.locator('.game-tooltip').innerText()).includes('cannot wield items'),`Offhand tooltip should explain that carried items can still be moved: ${await page.locator('.game-tooltip').innerText()}`);
 await page.locator('#offhand-slot').dispatchEvent('click');await page.locator('.inventory-slot[data-slot="11"]').click();
 await page.waitForFunction(()=>window.__inventory.state.offhand===null&&window.__inventory.state.slots[11]?.item==='crutches');
 await page.evaluate(body=>{window.__inventory.health=body;},unusableRightArm);
 assert(await page.locator('.hotbar-slot[data-slot="0"]').getAttribute('aria-disabled')==='true','A severely injured right arm should mark hotbar items unusable.');
 assert(await page.locator('.hotbar-slot[data-slot="0"]').evaluate(el=>el.classList.contains('unusable')),'Unusable mainhand items should receive the disabled visual state.');
 await page.locator('.hotbar-slot[data-slot="0"]').dispatchEvent('click');
 assert(await evaluate(()=>window.__inventory.selected===0),'Inventory movement and selection state should remain stable with an unusable arm.');

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

 await page.getByRole('tab',{name:'Health'}).click();await page.locator('.inventory-window .body-region[data-part="head"]').focus();await page.waitForSelector('.game-tooltip:not([hidden])');
 await page.keyboard.press('Escape');await page.waitForSelector('.inventory-window-layer[hidden]',{state:'attached'});
 assert(await page.locator('.game-tooltip').isHidden(),`Inventory close via Escape should also hide the active tooltip: ${await page.locator('.game-tooltip').evaluate(el=>el.outerHTML)}`);
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
 const stancePage=await browser.newPage({viewport:{width:800,height:600}});stancePage.on('pageerror',e=>errors.push(e.message));
 await stancePage.route('**/stance-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><canvas id="world"></canvas><script type="module">
 import '/client/style.css';import {PlayerCamera} from '/client/camera.ts';
 const c=new PlayerCamera(document.querySelector('canvas'),{surface:()=>({height:0,normal:[0,1,0]}),colliders:()=>[]});c.spawn(0,0,0);window.__stance=c;
 let last=performance.now();function frame(now){c.update((now-last)/1000);last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
 </script></body></html>`}));
 await stancePage.goto(`${origin}/stance-harness`);await stancePage.waitForFunction(()=>!!window.__stance);await stancePage.locator('canvas').click();
 await stancePage.waitForFunction(()=>document.pointerLockElement===document.querySelector('canvas'));
 const posture=async(value:string)=>stancePage.waitForFunction(expected=>window.__stance.character.posture===expected,value);
 await stancePage.keyboard.press('KeyC');await posture('crouch');await stancePage.keyboard.press('KeyC');await posture('stand');
 await stancePage.keyboard.down('KeyC');await posture('crawl');await stancePage.keyboard.up('KeyC');
 await stancePage.keyboard.press('KeyC');await posture('crouch');await stancePage.keyboard.press('KeyC');await posture('stand');
 await stancePage.keyboard.down('KeyC');await posture('crawl');await stancePage.keyboard.up('KeyC');
 await stancePage.keyboard.down('KeyC');await posture('stand');await stancePage.keyboard.up('KeyC');
 await stancePage.evaluate(()=>window.__stance.character.setHands(undefined,'crutches'));await stancePage.keyboard.press('KeyC');
 assert(await stancePage.evaluate(()=>window.__stance.character.posture)==='stand','Crutches must prevent C crouching.');
 await stancePage.evaluate(()=>{window.__stance.character.setHands();window.__stance.character.damage('leftLeg',80);});await posture('crawl');
 await stancePage.keyboard.press('KeyC');await stancePage.keyboard.down('KeyC');await stancePage.waitForTimeout(600);await stancePage.keyboard.up('KeyC');
 assert(await stancePage.evaluate(()=>window.__stance.character.posture)==='crawl','C must not override injury-forced crawling.');
 await stancePage.close();
 assert(errors.length===0,`Browser errors: ${errors.join('; ')}`);
 console.log(JSON.stringify({passed:true,hotbarSlots:9,packSlots:20,healthSegments:6,crafted:true,movedAndReturned:true,stanceKeyboard:true,deskRecipes:await page.locator('[data-craft]').count(),mobile:{dialog:mobile.dialog,slotCount:mobile.slots.length,recipeScroll:mobile.recipeScroll,grid:mobile.grid},errors},null,2));
}finally{await browser?.close();vite.kill();await once(vite,'exit').catch(()=>{});mkdirSync('artifacts',{recursive:true});}

declare global{interface Window{__inventory:any;__stance:any}}
