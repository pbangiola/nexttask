const express = require('express');
const userStore = require('./user-store');
const treeIntegrity = require('./tree-integrity');
const { getAuth } = require('@clerk/express');

const router = express.Router();

router.use('/users/:userId', (req, res, next) => {
    const auth = getAuth(req);
    if (!auth.isAuthenticated || !auth.userId) return res.status(401).json({ error: 'Unauthorized' });
    if (String(req.params.userId) !== String(auth.userId)) {
        return res.status(403).json({ error: 'User does not match authenticated Clerk identity' });
    }
    return next();
});
function badRequest(res,error){const message=error?.message||'Invalid request';const notFound=message.startsWith('Task node not found');return res.status(notFound?404:400).json({error:message});}

const priorities = require('./task-priorities');
router.get('/users/:userId/priorities',(req,res)=>{try{res.json(priorities.list(req.params.userId));}catch(error){badRequest(res,error);}});
router.put('/users/:userId/priorities/rank',(req,res)=>{try{res.json(priorities.rank(req.params.userId,req.body?.taskIds));}catch(error){badRequest(res,error);}});
router.put('/users/:userId/priorities/:taskId',(req,res)=>{try{res.json({priority:priorities.setDue(req.params.userId,req.params.taskId,req.body?.dueAt)});}catch(error){badRequest(res,error);}});

router.put('/users/:userId',(req,res)=>{try{userStore.ensureUser(req.params.userId);res.json({success:true,userId:req.params.userId});}catch(error){console.error('Failed to ensure user:',error);res.status(500).json({error:'Failed to save user',detail:error.message});}});
router.get('/users/:userId/tasks',(req,res)=>{try{userStore.ensureUser(req.params.userId);res.json({tasks:userStore.getOpenTasks(req.params.userId)});}catch(error){console.error('Failed to load user tasks:',error);res.status(500).json({error:'Failed to load user tasks',detail:error.message});}});
router.post('/users/:userId/tasks/import',(req,res)=>{try{const{sessionId}=req.body;if(!sessionId)return res.status(400).json({error:'sessionId is required'});if(String(sessionId)!==String(req.params.userId))return res.status(403).json({error:'Session does not belong to authenticated user'});const tasks=userStore.importOpenTasksIntoSession(req.params.userId,sessionId);res.json({tasks,sessionId});}catch(error){console.error('Failed to import user tasks:',error);res.status(500).json({error:'Failed to import user tasks',detail:error.message});}});

router.get('/users/:userId/integrity',(req,res)=>{try{userStore.ensureUser(req.params.userId);res.json(treeIntegrity.audit(req.params.userId));}catch(error){console.error('Failed to audit task tree:',error);res.status(500).json({error:'Failed to audit task tree',detail:error.message});}});
router.post('/users/:userId/integrity/reconcile',(req,res)=>{try{userStore.ensureUser(req.params.userId);res.json(treeIntegrity.reconcile(req.params.userId));}catch(error){console.error('Failed to reconcile task tree:',error);res.status(500).json({error:'Failed to reconcile task tree',detail:error.message});}});

router.get('/users/:userId/nodes',(req,res)=>{try{userStore.ensureUser(req.params.userId);const integrity=treeIntegrity.reconcile(req.params.userId);const nodes=req.query.tree==='1'||req.query.tree==='true'?userStore.getTree(req.params.userId):userStore.getRootNodes(req.params.userId);res.json({nodes,integrity});}catch(error){console.error('Failed to load task nodes:',error);res.status(500).json({error:'Failed to load task nodes',detail:error.message});}});
router.get('/users/:userId/nodes/:nodeId',(req,res)=>{try{treeIntegrity.reconcile(req.params.userId);const node=userStore.getNode(req.params.userId,req.params.nodeId);const children=userStore.getChildren(req.params.userId,req.params.nodeId);res.json({node,children});}catch(error){return badRequest(res,error);}});
router.post('/users/:userId/nodes',(req,res)=>{try{const node=userStore.createNode(req.params.userId,req.body||{});treeIntegrity.reconcile(req.params.userId);res.status(201).json({node:userStore.getNode(req.params.userId,node.id)});}catch(error){return badRequest(res,error);}});
router.put('/users/:userId/nodes/:nodeId',(req,res)=>{try{const node=userStore.updateNode(req.params.userId,req.params.nodeId,req.body||{});treeIntegrity.reconcile(req.params.userId);res.json({node:userStore.getNode(req.params.userId,node.id)});}catch(error){return badRequest(res,error);}});
router.put('/users/:userId/nodes/:nodeId/parent',(req,res)=>{try{const result=userStore.reparentNode(req.params.userId,req.params.nodeId,req.body?.parentId??null,req.body?.position);treeIntegrity.reconcile(req.params.userId);res.json({...result,node:userStore.getNode(req.params.userId,req.params.nodeId)});}catch(error){return badRequest(res,error);}});
router.delete('/users/:userId/nodes/:nodeId',(req,res)=>{try{const mode=req.query.mode==='ungroup'?'ungroup':'subtree';const result=userStore.deleteNode(req.params.userId,req.params.nodeId,mode);treeIntegrity.reconcile(req.params.userId);res.json(result);}catch(error){return badRequest(res,error);}});
router.post('/users/:userId/nodes/undo',(req,res)=>{try{userStore.restoreSnapshot(req.params.userId,req.body?.snapshot);treeIntegrity.reconcile(req.params.userId);res.json({success:true});}catch(error){return badRequest(res,error);}});

module.exports = router;
