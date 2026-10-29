'use strict';
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PlanDomain = factory();
})(typeof globalThis === 'object' ? globalThis : this, () => {
    const closed = node => ['completed', 'cancelled'].includes(node.status) || node.archived;
    function graph(nodes, dependencies = []) {
        const byId = new Map(nodes.map(n => [n.id, n]));
        const children = new Map(nodes.map(n => [n.id, []]));
        for (const node of nodes) if (node.parent_id) {
            const parent = byId.get(node.parent_id);
            if (!parent || parent.node_type !== 'project') throw new Error('Parent must be an owned project');
            children.get(parent.id).push(node.id);
        }
        const visiting = new Set(), visited = new Set();
        function hierarchy(id) {
            if (visiting.has(id)) throw new Error('Hierarchy cycle');
            if (visited.has(id)) return;
            visiting.add(id); children.get(id).forEach(hierarchy); visiting.delete(id); visited.add(id);
        }
        nodes.forEach(n => hierarchy(n.id));
        const leaves = id => byId.get(id).node_type === 'task' ? [id] : children.get(id).flatMap(leaves);
        const predecessors = new Map(nodes.filter(n => n.node_type === 'task').map(n => [n.id, new Set()]));
        const gates = new Map(nodes.map(n => [n.id, new Set()]));
        const edges = [...dependencies];
        for (const n of nodes) if (n.blocked_by_task_id) edges.push({task_id:n.id, prerequisite_id:n.blocked_by_task_id});
        for (const edge of edges) {
            if (!byId.has(edge.task_id) || !byId.has(edge.prerequisite_id)) throw new Error('Prerequisite must be an owned task or project');
            for (const target of [edge.task_id, ...leaves(edge.task_id)]) gates.get(target).add(edge.prerequisite_id);
            for (const target of leaves(edge.task_id)) for (const source of leaves(edge.prerequisite_id)) predecessors.get(target).add(source);
        }
        visiting.clear(); visited.clear();
        function dependency(id) {
            if (visiting.has(id)) throw new Error('Dependency cycle or project deadlock');
            if (visited.has(id)) return;
            visiting.add(id); predecessors.get(id).forEach(dependency); visiting.delete(id); visited.add(id);
        }
        predecessors.forEach((_, id) => dependency(id));
        function ancestors(id) {
            const result = []; let node = byId.get(id);
            while (node?.parent_id) { node = byId.get(node.parent_id); result.push(node); }
            return result;
        }
        function blocked(id) {
            const node = byId.get(id);
            if (!node || node.node_type !== 'task' || closed(node)) return ['Task is not open'];
            const reasons = [];
            if(node.independently_actionable===0)reasons.push('Not independently actionable');
            if(node.status==='blocked'&&!gates.get(id).size)reasons.push('Explicitly blocked; record or resolve the blocker');
            for (const ancestor of ancestors(id)) if (closed(ancestor)) reasons.push('Parent is closed');
            for (const source of gates.get(id)) if (byId.get(source).status !== 'completed') reasons.push(byId.get(source).name);
            return [...new Set(reasons)];
        }
        return {byId, children, leaves, predecessors, gates, ancestors, blocked};
    }
    function importance(nodes, comparisons = []) {
        // Newest evidence wins: retain an older edge only if it introduces no cycle.
        const ids = nodes.map(n => n.id), edges = new Map(ids.map(id => [id, new Set()]));
        const reachable = (a, b, seen = new Set()) => a === b || (!seen.has(a) && (seen.add(a), [...edges.get(a) || []].some(c => reachable(c, b, seen))));
        const known = new Set();
        for (const c of [...comparisons].sort((a,b) => b.created_at-a.created_at || (b.sequence || 0)-(a.sequence || 0))) {
            if (!edges.has(c.higher_id) || !edges.has(c.lower_id) || c.higher_id === c.lower_id) continue;
            known.add(c.higher_id); known.add(c.lower_id);
            if (!reachable(c.lower_id, c.higher_id)) edges.get(c.higher_id).add(c.lower_id);
        }
        const incoming = new Map(ids.map(id => [id, 0]));
        edges.forEach(list => list.forEach(id => incoming.set(id, incoming.get(id)+1)));
        const stable = (a,b) => (nodes.find(n=>n.id===a).position || 0)-(nodes.find(n=>n.id===b).position || 0) || a.localeCompare(b);
        const order = [];
        while (order.length < ids.length) {
            const next = ids.filter(id => !order.includes(id) && incoming.get(id) === 0).sort(stable)[0];
            order.push(next); edges.get(next).forEach(id => incoming.set(id, incoming.get(id)-1));
        }
        const expressedOrder=order.filter(id=>known.has(id));
        return {order, known, ranks:new Map(order.map(id => [id, known.has(id) ? expressedOrder.indexOf(id)+1 : null]))};
    }
    function intervals(input, now, reserve = 0) {
        const result = [...input].map(w => ({start:Math.max(now,w.start), end:w.end})).filter(w=>w.end>w.start).sort((a,b)=>a.start-b.start);
        for (let i=1;i<result.length;i++) if(result[i].start<result[i-1].end) throw new Error('Availability intervals cannot overlap');
        return result.map(w=>({...w,end:w.end-Math.floor((w.end-w.start)*reserve)})).filter(w=>w.end>w.start);
    }
    function fit(windows, after, duration, split, before = Infinity, reverse = false) {
        let left=duration; const segments=[];
        for(const w of reverse?[...windows].reverse():windows) {
            const start=Math.max(w.start,after),end=Math.min(w.end,before);
            if(end<=start || (!split && end-start<left))continue;
            const amount=Math.min(left,end-start);
            segments.push(reverse?{start:end-amount,end}:{start,end:start+amount});left-=amount;
            if(left===0)return segments.sort((a,b)=>a.start-b.start);
        }
        return null;
    }
    function plan(nodes, dependencies, comparisons, options) {
        const {now, windows:rawWindows, reserve=0} = options;
        const windows=intervals(rawWindows,now,reserve), g=graph(nodes,dependencies), ranks=importance(nodes,comparisons);
        const work=nodes.filter(n=>n.node_type==='task'&&n.independently_actionable!==0&&!closed(n));
        const remaining = n => n.remaining_ms ?? (n.estimated_ms>0?Math.max(0,n.estimated_ms-(n.actual_ms??n.elapsed_ms??0)):null);
        const duration = new Map(work.map(n=>[n.id,remaining(n)]));
        const deadlines=new Map(),targets=new Map(),release=new Map(),benefit=new Map();
        const min = list => list.filter(v=>v!=null).reduce((a,b)=>Math.min(a,b),Infinity);
        for(const n of work) {
            const family=[n,...g.ancestors(n.id)];
            deadlines.set(n.id,Math.min(min(family.map(n=>n.deadline_at)),n.scheduled_start_at!=null&&duration.get(n.id)!=null?n.scheduled_start_at+duration.get(n.id):Infinity));
            targets.set(n.id,min(family.map(n=>n.due_at)));
            release.set(n.id,Math.max(now,...family.map(n=>n.earliest_start_at||0),n.scheduled_start_at||0));
            benefit.set(n.id,min(family.map(n=>ranks.ranks.get(n.id))));
        }
        let changed=true;
        while(changed) {
            changed=false;
            for(const n of work)for(const id of g.predecessors.get(n.id))if(duration.has(id)) {
                for(const map of [deadlines, targets, benefit])if(map.get(id)>map.get(n.id)){map.set(id,map.get(n.id));changed=true;}
            }
        }
        const unavailable = new Set();
        for(const n of work) {
            if(duration.get(n.id)==null || g.ancestors(n.id).some(closed) || (n.status==='blocked'&&!g.gates.get(n.id).size)) unavailable.add(n.id);
            for(const gate of g.gates.get(n.id)) {
                const source=g.byId.get(gate);
                if(source.status!=='completed' && (closed(source)||g.leaves(gate).length===0))unavailable.add(n.id);
            }
        }
        changed=true;
        while(changed){changed=false;for(const n of work)if([...g.predecessors.get(n.id)].some(id=>unavailable.has(id)||(['cancelled'].includes(g.byId.get(id).status))))if(!unavailable.has(n.id)){unavailable.add(n.id);changed=true;}}
        const usable=work.filter(n=>!unavailable.has(n.id)), constrained=new Set(usable.filter(n=>Number.isFinite(deadlines.get(n.id))).map(n=>n.id));
        const baselineOrder=(a,b)=>deadlines.get(a.id)-deadlines.get(b.id)||targets.get(a.id)-targets.get(b.id)||benefit.get(a.id)-benefit.get(b.id)||a.id.localeCompare(b.id);
        function simulate(doneInput, cursor, fixedCandidate=null, onlyHard=false) {
            const done=new Set(doneInput), slots=[];
            let todo=usable.filter(n=>!done.has(n.id)&&(!onlyHard||constrained.has(n.id)));
            const eligible=n=>[...g.predecessors.get(n.id)].every(id=>g.byId.get(id).status==='completed'||done.has(id));
            while(todo.length) {
                const candidates=todo.filter(eligible).sort(baselineOrder);
                const n=fixedCandidate ? candidates.find(n=>n.id===fixedCandidate) : candidates[0];fixedCandidate=null;
                if(!n)return {ok:false,slots,reason:'Unresolved prerequisite'};
                const segments=duration.get(n.id)===0?[{start:Math.max(cursor,release.get(n.id)),end:Math.max(cursor,release.get(n.id))}]:fit(windows,Math.max(cursor,release.get(n.id)),duration.get(n.id),n.splittable!==false);
                if(!segments)return {ok:false,slots,reason:'Insufficient available capacity'};
                const end=segments.at(-1).end;
                if(end>deadlines.get(n.id))return {ok:false,slots,reason:'Hard deadline conflict'};
                slots.push({id:n.id,segments,start:segments[0].start,end});cursor=end;done.add(n.id);todo=todo.filter(t=>t.id!==n.id);
            }
            return {ok:true,slots};
        }
        const hardBaseline=simulate(new Set(),now,null,true), schedule=[],done=new Set();let cursor=now;
        const latest=new Map(),timingBound=new Map(usable.map(n=>[n.id,Math.min(deadlines.get(n.id),targets.get(n.id))]));
        // A resource-aware backward forecast: each prerequisite is reserved once.
        const pending=new Set(usable.filter(n=>Number.isFinite(timingBound.get(n.id))).map(n=>n.id));let before=Infinity;
        while(pending.size) {
            const sinks=usable.filter(n=>pending.has(n.id)&&!usable.some(other=>pending.has(other.id)&&g.predecessors.get(other.id).has(n.id)))
                .sort((a,b)=>timingBound.get(b.id)-timingBound.get(a.id)||b.id.localeCompare(a.id));
            const n=sinks[0];if(!n)break;
            const successors=usable.filter(other=>g.predecessors.get(other.id).has(n.id));
            const limit=Math.min(before,timingBound.get(n.id),...successors.map(other=>latest.get(other.id)??Infinity));
            const segments=fit(windows,release.get(n.id),duration.get(n.id),n.splittable!==false,limit,true);
            if(!segments)break;latest.set(n.id,segments[0].start);before=segments[0].start;pending.delete(n.id);
        }
        while(done.size<usable.length) {
            const candidates=usable.filter(n=>!done.has(n.id)&&[...g.predecessors.get(n.id)].every(id=>g.byId.get(id).status==='completed'||done.has(id)))
                .sort((a,b)=>benefit.get(a.id)-benefit.get(b.id)||targets.get(a.id)-targets.get(b.id)||a.id.localeCompare(b.id));
            if(!candidates.length)break;
            let selected;
            for(const n of candidates) {
                const segments=duration.get(n.id)===0?[{start:Math.max(cursor,release.get(n.id)),end:Math.max(cursor,release.get(n.id))}]:fit(windows,Math.max(cursor,release.get(n.id)),duration.get(n.id),n.splittable!==false);
                if(!segments || segments.at(-1).end>deadlines.get(n.id))continue;
                const nextDone=new Set([...done,n.id]);
                if(hardBaseline.ok&&!simulate(nextDone,segments.at(-1).end,null,true).ok)continue;
                selected={id:n.id,segments,start:segments[0].start,end:segments.at(-1).end};break;
            }
            if(!selected)break;
            done.add(selected.id);cursor=selected.end;schedule.push(selected);
        }
        const warnings=[];
        if(!rawWindows.length)warnings.push('Add available working intervals to obtain a timing forecast.');
        if(!hardBaseline.ok)warnings.push(hardBaseline.reason+'. No feasible schedule found by this planner; review capacity and constraints.');
        for(const n of work)if(!done.has(n.id))warnings.push(`${n.name}: ${unavailable.has(n.id)?'unknown estimate, closed parent, or unresolved prerequisite':'no placement found within available time'}.`);
        const items=work.map(n=>{
            const slot=schedule.find(s=>s.id===n.id),latestStart=latest.get(n.id)??null;
            const ancestors=g.ancestors(n.id), ownRank=ranks.ranks.get(n.id)??null;
            return {id:n.id,remainingMs:duration.get(n.id),importanceRank:ownRank,effectiveImportance:Number.isFinite(benefit.get(n.id))?benefit.get(n.id):null,
                deadlineAt:Number.isFinite(deadlines.get(n.id))?deadlines.get(n.id):null,dueAt:Number.isFinite(targets.get(n.id))?targets.get(n.id):null,latestStart,slackMs:latestStart==null?null:latestStart-now,
                ready:g.blocked(n.id).length===0&&release.get(n.id)<=now,blockedBy:g.blocked(n.id),...slot,
                reason:g.blocked(n.id).length?'Complete prerequisites first':release.get(n.id)>now?'Waiting for scheduled or earliest start':latestStart!=null&&slot&&slot.end>=latestStart?'Limited freedom before a deadline':ownRank==null&&Number.isFinite(benefit.get(n.id))?'Advances an important project or dependent task':ownRank!=null?'Advances your expressed importance':'Importance placement is uncertain',
                parentPath:ancestors.reverse().map(n=>n.name)};
        });
        for(const item of items){const node=g.byId.get(item.id);if(item.end&&Number.isFinite(targets.get(item.id))&&item.end>targets.get(item.id))warnings.push(`${node.name}: preferred due date missed.`);}
        return {now,schedule,items,warnings,hardConstraintsSatisfied:hardBaseline.ok&&work.filter(n=>Number.isFinite(deadlines.get(n.id))).every(n=>done.has(n.id)),provisional:true,importanceOrder:ranks.order};
    }
    return {graph,importance,plan,fit,intervals};
});
