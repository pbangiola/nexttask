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

const raw = new (require('better-sqlite3'))(path.join(directory,'task_sorter.db'));
test.after(()=>raw.close());
async function json(url,method='GET',body,owner='qa_owner') {
    const response=await request('/api/users/'+owner+url,owner,method,body);
    const result=await response.json(); assert.ok(response.ok,JSON.stringify(result)); return result;
}
test('B4/B5/B6: editing same-named tasks preserves IDs, ownership, history and immediately rolls up mutations/move/undo',async()=>{
    const create=(id,name,nodeType,parentId,mins=0)=>json('/nodes','POST',{id,name,nodeType,parentId,estimatedTimeMs:mins*60000});
    await create('oars','Oars','project');await create('left','Left','project','oars');await create('right','Right','project','oars');
    for(const [i,mins] of [45,60,60,15].entries()) await create('l'+i,'Duplicate','task','left',mins);
    for(const [i,mins] of [90,90].entries()) await create('r'+i,'Right '+i,'task','right',mins);
    const row=id=>raw.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    const minutes=id=>row(id).estimated_ms/60000;
    assert.equal(minutes('oars'),360);assert.equal(minutes('left'),180);
    raw.prepare('UPDATE tasks SET elapsed_ms=12345,started=100,last_changed=NULL WHERE id=?').run('l0');
    raw.prepare('UPDATE tasks SET blocked_by_task_id=? WHERE id=?').run('l0','l1');
    const before=row('l0');
    const {node:edited}=await json('/nodes/l0','PUT',{name:'Renamed',estimatedTimeMs:30*60000});
    for(const key of ['id','user_id','session_id','parent_id','position','elapsed_ms','status','started','completed','created']) assert.equal(edited[key],before[key],key);
    assert.equal(row('l1').blocked_by_task_id,'l0'); assert.equal(minutes('l1'),60);
    // Assert SQLite immediately after acknowledgment, before any read-triggered reconcile.
    assert.equal(minutes('left'),165);assert.equal(minutes('oars'),345);assert.equal(row('oars').elapsed_ms,12345);
    const moved=await json('/nodes/l3/parent','PUT',{parentId:'right'});
    assert.equal(minutes('left'),150);assert.equal(minutes('right'),195);assert.equal(minutes('oars'),345);
    await json('/nodes/undo','POST',{snapshot:moved.undo});
    assert.equal(row('l3').parent_id,'left');assert.equal(minutes('left'),165);assert.equal(minutes('right'),180);assert.equal(minutes('oars'),345);
    await json('/nodes/l0','PUT',{position:9}); assert.equal(minutes('oars'),345);assert.equal(row('l0').name,'Renamed');
    const fresh=await json('/nodes/oars'); assert.equal(fresh.node.estimated_ms,345*60000);assert.equal(fresh.node.elapsed_ms,12345);
    const denied=await request('/api/users/qa_owner/nodes/l0','other_owner','PUT',{name:'Wrong owner'});assert.equal(denied.status,403);assert.equal(row('l0').name,'Renamed');
});
test('B4 stale Focus snapshots preserve edited estimates while still filling missing estimates and saving elapsed work',async()=>{
    const owner='snapshot_owner';
    await json('/nodes','POST',{id:'snapshot_task',name:'Task',estimatedTimeMs:45000},owner);
    await json('/nodes/snapshot_task','PUT',{estimatedTimeMs:30000},owner);
    const response=await request('/api/session/'+owner+'/tasks',owner,'PUT',{tasks:[{id:'snapshot_task',name:'Old name',estimatedTimeMs:45000,actualTimeMs:1234},{id:'missing_task',name:'Missing',estimatedTimeMs:0}]});assert.equal(response.status,200);
    let row=raw.prepare('SELECT * FROM tasks WHERE id=?').get('snapshot_task');assert.equal(row.estimated_ms,30000);assert.equal(row.elapsed_ms,1234);assert.equal(row.name,'Task');
    assert.equal((await request('/api/session/'+owner+'/tasks',owner,'PUT',{tasks:[{id:'missing_task',name:'Missing',estimatedTimeMs:60000}]})).status,200);
    assert.equal(raw.prepare('SELECT estimated_ms FROM tasks WHERE id=?').get('missing_task').estimated_ms,60000);
});

test('owned deadline/ranking proposal is atomic, restart-safe, and cannot alter queue, hierarchy or elapsed totals',async()=>{
    const owner='priority_owner';
    for(const id of ['priority_a','priority_b'])await json('/nodes','POST',{id,name:id,estimatedTimeMs:60000},owner);
    await json('/nodes','POST',{id:'priority_foreign',name:'Foreign'},'priority_other');
    const session=await request('/api/work-sessions/prepare',owner,'POST',{id:'priority_session',taskIds:['priority_b','priority_a']});assert.equal(session.status,201);
    const before=raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner);
    const due=Date.now()+600000;
    await json('/priorities/priority_a','PUT',{dueAt:due},owner);await json('/priorities/rank','PUT',{taskIds:['priority_a','priority_b']},owner);
    const ranked=await json('/priorities','GET',undefined,owner);assert.equal(ranked.items.find(r=>r.id==='priority_a').importance_rank,1);
    const invalid=await request(`/api/users/${owner}/priorities/rank`,owner,'PUT',{taskIds:['priority_a','priority_foreign']});assert.ok(!invalid.ok);
    const denied=await request(`/api/users/${owner}/priorities/priority_a`,'priority_other','PUT',{dueAt:null});assert.equal(denied.status,403);
    const malformed=await request(`/api/users/${owner}/priorities/priority_a`,owner,'PUT',{dueAt:-1});assert.equal(malformed.status,400);
    assert.equal(raw.prepare('SELECT due_at FROM task_priorities WHERE task_id=?').get('priority_a').due_at,due);
    assert.deepEqual(raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner),before);
    assert.deepEqual((await (await request('/api/work-sessions/priority_session',owner)).json()).items.map(row=>row.id),['priority_b','priority_a']);
    const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,['-e',"console.log(JSON.stringify(require('./backend/task-priorities').list('priority_owner')))"] ,{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const restarted=JSON.parse(result.stdout);assert.equal(restarted.items.find(r=>r.id==='priority_a').due_at,due);assert.equal(restarted.items.find(r=>r.id==='priority_a').importance_rank,1);
    assert.deepEqual(raw.pragma('foreign_key_check'),[]);
});
