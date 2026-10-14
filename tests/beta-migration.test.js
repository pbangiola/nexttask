'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
test('optional-field migration/restart preserves canonical rows, ownership, markers, and exact ranking/deadline metadata',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'beta-migration-'));
    const run=code=>{const r=spawnSync(process.execPath,['-e',code],{cwd:path.resolve(__dirname,'..'),env:{...process.env,RAILWAY_VOLUME_MOUNT_PATH:dir},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());};
    try{
        const before=run(`require('./backend/database');const u=require('./backend/user-store');u.createNode('owner',{id:'stable',name:'Stable',estimatedTimeMs:45000});const db=new(require('better-sqlite3'))(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');db.prepare("INSERT INTO data_migrations(name,applied_at) VALUES('original-marker',123)").run();console.log(JSON.stringify({rows:db.prepare('SELECT * FROM tasks').all(),markers:db.prepare('SELECT * FROM data_migrations').all()}));`);
        const after=run(`const p=require('./backend/task-priorities');p.setDue('owner','stable',1234567890000);p.rank('owner',['stable']);const db=new(require('better-sqlite3'))(process.env.RAILWAY_VOLUME_MOUNT_PATH+'/task_sorter.db');console.log(JSON.stringify({rows:db.prepare('SELECT * FROM tasks').all(),markers:db.prepare('SELECT * FROM data_migrations').all(),priority:p.list('owner').items[0],version:db.prepare('SELECT version FROM schema_migrations WHERE version=4').get()}));`);
        assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.markers,before.markers);assert.equal(after.version.version,4);
        const restarted=run(`console.log(JSON.stringify(require('./backend/task-priorities').list('owner').items[0]));`);assert.equal(restarted.id,'stable');assert.equal(restarted.user_id,'owner');assert.equal(restarted.due_at,1234567890000);assert.equal(restarted.importance_rank,1);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
