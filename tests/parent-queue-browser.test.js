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
async function parentsFixture(owner){
    for(const [id,name,type,parent,mins] of [
        ['P','Parent P','project',null,0],['Q','Parent Q','project',null,0],['R','Root peer','task',null,1],
        ['p1','P first','task','P',1],['p2','P second','task','P',2],['q1','Q first','task','Q',1],['q2','Q second','task','Q',2]
    ])await api(owner,`/users/${owner}/nodes`,'POST',{id:owner+'_'+id,name,nodeType:type,parentId:parent?owner+'_'+parent:null,estimatedTimeMs:mins*60000});
}
async function reviewQueue(page,sort=false){
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.locator('#resumeExistingListBtn').click();await page.getByRole('button',{name:"No, I don't have a set stop time."}).click();
    await page.locator('#existingWorkSelectScreen input[type=checkbox]').setChecked(sort);await page.locator('#reviewExistingQueue').click();
}
async function comparePeers(page){
    const choices=[];while(await page.locator('#taskCompare:not(.hidden)').count()){
        choices.push(await page.locator('#task1,#task2').allTextContents());await page.locator('#task1').click();
    }return choices;
}
const ids=(owner,names)=>names.map(name=>owner+'_'+name);
async function queued(owner){const session=sessionRows(owner).at(-1);return (await api(owner,`/work-sessions/${session.id}`)).items.map(row=>row.id);}
test('importance and Work comparisons expose only parent peers; child order and child importance remain intact',async t=>{
    const {page,owner}=await pageFor(t);await parentsFixture(owner);
    await api(owner,`/users/${owner}/priorities/rank`,'PUT',{parentId:owner+'_P',taskIds:ids(owner,['p2','p1'])});
    const childRanks=raw.prepare('SELECT * FROM task_priorities WHERE task_id IN (?,?) ORDER BY task_id').all(...ids(owner,['p1','p2']));
    await page.locator('#insightsBtn').click();await page.waitForSelector('#priorityTable');assert.equal(await page.locator('#priorityTable tr[data-task-id]').count(),3);
    await page.locator('#rankImportance').click();const importance=await comparePeers(page);assert.ok(importance.length>0);
    assert.ok(importance.flat().every(name=>['Parent P','Parent Q','Root peer'].includes(name)));await page.waitForSelector('#priorityTable');
    assert.deepEqual(raw.prepare('SELECT * FROM task_priorities WHERE task_id IN (?,?) ORDER BY task_id').all(...ids(owner,['p1','p2'])),childRanks);
    await page.getByRole('button',{name:'Back',exact:true}).click();await reviewQueue(page,true);await page.waitForSelector('#taskCompare:not(.hidden)');const work=await comparePeers(page);assert.ok(work.flat().every(name=>['Parent P','Parent Q','Root peer'].includes(name)));
    await page.waitForSelector('#dashboardScreen');await idle(page);const order=await queued(owner);
    assert.equal(order.indexOf(owner+'_p2'),order.indexOf(owner+'_p1')+1);assert.equal(order.indexOf(owner+'_q2'),order.indexOf(owner+'_q1')+1);
    assert.equal(intervalRows(owner).length,0);assert.deepEqual(raw.prepare('SELECT * FROM task_priorities WHERE task_id IN (?,?) ORDER BY task_id').all(...ids(owner,['p1','p2'])),childRanks);
});
test('Snooze moves one whole parent past exactly one peer, persists reload, and does not complete or re-rank its children',async t=>{
    const {page,owner}=await pageFor(t);await parentsFixture(owner);await api(owner,`/users/${owner}/priorities/rank`,'PUT',{taskIds:ids(owner,['P','Q','R'])});
    const importance=raw.prepare('SELECT * FROM task_priorities WHERE user_id=? ORDER BY task_id').all(owner);
    await reviewQueue(page);await page.waitForSelector('#dashboardScreen');await idle(page);assert.deepEqual(await queued(owner),ids(owner,['p1','p2','q1','q2','R']));
    await page.locator(`[data-snooze-parent="${owner}_P"]`).click();await page.waitForFunction(()=>sortedTasks[0]?.canonicalName==='Q first');await idle(page);assert.deepEqual(await queued(owner),ids(owner,['q1','q2','p1','p2','R']));assert.equal(intervalRows(owner).length,0);
    await page.reload();await page.waitForSelector('#dashboardScreen');await idle(page);assert.deepEqual(await queued(owner),ids(owner,['q1','q2','p1','p2','R']));
    await page.locator(`[data-snooze-parent="${owner}_P"]`).click();await page.waitForFunction(()=>sortedTasks.findIndex(row=>row.canonicalName==='Root peer')<sortedTasks.findIndex(row=>row.canonicalName==='P first'));await idle(page);assert.deepEqual(await queued(owner),ids(owner,['q1','q2','R','p1','p2']));assert.equal(await page.locator(`[data-snooze-parent="${owner}_P"]`).isDisabled(),true);
    await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);
    await page.locator(`[data-snooze-parent="${owner}_Q"]`).click();await page.waitForFunction(()=>document.querySelector('#focusScreen h2')?.textContent.includes('Root peer'));await idle(page);
    assert.deepEqual(await queued(owner),ids(owner,['R','q1','q2','p1','p2']));const runs=intervalRows(owner);assert.equal(runs.length,2);assert.ok(runs.find(run=>run.task_id===owner+'_q1').ended_at);assert.equal(runs.find(run=>run.task_id===owner+'_R').ended_at,null);
    assert.notEqual(raw.prepare('SELECT status FROM tasks WHERE id=?').get(owner+'_q1').status,'completed');assert.deepEqual(raw.prepare('SELECT * FROM task_priorities WHERE user_id=? ORDER BY task_id').all(owner),importance);
    for(const label of ['Q first','Q second','P first']){await page.getByRole('button',{name:'Done, Next!',exact:true}).click();await page.waitForFunction(name=>document.querySelector('#focusScreen h2')?.textContent.includes(name),label);await idle(page);}
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(owner+'_Q').status,'completed');assert.notEqual(raw.prepare('SELECT status FROM tasks WHERE id=?').get(owner+'_P').status,'completed');
});
test('lost Snooze response reload replays only captured queue mutation and recovers paused without a duplicate interval',async t=>{
    const {page,owner}=await pageFor(t);await parentsFixture(owner);await reviewQueue(page);await page.waitForSelector('#dashboardScreen');await page.getByRole('button',{name:'Get to Work',exact:true}).click();await page.waitForSelector('#focusScreen');await idle(page);
    let first=true;await page.route('**/api/work-sessions/*/items',async route=>{if(!first)return route.continue();first=false;await route.fetch();await route.abort('failed');});
    await page.locator(`[data-snooze-parent="${owner}_P"]`).click();await page.getByRole('button',{name:'Retry Save',exact:true}).waitFor();
    await page.reload();await page.waitForSelector('#dashboardScreen');await idle(page);assert.deepEqual(await queued(owner),ids(owner,['q1','q2','p1','p2','R']));assert.equal(sessionRows(owner).length,1);assert.equal(intervalRows(owner).length,1);assert.ok(intervalRows(owner)[0].ended_at);assert.equal(await page.locator('#focusScreen').count(),0);
});
test('a never-decomposed parent stays pending through reload until explicitly marked complete',async t=>{
    const {page,owner}=await pageFor(t);const id=owner+'_empty';
    await api(owner,`/users/${owner}/nodes`,'POST',{id,name:'Unsplit parent',nodeType:'project'});await page.reload();await page.waitForSelector('#modeSelect:not(.hidden)');
    assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(id).status,'pending');
    await page.evaluate(id=>ProjectEditor.open(id),id);await page.locator('#projectEditorCompletion').click();await page.waitForFunction(()=>document.getElementById('projectEditorCompletion')?.textContent==='Reopen');assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(id).status,'completed');
    await page.locator('#projectEditorCompletion').click();await page.waitForFunction(()=>document.getElementById('projectEditorCompletion')?.textContent==='Mark complete');assert.equal(raw.prepare('SELECT status FROM tasks WHERE id=?').get(id).status,'pending');
});
