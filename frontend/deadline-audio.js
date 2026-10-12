'use strict';
/* Audible deadline cues. Browser audio is unlocked by the first user gesture. */
(() => {
  let audio = null;
  const fired = new Set();
  function unlock() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) { /* Unsupported browser: visual timers still work. */ }
  }
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  function beep(count) {
    if (!audio || audio.state !== 'running') return;
    const start = audio.currentTime + .02;
    for (let i = 0; i < count; i++) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      const at = start + i * (count === 2 ? .24 : .38);
      osc.type = 'sine'; osc.frequency.value = count === 2 ? 740 : 520;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(.16, at + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, at + (count === 2 ? .16 : .28));
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(at); osc.stop(at + (count === 2 ? .17 : .29));
    }
  }
  function once(key, count) {
    if (fired.has(key) || sessionStorage.getItem('taskSorterAudio:' + key)) return;
    fired.add(key);
    sessionStorage.setItem('taskSorterAudio:' + key, '1');
    beep(count);
  }
  function check() {
    const now = Date.now();
    try {
      if (typeof hardStopAtMs !== 'undefined' && hardStopAtMs > 0 && now >= hardStopAtMs)
        once('session:' + hardStopAtMs, 3);
      if (typeof currentTask === 'function' && document.getElementById('focusScreen')) {
        const task = currentTask();
        if (task && task.lastChanged != null && task.estimatedTimeMs > 0) {
          const remaining = task.estimatedTimeMs - (Number(task.actualTimeMs || 0) + Math.max(0, now - task.lastChanged));
          if (remaining <= 0) once('task:' + (task.id || task.name) + ':' + (task.timestamps?.created || ''), 2);
        }
      }
      if (typeof deadline !== 'undefined' && typeof currentTaskIndex !== 'undefined' &&
          document.getElementById('focusScreen') && deadline > 0 && now >= deadline * 1000) {
        once('legacy-task:' + currentTaskIndex + ':' + deadline, 2);
      }
    } catch (e) { console.warn('Audio timer check:', e); }
  }
  setInterval(check, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
