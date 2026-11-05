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
async function pageFor(t,owner){
 if(!browser){const {chromium}=require('playwright');browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});}
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await context.route('https://cdn.jsdelivr.net/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
 await context.route('https://'+domain+'/**',route=>route.fulfill({contentType:'application/javascript',body:`window.Clerk=window.Clerk||{isSignedIn:true,user:{id:${JSON.stringify(owner)}},session:{id:'sess_fixture',async getToken(){return ${JSON.stringify(token(owner))}}},async load(){},mountUserButton(){},addListener(){}};`}));
 page.setDefaultTimeout(10000);await page.goto(base);await page.waitForSelector('#modeSelect:not(.hidden)');return page;
}
const agenda=require('../backend/agenda-store');
const scheduler=require('../frontend/agenda-scheduler');
const H=3600000;
test('deadline moves protect more important deadlines and allow deadline-free work to move',()=>{
 const task=(id,extra={})=>({id,name:id,node_type:'task',status:'pending',estimated_ms:H,...extra});
 const domain=require('../frontend/plan-domain');
 const nodes=[task('major',{deadline_at:2*H}),task('minor',{deadline_at:H})];
 const options={now:0,importanceOrder:['major','minor']};
 assert.deepEqual(domain.plan(nodes,[],[],options).schedule.map(row=>row.id),['minor','major']);
 nodes[0].deadline_at=H;
 const conflict=domain.plan(nodes,[],[],options);assert.deepEqual(conflict.schedule.map(row=>row.id),['major','minor']);assert.equal(conflict.hardConstraintsSatisfied,false);assert.equal(conflict.schedule.length,2);
 nodes[0].deadline_at=null;assert.deepEqual(domain.plan(nodes,[],[],options).schedule.map(row=>row.id),['minor','major']);
});
test('Resume if/else covers no hard stop, fit choice, nothing fits, and backlog versus past start',()=>{
 const task=(id,ms,start)=>({id,estimated_ms:ms,elapsed_ms:0,start_at:start});
 const rows=[task('long',100,20),task('short',10,40)];
 assert.deepEqual(scheduler.resume([],rows,null,50).map(row=>row.id),['long']);
 assert.deepEqual(scheduler.resume([],rows,70,50).map(row=>row.id),['long','short']);
 assert.deepEqual(scheduler.resume([],rows,55,50).map(row=>row.id),['long']);
 assert.deepEqual(scheduler.resume([task('backlog',1)],rows,null,50).map(row=>row.id),['backlog','long']);
 assert.deepEqual(scheduler.resume([task('backlog',1)],rows,null,10).map(row=>row.id),['backlog']);
});
test('Agenda replacement clears backlog, persists ranking, isolates owners and rejects stale saves atomically',async()=>{
 const owner='agenda_storage';store.create(owner,{tasks:[{id:'agenda-a',name:'A',estimatedTimeMs:60000},{id:'agenda-b',name:'B',estimatedTimeMs:120000}]});
 const before=agenda.read(owner);assert.equal(before.backlog.length,2);
 const saved=agenda.save(owner,{revision:before.revision,tasks:[{id:'agenda-b',dueAt:null},{id:'agenda-a',dueAt:null}]});
 assert.equal(saved.backlog.length,0);assert.deepEqual(saved.agenda.map(row=>row.id),['agenda-b','agenda-a']);assert.equal(saved.agenda[0].importance_rank,1);
 agenda.backlog(owner,['agenda-a']);assert.equal(agenda.read(owner).backlog[0].id,'agenda-a');
 assert.throws(()=>agenda.save(owner,{revision:saved.revision,tasks:[]}),/changed/);assert.equal(agenda.read(owner).agenda.length,2);
 assert.throws(()=>agenda.backlog('other-owner',['agenda-a']),/not found/);assert.equal(agenda.read('other-owner').items.length,0);
 const refreshed=agenda.read(owner);agenda.save(owner,{revision:refreshed.revision,tasks:[{id:'agenda-a',dueAt:null},{id:'agenda-b',dueAt:null}]});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agenda_tasks WHERE user_id=?').get(owner).n,2);assert.equal(agenda.read(owner).backlog.length,0);
 const foreign=await api('intruder','/agenda','PUT',{revision:0,tasks:[{id:'agenda-a',dueAt:null}]});assert.equal(foreign.status,400);
});
test('calendar events stay fixed and exported text has UTC timestamps, escaping, and valid line folding',()=>{
 const owner='agenda_events',now=Date.now();store.create(owner,{tasks:[{id:'event-task',name:'Task',estimatedTimeMs:60000}]});
 agenda.addEvent(owner,{id:'fixed-event',name:'Meeting, with; notes',startAt:now,endAt:now+H});
 const before=agenda.read(owner);const saved=agenda.save(owner,{revision:before.revision,tasks:[{id:'event-task',dueAt:null}]});
 assert.ok(saved.agenda[0].start_at>=now+H);assert.equal(saved.events[0].start_at,now);
 assert.equal(agenda.read('other-owner').events.length,0);
 const content=scheduler.ics([{...saved.events[0],name:'Meeting, with; notes '+ 'é'.repeat(80)}],now);
 assert.match(content,/BEGIN:VCALENDAR/);assert.match(content,/DTSTART:\d{8}T\d{6}Z/);assert.match(content,/Meeting\\, with\\; notes/);
 assert.ok(content.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
 assert.ok(db.prepare('SELECT 1 FROM calendar_events WHERE id=?').get('fixed-event'));
 agenda.deleteEvent('other-owner','fixed-event');assert.equal(agenda.read(owner).events.length,1);
});
test('browser sign-in lands on Work/Plan; Plan sorts, reviews optional deadlines, and saves calendar with export',async t=>{
 const owner='agenda_browser';store.create(owner,{tasks:[{id:'browser-a',name:'Important long task',estimatedTimeMs:1200000},{id:'browser-b',name:'Short task',estimatedTimeMs:60000}]});
 const page=await pageFor(t,owner);assert.equal(await page.locator('#metricsBtn').count(),0);assert.equal(await page.locator('#insightsBtn').count(),0);
 await page.locator('#planBtn').click();await page.locator('#task1').click();await page.waitForSelector('#planDeadlines');
 assert.equal(await page.locator('#planDeadlines input').count(),2);await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');
 assert.equal(agenda.read(owner).backlog.length,0);assert.equal(agenda.read(owner).agenda[0].id,'browser-a');
 await page.locator('#calendarView').click();await page.waitForSelector('#calendarScreen .calendar-task');assert.equal(await page.locator('.calendar-day').count(),7);
 const downloaded=page.waitForEvent('download');await page.locator('#exportCalendar').click();const download=await downloaded;assert.equal(download.suggestedFilename(),'nexttask-agenda.ics');
 await page.screenshot({path:'/tmp/nexttask-agenda-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/nexttask-agenda-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');assert.equal(await page.locator('#agendaScreen').count(),0);
 await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:'Yes, I have a definite stop time.'}).click();await page.locator('#availableTime').fill('5');await page.locator('#timeConstraintNextBtn').click();await page.waitForSelector('#resumeChoiceScreen');
 await page.getByRole('button',{name:'Short task',exact:true}).click();await page.waitForSelector('#focusScreen');assert.equal(await page.locator('#focusScreen h2').textContent(),'Short task');
 await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session',exact:true}).click();await page.waitForFunction(()=>!window.TaskGraph.pending());
 assert.ok(agenda.read(owner).backlog.length>0);
});

