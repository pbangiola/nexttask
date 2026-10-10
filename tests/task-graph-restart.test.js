'use strict';
// Runs the same SQLite file through two independent Node processes to simulate
// a browser/backend restart without touching production data or requiring Clerk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporaryDatabase = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttask-restart-'));
const env = {...process.env, RAILWAY_VOLUME_MOUNT_PATH: temporaryDatabase};

function run(code) {
  const result = spawnSync(process.execPath, ['-e', code], {cwd:root, env, encoding:'utf8', timeout:15000});
  assert.equal(result.status, 0, 'Child process failed:\\n' + result.stderr + '\\n' + result.stdout);
  const output = result.stdout.trim().split('\\n').at(-1);
  return JSON.parse(output);
}

test('work session and running interval recover across process restart', () => {
  const initial = run(`
    require('./backend/database');
    const users=require('./backend/user-store');
    const graph=require('./backend/task-graph-store');
    users.createNode('alice',{id:'restart_a',name:'First task',nodeType:'task',estimatedTimeMs:120000});
    users.createNode('alice',{id:'restart_b',name:'Second task',nodeType:'task',estimatedTimeMs:180000});
    graph.createSession('alice',{id:'restart_session',availableMs:600000,endConstraint:'timebox'});
    graph.setItems('alice','restart_session',['restart_b','restart_a']);
    const interval=graph.startInterval('alice',{id:'restart_interval',taskId:'restart_b',workSessionId:'restart_session'});
    console.log(JSON.stringify({id:interval.id}));
  `);
  assert.equal(initial.id, 'restart_interval');
  const recovered = run(`
    require('./backend/database');
    require('./backend/user-store');
    const graph=require('./backend/task-graph-store');
    const session=graph.getOpenSession('alice');
    const items=graph.getItems('alice',session.id);
    const open=graph.getOpenIntervals('alice',session.id);
    const duplicate=graph.startInterval('alice',{id:'should_not_exist',taskId:'restart_b',workSessionId:session.id});
    console.log(JSON.stringify({session:session.id,availableMs:session.available_ms,order:items.map(t=>t.id),open:open.map(i=>i.id),reused:duplicate.id,otherUser:graph.getOpenSession('bob')}));
  `);
  assert.equal(recovered.session, 'restart_session');
  assert.equal(recovered.availableMs, 600000);
  assert.deepEqual(recovered.order, ['restart_b','restart_a']);
  assert.deepEqual(recovered.open, ['restart_interval']);
  assert.equal(recovered.reused, 'restart_interval');
  assert.equal(recovered.otherUser, null);
});

test.after(() => { fs.rmSync(temporaryDatabase, {recursive:true, force:true}); });
