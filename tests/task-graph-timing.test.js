'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const calls = [];
  const window = {activeWorkSessionId:'session_1'};
  window.TaskGraph = {
    async startWork(taskId, sessionId) {calls.push(['start',taskId,sessionId]);return {id:'interval_1'};},
    async stopWork(id, end) {calls.push(['stop',id,end]);return {id};},
    async openIntervals() {return [{id:'restored_1',task_id:'task_1'}];}
  };
  const code = fs.readFileSync(path.join(__dirname,'../frontend/task-graph-timing.js'),'utf8');
  vm.runInNewContext(code,{window,console,Promise,Map,Date});
  return {calls,bridge:window.TaskGraphTiming};
}

test('rapid start and stop preserve ordering',async()=>{
  const {calls,bridge}=setup();
  await Promise.all([bridge.start('task_1'),bridge.stop('task_1',1234)]);
  assert.deepEqual(calls,[['start','task_1','session_1'],['stop','interval_1',1234]]);
});

test('restored interval is reused',async()=>{
  const {calls,bridge}=setup();
  await bridge.restore('session_1');
  await bridge.start('task_1');
  await bridge.stop('task_1',4567);
  assert.deepEqual(calls,[['stop','restored_1',4567]]);
});