test('acknowledgement retry does not replace a newer Agenda, and Work estimates never create deadlines',async t=>{
 const owner='agenda_retry';store.create(owner,{tasks:[{id:'retry-a',name:'Retry A',estimatedTimeMs:60000},{id:'retry-b',name:'Retry B',estimatedTimeMs:60000}]});
 const first={requestId:'agenda-first',revision:agenda.read(owner).revision,tasks:[{id:'retry-a',dueAt:null},{id:'retry-b',dueAt:null}]};
 const acknowledgement=agenda.save(owner,first);
 agenda.save(owner,{revision:agenda.read(owner).revision,tasks:[{id:'retry-b',dueAt:null},{id:'retry-a',dueAt:null}]});
 assert.deepEqual(agenda.save(owner,first),acknowledgement);assert.equal(agenda.read(owner).agenda[0].id,'retry-b');
 const page=await pageFor(t,'work_no_deadlines');page.on('dialog',dialog=>dialog.accept());
 await page.locator('#workBtn').click();await page.locator('#createNewListBtn').click();await page.getByRole('button',{name:'Yes, I have a definite stop time.'}).click();await page.locator('#availableTime').fill('5');await page.locator('#timeConstraintNextBtn').click();
 await page.locator('#tasks').fill('Overruns session, 15m');await page.locator('#skipSortCheckbox').check();await page.locator('#startSort').click();await page.waitForSelector('#dashboardScreen');await page.waitForFunction(()=>!window.TaskGraph.pending());
 const task=store.snapshot('work_no_deadlines').nodes.find(row=>row.name==='Overruns session');assert.equal(task.estimated_ms,900000);assert.equal(task.deadline_at,null);
});

