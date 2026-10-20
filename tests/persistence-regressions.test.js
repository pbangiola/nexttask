'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../frontend', name), 'utf8');

test('plain comma lists split on each line while estimates stay attached', () => {
    const context = vm.createContext({ window: { location: { hostname: 'localhost', origin: 'http://localhost' }, taskSorterAuth: { userId: 'test' } } });
    vm.runInContext(source('initialization.js') + '\n' + source('task-entry.js'), context);
    const result = vm.runInContext(`JSON.stringify(parseTaskEntries('Email, Laundry, Dishes\\nRead, 5m, Walk\\n, ,'))`, context);
    assert.deepEqual(JSON.parse(result), { entries: [
        { name: 'Email', estimatedTimeMs: 0 }, { name: 'Laundry', estimatedTimeMs: 0 },
        { name: 'Dishes', estimatedTimeMs: 0 }, { name: 'Read', estimatedTimeMs: 300000 },
        { name: 'Walk', estimatedTimeMs: 0 }
    ], invalid: [] });
});

test('recovery checkpoints elapsed time before stopping interval and does not double count', async () => {
    const hardStop = 0;
    const task = { id: 'task', name: 'Task', elapsed_ms: 4000, estimated_ms: 60000,
        status: 'active', last_changed: 7000, node_type: 'task', independently_actionable: 1 };
    let open = [{ id: 'run', task_id: 'task', started_at: 6000 }];
    const workSession = { id: 'work', started_at: 5000, available_ms: 0, hard_stop_at: hardStop, end_constraint: '' };
    const writes = [];
    const graph = {
        validateRecovery: async () => false, flush: async () => {}, adopt: () => {},
        openIntervals: async () => open,
        request: async url => url === '/work-sessions/open' ? { workSession }
            : url.includes('/nodes?') ? { nodes: [task] } : { items: [task], history: [] },
        commit: async (label, steps, ack) => {
            writes.push(...steps);
            for (const step of steps) {
                if (step.path.endsWith('/tasks')) {
                    const saved = step.body.tasks[0]; task.elapsed_ms = saved.actualTimeMs; task.last_changed = saved.lastChanged;
                }
                if (step.path.endsWith('/stop')) open = [];
            }
            ack?.();
        }
    };
    const context = vm.createContext({
        window: { TaskGraph: graph, TaskGraphTiming: { clear() {} }, addEventListener() {} },
        document: { addEventListener() {}, createElement: () => ({}) },
        Date: { now: () => 10000 }, userId: 'owner', sortedTasks: [], activeTaskId: null,
        totalAvailableTimeMs: 0, endConstraint: '', hardStopAtMs: 0, hardStopHandled: false,
        sessionStartedAtMs: 0, createTask: (name, fields) => ({ name, ...fields }),
        restoreLocalState: () => null, hasHardStop: () => false,
        firstIncompleteTask() { return null; }, showDashboard() {}, startHardStopWatch() {}, el: () => null
    });
    // Boundary uses the restored hard stop; avoid unrelated UI closure in this unit check.
    context.hasHardStop = () => vm.runInContext('hardStopAtMs > 0', context);
    vm.runInContext(source('focus-durability.js'), context);
    await vm.runInContext('window.FocusDurability.recover()', context);
    assert.equal(task.elapsed_ms, 7000); // 4000 saved + 10000 - 7000 checkpoint
    assert.ok(writes[0].path.endsWith('/tasks'));
    assert.ok(writes[1].path.endsWith('/stop'));
    await vm.runInContext('window.FocusDurability.recover()', context);
    assert.equal(task.elapsed_ms, 7000, 'second recovery must not add the same time twice');
});
