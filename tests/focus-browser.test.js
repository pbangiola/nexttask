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

test('real loader, fresh timed lists with/without sorting, delayed start and rapid Done preserve HTTP ordering', async t => {
    for (const skip of [true, false]) {
        const { page, owner } = await pageFor(t);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let delayed = false;
        await page.route('**/api/work-intervals', async route => {
            if (delayed) return route.continue();
            delayed = true;
            if (skip) {
                const body = route.request().postDataJSON();
                await api(owner, '/work-intervals', 'POST', { ...body, id: owner+'_existing_run' });
            }
            const response = await route.fetch();
            await gate;
            await route.fulfill({ response });
        });
        await newList(page, skip);
        await page.waitForFunction(() => window.TaskGraph.pending());
        await page.getByRole('button', { name: 'Done, Next!' }).click();
        const clickedAt = Date.now();
        assert.notEqual(raw.prepare("SELECT status FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).status, 'completed');
        release();
        await page.waitForFunction(() => document.querySelector('#focusScreen h2')?.textContent.includes('Beta'));
        await idle(page);
        const alpha = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Alpha'").get(owner);
        assert.equal(alpha.status, 'completed');
        const intervals = intervalRows(owner).filter(row => row.task_id === alpha.id);
        assert.equal(intervals.length, 1);
        assert.ok(intervals[0].ended_at <= clickedAt);
        const sorting = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Sort Tasks'").get(owner);
        assert.equal(sorting.status, 'completed');
        assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM work_session_items WHERE task_id=?').get(sorting.id).n, 0);
        assert.equal(sessionRows(owner).length, 1);
        const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src));
        assert.equal(scripts.filter(src => src.includes('/frontend/auth.js')).length, 1);
        assert.ok(scripts.findIndex(src => src.includes('/task-graph.js')) < scripts.findIndex(src => src.includes('/task-graph-timing.js')));
        assert.equal(scripts.filter(src => src.includes('/frontend/planner.js')).length, 1);
        await page.getByRole('button', { name: 'Done, Next!' }).click();
        await page.waitForSelector('#completionScreen');
        await idle(page);
        assert.equal(sessionRows(owner)[0].status, 'ended');
        assert.ok(intervalRows(owner).every(row => row.ended_at !== null));
    }
});

