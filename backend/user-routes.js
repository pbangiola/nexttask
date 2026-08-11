const express = require('express');
const userStore = require('./user-store');
const actionabilityStore = require('./actionability-store');

const router = express.Router();
function badRequest(res,error){const message=error?.message||'Invalid request';const notFound=message.startsWith('Task node not found');return res.status(notFound?404:400).json({error:message});}

router.put('/users/:userId',(req,res)=>{try{userStore.ensureUser(req.params.userId);res.json({success:true,userId:req.params.userId});}catch(error){console.error('Failed to ensure user:',error);res.status(500).json({error:'Failed to save user',detail:error.message});}});
router.get('/users/:userId/tasks',(req,res)=>{try{userStore.claimUnownedTasks(req.params.userId);res.json({tasks:userStore.getOpenTasks(req.params.userId)});}catch(error){console.error('Failed to load user tasks:',error);res.status(500).json({error:'Failed to load user tasks',detail:error.message});}});
router.post('/users/:userId/tasks/import',(req,res)=>{try{const{sessionId}=req.body;if(!sessionId)return res.status(400).json({error:'sessionId is required'});const tasks=userStore.importOpenTasksIntoSession(req.params.userId,sessionId);res.json({tasks,sessionId});}catch(error){console.error('Failed to import user tasks:',error);res.status(500).json({error:'Failed to import user tasks',detail:error.message});}});

router.get('/users/:userId/actionable',(req,res)=>{try{userStore.claimUnownedTasks(req.params.userId);res.json({candidates:actionabilityStore.getActionableCandidates(req.params.userId)});}catch(error){console.error('Failed to load actionable tasks:',error);res.status(500).json({error:'Failed to load actionable tasks',detail:error.message});}});

router.get('/users/:userId/nodes',(req,res)=>{try{userStore.claimUnownedTasks(req.params.userId);const nodes=req.query.tree==='1'||req.query.tree==='true'?userStore.getTree(req.params.userId):userStore.getRootNodes(req.params.userId);res.json({nodes});}catch(error){console.error('Failed to load task nodes:',error);res.status(500).json({error:'Failed to load task nodes',detail:error.message});}});
router.get('/users/:userId/nodes/:nodeId',(req,res)=>{try{const node=userStore.getNode(req.params.userId,req.params.nodeId);const children=userStore.getChildren(req.params.userId,req.params.nodeId);res.json({node,children});}catch(error){return badRequest(res,error);}});
router.post('/users/:userId/nodes',(req,res)=>{try{const node=userStore.createNode(req.params.userId,req.body||{});res.status(201).json({node});}catch(error){return badRequest(res,error);}});
router.put('/users/:userId/nodes/:nodeId',(req,res)=>{try{const node=userStore.updateNode(req.params.userId,req.params.nodeId,req.body||{});res.json({node});}catch(error){return badRequest(res,error);}});
router.put('/users/:userId/nodes/:nodeId/parent',(req,res)=>{try{const result=userStore.reparentNode(req.params.userId,req.params.nodeId,req.body?.parentId??null,req.body?.position);res.json(result);}catch(error){return badRequest(res,error);}});
router.put('/users/:userId/nodes/:nodeId/dependency',(req,res)=>{try{const node=actionabilityStore.setDependency(req.params.userId,req.params.nodeId,req.body?.blockedByTaskId??null);res.json({node});}catch(error){return badRequest(res,error);}});
router.delete('/users/:userId/nodes/:nodeId',(req,res)=>{try{const mode=req.query.mode==='ungroup'?'ungroup':'subtree';res.json(userStore.deleteNode(req.params.userId,req.params.nodeId,mode));}catch(error){return badRequest(res,error);}});
router.post('/users/:userId/nodes/undo',(req,res)=>{try{userStore.restoreSnapshot(req.params.userId,req.body?.snapshot);res.json({success:true});}catch(error){return badRequest(res,error);}});

module.exports = router;
