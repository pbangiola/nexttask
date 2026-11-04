'use strict';
const express=require('express');
const store=require('./plan-store');
const router=express.Router();
const handle=fn=>(req,res)=>{try{res.json(fn(req.clerkUserId,req));}catch(error){res.status(error.status||(/not found/i.test(error.message)?404:400)).json({error:error.message});}};
const agenda=require('./agenda-store');
router.get('/plan/agenda',handle(owner=>agenda.read(owner)));
router.put('/plan/agenda',handle((owner,req)=>agenda.save(owner,req.body||{})));
router.post('/plan/agenda/backlog',handle((owner,req)=>agenda.backlog(owner,req.body?.taskIds)));
router.post('/plan/calendar-events',handle((owner,req)=>agenda.addEvent(owner,req.body||{})));
router.delete('/plan/calendar-events/:id',handle((owner,req)=>agenda.deleteEvent(owner,req.params.id)));
router.get('/plan',handle((owner)=>store.snapshot(owner)));
router.post('/plan/tasks',handle((owner,req)=>{
    const input=req.body||{};
    if(Array.isArray(input.tasks))for(const task of input.tasks){
        if(task.parentId&&task.nodeType!=='project'&&(!Number.isSafeInteger(task.estimatedTimeMs)||task.estimatedTimeMs<=0))throw new Error('New project tasks require an estimated duration');
    }
    return store.create(owner,input);
}));
router.put('/plan/tasks/:id',handle((owner,req)=>store.update(owner,req.params.id,req.body||{})));
router.post('/plan/tasks/:id/delete',handle((owner,req)=>store.remove(owner,req.params.id,req.body||{})));
router.post('/plan/tasks/:id/restore',handle((owner,req)=>store.restore(owner,req.params.id,req.body||{})));
router.post('/plan/bulk',handle((owner,req)=>store.bulk(owner,req.body||{})));
router.post('/plan/rank',handle((owner,req)=>store.rank(owner,req.body||{})));
router.put('/plan/settings',handle((owner,req)=>store.settings(owner,req.body||{})));
module.exports=router;
