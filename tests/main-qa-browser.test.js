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
test('B1: sorting tears down an outgoing timing screen and markup has no literal newline text', async t=>{
    const {page}=await pageFor(t);
    assert.deepEqual(await page.evaluate(()=>parseTaskEntries('1\n5m\n0m\nEmail, 10m')), {entries:[{name:'1',estimatedTimeMs:0},{name:'Email',estimatedTimeMs:600000}],invalid:['5m','0m']});
    await page.evaluate(()=>{sortedTasks=[createTask('One')];showSequentialTiming();prepareSortingDisplay(createTask('Sort Tasks',{estimatedTimeMs:60000}));});
    assert.equal(await page.locator('#timingEntryScreen').count(),0);
    assert.equal(await page.locator('body').evaluate(e=>Array.from(e.childNodes).filter(n=>n.nodeType===3).some(n=>n.textContent.includes('\\n'))),false);
});
test('B2: untimed add and blocker collect estimates before durable insertion, cancel resumes safely',async t=>{
    const {page,owner}=await pageFor(t); await newList(page); await idle(page);
    await page.getByRole('button',{name:'Add New Task'}).click(); await page.locator('#addTaskPage input').fill('Untimed'); await page.getByRole('button',{name:'Choose Work Position'}).click();
    await page.waitForSelector('#timingEntryScreen'); assert.equal(raw.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND name='Untimed'").get(owner).n,0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click(); await page.waitForSelector('#focusScreen'); await idle(page);
    await page.getByRole('button',{name:'Blocked',exact:true}).click(); await page.locator('#blockedTaskScreen input').fill('Prerequisite'); await page.getByRole('button',{name:'Add Blocker and Requeue Both'}).click();
    await page.waitForSelector('#timingEntryScreen'); await page.locator('#timingEntryScreen input').fill('3'); await page.getByRole('button',{name:'Save & Continue'}).click(); await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(raw.prepare("SELECT estimated_ms FROM tasks WHERE user_id=? AND name='Prerequisite'").get(owner).estimated_ms,180000);
    assert.ok(intervalRows(owner).every(r=>r.ended_at!==null));
});
test('B3: mixed project entry, both sort choices, optional container estimate and duplicate occurrences',async t=>{
    for(const skip of [true,false]) {
        const {page,owner}=await pageFor(t); page.on('dialog',d=>d.accept());
        await page.getByRole('button',{name:'Plan',exact:true}).click(); await page.locator('#plannerCreate').click(); await page.locator('#projectName').fill('qa'); await page.locator('#projectContinue').click();
        await page.waitForSelector('#partsText'); await page.locator('#partsText').fill('Plain\nTimed, 2m\nTimed, 3m'); await page.locator('#partsSkipSort').setChecked(skip); await page.locator('#partsContinue').click();
        if(!skip) {while(await page.locator('#taskCompare:not(.hidden)').count()) await page.locator('#task1').click();}
        await page.waitForSelector('#timingEntryScreen'); await page.locator('#timingEntryScreen input').fill('1'); await page.getByRole('button',{name:'Save & Continue'}).click(); await page.waitForSelector('#editProject');
        const tasks=raw.prepare("SELECT name,estimated_ms FROM tasks WHERE user_id=? AND node_type='task' ORDER BY position").all(owner);
        assert.deepEqual(tasks.map(x=>[x.name,x.estimated_ms]),[['Plain',60000],['Timed',120000],['Timed again',180000]]);
        await page.locator('#editProject').click(); await page.locator('#projectEditorAddProject').click(); await page.locator('#projectEditorProjectName').fill('Nested'); await page.locator('#projectEditorProjectSave').click(); await page.waitForSelector('#projectEditorTasks');
        assert.equal(raw.prepare("SELECT estimated_ms FROM tasks WHERE user_id=? AND name='Nested'").get(owner).estimated_ms,0);
    }
});
test('B4/B5/B6/B7: shared ID editor preserves history/duplicate estimates and refreshes Oars totals',async t=>{
    const {page,owner}=await pageFor(t); await fixture(owner);
    await planProjects(page); await page.getByRole('button',{name:'Oars',exact:true}).click(); await page.locator('#editProject').click(); await page.waitForSelector('#projectEditorTasks');
    await page.getByRole('button',{name:'Left oar shaping',exact:true}).click();
    const row=page.locator('.planner-order-row').filter({has:page.locator(`input[value="${owner}_left0"]`)});
    await row.getByRole('button',{name:'Edit',exact:true}).click();
    assert.equal(await page.locator('#projectEditorEditMinutes').inputValue(),'45'); assert.equal(await page.locator('#projectEditorEditName').inputValue(),'Same name');
    await page.locator('#projectEditorEditSave').click(); await page.waitForSelector('#projectEditorTasks');
    await row.getByRole('button',{name:'Edit',exact:true}).click(); await page.locator('#projectEditorEditMinutes').fill('30'); await page.locator('#projectEditorEditName').fill('Renamed');
    let release; const gate=new Promise(r=>release=r); await page.route(`**/nodes/${owner}_left0`,async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();await gate;await route.fulfill({response});});
    await page.locator('#projectEditorEditSave').click(); assert.equal(await page.locator('#projectEditorEditSave').isDisabled(),true); release(); await page.waitForSelector('#projectEditorTasks');
    assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_left').estimated_ms,165*60000);
    assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_oars').estimated_ms,345*60000);
    assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_left1').estimated_ms,60*60000);
    assert.equal(raw.prepare('SELECT parent_id FROM tasks WHERE id=?').get(owner+'_left0').parent_id,owner+'_left');
    await page.getByRole('button',{name:'Back',exact:true}).last().click(); await page.getByRole('button',{name:'Back',exact:true}).last().click(); await page.waitForSelector('#projectList');
    await stopServer(); await startServer(Number(new URL(base).port));
    await page.reload(); await page.waitForSelector('#modeSelect:not(.hidden)');
    await page.getByRole('button',{name:'Work',exact:true}).click(); await page.locator('#resumeExistingListBtn').click(); await page.getByRole('button',{name:"No, I don't have a set stop time."}).click(); await page.getByRole('button',{name:'Oars —',exact:false}).click(); await page.getByRole('button',{name:'Manage',exact:true}).click(); await page.getByRole('button',{name:'Left oar shaping',exact:true}).click();
    assert.match(await page.locator('#dynamicContainer').textContent(),/165 min/);
    await page.getByRole('button',{name:'Back',exact:true}).last().click(); await page.getByRole('button',{name:'Back',exact:true}).last().click(); await page.waitForSelector('#workProjectOverviewScreen'); assert.match(await page.locator('#workProjectOverviewScreen').textContent(),/345 minutes/);
});
test('B8: project context never follows a standalone active task, including recovery',async t=>{
    const {page,owner}=await pageFor(t); await fixture(owner);
    await page.getByRole('button',{name:'Work',exact:true}).click(); await page.locator('#resumeExistingListBtn').click(); await page.getByRole('button',{name:"No, I don't have a set stop time."}).click(); await page.getByRole('button',{name:'Oars —',exact:false}).click(); await page.getByRole('button',{name:'Start This Project'}).click(); await page.waitForSelector('#focusScreen'); await idle(page);
    assert.match(await page.locator('.project-work-toolbar').textContent(),/Oars/);
    await page.getByRole('button',{name:'Add New Task'}).click(); await page.locator('#addTaskPage input').fill('Standalone, 1m'); await page.getByRole('button',{name:'Choose Work Position'}).click(); await page.getByRole('button',{name:'Do this next'}).click(); await page.waitForSelector('#focusScreen'); await idle(page);
    await page.getByRole('button',{name:'Done, Next!'}).click(); await page.waitForFunction(()=>document.querySelector('#focusScreen h2')?.textContent.includes('Standalone')); await idle(page);
    assert.equal(await page.locator('.project-work-toolbar').count(),0);
    await page.reload(); await page.waitForSelector('#dashboardScreen'); await idle(page); await page.getByRole('button',{name:'Get to Work',exact:true}).click(); await page.waitForSelector('#focusScreen'); assert.equal(await page.locator('.project-work-toolbar').count(),0);
});
test('B1/B3 full untimed work journey sorts one screen, estimates only missing entries, reload stays paused',async t=>{
    const {page,owner}=await pageFor(t);
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#createNewListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.locator('#tasks').fill('1\n2, 2m\n3\n4\n5');
    await page.locator('#startSort').click();await page.waitForSelector('#taskCompare:not(.hidden)');
    assert.equal(await page.locator('#timingEntryScreen,#deadlinePage,#focusScreen').count(),0);
    while(await page.locator('#taskCompare:not(.hidden)').count())await page.locator('#task1').click();
    for(let i=0;i<4;i++){await page.waitForSelector('#timingEntryScreen');assert.doesNotMatch(await page.locator('#timingEntryScreen h2').textContent(),/Estimate: 2$/);await page.locator('#timingEntryScreen input').fill('1');await page.getByRole('button',{name:'Save & Continue'}).click();}
    await page.waitForSelector('#dashboardScreen');await idle(page);
    assert.equal(intervalRows(owner).length,0);assert.equal(raw.prepare("SELECT estimated_ms FROM tasks WHERE user_id=? AND name='2'").get(owner).estimated_ms,120000);
    await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);
    assert.equal(intervalRows(owner).filter(r=>r.ended_at===null).length,1);
    await page.reload();await page.waitForSelector('#dashboardScreen');await idle(page);assert.ok(intervalRows(owner).every(r=>r.ended_at!==null));assert.equal(await page.locator('#timingEntryScreen,#deadlinePage,#focusScreen').count(),0);
});
test('B2 untimed Add Task and project Add Task await the shared estimate continuation',async t=>{
    const {page,owner}=await pageFor(t);await newList(page);await idle(page);
    await page.getByRole('button',{name:'Add New Task'}).click();await page.locator('#addTaskPage input').fill('Inserted');await page.getByRole('button',{name:'Choose Work Position'}).click();await page.locator('#timingEntryScreen input').fill('4');await page.getByRole('button',{name:'Save & Continue'}).click();
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND name='Inserted'").get(owner).n,0);
    await page.getByRole('button',{name:'Do this next'}).click();await page.waitForSelector('#focusScreen');await idle(page);assert.equal(raw.prepare("SELECT estimated_ms FROM tasks WHERE user_id=? AND name='Inserted'").get(owner).estimated_ms,240000);
    await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session'}).click();await page.waitForSelector('#dashboardScreen');await idle(page);
    await page.evaluate(()=>resetAll());await page.waitForSelector('#modeSelect:not(.hidden)');await fixture(owner);await planProjects(page);await page.getByRole('button',{name:'Oars',exact:true}).click();await page.locator('#editProject').click();await page.locator('#projectEditorAddTask').click();await page.locator('#projectEditorTaskName').fill('New child');await page.locator('#projectEditorTaskNext').click();await page.locator('#timingEntryScreen input').fill('5');await page.getByRole('button',{name:'Save & Continue'}).click();await page.getByRole('button',{name:'Add at end'}).click();await page.waitForSelector('#projectEditorTasks');
    assert.equal(raw.prepare("SELECT estimated_ms FROM tasks WHERE user_id=? AND name='New child'").get(owner).estimated_ms,300000);
});
test('B6/B7 move and undo refresh nested editor totals, root navigation survives order/deleted rows',async t=>{
    const {page,owner}=await pageFor(t);await fixture(owner);
    await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_decoy',name:'Decoy',nodeType:'project',position:1});
    await planProjects(page);await api(owner,`/users/${owner}/nodes/${owner}_decoy`,'DELETE');
    await page.getByRole('button',{name:'Oars',exact:true}).click();await page.locator('#editProject').click();await page.getByRole('button',{name:'Left oar shaping',exact:true}).click();
    const row=page.locator('.planner-order-row').filter({has:page.locator(`input[value="${owner}_left3"]`)});await row.getByRole('button',{name:'Move',exact:true}).click();await page.getByRole('button',{name:'Right oar shaping',exact:true}).click();await page.waitForSelector('#projectEditorTasks');assert.match(await page.locator('#dynamicContainer').textContent(),/165 min planned/);assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_right').estimated_ms,195*60000);
    await page.locator('#projectEditorUndo').click();await page.waitForFunction(()=>document.querySelector('#dynamicContainer')?.textContent.includes('180 min planned'));assert.equal(raw.prepare('SELECT parent_id FROM tasks WHERE id=?').get(owner+'_left3').parent_id,owner+'_left');
    const first=page.locator('.planner-order-row').filter({has:page.locator(`input[value="${owner}_left0"]`)});await first.getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#projectEditorEditName').fill('Discarded');await page.locator('#projectEditorEditCancel').click();await page.waitForSelector('#projectEditorTasks');assert.equal(raw.prepare('SELECT name FROM tasks WHERE id=?').get(owner+'_left0').name,'Same name');
    await page.locator('#projectEditorSortLevel').click();await page.waitForSelector('#taskCompare:not(.hidden)');
    while(await page.locator('#taskCompare:not(.hidden)').count())await page.locator('#task2').click();
    await page.waitForSelector('#projectEditorTasks');assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_left0').estimated_ms,45*60000);assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(owner+'_left1').estimated_ms,60*60000);
    await page.getByRole('button',{name:'Back',exact:true}).last().click();await page.getByRole('button',{name:'Back',exact:true}).last().click();await page.waitForSelector('#projectList');
    await page.getByRole('button',{name:'Oars',exact:true}).click();await page.locator('#editProject').click();await page.getByRole('button',{name:'Back',exact:true}).last().click();await page.waitForSelector('#projectList');assert.equal(intervalRows(owner).length,0);
});
test('B4/B8 stale browser estimates/context yield to canonical edited rows and a fresh standalone list',async t=>{
    const {page,owner}=await pageFor(t);await fixture(owner);
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:'Oars —',exact:false}).click();await page.getByRole('button',{name:'Start This Project'}).click();await page.waitForSelector('#focusScreen');await idle(page);
    await api(owner,`/users/${owner}/nodes/${owner}_left0`,'PUT',{name:'Server edit',estimatedTimeMs:30*60000});
    await page.evaluate(()=>{clearInterval(timerInterval);const s=JSON.parse(localStorage.getItem(LOCAL_STATE_KEY));s.sortedTasks.forEach(t=>t.estimatedTimeMs=999);s.currentWorkProjectContext={id:'wrong',name:'Wrong'};localStorage.setItem(LOCAL_STATE_KEY,JSON.stringify(s));});
    await page.reload();await page.waitForSelector('#dashboardScreen');await idle(page);
    assert.match(await page.locator('#dashboardScreen').textContent(),/Server edit — 30 min/);assert.doesNotMatch(await page.locator('#dashboardScreen').textContent(),/Wrong/);
    await page.evaluate(()=>resetAll());await page.waitForSelector('#modeSelect:not(.hidden)');await newList(page);await idle(page);assert.equal(await page.locator('.project-work-toolbar').count(),0);
    await page.locator('#stopWorkingBtn').click();await page.getByRole('button',{name:'End Work Session'}).click();await page.waitForSelector('#dashboardScreen');await idle(page);
    await page.evaluate(()=>resetAll());await page.waitForSelector('#modeSelect:not(.hidden)');await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:'Entire Task List'}).click();await page.waitForSelector('#focusScreen');await idle(page);assert.equal(await page.locator('.project-work-toolbar').count(),0);
});
