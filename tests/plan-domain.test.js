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

test('calendar planning starts now without availability or importance comparisons',()=>{
 const now=Date.parse('2026-10-29T15:00:00Z'),nodes=[task('alpha'),task('beta',{estimated_ms:2*H})];
 for(const extra of [{},{windows:[]}]){
  const result=plan(nodes,[],[],{now,reserve:0.2,...extra});
  assert.equal(result.availabilityMode,'continuous');
  assert.equal(result.schedule[0].start,now);
  assert.equal(result.schedule.at(-1).end,now+3*H);
  assert.ok(result.items.every(i=>i.importanceRank===null&&i.ready));
  assert.deepEqual(result.warnings,[]);
 }
});
test('explicit task starts and working intervals override the present-time default',()=>{
 const now=Date.parse('2026-10-29T15:00:00Z');
 const nodes=[task('later',{earliest_start_at:now+2*H}),task('ready')];
 const evidence=[{higher_id:'later',lower_id:'ready',created_at:1}];
 const result=plan(nodes,[],evidence,{now,windows:[]});
 assert.deepEqual(result.schedule.map(i=>i.id),['ready','later']);
 assert.equal(result.schedule[0].start,now);assert.equal(result.schedule[1].start,now+2*H);
 assert.equal(result.items.find(i=>i.id==='later').ready,false);
 const explicit=plan([task('a')],[],[],{now,windows:[{start:now+4*H,end:now+6*H}]});
 assert.equal(explicit.availabilityMode,'specified');assert.equal(explicit.schedule[0].start,now+4*H);
 const expired=plan([task('a')],[],[],{now,windows:[{start:now-2*H,end:now-H}]});
 assert.equal(expired.schedule.length,0,'expired explicit windows must not silently become continuous availability');
});

test('weekly working hours respect days, breaks, and multi-day task splitting',()=>{
 const now=Date.parse('2026-10-26T14:00:00Z'); // Monday 09:00 in Chicago.
 const workingHours=[1,2,3,4,5].flatMap(weekday=>[{weekday,startMinute:540,endMinute:720},{weekday,startMinute:780,endMinute:1020}]);
 const result=plan([task('long',{estimated_ms:10*H})],[],[],{now,timezone:'America/Chicago',workingHoursEnabled:true,workingHours,reserve:0});
 assert.equal(result.availabilityMode,'weekly');
 assert.deepEqual(result.schedule[0].segments,[
  {start:now,end:Date.parse('2026-10-26T17:00:00Z')},
  {start:Date.parse('2026-10-26T18:00:00Z'),end:Date.parse('2026-10-26T22:00:00Z')},
  {start:Date.parse('2026-10-27T14:00:00Z'),end:Date.parse('2026-10-27T17:00:00Z')}
 ]);
 const unsplittable=plan([task('continuous',{estimated_ms:5*H,splittable:false})],[],[],{now,timezone:'America/Chicago',workingHoursEnabled:true,workingHours,reserve:0});
 assert.equal(unsplittable.schedule.length,0,'a continuous task cannot span a break');
});
test('weekly hours skip nonworking days and continue recurring beyond manually entered dates',()=>{
 const now=Date.parse('2026-10-30T23:00:00Z'); // Friday after work, before the fall DST change.
 const options={now,timezone:'America/Chicago',workingHoursEnabled:true,workingHours:[1,2,3,4,5].map(weekday=>({weekday,startMinute:540,endMinute:1020})),reserve:0};
 const result=plan([task('monday')],[],[],options);
 assert.equal(result.schedule[0].start,Date.parse('2026-11-02T15:00:00Z'));
 const distant=plan([task('new-year',{earliest_start_at:Date.parse('2027-01-04T15:00:00Z')})],[],[],options);
 assert.equal(distant.schedule[0].start,Date.parse('2027-01-04T15:00:00Z'));
 assert.ok(distant.horizonEnd>Date.parse('2027-01-04T15:00:00Z'));
});
test('weekly hours resolve DST gaps and repeated hours in the selected timezone',()=>{
 const {weeklyWindows}=require('../frontend/plan-domain');
 const sunday=[{weekday:0,startMinute:60,endMinute:240}];
 assert.deepEqual(weeklyWindows(sunday,{now:Date.parse('2026-03-08T05:00:00Z'),end:Date.parse('2026-03-09T04:00:00Z'),timezone:'America/New_York'}),[{start:Date.parse('2026-03-08T06:00:00Z'),end:Date.parse('2026-03-08T08:00:00Z')}]);
 assert.deepEqual(weeklyWindows(sunday,{now:Date.parse('2026-11-01T04:00:00Z'),end:Date.parse('2026-11-02T05:00:00Z'),timezone:'America/New_York'}),[{start:Date.parse('2026-11-01T05:00:00Z'),end:Date.parse('2026-11-01T09:00:00Z')}]);
 assert.deepEqual(weeklyWindows([{weekday:0,startMinute:150,endMinute:240}],{now:Date.parse('2026-03-08T05:00:00Z'),end:Date.parse('2026-03-09T04:00:00Z'),timezone:'America/New_York'}),[{start:Date.parse('2026-03-08T07:30:00Z'),end:Date.parse('2026-03-08T08:00:00Z')}]);
});
test('overnight shifts span midnight and weekly validation catches wraparound overlap',()=>{
 const {weeklyWindows,validateWorkingHours}=require('../frontend/plan-domain');
 const overnight=[{weekday:6,startMinute:1320,endMinute:1800}];
 const windows=weeklyWindows(overnight,{now:Date.parse('2026-10-31T20:00:00Z'),end:Date.parse('2026-11-01T08:00:00Z'),timezone:'UTC'});
 assert.deepEqual(windows,[{start:Date.parse('2026-10-31T22:00:00Z'),end:Date.parse('2026-11-01T06:00:00Z')}]);
 assert.throws(()=>validateWorkingHours([...overnight,{weekday:0,startMinute:300,endMinute:420}]),/overlap/);
 assert.throws(()=>validateWorkingHours([{weekday:7,startMinute:540,endMinute:1020}]),/Invalid/);
 assert.throws(()=>validateWorkingHours([{weekday:1,startMinute:540,endMinute:540}]),/Invalid/);
});
test('weekly and one-off availability merge once before reserving capacity; all days off stays unavailable',()=>{
 const now=Date.parse('2026-10-26T09:00:00Z'),base={now,timezone:'UTC',workingHoursEnabled:true,workingHours:[{weekday:1,startMinute:540,endMinute:720}],reserve:0.2};
 const merged=plan([task('four-hours',{estimated_ms:4*H})],[],[],{...base,windows:[{start:now+H,end:now+5*H}]});
 assert.equal(merged.schedule[0].start,now);assert.equal(merged.schedule[0].end,now+4*H);
 const off=plan([task('off')],[],[],{...base,workingHours:[]});assert.equal(off.schedule.length,0);assert.equal(off.availabilityMode,'weekly');
 const disabled=plan([task('now')],[],[],{...base,workingHoursEnabled:false});assert.equal(disabled.schedule[0].start,now);assert.equal(disabled.availabilityMode,'continuous');
});
