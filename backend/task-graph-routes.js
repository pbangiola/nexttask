const express = require('express');
const store = require('./task-graph-store');
const router = express.Router();

function user(req){return req.clerkUserId;}
function fail(res,error){const missing=/not found/i.test(error.message);return res.status(missing?404:400).json({error:error.message});}

router.get('/work-sessions/open',(req,res)=>{try{res.json({workSession:store.getOpenSession(user(req))});}catch(e){fail(res,e);}});
router.post('/work-sessions',(req,res)=>{try{res.status(201).json({workSession:store.createSession(user(req),req.body||{})});}catch(e){fail(res,e);}});
router.get('/work-sessions/:id',(req,res)=>{try{res.json({workSession:store.getSession(user(req),req.params.id),items:store.getItems(user(req),req.params.id)});}catch(e){fail(res,e);}});
router.put('/work-sessions/:id/items',(req,res)=>{try{res.json({items:store.setItems(user(req),req.params.id,req.body?.taskIds||[])});}catch(e){fail(res,e);}});
router.post('/work-sessions/:id/end',(req,res)=>{try{res.json({workSession:store.endSession(user(req),req.params.id)});}catch(e){fail(res,e);}});
router.post('/work-intervals',(req,res)=>{try{res.status(201).json({interval:store.startInterval(user(req),req.body||{})});}catch(e){fail(res,e);}});
router.post('/work-intervals/:id/stop',(req,res)=>{try{res.json({interval:store.stopInterval(user(req),req.params.id,req.body?.endedAt)});}catch(e){fail(res,e);}});
router.get('/tasks/:id/work-intervals',(req,res)=>{try{res.json({intervals:store.getIntervals(user(req),req.params.id)});}catch(e){fail(res,e);}});

module.exports=router;
