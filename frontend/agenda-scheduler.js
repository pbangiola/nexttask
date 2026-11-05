'use strict';
// Shared by the browser and server so previews and saved schedules agree.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./plan-domain'));
    else root.AgendaScheduler = factory(root.PlanDomain);
})(typeof window === 'object' ? window : globalThis, domain => {
    const duration = task => Math.max(0, Number(task.estimated_ms ?? task.estimatedTimeMs ?? 0) - Number(task.elapsed_ms ?? task.actualTimeMs ?? 0));
    // A prerequisite inherits its dependent's place, including across the
    // backlog/Agenda boundary. Keep dependents queued until they become ready.
    function dependencyOrder(priorities, items, nodes, dependencies = []) {
        const graph = domain.graph(nodes, dependencies);
        const available = new Map(items.map(row => [row.id, row]));
        const seen = new Set(), result = [];
        function visit(id) {
            if (seen.has(id) || !available.has(id)) return;
            seen.add(id);
            for (const source of graph.predecessors.get(id) || []) visit(source);
            result.push(available.get(id));
        }
        priorities.forEach(row => visit(row.id));
        return result;
    }
    function resume(backlog, agenda, hardStop = null, now = Date.now()) {
        if (backlog.length) {
            const due = agenda.find(task=>task.start_at != null && task.start_at < now && !backlog.some(row=>row.id===task.id));
            return due ? [backlog[0],due] : [backlog[0]];
        }
        if (!agenda.length) return [];
        if (hardStop == null || duration(agenda[0]) <= Math.max(0,hardStop-now)) return [agenda[0]];
        const fits = agenda.find(task=>duration(task)<=Math.max(0,hardStop-now));
        return fits && fits.id !== agenda[0].id ? [agenda[0],fits] : [agenda[0]];
    }
    function ics(items, now = Date.now()) {
        const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
        const escape = text => String(text).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
        const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//NextTask//Agenda//EN','CALSCALE:GREGORIAN'];
        for (const item of items) {
            lines.push('BEGIN:VEVENT',`UID:${escape(item.id)}@nexttask`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(item.start_at)}`,`DTEND:${stamp(item.end_at)}`,`SUMMARY:${escape(item.name)}`,'END:VEVENT');
        }
        lines.push('END:VCALENDAR');
        // RFC 5545 folds at 75 octets, preserving Unicode code points.
        return lines.map(line=>{let out='',bytes=0;for(const c of line){const n=new TextEncoder().encode(c).length;if(bytes+n>75){out+='\r\n ';bytes=1;}out+=c;bytes+=n;}return out;}).join('\r\n')+'\r\n';
    }
    return {resume,duration,ics,dependencyOrder};
});