test('lost start and stop responses retry exactly the same interval and completion action', async t => {
    const { page, owner } = await pageFor(t);
    let lostStart = false, lostStop = false;
    const ids = [];
    await page.route('**/api/work-intervals', async route => {
        ids.push(route.request().postDataJSON().id);
        if (lostStart) return route.continue();
        lostStart = true;
        await route.fetch(); await route.abort('failed');
    });
    await newList(page);
    await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    await page.getByRole('button', { name: 'Retry Save' }).click();
    await idle(page);
    assert.equal(ids[0], ids[1]);
    await page.route('**/api/work-intervals/*/stop', async route => {
        if (lostStop) return route.continue();
        lostStop = true;
        await route.fetch(); await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Done, Next!' }).click();
    await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    const firstEnd = intervalRows(owner)[0].ended_at;
    await page.getByRole('button', { name: 'Retry Save' }).click();
    await page.waitForFunction(() => document.querySelector('#focusScreen h2')?.textContent.includes('Beta'));
    await idle(page);
    assert.equal(intervalRows(owner).length, 2);
    assert.equal(intervalRows(owner)[0].ended_at, firstEnd);
    assert.equal(raw.prepare("SELECT status FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).status, 'completed');
});

test('consecutive snapshot requests cannot arrive out of order', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    let count = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/session/*/tasks', async route => {
        count++;
        const response = await route.fetch();
        if (count === 1) await gate;
        await route.fulfill({ response });
    });
    await page.evaluate(() => { sortedTasks[1].actualTimeMs = 10; save(); sortedTasks[1].actualTimeMs = 20; save(); });
    await page.waitForFunction(() => window.TaskGraph.pending());
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(count, 1);
    release(); await idle(page);
    assert.equal(raw.prepare("SELECT elapsed_ms FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).elapsed_ms, 20);
});

test('nested project labels, parent/session/name/position and blocker relationships survive recovery and queue ranking', async t => {
    const { page, owner } = await pageFor(t);
    await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_project`, name: 'Project', nodeType: 'project' });
    await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_nested`, name: 'Nested', nodeType: 'project', parentId: `${owner}_project` });
    const { node: leaf } = await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_leaf`, name: 'Leaf', parentId: `${owner}_nested`, estimatedTimeMs: 60000 });
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.locator('#resumeExistingListBtn').click();
    await page.getByRole('button', { name: "No, I don't have a set stop time." }).click();
    await page.getByRole('button', { name: 'Project —', exact: false }).click();
    await page.getByRole('button', { name: 'Start This Project' }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    assert.match(await page.locator('#focusScreen h2').textContent(), /Project: Nested: Leaf/);
    const after = raw.prepare('SELECT * FROM tasks WHERE id=?').get(leaf.id);
    for (const field of ['name', 'parent_id', 'position', 'session_id', 'node_type']) assert.equal(after[field], leaf[field], field);
    await page.getByRole('button', { name: 'Blocked', exact: true }).click();
    await page.waitForSelector('#blockedTaskScreen');
    await page.locator('#blockedTaskScreen input').fill('Prerequisite');
    await page.getByRole('button', { name: 'Add Blocker and Requeue Both' }).click();
    await page.waitForSelector('#timingEntryScreen');
    await page.locator('#timingEntryScreen input').fill('1');
    await page.getByRole('button', { name: 'Save & Continue' }).click();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    const blocked = raw.prepare('SELECT * FROM tasks WHERE id=?').get(leaf.id);
    assert.equal(blocked.status, 'blocked'); assert.ok(blocked.blocked_by_task_id);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM work_session_items WHERE task_id=?').get(leaf.id).n, 0);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.match(await page.locator('#dashboardScreen').textContent(), /Project: Nested: Leaf/);
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    await page.getByRole('button', { name: 'Done, Next!' }).click();
    await page.waitForFunction(() => document.querySelector('#focusScreen h2')?.textContent.includes('Leaf'));
    await idle(page);
    assert.equal(raw.prepare('SELECT blocked_by_task_id FROM tasks WHERE id=?').get(leaf.id).blocked_by_task_id, null);
});

test('add task persists before queue use, Stop checklist ends session with no open interval', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    await page.getByRole('button', { name: 'Add New Task' }).click();
    await page.waitForSelector('#addTaskPage');
    await page.locator('#addTaskPage input').fill('Added, 1m');
    await page.getByRole('button', { name: 'Choose Work Position' }).click();
    await page.getByRole('button', { name: 'Do this next' }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    const added = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Added'").get(owner);
    assert.ok(added);
    assert.equal(raw.prepare('SELECT rank FROM work_session_items WHERE task_id=?').get(added.id).rank, 2);
    await page.locator('#stopWorkingBtn').click();
    await page.waitForSelector('#stopChecklistScreen'); await idle(page);
    assert.ok(intervalRows(owner).every(row => row.ended_at !== null));
    await page.locator('#stopChecklistScreen input[type=checkbox]').first().check();
    await page.getByRole('button', { name: 'End Work Session' }).click();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(sessionRows(owner)[0].status, 'ended');
    assert.equal(raw.prepare("SELECT status FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).status, 'completed');
});

test('late hard-stop uses the recorded deadline for interval and session end', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    const at = Date.now();
    await page.evaluate(at => {
        clearInterval(timerInterval); clearInterval(hardStopInterval);
        hardStopAtMs = at; hardStopHandled = false;
    }, at);
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.evaluate(() => handleHardStop());
    await page.waitForSelector('#sessionEndedScreen'); await idle(page);
    assert.equal(intervalRows(owner)[0].ended_at, at);
    assert.equal(sessionRows(owner)[0].ended_at, at);
});

test('reload retries a lost response and server-only recovery restores queue paused without duplicate sessions', async t => {
    const { page, owner } = await pageFor(t);
    let lost = false;
    await page.route('**/api/work-intervals', async route => {
        if (lost) return route.continue();
        lost = true; await route.fetch(); await route.abort('failed');
    });
    await newList(page);
    await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    await page.reload();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(sessionRows(owner).length, 1); assert.equal(intervalRows(owner).length, 1);
    assert.ok(intervalRows(owner)[0].ended_at);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await stopServer(); await startServer(Number(new URL(base).port));
    await page.reload();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(sessionRows(owner).length, 1); assert.equal(intervalRows(owner).length, 1);
    assert.match(await page.locator('#dashboardScreen').textContent(), /Alpha/);
    assert.equal(await page.locator('#focusScreen').count(), 0);
});

test('stale cached Focus cannot resurrect a server-ended session or completed task', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    const active = sessionRows(owner)[0];
    const tasks = (await api(owner, `/session/${owner}/tasks`)).tasks;
    await api(owner, `/work-sessions/${active.id}/end`, 'POST', { endedAt: Date.now() });
    await api(owner, `/session/${owner}/tasks`, 'PUT', { tasks: tasks.map(row => ({ id: row.id, name: row.name, status: 'completed', completedTime: Date.now() })) });
    await page.reload();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(sessionRows(owner).length, 1);
    assert.equal(sessionRows(owner)[0].status, 'ended');
    assert.equal(await page.locator('#focusScreen').count(), 0);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND status!='completed'").get(owner).n, 0);
});

