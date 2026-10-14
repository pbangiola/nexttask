'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttask-http-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = directory;
process.env.CLERK_TELEMETRY_DISABLED = 'true';
// Offline test fixture, not a live Clerk app or a bypass of signature validation.
const domain = 'fixture.clerk.accounts.dev';
const publishableKey = `pk_test_${Buffer.from(domain + '$').toString('base64')}`;
process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength:2048 });
const jwtKey = publicKey.export({type:'spki',format:'pem'});
const { createApp } = require('../backend/server');
const users = require('../backend/user-store');
const graph = require('../backend/task-graph-store');
const db = require('../backend/database');
let server;
let base;
function token(user) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'fixture'})).toString('base64url');
    const payload = Buffer.from(JSON.stringify({iss:`https://${domain}`,sub:user,sid:'sess_fixture',iat:now,nbf:now-1,exp:now+300,azp:'http://localhost:3000'})).toString('base64url');
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    return `${header}.${payload}.${signature}`;
}
async function request(url, user, method = 'GET', body) {
    return fetch(base + url, {method, redirect:'manual', headers:{
        ...(user ? {Authorization:`Bearer ${token(user)}`} : {}),
        ...(body ? {'Content-Type':'application/json'} : {})
    }, ...(body ? {body:JSON.stringify(body)} : {})});
}
test.before(async () => {
    server = createApp({publishableKey, secretKey:'sk_test_offline_fixture', jwtKey}).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, {recursive:true,force:true});
});

test('public index, referenced scripts, health and config work without authentication', async () => {
    const index = await request('/');
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /taskSorterApp/);
    assert.equal((await request('/index.html')).status, 200);
    for (const name of ['auth','initialization','persistence','ui','core','timing','work-planner','planner','project-queue-filter','project-editor','duplicate-review','project-csv','planner-bridge','deadline-audio','task-graph-timing']) {
        const asset = await request(`/frontend/${name}.js?v=test`);
        assert.equal(asset.status, 200, name);
        assert.match(asset.headers.get('content-type'), /javascript/);
        assert.ok((await asset.text()).length > 0);
    }
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const config = await request('/api/config');
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {clerkPublishableKey:publishableKey});
});

test('health and static surface remain public when Clerk is not configured', async () => {
    delete process.env.CLERK_PUBLISHABLE_KEY;
    try {
        assert.equal((await request('/')).status, 200);
        assert.equal((await request('/api/health')).status, 200);
        assert.equal((await request('/api/config')).status, 500);
        assert.equal((await request('/api/work-sessions/open')).status, 401);
    } finally { process.env.CLERK_PUBLISHABLE_KEY = publishableKey; }
});

test('internal source/data, unknown assets and path traversal return no file bytes', async () => {
    for (const url of ['/backend/server.js','/server.js','/backend/database.js','/backend/task_sorter.db','/backend/task_sorter.db-wal','/backend/task_sorter.db-shm','/task_sorter.db','/frontend/task_sorter.db','/frontend/auth.js/../task_sorter.db','/frontend/%2e%2e%2fbackend%2fserver.js','/.git/config','/package.json','/package-lock.json','/Documentation/PLAN.md','/frontend/project-bulk-create.js']) {
        const response = await request(url);
        assert.equal(response.status, 404, url);
        assert.deepEqual(await response.json(), {error:'Not found'}, url);
    }
});

test('all private API families reject unauthenticated requests and forged JWTs', async () => {
    for (const url of ['/api/users/alice/nodes','/api/session/alice/tasks','/api/tasks/actionable','/api/work-sessions/open','/api/work-intervals']) {
        assert.equal((await request(url)).status, 401, url);
    }
    const forged = token('alice').split('.');
    forged[1] = Buffer.from(JSON.stringify({sub:'bob'})).toString('base64url');
    const result = await fetch(base+'/api/tasks/actionable',{headers:{Authorization:`Bearer ${forged.join('.')}`}});
    assert.equal(result.status, 401);
});

test('verified identities cannot mutate or read another owner through any graph path', async () => {
    const created = await request('/api/users/alice/nodes', 'alice', 'POST', {id:'http-alice', name:'Owned task'});
    assert.equal(created.status, 201, await created.text());
    users.createNode('bob', {id:'http-bob',name:'Foreign task'});
    graph.createSession('bob', {id:'http-bob-session'});
    graph.setItems('bob', 'http-bob-session', ['http-bob']);
    graph.startInterval('bob', {id:'http-bob-interval',taskId:'http-bob',workSessionId:'http-bob-session'});
    const before = users.getNode('bob','http-bob');
    const cases = [
        ['/api/users/bob/nodes','GET',null,403],
        ['/api/users/alice/nodes/http-bob','GET',null,404],
        ['/api/users/alice/nodes/http-bob','PUT',{name:'Stolen'},404],
        ['/api/users/alice/nodes','POST',{id:'foreign-child',name:'Child',parentId:'http-bob'},404],
        ['/api/users/alice/tasks/import','POST',{sessionId:'bob'},403],
        ['/api/session/bob/tasks','GET',null,403],
        ['/api/session/alice/tasks','PUT',{tasks:[{id:'http-bob',name:'Stolen'}]},400],
        ['/api/work-sessions/http-bob-session','GET',null,404],
        ['/api/work-sessions/http-bob-session/items','PUT',{taskIds:['http-alice']},404],
        ['/api/work-sessions/http-bob-session/open-intervals','GET',null,404],
        ['/api/work-sessions/http-bob-session/end','POST',{},404],
        ['/api/work-intervals','POST',{id:'foreign-interval',taskId:'http-bob'},404],
        ['/api/work-intervals','POST',{id:'foreign-session',taskId:'http-alice',workSessionId:'http-bob-session'},404],
        ['/api/work-intervals/http-bob-interval/stop','POST',{},404],
        ['/api/tasks/http-bob/work-intervals','GET',null,404]
    ];
    for (const [url, method, body, expected] of cases) {
        const response = await request(url, 'alice', method, body);
        assert.equal(response.status, expected, `${method} ${url}: ${await response.text()}`);
    }
    assert.deepEqual(users.getNode('bob','http-bob'), before);
    assert.equal(db.getSession('alice'), null, 'failed legacy write rolls back session creation');
});

test('durable session, ranked items and interval routes work for their verified owner', async () => {
    const session = await request('/api/work-sessions','alice','POST',{id:'http-alice-session',availableMs:60000});
    assert.equal(session.status,201);
    assert.equal((await request('/api/work-sessions/http-alice-session/items','alice','PUT',{taskIds:['http-alice']})).status,200);
    const interval = await request('/api/work-intervals','alice','POST',{id:'http-alice-interval',taskId:'http-alice',workSessionId:'http-alice-session',startedAt:Date.now()-1000});
    assert.equal(interval.status,201,await interval.text());
    const stopped = await request('/api/work-intervals/http-alice-interval/stop','alice','POST',{endedAt:Date.now()});
    assert.equal(stopped.status,200);
    assert.ok((await stopped.json()).interval.duration_ms >= 1000);
    assert.equal((await request('/api/work-sessions/http-alice-session/end','alice','POST',{})).status,200);
    assert.equal((await (await request('/api/work-sessions/open','alice')).json()).workSession,null);
});
