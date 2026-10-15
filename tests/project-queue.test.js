'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const queue=require('../frontend/project-queue');
const task=(id,path=[],options={})=>({id,projectAncestorIds:path,status:'pending',completed:false,...options});
test('snooze moves the whole parent after exactly one peer without reordering children or changing data',()=>{
    const tasks=[task('p1',['P']),task('p2',['P']),task('q1',['Q']),task('q2',['Q']),task('standalone')];
    const before=JSON.stringify(tasks),moved=queue.snoozed(tasks,'P');
    assert.deepEqual(moved.map(row=>row.id),['q1','q2','p1','p2','standalone']);assert.equal(JSON.stringify(tasks),before);
    assert.deepEqual(queue.snoozed(moved,'P').map(row=>row.id),['q1','q2','standalone','p1','p2']);
    assert.equal(queue.snoozed(queue.snoozed(moved,'P'),'P'),null);
});
test('nested snooze swaps only sibling blocks; completed history and unrelated roots are retained',()=>{
    const tasks=[task('sort',[],{isSortingOverhead:true,completed:true}),task('a1',['P','A']),task('a2',['P','A'],{completed:true,status:'completed'}),task('b',['P','B']),task('c',['P']),task('q',['Q'])];
    const moved=queue.snoozed(tasks,'A');assert.deepEqual(moved.map(row=>row.id),['sort','b','a1','a2','c','q']);
    assert.deepEqual(queue.snoozed(tasks,'P').map(row=>row.id),['sort','q','a1','a2','b','c']);
    assert.equal(queue.snoozed(tasks,'Q'),null);assert.equal(queue.snoozed(tasks,'unknown'),null);
});
test('finished peers do not count as queued work and leaf tasks never acquire a parent control',()=>{
    const tasks=[task('p',['P']),task('done',['Done'],{completed:true,status:'completed'}),task('leaf')];
    assert.deepEqual(queue.snoozed(tasks,'P').map(row=>row.id),['done','leaf','p']);
    assert.deepEqual(queue.parents(tasks).map(row=>row.id),['P']);assert.equal(queue.snoozed(tasks,'leaf'),null);
});
test('blocked-only peers are not counted as executable queue items',()=>{
    const tasks=[task('p',['P']),task('blocked',['Blocked'],{status:'blocked'}),task('r')];
    assert.deepEqual(queue.snoozed(tasks,'P').map(row=>row.id),['blocked','r','p']);assert.equal(queue.snoozed(tasks,'Blocked'),null);
});