test('account switch while obtaining a token rejects old actions before dispatch', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    let snapshots = 0;
    page.on('request', request => { if (request.url().includes(`/session/${owner}/tasks`)) snapshots++; });
    const before = raw.prepare("SELECT elapsed_ms FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).elapsed_ms;
    await page.evaluate(() => {
        clearInterval(timerInterval);
        window.tokenGate = new Promise(resolve => { window.releaseToken = resolve; });
        sortedTasks[1].actualTimeMs = 99999; save();
    });
    await page.waitForFunction(() => window.TaskGraph.pending());
    await page.evaluate(() => { window.Clerk.user = { id: 'other_account' }; window.accountListener(); window.releaseToken(); });
    await page.waitForFunction(() => !document.getElementById('authError').classList.contains('hidden'));
    assert.equal(snapshots, 0);
    assert.equal(raw.prepare("SELECT elapsed_ms FROM tasks WHERE user_id=? AND name='Alpha'").get(owner).elapsed_ms, before);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id='other_account'").get().n, 0);
});

test('background boundary pauses, explicit resume creates one new run and audio bootstrap stays singular', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    await page.evaluate(() => { currentTask().estimatedTimeMs=50; currentTask().lastChanged=Date.now()-100; });
    await page.waitForFunction(() => window.audioPulses === 2);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(intervalRows(owner).length, 1); assert.ok(intervalRows(owner)[0].ended_at);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    assert.equal(intervalRows(owner).length, 2);
    assert.equal(intervalRows(owner).filter(row => row.ended_at === null).length, 1);
    assert.equal(await page.locator('script[src*="deadline-audio.js"]').count(), 1);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await page.evaluate(() => window.audioPulses), 2, 'deadline cue is not repeated on resume');
});

test('failed replacement queue cannot hide the old session; retry uses the same prepared ID', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    const oldId = sessionRows(owner)[0].id;
    await page.evaluate(() => window.FocusDurability.pause(currentTask(), showDashboard));
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    await page.evaluate(() => showModeSelect());
    let fail = true;
    const attempts = [];
    await page.route('**/api/work-sessions/prepare', async route => {
        const body = route.request().postDataJSON(); attempts.push(body.id);
        if (!fail) return route.continue();
        fail = false;
        return route.continue({ postData: JSON.stringify({ ...body, taskIds: ['missing-queue-task'] }) });
    });
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.locator('#createNewListBtn').click();
    await page.getByRole('button', { name: "No, I don't have a set stop time." }).click();
    await page.locator('#tasks').fill('Replacement, 1m');
    await page.locator('#skipSortCheckbox').check();
    await page.locator('#startSort').click();
    await page.waitForSelector('#dashboardScreen');
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    assert.equal(sessionRows(owner).length, 1);
    assert.equal(sessionRows(owner)[0].status, 'open');
    assert.equal((await api(owner, '/work-sessions/open')).workSession.id, oldId);
    assert.equal(await page.locator('#focusScreen').count(), 0);
    await page.getByRole('button', { name: 'Retry Save' }).click(); await idle(page);
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    assert.equal(attempts[0], attempts[1]);
    assert.equal(sessionRows(owner).length, 2);
    assert.equal(sessionRows(owner).find(row => row.id === oldId).status, 'ended');
});

