'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {graph,plan,importance}=require('../frontend/plan-domain');
const H=3600000,task=(id,extra={})=>({id,name:id,node_type:'task',status:'pending',estimated_ms:H,...extra});
const edge=(a,b)=>({prerequisite_id:a,task_id:b});
const options={now:0,windows:[{start:0,end:12*H}],reserve:0};
test('dependency and importance remain separate; backward reservation is cumulative',()=>{
 const nodes=[task('a'),task('b',{estimated_ms:2*H,deadline_at:5*H})];
 const result=plan(nodes,[edge('a','b')],[{higher_id:'b',lower_id:'a',created_at:1}],options);
 assert.deepEqual(result.schedule.map(s=>s.id),['a','b']);assert.equal(result.items.find(i=>i.id==='b').importanceRank,1);
 assert.equal(result.items.find(i=>i.id==='b').latestStart,3*H);assert.equal(result.items.find(i=>i.id==='a').latestStart,2*H);
});
test('parallel graph prerequisites consume serial user capacity and shared work occurs once',()=>{
 const nodes=[task('a'),task('c'),task('b',{estimated_ms:2*H,deadline_at:4*H})];
 const r=plan(nodes,[edge('a','b'),edge('c','b')],[],options);assert.equal(r.schedule.at(-1).end,4*H);assert.equal(r.hardConstraintsSatisfied,true);
 const shared=plan([...nodes,task('d')],[edge('a','b'),edge('a','d')],[],options);assert.equal(shared.schedule.filter(i=>i.id==='a').length,1);
});
test('importance fills freedom without sacrificing hard deadlines',()=>{
 const nodes=[task('minor',{deadline_at:3*H}),task('major')],evidence=[{higher_id:'major',lower_id:'minor',created_at:1}];
 assert.deepEqual(plan(nodes,[],evidence,options).schedule.map(i=>i.id),['major','minor']);
 nodes[0].deadline_at=H;assert.deepEqual(plan(nodes,[],evidence,options).schedule.map(i=>i.id),['minor','major']);
});
test('fragmented availability reserves the last usable continuous interval',()=>{
 const nodes=[task('long',{estimated_ms:3*H,deadline_at:10*H,splittable:false}),task('short')];
 const r=plan(nodes,[],[{higher_id:'short',lower_id:'long',created_at:1}],{...options,windows:[{start:0,end:3*H},{start:4*H,end:5*H},{start:6*H,end:7*H}]});
 assert.equal(r.schedule[0].id,'long');assert.equal(r.items.find(i=>i.id==='long').latestStart,0);
});
test('unknown prerequisites and insufficient capacity never yield false feasibility',()=>{
 const r=plan([task('unknown',{estimated_ms:0}),task('b',{deadline_at:H})],[edge('unknown','b')],[],options);
 assert.equal(r.schedule.length,0);assert.ok(r.warnings.length);
 const impossible=plan([task('a',{estimated_ms:2*H,deadline_at:H})],[],[],options);assert.equal(impossible.hardConstraintsSatisfied,false);
});
test('composition inherits dates, benefits, and project prerequisites; deadlocks rejected',()=>{
 const p={id:'p',name:'project',node_type:'project',status:'pending',deadline_at:3*H};
 const nodes=[p,task('a',{parent_id:'p'}),task('b')];
 assert.throws(()=>graph(nodes,[edge('p','a')]),/deadlock|cycle/);
 assert.throws(()=>graph(nodes,[edge('a','b'),edge('b','a')]),/cycle/);
 const r=plan(nodes,[],[{higher_id:'p',lower_id:'b',created_at:1}],options);assert.equal(r.schedule[0].id,'a');assert.equal(r.items.find(i=>i.id==='a').deadlineAt,3*H);
});
test('newer contradictory evidence wins while unrelated judgments remain',()=>{
 const nodes=['a','b','c'].map(id=>task(id));
 const ranked=importance(nodes,[{higher_id:'a',lower_id:'b',created_at:1},{higher_id:'b',lower_id:'c',created_at:2},{higher_id:'b',lower_id:'a',created_at:3}]);
 assert.ok(ranked.order.indexOf('b')<ranked.order.indexOf('a'));assert.ok(ranked.order.indexOf('b')<ranked.order.indexOf('c'));
});
test('scheduled work reserves capacity even when more important work is flexible',()=>{
 const r=plan([task('fixed',{scheduled_start_at:H}),task('flexible',{estimated_ms:2*H})],[],[{higher_id:'flexible',lower_id:'fixed',created_at:1}],options);
 assert.equal(r.schedule.find(i=>i.id==='fixed').start,H);assert.equal(r.hardConstraintsSatisfied,true);
});
test('archived parents and cancelled prerequisites cannot enable work',()=>{
 const nodes=[{id:'p',name:'p',node_type:'project',status:'pending',archived:true},task('a',{parent_id:'p'}),task('cancelled',{status:'cancelled'}),task('b',{deadline_at:4*H})];
 const r=plan(nodes,[edge('cancelled','b')],[],options);assert.equal(r.schedule.length,0);assert.equal(r.hardConstraintsSatisfied,false);
});
test('work availability and interruption reserve affect deadline feasibility',()=>{
 const nodes=[task('a',{estimated_ms:3*H,deadline_at:4*H})];
 assert.equal(plan(nodes,[],[],{now:0,windows:[{start:0,end:4*H}],reserve:0.5}).hardConstraintsSatisfied,false);
 assert.equal(plan(nodes,[],[],{now:0,windows:[{start:0,end:4*H}],reserve:0}).hardConstraintsSatisfied,true);
});
test('preferred due dates flow through projects and prerequisites without becoming hard constraints',()=>{
 const nodes=[{id:'p',name:'p',node_type:'project',status:'pending',due_at:3*H},task('a',{parent_id:'p'}),task('source')];
 const r=plan(nodes,[edge('source','a')],[],options),a=r.items.find(i=>i.id==='a'),source=r.items.find(i=>i.id==='source');
 assert.equal(a.dueAt,3*H);assert.equal(a.deadlineAt,null);assert.equal(source.latestStart,H);assert.equal(r.hardConstraintsSatisfied,true);
});
