'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');
const { chromium } = require('playwright');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttask-focus-browser-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
process.env.CLERK_TELEMETRY_DISABLED = 'true';
const domain = 'focus-fixture.clerk.accounts.dev';
const publishableKey = `pk_test_${Buffer.from(domain + '$').toString('base64')}`;
process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: 'spki', format: 'pem' });
require('../backend/server');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
let server, base, browser;
let counter = 0;
const raw = new Database(path.join(directory, 'task_sorter.db'));
function token(owner) {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'fixture' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: `https://${domain}`, sub: owner, sid: 'sess_fixture', iat: now, nbf: now - 1, exp: now + 600, azp: 'http://localhost:3000' })).toString('base64url');
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}
async function api(owner, url, method = 'GET', body) {
    const response = await fetch(base + '/api' + url, { method, headers: { Authorization: `Bearer ${token(owner)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    assert.ok(response.ok, `${method} ${url}: ${response.status} ${data.error || ''}`);
    return data;
}
async function startServer(port) {
    server = spawn(process.execPath, ['-e', `
        const {createApp}=require('./backend/server');
        createApp({publishableKey:process.env.CLERK_PUBLISHABLE_KEY, secretKey:'sk_test_offline_fixture',jwtKey:process.env.NEXTTASK_FIXTURE_JWT_KEY})
            .listen(Number(process.env.PORT),'127.0.0.1',()=>process.send({ready:true}));
    `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), NEXTTASK_FIXTURE_JWT_KEY: jwtKey }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    await new Promise((resolve, reject) => { server.once('message', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Fixture server exited: ${code}`))); });
}
async function stopServer() {
    const exiting = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await exiting;
}
test.before(async () => {
    const reservation = require('node:net').createServer().listen(0, '127.0.0.1');
    await new Promise(resolve => reservation.once('listening', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    process.env.FRONTEND_ORIGINS = base;
    await startServer(port);
    const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
test.after(async () => {
    await browser?.close();
    if (server) await stopServer();
    raw.close();
    fs.rmSync(directory, { recursive: true, force: true });
});
async function pageFor(t, existingOwner) {
    const owner = existingOwner || `browser_${++counter}`;
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.audioPulses = 0;
        window.AudioContext = class {
            state = 'running'; currentTime = 0; destination = {};
            createOscillator() { return { frequency:{value:0}, connect(){}, start(){window.audioPulses++;}, stop(){} }; }
            createGain() { return { connect(){}, gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}} }; }
        };
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
    await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await context.route(`https://${domain}/**`, route => route.fulfill({ contentType: 'application/javascript', body: `
        window.Clerk = window.Clerk || {
            isSignedIn:true, user:{id:${JSON.stringify(owner)}},
            session:{id:'sess_fixture', async getToken(){ if(window.tokenGate) await window.tokenGate; return ${JSON.stringify(token(owner))}; }},
            async load(){}, mountUserButton(){}, addListener(listener){ window.accountListener=listener; }
        };
    ` }));
    page.setDefaultTimeout(10000);
    await page.goto(base);
    await page.waitForFunction(() => window.FocusDurability && !document.getElementById('taskSorterApp').classList.contains('hidden') && !document.getElementById('modeSelect').classList.contains('hidden'));
    return { page, owner, context };
}
async function newList(page, skip = true) {
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.locator('#createNewListBtn').click();
    await page.getByRole('button', { name: "No, I don't have a set stop time." }).click();
    await page.locator('#tasks').fill('Alpha, 1m\nBeta, 2m');
    await page.locator('#skipSortCheckbox').setChecked(skip);
    await page.locator('#startSort').click();
    if (!skip) { await page.locator('#task1').click(); }
    await page.waitForSelector('#dashboardScreen');
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.waitForSelector('#focusScreen');
}
async function idle(page) { await page.waitForFunction(() => !window.TaskGraph.pending()); }
function intervalRows(owner) { return raw.prepare('SELECT * FROM work_intervals WHERE user_id=? ORDER BY created_at,id').all(owner); }
function sessionRows(owner) { return raw.prepare('SELECT * FROM work_sessions WHERE user_id=?').all(owner); }

async function planProjects(page) {
    await page.getByRole('button',{name:'Plan',exact:true}).click();
    await page.locator('#plannerReview').click(); await page.locator('#reviewProjects').click();
}
async function fixture(owner) {
    const create=async(id,name,nodeType,parentId,mins=0)=> (await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_'+id,name,nodeType,parentId:parentId?owner+'_'+parentId:null,estimatedTimeMs:mins*60000})).node;
    await create('oars','Oars','project'); await create('left','Left oar shaping','project','oars'); await create('right','Right oar shaping','project','oars');
    for(const [i,m] of [45,60,60,15].entries()) await create('left'+i,i<2?'Same name':'Left '+i,'task','left',m);
    for(const [i,m] of [90,90].entries()) await create('right'+i,'Right '+i,'task','right',m);
    await api(owner,`/users/${owner}/nodes?tree=1`);
}

async function guestFor(t,mode='unavailable') {
    const context=await browser.newContext({viewport:{width:390,height:844}});t.after(()=>context.close());
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const privateRequests=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['/api/config','/api/health'].includes(new URL(r.url()).pathname))privateRequests.push(r.url());});
    await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:''}));
    await context.route('**/api/config',async route=>{if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,3000));try{await route.fulfill({status:503,contentType:'application/json',body:'{"error":"fixture offline"}'});}catch(_){} });
    await page.goto(base);await page.waitForFunction(()=>window.taskSorterMode==='guest'&&window.FocusDurability&&!document.getElementById('taskSorterApp').classList.contains('hidden'));
    return {page,privateRequests,context};
}
async function entry(page,text,sort=false) {
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#createNewListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.locator('#tasks').fill(text);await page.locator('#skipSortCheckbox').setChecked(!sort);await page.locator('#startSort').click();
    if(sort)while(await page.locator('#taskCompare:not(.hidden)').count())await page.locator('#task1').click();
}
test('shared parser supports structured mixed compact/multiline records without consuming duration tokens as names',async t=>{
    const {page}=await pageFor(t);
    const parsed=await page.evaluate(()=>parseTaskEntries('Alpha, 5m, Beta\nSame, 2m\nSame\nDiscuss X, Y\n0m'));
    assert.deepEqual(parsed,{entries:[{name:'Alpha',estimatedTimeMs:300000},{name:'Beta',estimatedTimeMs:0},{name:'Same',estimatedTimeMs:120000},{name:'Same',estimatedTimeMs:0},{name:'Discuss X, Y',estimatedTimeMs:0}],invalid:['0m']});
    page.on('dialog',dialog=>dialog.accept());await entry(page,'Repeat, 1m\nRepeat, 3m',true);await page.waitForSelector('#dashboardScreen');await idle(page);
    const rows=raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name LIKE 'Repeat%' ORDER BY position").all((await page.evaluate(()=>userId)));
    assert.deepEqual(rows.map(row=>[row.name,row.estimated_ms]),[['Repeat',60000],['Repeat again',180000]]);assert.notEqual(rows[0].id,rows[1].id);
});
test('offline and slow-config guest startup completes a local workflow/reload with zero private HTTP requests',async t=>{
    for(const mode of ['unavailable','slow']){
        const {page,privateRequests}=await guestFor(t,mode);
        await entry(page,'Local timed, 1m, Local untimed',true);
        await page.waitForSelector('#timingEntryScreen');await page.locator('#timingEntryScreen input').fill('2');await page.getByRole('button',{name:'Save & Continue'}).click();await page.waitForSelector('#dashboardScreen');
        await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');
        await page.getByRole('button',{name:'Done, Next!'}).click();await page.waitForFunction(()=>document.querySelector('#focusScreen h2')?.textContent.includes('Local untimed'));
        await page.reload();await page.waitForSelector('#dashboardScreen');assert.equal(await page.locator('#focusScreen').count(),0);
        const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('nexttaskGuestGraph_v1')));assert.equal(Object.values(state.nodes).find(row=>row.name==='Local timed').status,'completed');
        await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session'}).click();await page.waitForSelector('#dashboardScreen');
        assert.deepEqual(privateRequests,[]);assert.equal(await page.locator('#planBtn').isDisabled(),true);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'guest workflow fits mobile viewport');
    }
});
test('guest and authenticated account storage remain separate with no automatic guest upload',async t=>{
    const {page:guestPage,context}=await guestFor(t);await entry(guestPage,'Guest only, 1m');await guestPage.waitForSelector('#dashboardScreen');
    const keys=await guestPage.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
    const {page,owner}=await pageFor(t);await page.evaluate(keys=>{for(const [key,value]of Object.entries(keys))localStorage.setItem(key,value);},keys);await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND name='Guest only'").get(owner).n,0);
    assert.ok(await page.evaluate(()=>localStorage.getItem('nexttaskGuestGraph_v1')));assert.equal(await page.locator('#guestNotice').isVisible(),false);
});
test('optional pairwise importance/deadline matrix persists owned fields without changing canonical structure or Work order',async t=>{
    const {page,owner}=await pageFor(t);await fixture(owner);
    const before=raw.prepare('SELECT id,parent_id,position,estimated_ms,elapsed_ms FROM tasks WHERE user_id=? ORDER BY id').all(owner);
    await page.locator('#insightsBtn').click();await page.waitForSelector('#priorityTable');assert.match(await page.locator('#dynamicContainer').textContent(),/Timezone:/);assert.match(await page.locator('#priorityTable').textContent(),/Unspecified/);
    await page.locator('#rankImportance').click();await page.locator('#cancelImportance').click();await page.waitForSelector('#priorityTable');assert.match(await page.locator('#priorityTable').textContent(),/Unspecified/);
    await page.locator('#rankImportance').click();while(await page.locator('#taskCompare:not(.hidden)').count())await page.locator('#task1').click();await page.waitForSelector('#priorityTable');
    const first=page.locator('#priorityTable tr[data-task-id]').first();const firstId=await first.getAttribute('data-task-id');await first.locator('input[type=datetime-local]').fill('2020-01-01T12:00');await first.getByRole('button',{name:'Save due'}).click();await page.waitForFunction(()=>document.querySelector('#priorityTable')?.textContent.includes('latest-start overdue'));
    const saved=raw.prepare('SELECT * FROM task_priorities WHERE task_id=?').get(firstId);assert.ok(saved.due_at);assert.equal(saved.importance_rank,1);
    await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await page.locator('#insightsBtn').click();await page.waitForSelector('#priorityTable');assert.equal(await page.locator(`[data-task-id="${firstId}"] input`).inputValue(),'2020-01-01T12:00');
    assert.deepEqual(raw.prepare('SELECT id,parent_id,position,estimated_ms,elapsed_ms FROM tasks WHERE user_id=? ORDER BY id').all(owner),before);
    assert.equal(intervalRows(owner).length,0);assert.equal(sessionRows(owner).length,0);
    await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:'Entire Task List',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);
    const {items}=await api(owner,`/work-sessions/${sessionRows(owner)[0].id}`);assert.deepEqual(items.map(row=>row.id),[owner+'_left0',owner+'_left1',owner+'_left2',owner+'_left3',owner+'_right0',owner+'_right1']);
});
test('hierarchy metrics export canonical IDs/minute units without double counting; direct root edit persists its ID',async t=>{
    const {page,owner}=await pageFor(t);await fixture(owner);await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_loose',name:'Loose, quoted "task"',estimatedTimeMs:60000});
    raw.prepare('UPDATE tasks SET elapsed_ms=? WHERE id=?').run(30000,owner+'_loose');
    await page.locator('#metricsBtn').click();await page.waitForSelector('#metricsExport');
    const csv=await page.evaluate(async()=>window.BetaInsights.csv((await window.TaskGraph.request(`/users/${userId}/nodes?tree=1`)).nodes.flatMap(function flatten(row){return [row,...(row.children||[]).flatMap(flatten)];})));
    assert.match(csv,/Canonical ID,Parent ID,Node type/);assert.match(csv,/"Loose, quoted ""task"""/);assert.match(csv,/summary-leaves,Leaf totals including retained history,,361\.00,0\.50,-360\.50/);
    const row=page.locator(`[data-node-id="${owner}_loose"]`);await row.getByRole('button',{name:'Edit / Move task',exact:true}).click();await page.locator('#projectEditorEditName').fill('Loose edited');await page.locator('#projectEditorEditMinutes').fill('2');await page.locator('#projectEditorEditSave').click();await page.waitForSelector('#metricsExport');
    const saved=raw.prepare('SELECT * FROM tasks WHERE id=?').get(owner+'_loose');assert.equal(saved.name,'Loose edited');assert.equal(saved.elapsed_ms,30000);assert.equal(saved.estimated_ms,120000);assert.equal(saved.parent_id,null);
});