test('server-only recovery of an expired hard stop closes at its recorded deadline without elapsed reconciliation', async t => {
    const { page, owner } = await pageFor(t);
    const now = Date.now(), deadline = now - 1000;
    await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_expired_task`, name: 'Expired task', estimatedTimeMs: 60000 });
    await api(owner, '/work-sessions/prepare', 'POST', { id: `${owner}_expired_session`, startedAt: now - 3000, hardStopAt: deadline, taskIds: [`${owner}_expired_task`] });
    await api(owner, '/work-intervals', 'POST', { id: `${owner}_expired_run`, taskId: `${owner}_expired_task`, workSessionId: `${owner}_expired_session`, startedAt: now - 2000 });
    await page.reload(); await page.waitForSelector('#sessionEndedScreen'); await idle(page);
    assert.equal(intervalRows(owner)[0].ended_at, deadline);
    assert.equal(sessionRows(owner)[0].ended_at, deadline);
    assert.equal(raw.prepare('SELECT elapsed_ms FROM tasks WHERE id=?').get(`${owner}_expired_task`).elapsed_ms, 0);
    await page.reload(); await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(intervalRows(owner).length, 1); assert.equal(sessionRows(owner).length, 1);
    assert.equal(sessionRows(owner)[0].status, 'ended');
});

test('discovery failure provides retry and cannot replace recoverable server work with an empty snapshot', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    await page.evaluate(() => window.FocusDurability.pause(currentTask(), showDashboard));
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    const oldId = sessionRows(owner)[0].id;
    let fail = true;
    await page.route('**/api/work-sessions/open', route => {
        if (!fail) return route.continue();
        fail = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fixture unavailable"}' });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Retry Recovery' }).waitFor();
    assert.equal(sessionRows(owner).length, 1);
    assert.equal((await api(owner, '/work-sessions/open')).workSession.id, oldId);
    await page.getByRole('button', { name: 'Retry Recovery' }).click();
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.match(await page.locator('#dashboardScreen').textContent(), /Alpha/);
    assert.equal(sessionRows(owner).length, 1);
});

test('reload of an uncertain immediate Done retains the intended completion and the original interval ID', async t => {
    const { page, owner } = await pageFor(t);
    let first = true, release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/work-intervals', async route => {
        if (!first) return route.continue();
        first = false; await route.fetch(); await gate; await route.abort('failed');
    });
    await newList(page);
    await page.getByRole('button', { name: 'Done, Next!' }).click();
    const at = Date.now();
    release(); await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    await page.reload(); await page.waitForSelector('#dashboardScreen'); await idle(page);
    const task = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Alpha'").get(owner);
    assert.equal(task.status, 'completed');
    const runs = intervalRows(owner).filter(row => row.task_id === task.id);
    assert.equal(runs.length, 1); assert.ok(runs[0].ended_at <= at);
    assert.equal(sessionRows(owner).length, 1);
    assert.equal(await page.locator('#focusScreen').count(), 0);
});

test('confirmed server closure cancels stale journaled starts on reload', async t => {
    const { page, owner } = await pageFor(t);
    let first = true;
    await page.route('**/api/work-intervals', async route => {
        if (!first) return route.continue();
        first = false; await route.fetch(); await route.abort('failed');
    });
    await newList(page); await page.getByRole('button', { name: 'Retry Save' }).waitFor();
    const id = sessionRows(owner)[0].id;
    await api(owner, `/work-sessions/${id}/end`, 'POST', { endedAt: Date.now() });
    await page.reload(); await page.waitForSelector('#dashboardScreen'); await idle(page);
    assert.equal(sessionRows(owner).length, 1); assert.equal(sessionRows(owner)[0].status, 'ended');
    assert.equal(intervalRows(owner).length, 1); assert.ok(intervalRows(owner)[0].ended_at);
    assert.equal(await page.locator('#focusScreen').count(), 0);
});

test('sorting an existing backlog keeps canonical IDs, estimates, names and sibling positions while changing only queue rank', async t => {
    const { page, owner } = await pageFor(t);
    const { node: first } = await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_one`, name: 'Existing One', estimatedTimeMs: 60000 });
    const { node: second } = await api(owner, `/users/${owner}/nodes`, 'POST', { id: `${owner}_two`, name: 'Existing Two', estimatedTimeMs: 120000 });
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.locator('#resumeExistingListBtn').click();
    await page.getByRole('button', { name: "No, I don't have a set stop time." }).click();
    await page.getByLabel('Sort selected work before Focus').check();
    await page.getByRole('button', { name: 'Entire Task List', exact: true }).click();
    await page.locator('#task2').click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    assert.match(await page.locator('#focusScreen h2').textContent(), /Existing Two/);
    const session = sessionRows(owner)[0];
    const { items } = await api(owner, `/work-sessions/${session.id}`);
    assert.deepEqual(items.map(row => row.id), [second.id, first.id]);
    for (const before of [first, second]) {
        const after = raw.prepare('SELECT * FROM tasks WHERE id=?').get(before.id);
        for (const field of ['id', 'session_id', 'user_id', 'name', 'parent_id', 'position', 'estimated_ms']) assert.equal(after[field], before[field], field);
    }
    const sorting = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Sort Tasks'").get(owner);
    assert.equal(sorting.status, 'completed');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM work_session_items WHERE task_id=?').get(sorting.id).n, 0);
});

