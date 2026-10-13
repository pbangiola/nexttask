'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporaryDatabase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttask-integration-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = temporaryDatabase;
const legacy = require('../backend/database');
const users = require('../backend/user-store');
const graph = require('../backend/task-graph-store');

test.after(() => {
  // SQLite connections are owned by the store modules and close on process exit.
  // Removing an open database here can trigger native cleanup failures.
  process.env.RAILWAY_VOLUME_MOUNT_PATH = temporaryDatabase;
});

function task(owner, id) {
  return users.createNode(owner, {id, name:id, nodeType:'task', independentlyActionable:true});
}

test('work session survives a store read and preserves queue order', () => {
  task('alice', 'task_a');
  task('alice', 'task_b');
  graph.createSession('alice', {id:'session_a', availableMs:600000});
  graph.setItems('alice', 'session_a', ['task_b','task_a']);
  assert.deepEqual(graph.getItems('alice', 'session_a').map(item => item.id), ['task_b','task_a']);
  assert.equal(graph.getOpenSession('alice').id, 'session_a');
});

test('other users cannot read or change a work session', () => {
  assert.throws(() => graph.getSession('bob', 'session_a'), /not found/i);
  assert.throws(() => graph.getItems('bob', 'session_a'), /not found/i);
  assert.throws(() => graph.setItems('bob', 'session_a', []), /not found/i);
});

test('intervals can be recovered and closing session stops them', () => {
  const started = graph.startInterval('alice', {id:'interval_a', taskId:'task_a', workSessionId:'session_a'});
  assert.equal(graph.getOpenIntervals('alice', 'session_a')[0].id, started.id);
  assert.equal(graph.startInterval('alice', {id:'interval_duplicate', taskId:'task_a', workSessionId:'session_a'}).id, started.id);
  graph.endSession('alice', 'session_a');
  assert.equal(graph.getOpenIntervals('alice', 'session_a').length, 0);
  assert.equal(graph.getSession('alice', 'session_a').status, 'ended');
});

test('cannot add foreign-owned task to a work queue', () => {
  task('bob', 'task_bob');
  graph.createSession('alice', {id:'session_new'});
  assert.throws(() => graph.setItems('alice', 'session_new', ['task_bob']), /not found/i);
  assert.deepEqual(graph.getItems('alice', 'session_new'), []);
});

test('queue replacement is atomic and never changes canonical sibling positions', () => {
  graph.setItems('alice','session_new',['task_a','task_b']);
  const before = users.getNode('alice','task_a');
  assert.throws(() => graph.setItems('alice','session_new',['task_b','task_bob']), /not found/i);
  assert.deepEqual(graph.getItems('alice','session_new').map(row=>row.id),['task_a','task_b']);
  graph.setItems('alice','session_new',['task_b','task_a','task_b']);
  assert.deepEqual(graph.getItems('alice','session_new').map(row=>row.rank),[1,2]);
  assert.deepEqual(users.getNode('alice','task_a'),before);
  assert.throws(() => graph.setItems('alice','session_new','task_a'),/array/);
});

test('foreign and anonymous IDs fail in legacy writes, attach, import and planner undo', () => {
  const Database = require('better-sqlite3');
  const raw = new Database(path.join(temporaryDatabase,'task_sorter.db'));
  raw.prepare("INSERT INTO sessions(id,updated_at) VALUES('anonymous',1)").run();
  raw.prepare("INSERT INTO tasks(id,session_id,user_id,name,created,updated_at) VALUES('anonymous','anonymous',NULL,'Anonymous',1,1)").run();
  const before = users.getNode('bob','task_bob');
  assert.throws(()=>users.attachTask('alice','task_bob'),/not found/i);
  assert.throws(()=>users.attachTask('alice','anonymous'),/not found/i);
  assert.throws(()=>users.claimUnownedTasks('alice'),/approved migration/i);
  assert.throws(()=>users.prependOpenTasks('alice',['task_a','task_bob']),/not found/i);
  assert.throws(()=>users.importOpenTasksIntoSession('alice',before.session_id),/does not belong/i);
  assert.throws(()=>users.createNode('alice',{id:'bad-session',name:'bad',sessionId:'bob'}),/does not belong/i);
  assert.throws(()=>users.updateNode('alice','task_a',{parentId:'task_bob'}),/not found/i);
  assert.throws(()=>users.restoreSnapshot('alice',[{id:'task_a',parent_id:'task_bob'}]),/not found/i);
  for (const id of ['task_bob','anonymous']) {
    assert.throws(()=>legacy.saveTaskList('alice',[{id:'rollback-new',userId:'alice',name:'New'},{id,userId:'alice',name:'Stolen'}]),/not found/i);
    assert.equal(raw.prepare("SELECT * FROM tasks WHERE id='rollback-new'").get(),undefined);
  }
  assert.throws(()=>legacy.saveTaskList('alice',[{id:'new-foreign-parent',userId:'alice',name:'New',parentId:'task_bob'}]),/not found/i);
  assert.throws(()=>legacy.saveTaskList('alice',[{id:'new-foreign-blocker',userId:'alice',name:'New',blockedByTaskId:'task_bob'}]),/not found/i);
  assert.deepEqual(users.getNode('bob','task_bob'),before);
  assert.equal(raw.prepare("SELECT user_id FROM tasks WHERE id='anonymous'").get().user_id,null);
  assert.equal(legacy.getTasks('anonymous').length,0);
  raw.close();
});

