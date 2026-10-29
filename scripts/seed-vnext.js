'use strict';
const store=require('../backend/plan-store');
module.exports=function seed(owner){
    if(store.snapshot(owner).nodes.length)return;
    const now=Date.now(),H=3600000;
    store.create(owner,{requestId:'vnext-demo-seed',tasks:[
        {id:'demo-project',name:'Prepare an important proposal',nodeType:'project',deadline_at:now+3*86400000,description:'Advance important work before its opportunities disappear.'},
        {id:'demo-research',name:'Gather the supporting evidence',parentId:'demo-project',estimatedTimeMs:45*60000,tags:['work']},
        {id:'demo-draft',name:'Write the proposal',parentId:'demo-project',estimatedTimeMs:90*60000,prerequisites:['demo-research'],splittable:false},
        {id:'demo-submit',name:'Review and submit',parentId:'demo-project',estimatedTimeMs:30*60000,prerequisites:['demo-draft']},
        {id:'demo-email',name:'Clear routine email',estimatedTimeMs:20*60000,due_at:now+86400000,tags:['work']},
        {id:'demo-home',name:'Household essentials',nodeType:'project'},
        {id:'demo-groceries',name:'Plan groceries',parentId:'demo-home',estimatedTimeMs:15*60000,tags:['home']},
        {id:'demo-care',name:'Take time for a walk',estimatedTimeMs:30*60000,recurrence_days:1,recurrence_zone:'America/Chicago',tags:['self-care']},
        {id:'demo-inbox',name:'An obligation still to estimate',tags:['inbox']}
    ]});
    store.rank(owner,{ids:['demo-project','demo-care','demo-home','demo-email']});
    store.settings(owner,{timezone:'America/Chicago',reserve:0.2,windows:[{start:now,end:now+4*H},{start:now+86400000,end:now+86400000+3*H},{start:now+2*86400000,end:now+2*86400000+4*H}]});
};
if(require.main===module){const owner=process.argv[2];if(!owner)throw new Error('Supply the Clerk user ID to seed in the isolated Dev database.');module.exports(owner);console.log('Seeded demo tasks if the account was empty.');}
