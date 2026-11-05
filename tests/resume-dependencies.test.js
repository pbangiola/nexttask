'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexttask-resume-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH=directory;
const store=require('../backend/plan-store'),db=require('../backend/database').connection;
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
const agenda=require('../backend/agenda-store');
const scheduler=require('../frontend/agenda-scheduler');
const H=3600000;

const vm=require('node:vm');
function browserModel(state){
 const ctx=vm.createContext({window:{taskSorterMode:'guest',TaskGraph:{},PlanExecution:{refresh:async()=>{}},FocusDurability:{newWork(){},prepare:async()=>{}}},document:{},console,Date,Map,Set,Promise,
  hideStaticScreens(){},hide(){},el(){return null},createTask:(name,values)=>({name,...values}),hasHardStop:()=>false,showFocus:async()=>{},showModeSelect(){}});
 ctx.window.window=ctx.window;ctx.window.AgendaScheduler=scheduler;ctx.fixture=state;
 let code=fs.readFileSync('frontend/agenda.js','utf8');
 const shellStart=code.indexOf('    function shell('),errorStart=code.indexOf('    function error(');
 code=code.slice(0,shellStart)+"    function shell(){return {append(){}};}\n"+code.slice(errorStart);
 const loadStart=code.indexOf('    async function load()'),planStart=code.indexOf('    async function plan(');
 code=code.slice(0,loadStart)+'    async function load(){return fixture;}\n'+code.slice(planStart);
 const showStart=code.indexOf('    async function showAgenda()'),eventStart=code.indexOf('    function eventForm(');
 code=code.slice(0,showStart)+'    async function showAgenda(){window.showAgendaCalled=true;}\n'+code.slice(eventStart);
 vm.runInContext('let sortedTasks=[],activeTaskId=null;'+code,ctx);return ctx;
}

test('Resume keeps dependents and promotes their prerequisite ahead of unrelated work',async()=>{
 const owner='fixed_resume';store.create(owner,{tasks:[{id:'resume-main',name:'Main task',estimatedTimeMs:60000,prerequisites:[]},{id:'resume-other',name:'Other work',estimatedTimeMs:60000},{id:'resume-pre',name:'Prerequisite',estimatedTimeMs:60000}]});
 store.update(owner,'resume-main',{prerequisites:['resume-pre']});
 const state=agenda.read(owner);state.nodes=new Map(store.snapshot(owner).nodes.map(n=>[n.id,n]));const ctx=browserModel(state);
 await ctx.window.Agenda.resume();const ids=vm.runInContext('sortedTasks.map(n=>n.id)',ctx);assert.deepEqual([...ids],['resume-pre','resume-main','resume-other']);
});
test('prerequisites inherit dependent priority across backlog and Agenda without duplicates',()=>{
 const nodes=[{id:'project',name:'Source project',node_type:'project',status:'pending'},...['main','other','pre'].map((id,index)=>({id,name:id,node_type:'task',parent_id:id==='pre'?'project':null,status:'pending',estimated_ms:60000,position:index+1}))];
 const rows=nodes.filter(n=>n.node_type==='task'),deps=[{task_id:'main',prerequisite_id:'project'}];
 assert.deepEqual(scheduler.dependencyOrder([rows[0]],rows,nodes,deps).map(n=>n.id),['pre','main']);
 assert.deepEqual(scheduler.dependencyOrder(rows,rows,nodes,deps).map(n=>n.id),['pre','main','other']);
});
test('shared and transitive prerequisites are queued once before their dependents',()=>{
 const rows=['main','other','pre','first'].map(id=>({id,name:id,node_type:'task',status:'pending',estimated_ms:60000}));
 const deps=[{task_id:'main',prerequisite_id:'pre'},{task_id:'other',prerequisite_id:'pre'},{task_id:'pre',prerequisite_id:'first'}];
 assert.deepEqual(scheduler.dependencyOrder(rows,rows,rows,deps).map(n=>n.id),['first','pre','main','other']);
});
test('legacy due input maps to one deadline and Agenda round trip retains it',()=>{
 const owner='single_deadline',due=Date.now()+H;store.create(owner,{tasks:[{id:'single-date',name:'One date',estimatedTimeMs:60000,due_at:due}]});
 let n=store.snapshot(owner).nodes[0];assert.equal(n.due_at,null);assert.equal(n.deadline_at,due);
 const state=agenda.read(owner);agenda.save(owner,{revision:state.revision,tasks:state.items.map(row=>({id:row.id,dueAt:row.due_at}))});
 n=store.snapshot(owner).nodes[0];assert.equal(n.due_at,null);assert.equal(n.deadline_at,due);
 store.update(owner,n.id,{deadline_at:null});n=store.snapshot(owner).nodes[0];assert.equal(n.deadline_at,null);assert.equal(n.due_at,null);
});
test('task editor and bulk editor expose only Deadline',()=>{
 const source=fs.readFileSync('frontend/plan.js','utf8');assert.doesNotMatch(source,/Preferred due date|Hard deadline|due_at/);
 assert.match(source,/field\(dates,'Deadline'/);assert.match(source,/\['deadline_at','Deadline'\]/);
});

test('completion enables a dependent immediately, including completed project prerequisites',()=>{
 const rows=[{id:'p',name:'Project',node_type:'project',status:'pending'},{id:'pre',name:'Prerequisite',parent_id:'p',node_type:'task',status:'pending'},{id:'main',name:'Main',node_type:'task',status:'pending'}];
 const source=fs.readFileSync('frontend/plan.js','utf8'),start=source.indexOf('    const execution='),end=source.indexOf('    window.PlanExecution=execution;',start);
 const queue=[{id:'pre',status:'pending'},{id:'main',status:'pending'}];
 const ctx=vm.createContext({window:{PlanDomain:require('../frontend/plan-domain')},sortedTasks:queue,Date});
 vm.runInContext(source.slice(start,end)+'globalThis.execution=execution;',ctx);
 ctx.execution.adopt({nodes:rows,dependencies:[{task_id:'main',prerequisite_id:'p'}]});
 assert.equal(ctx.execution.allowed(queue[1]),false);queue[0].completed=true;assert.equal(ctx.execution.allowed(queue[1]),true);
 assert.equal(rows[0].status,'pending','eligibility must not mutate the canonical snapshot');
});
test('deadline migration preserves legacy dates and existing deadlines across restarts',()=>{
 const {execFileSync}=require('node:child_process'),owner='date_migration';
 store.create(owner,{tasks:[{id:'date-old',name:'Old date'},{id:'date-hard',name:'Both dates',deadline_at:2000}]});
 db.prepare('UPDATE plan_details SET due_at=? WHERE task_id=?').run(1000,'date-old');
 db.prepare('UPDATE plan_details SET due_at=? WHERE task_id=?').run(1000,'date-hard');
 db.prepare('DELETE FROM schema_migrations WHERE version=7').run();
 const migrate=()=>execFileSync(process.execPath,['-e',"require('./backend/plan-store')"],{cwd:process.cwd(),env:process.env,stdio:'pipe'});
 migrate();
 assert.deepEqual(db.prepare('SELECT due_at,deadline_at FROM plan_details WHERE task_id=?').get('date-old'),{due_at:null,deadline_at:1000});
 assert.deepEqual(db.prepare('SELECT due_at,deadline_at FROM plan_details WHERE task_id=?').get('date-hard'),{due_at:null,deadline_at:2000});
 store.update(owner,'date-old',{deadline_at:null});migrate();
 assert.equal(db.prepare('SELECT deadline_at FROM plan_details WHERE task_id=?').get('date-old').deadline_at,null);
});
