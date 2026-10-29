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
    await page.evaluate(()=>window.ProjectPlanner.open());
    await page.waitForFunction(()=>document.querySelector('#plannerReview,#summaryDone,#projectList,#reviewProjects'));
    if(await page.locator('#summaryDone').count())await page.locator('#summaryDone').click();
    if(await page.locator('#plannerReview').count())await page.locator('#plannerReview').click();
    if(await page.locator('#reviewProjects').count())await page.locator('#reviewProjects').click();
    await page.waitForSelector('#projectList');
}
async function fixture(owner) {
    const create=async(id,name,nodeType,parentId,mins=0)=> (await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_'+id,name,nodeType,parentId:parentId?owner+'_'+parentId:null,estimatedTimeMs:mins*60000})).node;
    await create('oars','Oars','project'); await create('left','Left oar shaping','project','oars'); await create('right','Right oar shaping','project','oars');
    for(const [i,m] of [45,60,60,15].entries()) await create('left'+i,i<2?'Same name':'Left '+i,'task','left',m);
    for(const [i,m] of [90,90].entries()) await create('right'+i,'Right '+i,'task','right',m);
    await api(owner,`/users/${owner}/nodes?tree=1`);
}
test('project discovery includes empty/completed projects in Plan and Work after fresh authenticated contexts',async t=>{
    const {page,owner}=await pageFor(t);
    await api(owner,`/users/${owner}/nodes`,'POST',{id:'empty-discover',name:'Empty saved project',nodeType:'project'});
    await api(owner,`/users/${owner}/nodes`,'POST',{id:'done-discover',name:'Completed saved project',nodeType:'project'});
    await api(owner,`/users/${owner}/nodes`,'POST',{id:'done-child',name:'Finished child',parentId:'done-discover',estimatedTimeMs:60000});
    raw.prepare("UPDATE tasks SET status='completed',completed=123 WHERE id='done-child'").run();
    await planProjects(page);await page.waitForSelector('#projectList');
    await expectProjects(page);
    await page.getByRole('button',{name:'Completed saved project',exact:true}).click();await page.locator('#editProject').click();
    assert.match(await page.locator('#projectEditorTasks').textContent(),/Finished child/);
    await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();
    await page.getByRole('button',{name:/Completed saved project —/}).click();assert.equal(await page.getByRole('button',{name:'Start This Project',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Manage',exact:true}).click();assert.match(await page.locator('#projectEditorTasks').textContent(),/Finished child/);
    const fresh=await pageFor(t,owner);await planProjects(fresh.page);await expectProjects(fresh.page);
    const other=await pageFor(t);await planProjects(other.page);assert.equal(await other.page.getByRole('button',{name:'Empty saved project',exact:true}).count(),0);
});
async function expectProjects(page){await page.getByRole('button',{name:'Empty saved project',exact:true}).waitFor();await page.getByRole('button',{name:'Completed saved project',exact:true}).waitFor();}
test('direct task editor offers recursive decomposition without estimates and supports completion/delete/move',async t=>{
    const {page,owner}=await pageFor(t);await fixture(owner);
    await page.evaluate(id=>window.ProjectEditor.open(id),owner+'_oars');await page.getByRole('button',{name:'Left oar shaping',exact:true}).click();
    const row=page.locator('.planner-order-row').filter({has:page.locator(`input[value="${owner}_left0"]`)});await row.getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator('#projectEditorAddSubtask').click();await page.locator('#projectEditorTaskName').fill('Untimed grandchild');await page.locator('#projectEditorTaskDefer').check();await page.locator('#projectEditorTaskNext').click();await page.getByRole('button',{name:'Add at end',exact:true}).click();
    await page.locator('#projectEditorDecomposeSkip').click();assert.match(await page.locator('#projectEditorTasks').textContent(),/Untimed grandchild/);
    const child=raw.prepare('SELECT * FROM tasks WHERE user_id=? AND name=?').get(owner,'Untimed grandchild');assert.equal(child.estimated_ms,0);assert.equal(child.parent_id,owner+'_left0');
    const childRow=page.locator('.planner-order-row').filter({has:page.locator(`input[value="${child.id}"]`)});await childRow.getByRole('button',{name:'Complete',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-node-id="${id}"]`)?.textContent.includes('completed'),child.id);
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(owner+'_left1').status,'pending');
    const completeRow=page.locator(`[data-node-id="${child.id}"]`);await completeRow.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('#confirmProjectTaskDelete').click();await page.waitForSelector('#projectEditorTasks');await page.waitForFunction(id=>!document.querySelector(`[data-node-id="${id}"]`),child.id);assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(child.id).status,'cancelled');
});
test('urgency requires an explicit estimate and deadline and is independent of importance',async t=>{
    const {page}=await pageFor(t);
    const result=await page.evaluate(()=>({missing:BetaInsights.slack({due_at:10000,estimated_ms:0,elapsed_ms:0},1000),known:BetaInsights.slack({due_at:10000,estimated_ms:5000,elapsed_ms:2000},1000)}));
    assert.equal(result.missing,null);assert.equal(result.known,6000);
});
test('UI create/save/delete/edit/decompose/move/complete restores exact totals after reload and server restart',async t=>{
    const {page,owner}=await pageFor(t);
    await page.evaluate(()=>window.ProjectPlanner.open());await page.locator('#plannerCreate').click();await page.locator('#projectName').fill('Repair acceptance');await page.locator('#projectContinue').click();
    await page.locator('#partsText').fill('Ten, 10m\nTwenty, 20m\nThirty, 30m');await page.locator('#partsSkipSort').check();await page.locator('#partsContinue').click();await page.locator('#editProject').click();await page.waitForSelector('#projectEditorTasks');
    const byName=name=>raw.prepare('SELECT * FROM tasks WHERE user_id=? AND name=?').get(owner,name);
    const root=byName('Repair acceptance'),ten=byName('Ten'),twenty=byName('Twenty'),thirty=byName('Thirty');
    const estimate=id=>raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(id).estimated_ms;
    assert.equal(estimate(root.id),60*60000);
    const row=id=>page.locator(`[data-node-id="${id}"]`);
    await row(twenty.id).getByRole('button',{name:'Delete',exact:true}).click();await page.locator('#confirmProjectTaskDelete').click();await page.waitForFunction(()=>document.querySelector('#dynamicContainer')?.textContent.includes('40 min planned'));assert.equal(estimate(root.id),40*60000);
    await row(thirty.id).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#projectEditorEditMinutes').fill('45');await page.locator('#projectEditorEditSave').click();await page.waitForFunction(()=>document.querySelector('#dynamicContainer')?.textContent.includes('55 min planned'));assert.equal(estimate(root.id),55*60000);
    await row(thirty.id).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#projectEditorAddSubtask').click();await page.locator('#projectEditorTaskName').fill('Fifteen grandchild');await page.locator('#projectEditorTaskMinutes').fill('15');await page.locator('#projectEditorTaskNext').click();await page.getByRole('button',{name:'Add at end',exact:true}).click();await page.locator('#projectEditorDecomposeSkip').click();
    assert.equal(estimate(root.id),25*60000);assert.equal(estimate(thirty.id),15*60000);assert.equal(byName('Fifteen grandchild').parent_id,thirty.id);
    await page.getByRole('button',{name:'Back',exact:true}).last().click();await page.waitForSelector('#projectEditorProjects');
    const dest=(await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_destination',name:'Move destination',nodeType:'project'})).node;
    await row(thirty.id).getByRole('button',{name:'Move',exact:true}).click();await page.getByRole('button',{name:'Move destination',exact:true}).click();await page.waitForSelector('#projectEditorTasks');assert.equal(estimate(root.id),10*60000);assert.equal(estimate(dest.id),15*60000);assert.equal(estimate(ten.id),10*60000);
    await page.evaluate(id=>ProjectEditor.open(id),dest.id);await page.getByRole('button',{name:'Thirty',exact:true}).click();const child=byName('Fifteen grandchild');await row(child.id).getByRole('button',{name:'Complete',exact:true}).click();await page.waitForFunction(id=>document.querySelector(`[data-node-id="${id}"]`)?.textContent.includes('completed'),child.id);
    assert.equal(byName('Ten').status,'pending');assert.equal(estimate(dest.id),15*60000);assert.match(await page.locator('#dynamicContainer').textContent(),/1\/1 tasks completed/);
    await stopServer();await startServer(Number(new URL(base).port));await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');await planProjects(page);await page.getByRole('button',{name:'Move destination',exact:true}).click();await page.locator('#editProject').click();await page.getByRole('button',{name:'Thirty',exact:true}).click();assert.match(await row(child.id).textContent(),/completed/);assert.equal(estimate(root.id),10*60000);assert.equal(estimate(dest.id),15*60000);
});
test('Plan can save untimed parts and editing can defer estimates until execution',async t=>{
    const {page,owner}=await pageFor(t);await page.evaluate(()=>window.ProjectPlanner.open());await page.locator('#plannerCreate').click();await page.locator('#projectName').fill('Estimate later');await page.locator('#projectContinue').click();await page.locator('#partsText').fill('Untimed part');await page.locator('#partsSkipSort').check();await page.locator('#partsDeferEstimates').check();await page.locator('#partsContinue').click();await page.locator('#editProject').click();
    await page.waitForSelector('#projectEditorTasks');assert.match(await page.locator('#dynamicContainer').textContent(),/remaining estimate Unestimated/);const leaf=raw.prepare('SELECT * FROM tasks WHERE user_id=? AND name=?').get(owner,'Untimed part');assert.equal(leaf.estimated_ms,0);
    await page.locator(`[data-node-id="${leaf.id}"]`).getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#projectEditorEditName').fill('Renamed without estimate');await page.locator('#projectEditorEditSave').click();await page.waitForSelector('#projectEditorTasks');assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(leaf.id).estimated_ms,0);
    await page.evaluate(()=>showModeSelect());await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();await page.getByRole('button',{name:/Estimate later —/}).click();await page.getByRole('button',{name:'Start This Project',exact:true}).click();await page.waitForSelector('#deadlinePage');assert.equal(intervalRows(owner).length,0,'untimed work never starts an interval');await page.evaluate(()=>{window.currentWorkProjectContext.startedAtMs=Date.now()-600000;});await page.locator('#deadlinePage input').fill('2');await page.getByRole('button',{name:'Start Task',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get(leaf.id).estimated_ms,120000);await page.waitForFunction(()=>document.querySelector('.project-work-toolbar')?.dataset.estimatedMs==='120000');assert.equal(await page.locator('.project-work-toolbar').getAttribute('data-elapsed-ms'),'0');assert.match(await page.locator('.project-work-toolbar').textContent(),/saved actual/);
});
test('metrics retain former-leaf actual once and exclude deleted estimates from the summary',async t=>{
    const {page}=await pageFor(t);
    const exported=await page.evaluate(()=>BetaInsights.csv([
        {id:'parent',name:'Parent',node_type:'project',estimated_ms:600000,elapsed_ms:150000,own_elapsed_ms:60000,status:'pending'},
        {id:'leaf',parent_id:'parent',name:'Leaf',node_type:'task',estimated_ms:600000,elapsed_ms:30000,status:'pending'},
        {id:'deleted',parent_id:'parent',name:'Retained history',node_type:'task',estimated_ms:1200000,elapsed_ms:60000,status:'cancelled'}
    ]));
    const summary=exported.trim().split('\n').at(-1).split(',');assert.deepEqual(summary.slice(5),['10.00','2.50','-7.50']);
});
