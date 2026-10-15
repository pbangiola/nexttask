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
const create=(owner,id,nodeType='task',parentId=null,mins=0)=>json('/nodes','POST',{id,name:id,nodeType,parentId,estimatedTimeMs:mins*60000},owner);
const node=id=>raw.prepare('SELECT * FROM tasks WHERE id=?').get(id);
test('discovery and editing retain completed projects/children and isolate accounts',async()=>{
    const owner='discover';await create(owner,'discovery-empty','project');await create(owner,'discovery-root','project');await create(owner,'discovery-child','task','discovery-root',10);
    raw.prepare("UPDATE tasks SET status='completed',completed=123 WHERE id=?").run('discovery-child');
    const {nodes}=await json('/nodes','GET',undefined,owner);
    assert.ok(nodes.some(n=>n.id==='discovery-root'),'completed project remains discoverable');
    const detail=await json('/nodes/discovery-root','GET',undefined,owner);assert.equal(detail.children[0]?.id,'discovery-child');
    assert.equal(detail.children[0].status,'completed');assert.equal((await json('/nodes','GET',undefined,'discover_other')).nodes.length,0);
});
test('delete/edit/move update every ancestor immediately, including an emptied source and fractional milliseconds',async()=>{
    const owner='totals';await create(owner,'total-root','project');await create(owner,'total-other','project');
    for(const [id,mins] of [['total-a',10],['total-b',20],['total-c',30]])await create(owner,id,'task','total-root',mins);
    assert.equal(node('total-root').estimated_ms,3600000);
    const deleted=await json('/nodes/total-b','DELETE',undefined,owner);assert.equal(node('total-root').estimated_ms,2400000);
    await json('/nodes/total-c','PUT',{estimatedTimeMs:2700000},owner);assert.equal(node('total-root').estimated_ms,3300000);
    // Existing in-place decomposition: children replace a container estimate, never add to it.
    await json('/nodes/total-c','PUT',{nodeType:'project',independentlyActionable:false},owner);
    await create(owner,'total-grand','task','total-c',15);assert.equal(node('total-root').estimated_ms,1500000);
    const moved=await json('/nodes/total-c/parent','PUT',{parentId:'total-other'},owner);
    assert.equal(node('total-root').estimated_ms,600000);assert.equal(node('total-other').estimated_ms,900000);assert.equal(node('total-grand').parent_id,'total-c');
    await json('/nodes/total-grand','DELETE',undefined,owner);assert.equal(node('total-c').estimated_ms,0);assert.equal(node('total-other').estimated_ms,0);
    await json('/nodes/undo','POST',{snapshot:moved.undo},owner);assert.equal(node('total-c').parent_id,'total-root');
    await json('/nodes/undo','POST',{snapshot:deleted.undo},owner);assert.equal(node('total-root').estimated_ms,1800000);
    await json('/nodes/total-a','PUT',{estimatedTimeMs:1234567},owner);assert.equal(node('total-root').estimated_ms,2434567);
    await json('/nodes','GET',undefined,owner);assert.equal(node('total-root').estimated_ms,2434567);
});
test('recursive parent creation is atomic, preserves identity/actual/relationships and blocks invalid moves',async()=>{
    const owner='recursive';await create(owner,'rec-root','project');await create(owner,'rec-parent','task','rec-root',45);await create(owner,'rec-sibling','task','rec-root',5);
    raw.prepare('UPDATE tasks SET elapsed_ms=12345 WHERE id=?').run('rec-parent');const before=node('rec-parent');
    // A task parent is promoted in the same transaction that inserts its first child.
    await create(owner,'rec-child','task','rec-parent',15);
    assert.equal(node('rec-parent').node_type,'project');assert.equal(node('rec-parent').id,before.id);assert.equal(node('rec-parent').elapsed_ms,12345);
    assert.equal(node('rec-root').elapsed_ms,12345);assert.equal(node('rec-root').estimated_ms,20*60000);
    await create(owner,'rec-grand','task','rec-child',2);await create(owner,'rec-deep','task','rec-grand',1);
    assert.equal(node('rec-root').estimated_ms,6*60000);assert.equal(node('rec-parent').elapsed_ms,12345);
    const cycle=await request('/api/users/'+owner+'/nodes/rec-parent/parent',owner,'PUT',{parentId:'rec-deep'});assert.equal(cycle.status,400);
    assert.equal(node('rec-deep').node_type,'task','failed move does not promote its target');
    const foreign=await request('/api/users/'+owner+'/nodes/rec-parent/parent','other','PUT',{parentId:null});assert.equal(foreign.status,403);
    await json('/nodes/rec-child','DELETE',undefined,owner);assert.equal(node('rec-parent').estimated_ms,0);assert.equal(node('rec-root').estimated_ms,5*60000);assert.equal(node('rec-sibling').status,'pending');
    for(const id of ['rec-child','rec-grand','rec-deep'])assert.equal(node(id).status,'cancelled');
    await create(owner,'rec-old-empty','project');raw.prepare('UPDATE tasks SET elapsed_ms=23456 WHERE id=?').run('rec-old-empty');
    await create(owner,'rec-new-child','task','rec-old-empty',1);assert.equal(node('rec-old-empty').elapsed_ms,23456);assert.equal(node('rec-old-empty').own_elapsed_ms,23456);
    assert.deepEqual(raw.pragma('foreign_key_check'),[]);
});
test('completion changes only intended child, retains siblings/history and reopens ancestors when needed',async()=>{
    const owner='complete';await create(owner,'comp-root','project');await create(owner,'comp-a','task','comp-root',10);await create(owner,'comp-b','task','comp-root',20);
    const sibling=node('comp-b');await json('/nodes/comp-a','PUT',{status:'completed'},owner);
    assert.equal(node('comp-a').status,'completed');assert.ok(node('comp-a').completed);assert.equal(node('comp-root').status,'pending');assert.deepEqual(node('comp-b'),sibling);
    assert.equal((await json('/nodes/comp-root','GET',undefined,owner)).children.length,2);assert.equal(node('comp-root').estimated_ms,30*60000);
    await json('/nodes/comp-b','PUT',{status:'completed'},owner);assert.equal(node('comp-root').status,'completed');
    await create(owner,'comp-new','task','comp-root',5);assert.equal(node('comp-root').status,'pending');assert.equal(node('comp-a').status,'completed');
    await json('/nodes/comp-a','PUT',{status:'pending'},owner);assert.equal(node('comp-a').completed,null);
    const before=node('comp-root');const invalid=await request('/api/users/'+owner+'/nodes/comp-root',owner,'PUT',{status:'completed'});assert.equal(invalid.status,400);assert.deepEqual(node('comp-root'),before);
});
test('multi-node move/group/insert/undo are atomic and completed subtrees preserve history across projects',async()=>{
    const owner='atomic';for(const id of ['atomic-source','atomic-dest'])await create(owner,id,'project');
    await create(owner,'atomic-branch','task','atomic-source',30);await create(owner,'atomic-leaf','task','atomic-branch',15);await create(owner,'atomic-peer','task','atomic-source',5);
    raw.prepare('UPDATE tasks SET elapsed_ms=12345 WHERE id=?').run('atomic-leaf');
    await json('/nodes/atomic-leaf','PUT',{status:'completed'},owner);
    const leaf=node('atomic-leaf');await json('/nodes/atomic-branch/parent','PUT',{parentId:'atomic-dest'},owner);
    assert.deepEqual(node('atomic-leaf'),leaf);assert.equal(node('atomic-branch').status,'completed');assert.equal(node('atomic-source').estimated_ms,5*60000);assert.equal(node('atomic-dest').estimated_ms,15*60000);
    await create('atomic-other','atomic-foreign');
    const before=raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner);
    const rejected=await request('/api/users/'+owner+'/nodes/batch',owner,'POST',{action:'move',ids:['atomic-peer','atomic-foreign'],parentId:'atomic-dest'});assert.equal(rejected.status,404);
    assert.deepEqual(raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner),before);
    // A failure after an earlier move must also roll back (moving ancestor under descendant).
    const cycle=await request('/api/users/'+owner+'/nodes/batch',owner,'POST',{action:'move',ids:['atomic-peer','atomic-dest'],parentId:'atomic-branch'});assert.equal(cycle.status,400);assert.equal(node('atomic-peer').parent_id,'atomic-source');
    await create(owner,'atomic-second','task','atomic-source',2);
    const group=await json('/nodes/batch','POST',{action:'group',parentId:'atomic-source',ids:['atomic-peer','atomic-second'],group:{id:'atomic-group',name:'Group'}},owner);
    assert.equal(node('atomic-group').estimated_ms,7*60000);assert.equal(node('atomic-source').estimated_ms,7*60000);
    await json('/nodes/undo','POST',{snapshot:group.undo,deleteIds:group.deleteIds},owner);assert.equal(node('atomic-group').status,'cancelled');assert.equal(node('atomic-source').estimated_ms,7*60000);
    const old=raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner);
    const insert=await request('/api/users/'+owner+'/nodes/batch',owner,'POST',{action:'insert',parentId:'atomic-source',index:0,node:{id:'atomic-peer',name:'Duplicate ID'}});assert.equal(insert.status,400);assert.deepEqual(raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner),old);
    const badUndo=await request('/api/users/'+owner+'/nodes/undo',owner,'POST',{snapshot:group.undo,deleteIds:['atomic-foreign']});assert.equal(badUndo.status,404);assert.deepEqual(raw.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id').all(owner),old);
    // Confirm stored graph and metrics after an actual process restart.
    const result=require('node:child_process').spawnSync(process.execPath,['-e',`const u=require('./backend/user-store');console.log(JSON.stringify(u.getTree('${owner}')));`],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const restarted=JSON.parse(result.stdout);assert.equal(restarted.find(n=>n.id==='atomic-dest').children[0].children[0].elapsed_ms,12345);assert.deepEqual(raw.pragma('foreign_key_check'),[]);
});
test('deadline/duration edits and pairwise rank writes remain independent without a third score',async()=>{
    const owner='dimensions';await create(owner,'dim-a');await create(owner,'dim-b','task',null,1);
    await json('/priorities/rank','PUT',{taskIds:['dim-b','dim-a']},owner);await json('/priorities/dim-a','PUT',{dueAt:200000},owner);
    const initial=(await json('/priorities','GET',undefined,owner)).items.find(n=>n.id==='dim-a');assert.equal(initial.estimated_ms,0);assert.equal(initial.importance_rank,2);
    await json('/nodes/dim-a','PUT',{estimatedTimeMs:120000},owner);await json('/priorities/dim-a','PUT',{dueAt:300000},owner);
    const changed=(await json('/priorities','GET',undefined,owner)).items.find(n=>n.id==='dim-a');assert.equal(changed.importance_rank,2);assert.equal(changed.due_at,300000);assert.equal(changed.estimated_ms,120000);
    await json('/priorities/rank','PUT',{taskIds:['dim-a','dim-b']},owner);
    const ranked=(await json('/priorities','GET',undefined,owner)).items.find(n=>n.id==='dim-a');assert.equal(ranked.importance_rank,1);assert.equal(ranked.due_at,changed.due_at);assert.equal(ranked.estimated_ms,changed.estimated_ms);
});
test('editing active work cannot silently abandon its interval; paused decomposition retains history',async()=>{
    const owner='guard';await create(owner,'guard-leaf','task',null,2);
    const prepared=await request('/api/work-sessions/prepare',owner,'POST',{id:'guard-session',taskIds:['guard-leaf']});assert.equal(prepared.status,201);
    const start=Date.now();const interval=await request('/api/work-intervals',owner,'POST',{id:'guard-run',taskId:'guard-leaf',workSessionId:'guard-session',startedAt:start});assert.equal(interval.status,201);
    const before=node('guard-leaf');
    for(const [url,method,body] of [['/nodes','POST',{id:'guard-child',name:'Child',parentId:'guard-leaf'}],['/nodes/guard-leaf','DELETE'],['/nodes/guard-leaf','PUT',{status:'completed'}]]){
        const rejected=await request('/api/users/'+owner+url,owner,method,body);assert.equal(rejected.status,400);assert.deepEqual(node('guard-leaf'),before);assert.equal(node('guard-child'),undefined);
    }
    const stop=await request('/api/work-intervals/guard-run/stop',owner,'POST',{endedAt:start+1000});assert.equal(stop.status,200);
    // Acknowledged actual is canonical; do not infer an extra second from audit intervals.
    raw.prepare('UPDATE tasks SET elapsed_ms=5000 WHERE id=?').run('guard-leaf');await create(owner,'guard-child','task','guard-leaf',1);assert.equal(node('guard-leaf').elapsed_ms,5000);assert.equal(node('guard-leaf').own_elapsed_ms,5000);
});
