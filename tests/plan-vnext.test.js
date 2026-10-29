'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {generateKeyPairSync,sign}=require('node:crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexttask-plan-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH=directory;
process.env.CLERK_TELEMETRY_DISABLED='true';
const domain='plan-fixture.clerk.accounts.dev',publishableKey='pk_test_'+Buffer.from(domain+'$').toString('base64');
process.env.CLERK_PUBLISHABLE_KEY=publishableKey;
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwtKey=publicKey.export({type:'spki',format:'pem'});
const {createApp}=require('../backend/server'),store=require('../backend/plan-store'),users=require('../backend/user-store'),graph=require('../backend/task-graph-store'),db=require('../backend/database').connection;
let server,base,browser;
function token(owner){const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'fixture'})).toString('base64url'),payload=Buffer.from(JSON.stringify({iss:'https://'+domain,sub:owner,sid:'sess_fixture',iat:now,nbf:now-1,exp:now+1800,azp:'http://localhost:3000'})).toString('base64url');return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');}
async function api(owner,url='',method='GET',body){const response=await fetch(base+'/api/plan'+url,{method,headers:{Authorization:'Bearer '+token(owner),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();return {status:response.status,result};}
test.before(async()=>{server=createApp({publishableKey,secretKey:'sk_test_offline_fixture',jwtKey}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{if(browser)await browser.close();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
test('atomic task metadata, ownership, retry identity, revision conflicts, and cycle rejection',async()=>{
 const owner='plan_crud';
 const body={requestId:'capture-once',tasks:[{id:'pc-p',name:'Project',nodeType:'project'},{id:'pc-a',name:'A',parentId:'pc-p',estimatedTimeMs:60000,description:'Description',tags:['work']},{id:'pc-b',name:'B',estimatedTimeMs:120000,prerequisites:['pc-a']}]};
 const created=await api(owner,'/tasks','POST',body);assert.equal(created.status,200);assert.deepEqual((await api(owner,'/tasks','POST',body)).result,created.result);
 assert.equal(store.snapshot(owner).nodes.length,3);
 let state=(await api(owner)).result;const version=state.version;
 assert.equal((await api(owner,'/tasks/pc-a','PUT',{version,name:'Renamed'})).status,200);
 assert.equal((await api(owner,'/tasks/pc-a','PUT',{version,name:'Lost update'})).status,409);
 assert.equal((await api('intruder','/tasks/pc-a','PUT',{name:'Wrong'})).status,404);
 assert.equal((await api(owner,'/tasks/pc-a','PUT',{description:'Must roll back',prerequisites:['pc-b']})).status,400);
 state=(await api(owner)).result;assert.equal(state.nodes.find(n=>n.id==='pc-a').description,'Description');
 assert.equal((await api(owner,'/tasks/pc-a','PUT',{parentId:'pc-b'})).status,400);
 assert.equal((await api(owner,'/tasks/pc-p','PUT',{prerequisites:['pc-a']})).status,400);
 assert.equal((await api(owner,'/tasks/pc-a','PUT',{remaining_ms:-1})).status,400);
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('Plan → Work → Plan uses the same identity, enforces prerequisites, and rolls up actual intervals once',()=>{
 const owner='plan_work',now=Date.now();
 store.create(owner,{tasks:[{id:'pw-p',name:'Project',nodeType:'project'},{id:'pw-a',name:'Prerequisite',parentId:'pw-p',estimatedTimeMs:60000},{id:'pw-b',name:'Important dependent',parentId:'pw-p',estimatedTimeMs:60000,prerequisites:['pw-a']}]});
 graph.prepareSession(owner,{id:'pw-session',taskIds:['pw-a','pw-b']});
 assert.throws(()=>graph.startInterval(owner,{id:'pw-wrong',taskId:'pw-b',workSessionId:'pw-session'}),/blocked/);
 graph.startInterval(owner,{id:'pw-interval',taskId:'pw-a',workSessionId:'pw-session',startedAt:now-5000});
 graph.stopInterval(owner,'pw-interval',now-1000);graph.stopInterval(owner,'pw-interval',now);
 store.update(owner,'pw-a',{status:'completed'});
 let s=store.snapshot(owner);assert.equal(s.nodes.find(n=>n.id==='pw-p').progress.actualMs,4000);assert.equal(s.nodes.find(n=>n.id==='pw-p').progress.completed,1);
 graph.startInterval(owner,{id:'pw-b-interval',taskId:'pw-b',workSessionId:'pw-session'});
 assert.throws(()=>graph.startInterval(owner,{id:'pw-overlap',taskId:'pw-a',workSessionId:'pw-session'}),/open actionable|blocked/);
 graph.stopInterval(owner,'pw-b-interval');store.update(owner,'pw-b',{status:'completed'});
 s=store.snapshot(owner);assert.equal(s.nodes.find(n=>n.id==='pw-p').status,'completed');assert.equal(s.nodes.length,3);
 store.update(owner,'pw-b',{status:'pending'});assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='pw-p').status,'pending');
 store.update(owner,'pw-a',{parentId:null});s=store.snapshot(owner);assert.equal(s.nodes.find(n=>n.id==='pw-a').actual_ms,4000);assert.equal(s.nodes.find(n=>n.id==='pw-p').progress.actualMs,s.nodes.find(n=>n.id==='pw-b').actual_ms);
});
test('recurrence preserves history, calendar-day timezone behavior, and occurrence identity across retries',()=>{
 const owner='plan_repeat';store.create(owner,{tasks:[{id:'repeat',name:'Daily care',estimatedTimeMs:300000,recurrence_days:1,recurrence_zone:'America/Chicago',tags:['care'],due_at:Date.parse('2026-03-07T15:00:00Z')}]});
 store.update(owner,'repeat',{status:'completed',requestId:'finish-repeat'});store.update(owner,'repeat',{status:'completed',requestId:'finish-repeat'});
 const first=store.snapshot(owner),again=store.snapshot(owner);assert.equal(first.nodes.length,2);assert.deepEqual(first.nodes.map(n=>n.id),again.nodes.map(n=>n.id));
 const occurrence=first.nodes.find(n=>n.id!=='repeat');assert.equal(occurrence.due_at,Date.parse('2026-03-08T14:00:00Z'));assert.deepEqual(occurrence.tags,['care']);assert.equal(occurrence.earliest_start_at,null,'a dated recurrence must not acquire an inferred start after its due time');assert.equal(first.nodes.find(n=>n.id==='repeat').status,'completed');
});
test('availability is validated atomically; importance comparisons never mutate queue or hierarchy',()=>{
 const owner='plan_landscape',now=Date.now();store.create(owner,{tasks:[{id:'land-a',name:'A',estimatedTimeMs:60000},{id:'land-b',name:'B',estimatedTimeMs:60000}]});
 graph.prepareSession(owner,{id:'land-session',taskIds:['land-b','land-a']});
 store.rank(owner,{ids:['land-a','land-b']});assert.deepEqual(graph.getItems(owner,'land-session').map(n=>n.id),['land-b','land-a']);
 store.settings(owner,{timezone:'America/Chicago',reserve:0.2,windows:[{start:now,end:now+3600000}]});
 assert.throws(()=>store.settings(owner,{timezone:'America/Chicago',reserve:0.2,windows:[{start:now,end:now+3600000},{start:now+1000,end:now+2000}]}),/overlap/);
 assert.equal(store.snapshot(owner).windows.length,1);
 users.createNode(owner,{id:'land-legacy',name:'Legacy write'});assert.ok(store.snapshot(owner).version>0);
});
test('private APIs reject absent authentication and malformed JSON; demo auth cannot run on Railway',async()=>{
 assert.equal((await fetch(base+'/api/plan')).status,401);
 const malformed=await fetch(base+'/api/plan/tasks',{method:'POST',headers:{Authorization:'Bearer '+token('malformed'),'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
 process.env.NEXTTASK_LOCAL_DEMO='1';process.env.RAILWAY_ENVIRONMENT_ID='dev-fixture';try{assert.throws(()=>createApp(),/disabled/);}finally{delete process.env.NEXTTASK_LOCAL_DEMO;delete process.env.RAILWAY_ENVIRONMENT_ID;}
});
async function pageFor(t,owner){
 if(!browser){const {chromium}=require('playwright');browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});}
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await context.route('https://'+domain+'/**',route=>route.fulfill({contentType:'application/javascript',body:`window.Clerk=window.Clerk||{isSignedIn:true,user:{id:${JSON.stringify(owner)}},session:{id:'sess_fixture',async getToken(){return ${JSON.stringify(token(owner))}}},async load(){},mountUserButton(){},addListener(){}};`}));
 page.setDefaultTimeout(10000);await page.goto(base);await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();await page.waitForSelector('#nextPlan .plan-capture');return page;
}
test('browser capture, nested project editing, comparison, dependencies, calendar, reload, and shared Work identity',async t=>{
 const owner='plan_browser',page=await pageFor(t,owner);
 await page.getByRole('button',{name:'New project',exact:true}).click();await page.locator('dialog input[name=title]').fill('Important project');await page.locator('dialog button[type=submit]').click();
 await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'Important project',exact:true}).click();
 await page.getByLabel('Quick add task').fill('Gather evidence, 1m');await page.locator('.plan-capture button[type=submit]').click();await page.waitForSelector('.plan-row');
 await page.getByLabel('Quick add task').fill('Write proposal, 2m');await page.locator('.plan-capture button[type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.plan-row').length===2);
 const state=store.snapshot(owner),a=state.nodes.find(n=>n.name==='Gather evidence'),b=state.nodes.find(n=>n.name==='Write proposal');
 await page.locator(`[data-task-id="${b.id}"]`).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('dialog details').evaluate(e=>e.open=true);await page.locator('dialog select[name=prerequisites]').selectOption([a.id]);await page.locator('dialog button[type=submit]').click();
 await page.waitForFunction(()=>!document.querySelector('dialog'));
 await page.getByRole('button',{name:'Sort importance',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Write proposal',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.equal(store.snapshot(owner).forecast.items.find(i=>i.id===b.id).importanceRank,1);
 await page.getByRole('button',{name:'Availability',exact:true}).click();await page.getByRole('button',{name:'Next 7 weekdays, 9–5',exact:true}).click();await page.getByRole('button',{name:'Save availability',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.waitForSelector('.plan-day');
 await page.getByRole('button',{name:'Matrix',exact:true}).click();await page.waitForSelector('.plan-grid');
 await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();await page.getByRole('button',{name:'All work',exact:true}).click();await page.waitForSelector(`[data-task-id="${b.id}"]`);
 // Select both tasks: the prerequisite executes first despite expressed importance.
 await page.getByLabel('Select Gather evidence',{exact:true}).check();await page.getByLabel('Select Write proposal',{exact:true}).check();await page.locator('#nextPlan header').getByRole('button',{name:'Work',exact:true}).click();
 await page.waitForSelector('#dashboardScreen');await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');
 assert.match(await page.locator('#focusScreen h2').textContent(),/Gather evidence/);
 await page.getByRole('button',{name:'Done, Next!',exact:true}).click();await page.waitForFunction(()=>document.getElementById('focusScreen')?.textContent.includes('Write proposal'));
 assert.equal(store.snapshot(owner).nodes.find(n=>n.id===a.id).status,'completed');assert.ok(store.snapshot(owner).nodes.some(n=>n.id===b.id));
 await page.evaluate(()=>window.NextPlan.open('all'));await page.waitForSelector('#nextPlan .plan-capture');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM work_intervals WHERE user_id=? AND ended_at IS NULL').get(owner).n,0);
 assert.equal(store.snapshot(owner).nodes.find(n=>n.id===b.id).status,'pending');
});
test('mobile Plan fits viewport and retains a failed form for correction',async t=>{
 const page=await pageFor(t,'plan_mobile');await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'New project',exact:true}).click();await page.locator('dialog input[name=title]').fill('Mobile project');await page.locator('dialog button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
});
test('delete and restore retain complete subtree history; remaining overrides consume subsequent work',()=>{
 const owner='plan_restore',now=Date.now();store.create(owner,{tasks:[{id:'restore-p',name:'Parent',nodeType:'project'},{id:'restore-a',name:'A',parentId:'restore-p',estimatedTimeMs:60000}]});
 graph.startInterval(owner,{id:'restore-first',taskId:'restore-a',startedAt:now-5000});graph.stopInterval(owner,'restore-first',now-4000);
 store.update(owner,'restore-a',{remaining_ms:10000});
 graph.startInterval(owner,{id:'restore-second',taskId:'restore-a',startedAt:now-3000});graph.stopInterval(owner,'restore-second',now-1000);
 assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='restore-a').remaining_ms,8000);
 store.remove(owner,'restore-p',{});assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='restore-a').status,'cancelled');
 store.restore(owner,'restore-p',{});const snapshot=store.snapshot(owner);assert.equal(snapshot.nodes.find(n=>n.id==='restore-a').status,'pending');assert.equal(snapshot.nodes.find(n=>n.id==='restore-p').progress.actualMs,3000);
 store.update(owner,'restore-a',{nodeType:'project'});assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='restore-a').progress.actualMs,3000);
});
test('Work-created blocker relationships remain durable after Plan completes and later reopens a prerequisite',()=>{
 const owner='work_blocker';users.createNode(owner,{id:'wb-main',name:'Main',estimatedTimeMs:60000});users.createNode(owner,{id:'wb-source',name:'Blocker',estimatedTimeMs:60000});
 const legacy=require('../backend/database');
 legacy.saveTaskList(owner,[{id:'wb-main',name:'Main',userId:owner,status:'blocked',blockedByTaskId:'wb-source'}]);
 store.update(owner,'wb-source',{status:'completed'});assert.equal(store.snapshot(owner).forecast.items.find(i=>i.id==='wb-main').ready,true);
 store.update(owner,'wb-source',{status:'pending'});assert.equal(store.snapshot(owner).forecast.items.find(i=>i.id==='wb-main').ready,false);
 assert.throws(()=>graph.startInterval(owner,{id:'wb-rejected',taskId:'wb-main'}),/blocked/);
});
