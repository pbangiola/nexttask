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
  fs.rmSync(temporaryDatabase, {recursive:true, force:true});
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