test('definitively rejected preparation offers safe return to the old saved session without deleting task rows', async t => {
    const { page, owner } = await pageFor(t);
    await newList(page); await idle(page);
    const oldId = sessionRows(owner)[0].id;
    await page.evaluate(() => window.FocusDurability.pause(currentTask(), showDashboard));
    await page.waitForSelector('#dashboardScreen'); await idle(page);
    await page.evaluate(() => {
        const extra = createTask('Retained unscheduled task', { estimatedTimeMs: 60000 });
        sortedTasks.push(extra);
        window.TaskGraph.commit('work preparation', [window.FocusDurability.snapshot(), {
            path:'/work-sessions/prepare', method:'POST', body: { id:createId('rejected_session'),taskIds:['missing-task'],replaceSessionId:window.activeWorkSessionId }
        }]).catch(() => {});
    });
    await page.getByRole('button', { name: 'Return to Saved Work' }).waitFor();
    await page.getByRole('button', { name: 'Return to Saved Work' }).click();
    await idle(page);
    assert.equal((await api(owner, '/work-sessions/open')).workSession.id, oldId);
    assert.equal(sessionRows(owner).length, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND name='Retained unscheduled task'").get(owner).n, 1);
    assert.equal(await page.locator('#focusScreen').count(), 0);
    assert.match(await page.locator('#dashboardScreen').textContent(), /Alpha/);
});

test('reload during sorting retains canonical tasks and acknowledged overhead without queuing sorting as executable work', async t => {
    const { page, owner } = await pageFor(t);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.locator('#createNewListBtn').click();
    await page.getByRole('button', { name: "No, I don't have a set stop time." }).click();
    await page.locator('#tasks').fill('Alpha, 1m\nBeta, 2m');
    await page.locator('#startSort').click();
    await page.waitForSelector('#taskCompare'); await idle(page);
    const original = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name!='Sort Tasks' ORDER BY position").all(owner);
    const overhead = raw.prepare("SELECT * FROM tasks WHERE user_id=? AND name='Sort Tasks'").get(owner);
    await page.reload(); await page.waitForSelector('#dashboardScreen').catch(async error=>{
        console.error('Sorting reload diagnostics',await page.evaluate(()=>({mode:window.taskSorterMode,screen:document.getElementById('dynamicContainer')?.textContent})));
        throw error;
    }); await idle(page);
    const recovered = raw.prepare('SELECT * FROM tasks WHERE id=?').get(overhead.id);
    assert.equal(recovered.status, 'completed'); assert.equal(recovered.elapsed_ms, overhead.elapsed_ms);
    assert.equal(recovered.independently_actionable, 0);
    await page.getByRole('button', { name: 'Get to Work', exact: true }).click();
    await page.waitForSelector('#focusScreen'); await idle(page);
    const { items } = await api(owner, `/work-sessions/${sessionRows(owner)[0].id}`);
    assert.deepEqual(items.map(row => row.id), original.map(row => row.id));
    assert.equal(intervalRows(owner).length, 1);
    assert.notEqual(intervalRows(owner)[0].task_id, overhead.id);
});
