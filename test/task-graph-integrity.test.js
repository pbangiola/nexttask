'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('legacy focus snapshots cannot flatten or relocate project nodes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexttask-integrity-'));
  try {
    const script = `
      const assert = require('node:assert/strict');
      const db = require('./backend/database');
      const users = require('./backend/user-store');
      const graph = require('./backend/task-graph-store');
      const user = 'user_test';
      users.ensureUser(user);
      const project = users.createNode(user,{id:'project_one',name:'Project',nodeType:'project',independentlyActionable:false,sessionId:'planner:user_test'});
      const child = users.createNode(user,{id:'task_child',name:'Original',parentId:project.id,sessionId:'planner:user_test',position:7});
      const other = users.createNode(user,{id:'task_other',name:'Other',parentId:project.id,sessionId:'planner:user_test',position:8});
      const before = users.getNode(user,child.id);
      const session = graph.createSession(user,{id:'work_test'});
      graph.setItems(user,session.id,[other.id,child.id]);
      db.saveTaskList(user,[{id:child.id,userId:user,name:'Project: Renamed by UI',status:'active',estimatedTimeMs:60000,position:1},{id:other.id,userId:user,name:'Project: Other',status:'pending',position:2}],{});
      const after = users.getNode(user,child.id);
      assert.equal(after.parent_id,project.id);
      assert.equal(after.session_id,before.session_id);
      assert.equal(after.name,'Original');
      assert.equal(after.position,before.position);
      assert.deepEqual(graph.getItems(user,session.id).map(t=>t.id),[other.id,child.id]);
      const originalSession = after.session_id;
      users.importOpenTasksIntoSession(user,'legacy_resume');
      assert.equal(users.getNode(user,child.id).session_id,originalSession);
      assert.equal(users.getNode(user,project.id).node_type,'project');
      assert.equal(users.getNode(user,project.id).independently_actionable,0);
    `;
    const result = spawnSync(process.execPath,['-e',script],{
      cwd:path.join(__dirname,'..'),
      env:{...process.env,RAILWAY_VOLUME_MOUNT_PATH:dir},
      encoding:'utf8'
    });
    assert.equal(result.status,0,result.stderr || result.stdout);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
