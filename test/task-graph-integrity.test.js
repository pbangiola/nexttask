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

test('nested project graph survives snapshots and read-only import with main rollups intact', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'nexttask-nested-integrity-'));
  try {
    const script=`
      const assert=require('node:assert/strict');
      const legacy=require('./backend/database');
      const users=require('./backend/user-store');
      const graph=require('./backend/task-graph-store');
      const integrity=require('./backend/tree-integrity');
      const uid='nested-owner';
      users.createNode(uid,{id:'root',name:'Root original',nodeType:'project',position:3});
      users.createNode(uid,{id:'nested',name:'Nested original',nodeType:'project',parentId:'root',position:7});
      users.createNode(uid,{id:'child',name:'Child original',parentId:'nested',position:11,estimatedTimeMs:120000});
      users.createNode(uid,{id:'sibling',name:'Sibling original',parentId:'root',position:8,estimatedTimeMs:30000});
      users.createNode(uid,{id:'empty',name:'Empty original',nodeType:'project',position:20,estimatedTimeMs:45000});
      const ids=['root','nested','child','sibling','empty'];
      const structure=()=>ids.map(id=>{const n=users.getNode(uid,id);return {id:n.id,user_id:n.user_id,session_id:n.session_id,name:n.name,parent_id:n.parent_id,project_id:n.project_id,position:n.position,node_type:n.node_type,independently_actionable:n.independently_actionable};});
      const before=structure();
      graph.createSession(uid,{id:'nested-work'});graph.setItems(uid,'nested-work',['sibling','child']);
      legacy.saveTaskList(uid,ids.map((id,index)=>({id,userId:uid,name:'Renamed by focus',parentId:null,nodeType:'task',position:index+1,status:id==='child'?'completed':'pending',completed:id==='child',estimatedTimeMs:id==='child'?120000:30000,actualTimeMs:id==='child'?10000:0})),{});
      users.importOpenTasksIntoSession(uid,uid);
      assert.deepEqual(structure(),before);
      const reconciled=integrity.reconcile(uid);
      assert.equal(users.getNode(uid,'nested').status,'completed');
      assert.equal(users.getNode(uid,'nested').estimated_ms,120000);
      assert.equal(users.getNode(uid,'nested').elapsed_ms,10000);
      assert.equal(users.getNode(uid,'root').estimated_ms,150000);
      assert.equal(users.getNode(uid,'root').elapsed_ms,10000);
      assert.equal(users.getNode(uid,'root').status,'pending');
      assert.equal(users.getNode(uid,'empty').status,'pending');
      assert.equal(users.getNode(uid,'empty').estimated_ms,45000);
      assert.deepEqual(structure(),before);
      assert.deepEqual(graph.getItems(uid,'nested-work').map(t=>t.id),['sibling','child']);
      assert.equal(reconciled.audit.issues.some(i=>i.type==='hierarchy_cycle'),false);
    `;
    const result=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,RAILWAY_VOLUME_MOUNT_PATH:dir},encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr||result.stdout);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
