import {chromium} from 'playwright';
import {readdir,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const server=spawn(process.execPath,['scripts/dev-local-sprites.mjs'],{stdio:'pipe'});
await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),20000);server.stdout.on('data',b=>{if(b.toString().includes('4183')){clearTimeout(t);resolve();}});server.on('error',reject);});
const root='artifacts/trestle',browser=await chromium.launch({headless:true}),ctx=await browser.newContext({viewport:{width:1280,height:800},recordVideo:{dir:root+'/evidence',size:{width:1280,height:800}}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir(root+'/evidence',{recursive:true});
await page.goto('http://127.0.0.1:4183');await page.locator('#local-sprite-files').waitFor();await page.locator('canvas[data-character-asset="ready"]').waitFor();
await page.locator('#local-sprite-files').setInputFiles(['manifest.json','provenance.json','coverage-report.json','atlas-0.png'].map(f=>'public/assets/characters/trestle/v0.1/'+f));await page.locator('#local-sprite-load').click();await page.getByText('Local package active',{exact:false}).waitFor();
await page.evaluate(async()=>{window.reviewGame=(await import('/src/main.ts')).game;});
await page.waitForFunction(()=>window.reviewGame.scene.getScene('Arena').views[0].diagnostics().pose?.frame.startsWith('e-'));
const checks=[];
for(const facing of ['n','ne','e','se','s','sw','w','nw']){
 const d=await page.evaluate(facing=>{const s=window.reviewGame.scene.getScene('Arena');s.match.fighters[0].facing=facing;s.update(0,0);return s.views[0].diagnostics();},facing);if(d.status!=='sprite'||d.pose.facing!==facing)throw Error('Facing failed '+facing);checks.push({facing,frame:d.pose.frame,mirrored:d.body.flipX});
}
await page.addStyleTag({content:'#local-sprite-import{display:none!important}'});
await page.locator('#start-game').click();await page.waitForTimeout(3300);
await page.screenshot({path:root+'/evidence/arena-trestle-p1.png'});
const walkFrames=new Set(),attackFrames=new Set();
for(const key of ['ArrowRight','ArrowDown','ArrowLeft','ArrowUp']){
 await page.keyboard.down(key);for(let i=0;i<12;i++){await page.waitForTimeout(25);const d=await page.evaluate(()=>window.reviewGame.scene.getScene('Arena').views[0].diagnostics());if(d.pose?.clip==='move')walkFrames.add(d.pose.frame);}await page.keyboard.up(key);
}
for(let i=0;i<4;i++){await page.keyboard.press('j');for(let k=0;k<15;k++){await page.waitForTimeout(15);const d=await page.evaluate(()=>window.reviewGame.scene.getScene('Arena').views[0].diagnostics());if(d.pose?.clip==='ground.light_1')attackFrames.add(d.pose.frame);}await page.waitForTimeout(400);}
await page.screenshot({path:root+'/evidence/arena-after-movement-and-attacks.png'});
// Presentation-only inspection of exact source poses in the REAL arena; simulation is paused, not retuned.
const inspect=await page.evaluate(async()=>{const s=window.reviewGame.scene.getScene('Arena'),{createCombatFighter}=await import('/src/core/combat.ts');s.scene.pause();const f=createCombatFighter('P1',-70,0,'se');const states=[];for(const frame of [1,5,6,8,9,18]){f.action={type:'attack',kind:'light',airborne:false,frame,facing:'se',instanceId:'review',stats:f.stats.attacks.ground.light,hitTargets:new Set(),comboStage:'light_1'};s.views[0].sync(f,0,false,{clock:0,age:0,airAge:1,hitAge:4,matchState:'Fighting'});states.push(s.views[0].diagnostics().pose);}return states;});
await page.screenshot({path:root+'/evidence/arena-punch-inspection.png'});
if(errors.length||!walkFrames.size||!attackFrames.size)throw Error(JSON.stringify({errors,walkFrames:[...walkFrames],attackFrames:[...attackFrames]}));
await writeFile(root+'/evidence/browser-results.json',JSON.stringify({browser:'system Chromium',checks,walkFrames:[...walkFrames],attackFrames:[...attackFrames],phaseInspection:inspect,errors},null,2));
console.log(JSON.stringify({facings:checks.length,walkFrames:walkFrames.size,attackFrames:attackFrames.size,errors}));await ctx.close();await browser.close();server.kill();
