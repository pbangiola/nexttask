'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('v4 database gains only additive project bookkeeping and survives restart without resetting canonical data',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexttask-project-migrate-'));
    const run=code=>{const r=spawnSync(process.execPath,['-e',code],{cwd:path.resolve(__dirname,'..'),env:{...process.env,RAILWAY_VOLUME_MOUNT_PATH:directory},encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
    try{
        const before=run(`const d=require('./backend/database').connection;const u=require('./backend/user-store');u.createNode('owner',{id:'parent',name:'Parent',nodeType:'project',estimatedTimeMs:999});u.createNode('owner',{id:'child',name:'Child',parentId:'parent',estimatedTimeMs:1234567});u.createNode('owner',{id:'empty',name:'Optional empty estimate',nodeType:'project',estimatedTimeMs:90000});u.createNode('other',{id:'foreign',name:'Foreign'});d.prepare("UPDATE tasks SET elapsed_ms=12345 WHERE id='child'").run();d.prepare("INSERT INTO data_migrations(name,applied_at) VALUES('old-reset-marker',456)").run();d.exec('ALTER TABLE tasks DROP COLUMN estimated_from_children; ALTER TABLE tasks DROP COLUMN own_elapsed_ms; DELETE FROM schema_migrations WHERE version=5; INSERT OR IGNORE INTO schema_migrations VALUES(4,123);');console.log(JSON.stringify({rows:d.prepare('SELECT * FROM tasks ORDER BY id').all(),markers:d.prepare('SELECT * FROM data_migrations').all()}));`);
        const code=`const d=require('./backend/database').connection;console.log(JSON.stringify({rows:d.prepare('SELECT * FROM tasks ORDER BY id').all(),markers:d.prepare('SELECT * FROM data_migrations').all(),versions:d.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),foreign:d.pragma('foreign_key_check')}));`;
        const after=run(code);assert.deepEqual(after.markers,before.markers);assert.deepEqual(after.foreign,[]);assert.ok(after.versions.some(r=>r.version===4));assert.ok(after.versions.some(r=>r.version===5));
        for(let i=0;i<before.rows.length;i++){const {estimated_from_children,own_elapsed_ms,...original}=after.rows[i];assert.deepEqual(original,before.rows[i]);assert.equal(own_elapsed_ms,0);assert.equal(estimated_from_children,original.id==='parent'?1:0);}
        assert.deepEqual(run(code),after);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