test('complete beta session: local guest, untimed project/nesting/edit, Work blocker/add/reload/Done/Stop and clean standalone context',async t=>{
    const {page:guestPage,privateRequests}=await guestFor(t);await entry(guestPage,'Guest first, 1m');await guestPage.waitForSelector('#dashboardScreen');assert.deepEqual(privateRequests,[]);
    const {page,owner}=await pageFor(t);page.on('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Plan',exact:true}).click();await page.locator('#plannerCreate').click();await page.locator('#projectName').fill('Journey');await page.locator('#projectContinue').click();await page.locator('#partsText').fill('First\nSecond, 2m');await page.locator('#partsSkipSort').check();await page.locator('#partsContinue').click();await page.locator('#timingEntryScreen input').fill('1');await page.getByRole('button',{name:'Save & Continue'}).click();await page.locator('#editProject').click();
    const root=raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Journey'").get(owner);
    await page.locator('#projectEditorAddProject').click();await page.locator('#projectEditorProjectName').fill('Inner');await page.locator('#projectEditorProjectSave').click();await page.locator('#projectEditorAddTask').click();await page.locator('#projectEditorTaskName').fill('Nested');await page.locator('#projectEditorTaskNext').click();await page.locator('#timingEntryScreen input').fill('3');await page.getByRole('button',{name:'Save & Continue'}).click();await page.getByRole('button',{name:'Add at end'}).click();await page.waitForSelector('#projectEditorTasks');
    const nested=raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Nested'").get(owner);
    await page.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#projectEditorEditMinutes').fill('4');await page.locator('#projectEditorEditSave').click();await page.waitForSelector('#projectEditorTasks');assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(root.id).estimated_ms,7*60000);assert.equal(raw.prepare('SELECT id FROM tasks WHERE id=?').get(nested.id).id,nested.id);
    await page.evaluate(()=>showModeSelect());await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:'Journey —',exact:false}).click();await page.getByRole('button',{name:'Start This Project'}).click();await page.waitForSelector('#focusScreen');await idle(page);
    await page.getByRole('button',{name:'Blocked',exact:true}).click();await page.locator('#blockedTaskScreen input').fill('Fix prerequisite');await page.getByRole('button',{name:'Add Blocker and Requeue Both'}).click();await page.locator('#timingEntryScreen input').fill('1');await page.getByRole('button',{name:'Save & Continue'}).click();await page.waitForSelector('#dashboardScreen');await idle(page);await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');
    await page.getByRole('button',{name:'Add New Task'}).click();await page.locator('#addTaskPage input').fill('Standalone inserted');await page.getByRole('button',{name:'Choose Work Position'}).click();await page.locator('#timingEntryScreen input').fill('1');await page.getByRole('button',{name:'Save & Continue'}).click();await page.getByRole('button',{name:'Do this next'}).click();await page.waitForSelector('#focusScreen');await idle(page);
    await page.reload();await page.waitForSelector('#dashboardScreen');await idle(page);await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await page.getByRole('button',{name:'Done, Next!'}).click();await page.waitForFunction(()=>document.querySelector('#focusScreen h2')?.textContent.includes('Standalone inserted'));await idle(page);assert.equal(await page.locator('.project-work-toolbar').count(),0);
    await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session'}).click();await page.waitForSelector('#dashboardScreen');await idle(page);assert.ok(intervalRows(owner).every(row=>row.ended_at!==null));
    await page.evaluate(()=>resetAll());await page.waitForSelector('#modeSelect:not(.hidden)');await entry(page,'Unrelated new list, 1m');await page.waitForSelector('#dashboardScreen');await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);assert.equal(await page.locator('.project-work-toolbar').count(),0);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND name='Guest first'").get(owner).n,0);
});

test('selected blocked-only project explains eligibility and never prepares a queue or loses its prerequisite',async t=>{
    const {page,owner}=await pageFor(t);
    await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_blocked_project',name:'Blocked selection',nodeType:'project'});
    await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_blocked',name:'Blocked leaf',parentId:owner+'_blocked_project',estimatedTimeMs:60000});
    await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_prerequisite',name:'Outside prerequisite',estimatedTimeMs:60000});
    await api(owner,`/session/${owner}/tasks`,'PUT',{tasks:[{id:owner+'_blocked',name:'Blocked leaf',status:'blocked',blockedByTaskId:owner+'_prerequisite',estimatedTimeMs:60000}]});
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:'Blocked selection —',exact:false}).click();await page.getByRole('button',{name:'Start This Project'}).click();await page.waitForSelector('#blockedOnlyState');await idle(page);
    assert.equal(await page.getByRole('button',{name:'Get to Work',exact:true}).isDisabled(),true);assert.equal(sessionRows(owner).length,0);assert.equal(intervalRows(owner).length,0);assert.equal(raw.prepare('SELECT blocked_by_task_id FROM tasks WHERE id=?').get(owner+'_blocked').blocked_by_task_id,owner+'_prerequisite');
});