test('a returning user keeps unfinished open-session work in backlog before Work/Plan appears',async t=>{
 const owner='agenda_return';store.create(owner,{tasks:[{id:'return-task',name:'Carried work',estimatedTimeMs:60000}]});
 agenda.save(owner,{revision:agenda.read(owner).revision,tasks:[{id:'return-task',dueAt:null}]});assert.equal(agenda.read(owner).backlog.length,0);
 graph.prepareSession(owner,{id:'return-session',taskIds:['return-task'],startedAt:Date.now()-2000});
 graph.startInterval(owner,{id:'return-interval',taskId:'return-task',workSessionId:'return-session',startedAt:Date.now()-1000});
 const page=await pageFor(t,owner);assert.equal(await page.locator('#focusScreen').count(),0);assert.equal(agenda.read(owner).backlog[0].id,'return-task');
 assert.ok(db.prepare('SELECT ended_at FROM work_intervals WHERE id=?').get('return-interval').ended_at);
});

test('completed Work tasks stay out of backlog and repeated Plan entries after reload',async t=>{
 const owner='agenda_completed';store.create(owner,{tasks:[{id:'completed-a',name:'Finish this task',estimatedTimeMs:60000},{id:'completed-b',name:'Keep this unfinished',estimatedTimeMs:60000}]});
 const page=await pageFor(t,owner);
 await page.locator('#workBtn').click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.waitForSelector('#focusScreen');
 await page.getByRole('button',{name:'Done, Next!',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#focusScreen h2')?.textContent==='Keep this unfinished');await page.waitForFunction(()=>!window.TaskGraph.pending());
 assert.equal(store.snapshot(owner).nodes.find(row=>row.id==='completed-a').status,'completed');
 await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session',exact:true}).click();await page.waitForFunction(()=>!window.TaskGraph.pending());
 for(let visit=0;visit<3;visit++){
  await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();
  if(visit>0){await page.waitForSelector('#agendaScreen');assert.doesNotMatch(await page.locator('#agendaScreen').textContent(),/Finish this task/);continue;}
  await page.waitForSelector('#planDeadlines');
  assert.doesNotMatch(await page.locator('#planDeadlines').textContent(),/Finish this task/);assert.equal(await page.locator('#planDeadlines input').count(),1);
  await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');assert.equal(agenda.read(owner).backlog.length,0);assert.equal(agenda.read(owner).agenda.length,1);
 }
});

test('opening Plan repeatedly reuses saved importance instead of sorting the same backlog again',async t=>{
 const owner='saved_sort';store.create(owner,{tasks:[{id:'saved-sort-a',name:'make dinner',estimatedTimeMs:60000},{id:'saved-sort-b',name:'one more job',estimatedTimeMs:60000}]});
 const page=await pageFor(t,owner);await page.locator('#planBtn').click();await page.locator('#task1').click();await page.waitForSelector('#planDeadlines');await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');
 const ids=agenda.read(owner).agenda.map(row=>row.id);
 for(let visit=0;visit<3;visit++){
  await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();await page.waitForSelector('#agendaScreen');assert.equal(await page.locator('#taskCompare:not(.hidden)').count(),0);assert.deepEqual(agenda.read(owner).agenda.map(row=>row.id),ids);
 }
 // Carry-over work needs deadline review, but no repeat importance comparisons.
 agenda.backlog(owner,ids);await page.evaluate(()=>showModeSelect());await page.locator('#planBtn').click();await page.waitForSelector('#planDeadlines');assert.equal(await page.locator('#taskCompare:not(.hidden)').count(),0);
 await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');await page.getByRole('button',{name:'Reorder importance',exact:true}).click();await page.waitForSelector('#taskCompare:not(.hidden)');assert.deepEqual((await page.locator('#task1,#task2').allTextContents()).sort(),['make dinner','one more job']);
});

test('Plan preserves answered comparisons until Save Agenda and compares only new tasks against the saved order',async t=>{
 const owner='sort_progress';store.create(owner,{tasks:[{id:'progress-a',name:'First saved',estimatedTimeMs:60000},{id:'progress-b',name:'Second saved',estimatedTimeMs:60000}]});
 const page=await pageFor(t,owner);await page.locator('#planBtn').click();await page.locator('#task1').click();await page.waitForSelector('#planDeadlines');
 // Leaving the deadline screen does not throw away completed sorting work.
 await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#planBtn').click();await page.waitForSelector('#planDeadlines');assert.equal(await page.locator('#taskCompare:not(.hidden)').count(),0);
 await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');
 store.create(owner,{tasks:[{id:'progress-c',name:'New unsorted task',estimatedTimeMs:60000}]});
 await page.evaluate(()=>showModeSelect());await page.locator('#planBtn').click();await page.waitForSelector('#taskCompare:not(.hidden)');
 let comparisons=0;while(await page.locator('#taskCompare:not(.hidden)').count()){
  const pair=await page.locator('#task1,#task2').allTextContents();assert.ok(pair.includes('New unsorted task'));comparisons++;await page.locator(pair[0]==='New unsorted task'?'#task2':'#task1').click();
 }
 await page.waitForSelector('#planDeadlines');assert.ok(comparisons>0);await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');
 assert.deepEqual(agenda.read(owner).agenda.map(row=>row.id),['progress-a','progress-b','progress-c']);
});

test('Plan merges sorted backlog as the left list and saved Agenda as the right list using only their heads',async t=>{
 const owner='two_sorted_lists';store.create(owner,{tasks:[{id:'merge-a',name:'Agenda A',estimatedTimeMs:60000},{id:'merge-c',name:'Agenda C',estimatedTimeMs:60000}]});
 agenda.save(owner,{revision:agenda.read(owner).revision,tasks:[{id:'merge-a',dueAt:null},{id:'merge-c',dueAt:null}]});
 store.create(owner,{tasks:[{id:'merge-b',name:'Backlog B',estimatedTimeMs:60000},{id:'merge-d',name:'Backlog D',estimatedTimeMs:60000}]});store.rank(owner,{ids:['merge-b','merge-d']});
 const page=await pageFor(t,owner);await page.locator('#planBtn').click();
 const expected=[['Backlog B','Agenda A'],['Backlog B','Agenda C'],['Backlog D','Agenda C']];
 for(const [index,pair] of expected.entries()){
  await page.waitForSelector('#taskCompare:not(.hidden)');assert.deepEqual(await page.locator('#task1,#task2').allTextContents(),pair);await page.locator(index===1?'#task1':'#task2').click();
 }
 await page.waitForSelector('#planDeadlines');await page.locator('#saveAgenda').click();await page.waitForSelector('#agendaScreen');
 assert.deepEqual(agenda.read(owner).agenda.map(row=>row.id),['merge-a','merge-b','merge-c','merge-d']);assert.equal(agenda.read(owner).backlog.length,0);
});
