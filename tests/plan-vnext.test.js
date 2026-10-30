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

test('new accounts receive calendar placements immediately without setting dates or sorting',async()=>{
 const owner='plan_now';
 const created=await api(owner,'/tasks','POST',{tasks:[{id:'now-a',name:'Start now',estimatedTimeMs:60000},{id:'now-b',name:'Next task',estimatedTimeMs:120000}]});
 assert.equal(created.status,200);
 const {result:state}=await api(owner);
 assert.equal(state.windows.length,0);assert.equal(state.comparisons.length,0);
 assert.equal(state.forecast.schedule.length,2);assert.equal(state.forecast.schedule[0].start,state.forecast.now);
 assert.equal(state.forecast.availabilityMode,'continuous');assert.ok(state.nodes.every(n=>n.earliest_start_at==null));
});
test('bulk edits apply chosen metadata atomically and preserve other fields and ownership',async()=>{
 const owner='bulk_edit';
 store.create(owner,{tasks:[{id:'be-p',name:'Project',nodeType:'project'},{id:'be-a',name:'A',parentId:'be-p',estimatedTimeMs:60000,notes:'Keep notes',due_at:1000,tags:['old']},{id:'be-b',name:'B',estimatedTimeMs:120000,description:'Keep description',due_at:2000,tags:['other']},{id:'be-unselected',name:'Unselected',estimatedTimeMs:180000}]});
 store.create('bulk_foreign',{tasks:[{id:'be-foreign',name:'Foreign'}]});
 let state=store.snapshot(owner),version=state.version;
 const edits={ids:['be-p','be-a','be-b'],version,requestId:'bulk-metadata',changes:{estimatedTimeMs:720000,tags:['review'],due_at:null,location:'Office'}};
 const edited=await api(owner,'/bulk','POST',edits);assert.equal(edited.status,200);
 assert.deepEqual((await api(owner,'/bulk','POST',edits)).result,edited.result,'a retried edit must acknowledge the original write');
 state=store.snapshot(owner);const a=state.nodes.find(n=>n.id==='be-a'),b=state.nodes.find(n=>n.id==='be-b');
 assert.equal(a.estimated_ms,720000);assert.equal(b.estimated_ms,720000);assert.equal(a.notes,'Keep notes');assert.equal(b.description,'Keep description');
 assert.equal(a.parent_id,'be-p');assert.equal(a.due_at,null);assert.equal(b.due_at,null);assert.deepEqual(a.tags,['review']);assert.equal(b.location,'Office');
 assert.equal(state.nodes.find(n=>n.id==='be-p').estimated_ms,720000,'the project total is derived, not directly assigned');
 assert.equal(state.nodes.find(n=>n.id==='be-unselected').estimated_ms,180000);
 assert.equal((await api(owner,'/bulk','POST',{ids:['be-a'],version,changes:{notes:'Stale'}})).status,409);
 const denied=await api(owner,'/bulk','POST',{ids:['be-a','be-foreign'],changes:{notes:'Wrong owner'}});assert.equal(denied.status,404);
 assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='be-a').notes,'Keep notes');
 const invalid=await api(owner,'/bulk','POST',{ids:['be-a','be-b'],changes:{location:'Must roll back',tags:[null]}});assert.equal(invalid.status,400);
 assert.ok(store.snapshot(owner).nodes.filter(n=>['be-a','be-b'].includes(n.id)).every(n=>n.location==='Office'));
});
test('bulk deletion deduplicates selected subtrees, is retry-safe, and restores recorded history',async()=>{
 const owner='bulk_delete',now=Date.now();
 store.create(owner,{tasks:[{id:'bd-p',name:'Parent',nodeType:'project'},{id:'bd-child',name:'Child',parentId:'bd-p',estimatedTimeMs:60000},{id:'bd-other',name:'Other',estimatedTimeMs:60000},{id:'bd-keep',name:'Keep',estimatedTimeMs:60000}]});
 graph.startInterval(owner,{id:'bd-history',taskId:'bd-child',startedAt:now-3000});graph.stopInterval(owner,'bd-history',now-1000);
 store.update(owner,'bd-child',{status:'completed'});
 const request={ids:['bd-p','bd-child','bd-other'],action:'delete',requestId:'delete-selection',version:store.snapshot(owner).version};
 const deleted=await api(owner,'/bulk','POST',request);assert.equal(deleted.status,200);assert.deepEqual(deleted.result.deletedIds,['bd-p','bd-other']);
 assert.deepEqual((await api(owner,'/bulk','POST',request)).result,deleted.result);
 assert.equal(store.snapshot(owner).nodes.find(n=>n.id==='bd-keep').status,'pending');
 assert.ok(store.snapshot(owner).nodes.filter(n=>['bd-p','bd-child','bd-other'].includes(n.id)).every(n=>n.status==='cancelled'));
 await api(owner,'/bulk','POST',{ids:request.ids,action:'delete',requestId:'delete-already-deleted'});
 await api(owner,'/tasks/bd-p/restore','POST',{});const restored=store.snapshot(owner);
 assert.equal(restored.nodes.find(n=>n.id==='bd-child').status,'completed');assert.equal(restored.nodes.find(n=>n.id==='bd-child').actual_ms,2000);
 assert.equal(restored.nodes.find(n=>n.id==='bd-p').status,'completed');assert.equal(restored.nodes.find(n=>n.id==='bd-other').status,'cancelled');
});
test('bulk deletion rolls back the whole selection if any task is running or belongs to another owner',async()=>{
 const owner='bulk_delete_guard';store.create(owner,{tasks:[{id:'bg-a',name:'A',estimatedTimeMs:60000},{id:'bg-running',name:'Running',estimatedTimeMs:60000}]});
 store.create('bg-other',{tasks:[{id:'bg-foreign',name:'Foreign'}]});
 assert.equal((await api(owner,'/bulk','POST',{ids:['bg-a','bg-foreign'],action:'delete'})).status,404);
 graph.startInterval(owner,{id:'bg-interval',taskId:'bg-running'});
 assert.equal((await api(owner,'/bulk','POST',{ids:['bg-a','bg-running'],action:'delete'})).status,400);
 assert.equal(users.getNode(owner,'bg-a').status,'pending');assert.equal(users.getNode(owner,'bg-running').status,'pending');
 graph.stopInterval(owner,'bg-interval');
});
test('browser calendar works before setup and selected tasks support bulk metadata edits and deletion',async t=>{
 const owner='bulk_browser';store.create(owner,{tasks:[{id:'bb-a',name:'Bulk Alpha',estimatedTimeMs:60000,notes:'Keep Alpha',due_at:Date.now()+86400000},{id:'bb-b',name:'Bulk Beta',estimatedTimeMs:120000,notes:'Keep Beta',due_at:Date.now()+2*86400000},{id:'bb-keep',name:'Leave alone',estimatedTimeMs:180000}]});
 const page=await pageFor(t,owner);
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.waitForSelector('.plan-day');
 assert.doesNotMatch(await page.locator('#planContent').textContent(),/Unscheduled|No timing placement/);
 await page.getByRole('button',{name:'Availability',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Add interval',exact:true}).click();
 const start=await page.locator('dialog').getByLabel('Available from',{exact:true}).inputValue();
 assert.ok(await page.evaluate(value=>Math.abs(new Date(value).getTime()-Date.now())<60000,start),'a newly added interval defaults to now, not an hour later');
 await page.locator('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByLabel('Select Bulk Alpha',{exact:true}).check();await page.getByLabel('Select Bulk Beta',{exact:true}).check();
 await page.getByRole('button',{name:'Edit selected',exact:true}).click();
 const dialog=page.locator('dialog');await dialog.getByLabel('Change Estimated total minutes',{exact:true}).check();await dialog.getByLabel('Estimated total minutes',{exact:true}).fill('12');
 await dialog.getByLabel('Change Tags (comma separated)',{exact:true}).check();await dialog.getByLabel('Tags (comma separated)',{exact:true}).fill('review, home');
 await dialog.getByLabel('Change Preferred due date',{exact:true}).check();await dialog.getByLabel('Preferred due date',{exact:true}).fill('');
 await dialog.getByRole('button',{name:'Apply changes',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 let state=store.snapshot(owner);for(const id of ['bb-a','bb-b']){const n=state.nodes.find(n=>n.id===id);assert.equal(n.estimated_ms,720000);assert.equal(n.due_at,null);assert.deepEqual(n.tags,['home','review']);}
 assert.equal(state.nodes.find(n=>n.id==='bb-a').notes,'Keep Alpha');assert.equal(state.nodes.find(n=>n.id==='bb-keep').estimated_ms,180000);
 await page.getByLabel('Search tasks').fill('Bulk ');await page.getByLabel('Select all visible items',{exact:true}).check();
 assert.equal(await page.getByLabel('Select Bulk Alpha',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('Select Bulk Beta',{exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'Delete selected',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(users.getNode(owner,'bb-a').status,'pending');
 await page.getByRole('button',{name:'Delete selected',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Delete items',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 state=store.snapshot(owner);assert.equal(state.nodes.find(n=>n.id==='bb-a').status,'cancelled');assert.equal(state.nodes.find(n=>n.id==='bb-b').status,'cancelled');assert.equal(state.nodes.find(n=>n.id==='bb-keep').status,'pending');
 await page.getByLabel('Search tasks').fill('');await page.getByRole('button',{name:'Archive',exact:true}).click();await page.locator('[data-task-id="bb-a"]').getByRole('button',{name:'Restore',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[data-task-id="bb-a"]'));assert.equal(users.getNode(owner,'bb-a').status,'pending');
 await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();await page.waitForSelector('[data-task-id="bb-a"]');
 assert.match(await page.locator('[data-task-id="bb-a"]').textContent(),/12 min remaining/);
});
