'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('a write queued immediately after an acknowledged write drains without another user action',{timeout:1500},async()=>{
 const calls=[],cache=new Map();let next=0;
 const context=vm.createContext({
  window:{taskSorterMode:'authenticated',taskSorterAuth:{userId:'journal-owner'},dispatchEvent(){}},
  localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)},
  API_BASE_URL:'http://localhost:3000',createId:prefix=>prefix+'_'+ ++next,
  CustomEvent:class{},queueMicrotask,
  fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({saved:true})};}
 });
 vm.runInContext(fs.readFileSync('frontend/task-graph.js','utf8'),context);
 const graph=context.window.TaskGraph;
 await graph.commit('first',[{path:'/test-first',method:'POST',body:{id:1}}]);
 await graph.commit('second',[{path:'/test-second',method:'POST',body:{id:2}}]);
 assert.deepEqual(calls.map(c=>c.url),['http://localhost:3000/api/test-first','http://localhost:3000/api/test-second']);
 assert.equal(graph.pending(),false);
});