test('only open actionable queue tasks can open new intervals', () => {
  const Database = require('better-sqlite3');
  const raw = new Database(path.join(temporaryDatabase,'task_sorter.db'));
  users.createNode('alice',{id:'container',name:'Container',nodeType:'project'});
  users.createNode('alice',{id:'not-actionable',name:'Not actionable',independentlyActionable:false});
  for (const status of ['blocked','completed','cancelled']) {
    task('alice','status-'+status);
    raw.prepare('UPDATE tasks SET status=? WHERE id=?').run(status,'status-'+status);
  }
  for (const id of ['container','not-actionable','status-blocked','status-completed','status-cancelled']) {
    assert.throws(()=>graph.setItems('alice','session_new',[id]),/actionable/i);
    assert.throws(()=>graph.startInterval('alice',{id:'bad-'+id,taskId:id}),/actionable/i);
  }
  graph.createSession('alice',{id:'empty-queue'});
  assert.throws(()=>graph.startInterval('alice',{id:'not-selected',taskId:'task_a',workSessionId:'empty-queue'}),/not in.*queue/i);
  assert.throws(()=>graph.startInterval('alice',{id:'foreign-task',taskId:'task_bob'}),/not found/i);
  assert.throws(()=>graph.startInterval('bob',{id:'foreign-session',taskId:'task_bob',workSessionId:'empty-queue'}),/not found/i);
  assert.throws(()=>graph.stopInterval('bob','interval_a'),/not found/i);
  assert.throws(()=>graph.getIntervals('bob','task_a'),/not found/i);
  assert.throws(()=>graph.createSession('bob',{id:'empty-queue'}),/another user/i);
  raw.close();
});

test('interval retry and session end are idempotent without changing elapsed policy', () => {
  graph.createSession('alice',{id:'retry-session'});
  graph.setItems('alice','retry-session',['task_b']);
  const before = users.getNode('alice','task_b');
  const started = graph.startInterval('alice',{id:'retry-interval',taskId:'task_b',workSessionId:'retry-session',startedAt:Date.now()-1000});
  const stopped = graph.stopInterval('alice',started.id,started.started_at+500);
  assert.equal(stopped.duration_ms,500);
  assert.deepEqual(graph.stopInterval('alice',started.id,Date.now()),stopped);
  assert.deepEqual(graph.startInterval('alice',{id:started.id,taskId:'task_b',workSessionId:'retry-session'}),stopped);
  const ended = graph.endSession('alice','retry-session');
  assert.deepEqual(graph.endSession('alice','retry-session'),ended);
  assert.throws(()=>graph.createSession('alice',{id:'retry-session'}),/closed/i);
  assert.throws(()=>graph.startInterval('alice',{id:'new-after-end',taskId:'task_b',workSessionId:'retry-session'}),/closed/i);
  assert.deepEqual(users.getNode('alice','task_b'),before,'interval records do not choose D4 elapsed reconciliation');
});

test('malformed timestamps and capacities fail before durable writes', () => {
  assert.throws(()=>graph.createSession('alice',{id:'invalid-capacity',availableMs:'not a number'}),/nonnegative integer/);
  assert.throws(()=>graph.startInterval('alice',{id:'invalid-time',taskId:'task_a',startedAt:-1}),/nonnegative integer/);
  assert.equal(graph.getIntervals('alice','task_a').some(row=>row.id==='invalid-time'),false);
});
