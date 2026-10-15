'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');

function run(directory, code) {
    const result = spawnSync(process.execPath,['-e',code],{
        cwd:root, env:{...process.env,RAILWAY_VOLUME_MOUNT_PATH:directory},encoding:'utf8',timeout:15000
    });
    assert.equal(result.status,0,result.stderr || result.stdout);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

for (const hasResetMarker of [true,false]) {
    test(`upgrade/restart preserves legacy rows and ${hasResetMarker ? 'existing' : 'absent'} reset marker`, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(),'nexttask-upgrade-'));
        try {
            // Seed the pre-graph main schema without loading the new graph store.
            // Legacy tables are deliberately populated: upgrades must not DROP them.
            const before = run(directory, `
                require('./backend/database');
                const users = require('./backend/user-store');
                const Database = require('better-sqlite3');
                users.createNode('owner',{id:'upgrade-root',name:'Root',nodeType:'project',position:9,estimatedTimeMs:90000});
                users.createNode('owner',{id:'upgrade-project',name:'Nested',nodeType:'project',parentId:'upgrade-root',position:4});
                users.createNode('owner',{id:'upgrade-child',name:'Original child',parentId:'upgrade-project',position:7,estimatedTimeMs:60000});
                users.createNode('other',{id:'upgrade-other',name:'Other owner'});
                const db = new Database(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');
                db.exec("CREATE TABLE projects(id TEXT); INSERT INTO projects VALUES('historical-project'); CREATE TABLE project_tasks(id TEXT); INSERT INTO project_tasks VALUES('historical-child'); CREATE TABLE task_queue(id TEXT); INSERT INTO task_queue VALUES('historical-queue'); CREATE TABLE completed_tasks(id TEXT); INSERT INTO completed_tasks VALUES('historical-completed');");
                db.prepare("INSERT INTO tasks(id,session_id,user_id,name,created,updated_at) VALUES('upgrade-anonymous','planner:owner',NULL,'Anonymous',1,1)").run();
                db.prepare("INSERT INTO data_migrations(name,applied_at) VALUES('existing-nonreset-marker',123)").run();
                if (${hasResetMarker}) db.prepare("INSERT INTO data_migrations(name,applied_at) VALUES('2026-09-29-clerk-fresh-start',456)").run();
                console.log(JSON.stringify({tasks:db.prepare('SELECT * FROM tasks ORDER BY id').all(),sessions:db.prepare('SELECT * FROM sessions ORDER BY id').all(),markers:db.prepare('SELECT * FROM data_migrations ORDER BY name').all()}));
                db.close();
            `);
            const migrated = run(directory, `
                require('./backend/database');require('./backend/user-store');
                const graph = require('./backend/task-graph-store');
                const Database = require('better-sqlite3');
                graph.createSession('owner',{id:'upgrade-work'});
                graph.setItems('owner','upgrade-work',['upgrade-child']);
                graph.startInterval('owner',{id:'upgrade-interval',taskId:'upgrade-child',workSessionId:'upgrade-work',startedAt:Date.now()-1000});
                const db = new Database(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');
                console.log(JSON.stringify({tasks:db.prepare('SELECT * FROM tasks ORDER BY id').all(),sessions:db.prepare('SELECT * FROM sessions ORDER BY id').all(),markers:db.prepare('SELECT * FROM data_migrations ORDER BY name').all(),schema:db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),violations:db.pragma('foreign_key_check')}));
                db.close();
            `);
            assert.deepEqual(migrated.tasks,before.tasks);
            assert.deepEqual(migrated.sessions,before.sessions);
            assert.deepEqual(migrated.markers,before.markers);
            assert.deepEqual(migrated.schema,[{version:2},{version:3},{version:5}]);
            assert.deepEqual(migrated.violations,[]);
            const restarted = run(directory, `
                require('./backend/database');require('./backend/user-store');
                const graph = require('./backend/task-graph-store');
                const Database = require('better-sqlite3');
                const db = new Database(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');
                const session=graph.getOpenSession('owner');
                console.log(JSON.stringify({tasks:db.prepare('SELECT * FROM tasks ORDER BY id').all(),markers:db.prepare('SELECT * FROM data_migrations ORDER BY name').all(),session:session.id,queue:graph.getItems('owner',session.id).map(t=>t.id),intervals:graph.getOpenIntervals('owner',session.id).map(i=>i.id),legacyTables:['projects','project_tasks','task_queue','completed_tasks'].map(t=>db.prepare('SELECT * FROM '+t).all()),violations:db.pragma('foreign_key_check')}));
                db.close();
            `);
            assert.deepEqual(restarted.tasks,before.tasks);
            assert.deepEqual(restarted.markers,before.markers);
            assert.equal(restarted.session,'upgrade-work');
            assert.deepEqual(restarted.queue,['upgrade-child']);
            assert.deepEqual(restarted.intervals,['upgrade-interval']);
            assert.deepEqual(restarted.legacyTables,[[{id:'historical-project'}],[{id:'historical-child'}],[{id:'historical-queue'}],[{id:'historical-completed'}]]);
            assert.deepEqual(restarted.violations,[]);
        } finally {fs.rmSync(directory,{recursive:true,force:true});}
    });
}

test('older task schemas gain graph columns without deleting data', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexttask-old-schema-'));
    try {
        run(directory, `
            const Database=require('better-sqlite3');
            const db=new Database(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');
            db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,updated_at INTEGER NOT NULL,total_available_time_ms INTEGER NOT NULL DEFAULT 0,end_constraint TEXT NOT NULL DEFAULT ''); INSERT INTO sessions(id,updated_at) VALUES('legacy-session',1);");
            db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,name TEXT NOT NULL,status TEXT DEFAULT 'pending',estimated_ms INTEGER DEFAULT 0,elapsed_ms INTEGER DEFAULT 0,position INTEGER DEFAULT 0,blocked_by_task_id TEXT,created INTEGER,started INTEGER,completed INTEGER,last_changed INTEGER,updated_at INTEGER); INSERT INTO tasks(id,session_id,name,created,updated_at) VALUES('legacy-id','legacy-session','Legacy anonymous task',1,1);");
            console.log('{}');db.close();
        `);
        const upgraded=run(directory, `
            require('./backend/database');require('./backend/user-store');require('./backend/task-graph-store');
            const Database=require('better-sqlite3');const db=new Database(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');
            console.log(JSON.stringify(db.prepare("SELECT * FROM tasks WHERE id='legacy-id'").get()));db.close();
        `);
        assert.equal(upgraded.name,'Legacy anonymous task');
        assert.equal(upgraded.user_id,null);
        assert.equal(upgraded.node_type,'task');
        assert.equal(upgraded.independently_actionable,1);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
