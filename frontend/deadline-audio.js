'use strict';
/* Alarm state is separate from accounting. One scheduler reads wall-clock timing. */
window.FocusAlarm = (() => {
    let audio = null, error = '', lastPulseKey = null, lastPulseAt = -Infinity;
    const sources = new Set(), memory = new Map();
    const prefix = 'taskSorterFocusAlarm:v1:';
    function read(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || memory.get(key) || fallback; } catch (_) { return memory.get(key) || fallback; }
    }
    function write(key, value) {
        memory.set(key, value);
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { error = 'Alarm settings cannot be saved in this browser.'; }
    }
    const account = () => typeof userId === 'undefined' ? 'guest' : userId;
    const settingsKey = () => prefix + JSON.stringify([account(), 'sound']);
    const settings = () => read(settingsKey(), { enabled: true, volume: .6 });
    function key(task) {
        return task && window.activeWorkSessionId ? prefix + JSON.stringify([account(), window.activeWorkSessionId, task.id]) : null;
    }
    function stop() {
        for (const source of sources) { try { source.stop(); } catch (_) {} }
        sources.clear();
    }
    function unlock() {
        try {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) { error = 'Audio is unavailable. Watch the visual alarm.'; return; }
            audio ||= new Context();
            if (audio.state === 'suspended') return Promise.resolve(audio.resume()).then(check).catch(() => { error = 'Audio was blocked. Use Test Sound to retry.'; });
        } catch (_) { error = 'Audio is unavailable. Watch the visual alarm.'; }
    }
    function beep() {
        const prefs = settings();
        if (!prefs.enabled || prefs.volume <= 0) return;
        if (!audio || audio.state !== 'running') { error = 'Audio needs permission. Use Test Sound; the visual alarm still works.'; return; }
        try {
            const osc = audio.createOscillator(), gain = audio.createGain();
            const at = audio.currentTime + .01;
            osc.type = 'sine'; osc.frequency.value = 740;
            gain.gain.setValueAtTime(.0001, at);
            gain.gain.exponentialRampToValueAtTime(Math.max(.0001, .25 * prefs.volume), at + .015);
            gain.gain.exponentialRampToValueAtTime(.0001, at + .22);
            osc.connect(gain); gain.connect(audio.destination);
            sources.add(osc); osc.onended = () => { sources.delete(osc); osc.disconnect?.(); gain.disconnect?.(); };
            osc.start(at); osc.stop(at + .23);
            error = '';
        } catch (_) { error = 'Sound could not play. The visual alarm still works.'; stop(); }
    }
    function current() {
        const task = typeof currentTask === 'function' ? currentTask() : null;
        const now = Date.now(), id = key(task);
        const state = id ? read(id, {}) : {};
        const active = !!(task && id && document.getElementById('focusScreen') && !document.getElementById('taskSorterApp')?.classList.contains('hidden') && task.lastChanged != null && !task.completed
            && !(typeof hardStopAtMs !== 'undefined' && hardStopAtMs > 0 && now >= hardStopAtMs));
        const elapsed = task ? Number(task.actualTimeMs || 0) + (task.lastChanged == null ? 0 : Math.max(0, now - task.lastChanged)) : 0;
        const overdue = active && task.estimatedTimeMs > 0 && elapsed >= task.estimatedTimeMs;
        return { task, id, state, now, ringing: overdue && !state.dismissed && !(state.snoozeUntil > now), overdue };
    }
    function check() {
        const status = current();
        if (!status.ringing) stop();
        else if (lastPulseKey !== status.id || status.now - lastPulseAt >= 1500) {
            lastPulseKey = status.id; lastPulseAt = status.now; beep();
        }
        const panel = document.getElementById('focusAlarm');
        if (panel) {
            panel.hidden = !status.overdue;
            const message = document.getElementById('focusAlarmMessage');
            if (message) message.textContent = status.ringing ? 'Time estimate reached — alarm ringing.' : status.state.dismissed ? 'Alarm turned off for this task.' : `Alarm snoozed until ${new Date(status.state.snoozeUntil).toLocaleTimeString()}.`;
            for (const id of ['alarmOff', 'alarmSnooze']) { const button = document.getElementById(id); if (button) button.hidden = !status.ringing; }
        }
        const note = document.getElementById('audioStatus');
        if (note) note.textContent = error;
        return status;
    }
    function dismiss() { const s = current(); if (s.id) write(s.id, { dismissed: true }); stop(); check(); }
    function snooze() { const s = current(); if (s.id) write(s.id, { snoozeUntil: Date.now() + 300000 }); stop(); check(); }
    function cancel(task) { const id = key(task); if (id) write(id, { dismissed: true }); stop(); }
    function configure(prefs) { write(settingsKey(), { ...settings(), ...prefs }); stop(); check(); }
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('pagehide', stop);
    window.addEventListener('storage', check);
    setInterval(check, 250);
    return { check, dismiss, snooze, cancel, stop, settings, configure, unlock, async test() { await unlock(); beep(); check(); } };
})();
