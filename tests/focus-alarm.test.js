'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/deadline-audio.js'), 'utf8');
function fixture(storage = new Map(), mode = 'running') {
    let now = 10000, pulses = 0, stopped = 0, focused = true;
    const callbacks = [], listeners = {};
    const task = { id:'one', estimatedTimeMs:1000, actualTimeMs:0, lastChanged:10000, completed:false, started:10000, status:'active' };
    const context = vm.createContext({ userId:'account', hardStopAtMs:0, currentTask:()=>task,
        Date:class extends Date { static now() { return now; } },
        localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
        setInterval:fn=>callbacks.push(fn),
        document:{getElementById:id=>id==='focusScreen'&&focused?{}:null,addEventListener:(e,fn)=>{listeners[e]=fn;}},
        window:{activeWorkSessionId:'session',addEventListener(){},AudioContext: mode==='unsupported'?undefined:class {
            state=mode;currentTime=0;destination={};
            createOscillator(){if(mode==='throws')throw Error('blocked');return {frequency:{},connect(){},start(){pulses++;},stop(){stopped++;}};}
            createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};}
        }}
    });
    vm.runInContext(source,context);
    const alarm=context.window.FocusAlarm;
    alarm.unlock();
    return {alarm,task,storage,context,listeners,callbacks,pulses:()=>pulses,stopped:()=>stopped,advance(ms){now+=ms;callbacks.forEach(fn=>fn());},focus(value){focused=value;alarm.check();}};
}
test('one scheduler repeats at zero, overtime keeps increasing and alarm actions never mutate accounting',()=>{
    const f=fixture(), before=JSON.stringify(f.task);
    f.advance(1000);assert.equal(f.pulses(),1);assert.equal(f.alarm.check().ringing,true);
    for(let i=0;i<20;i++){f.alarm.check();f.listeners.visibilitychange();}
    assert.equal(f.pulses(),1);assert.equal(f.callbacks.length,1);
    f.advance(1500);assert.equal(f.pulses(),2);
    f.alarm.snooze();assert.equal(JSON.stringify(f.task),before);
    f.advance(299999);assert.equal(f.pulses(),2);
    f.advance(1);assert.equal(f.pulses(),3);
    assert.ok(f.context.Date.now()-f.task.lastChanged>300000);
    f.alarm.dismiss();f.advance(600000);assert.equal(f.pulses(),3);
    assert.equal(JSON.stringify(f.task),before);
});
test('reload retains snooze and dismissal; task, account and session scope are independent',()=>{
    const f=fixture();f.advance(1000);f.alarm.snooze();
    const reloaded=fixture(f.storage);reloaded.advance(300999);assert.equal(reloaded.pulses(),0);
    reloaded.advance(1);assert.equal(reloaded.pulses(),1);
    reloaded.alarm.dismiss();
    const again=fixture(f.storage);again.advance(400000);assert.equal(again.pulses(),0);
    again.task.id='two';again.alarm.check();assert.equal(again.pulses(),1);
    again.alarm.dismiss();again.context.window.activeWorkSessionId='session2';again.alarm.check();assert.equal(again.pulses(),2);
    again.alarm.dismiss();again.context.userId='other';again.alarm.check();assert.equal(again.pulses(),3);
});
test('pause preserves snooze, leaving stops sound, completion cancels and hard stop is authoritative',()=>{
    const f=fixture();f.advance(1000);f.alarm.snooze();f.task.lastChanged=null;
    f.advance(400000);assert.equal(f.pulses(),1);
    f.task.actualTimeMs=5000;f.task.lastChanged=f.context.Date.now();f.alarm.check();assert.equal(f.pulses(),2);
    f.focus(false);f.advance(2000);assert.equal(f.pulses(),2);
    f.focus(true);assert.equal(f.pulses(),3);
    f.context.hardStopAtMs=f.context.Date.now()+1000;f.advance(1000);assert.equal(f.pulses(),3);assert.equal(f.alarm.check().ringing,false);
    f.context.hardStopAtMs=0;f.alarm.cancel(f.task);f.task.completed=true;f.advance(600000);assert.equal(f.pulses(),3);
    f.task.id='next';f.task.completed=false;f.alarm.check();assert.equal(f.pulses(),4);
});
test('muted, unsupported, blocked and failing audio preserve visual alarm and task data',()=>{
    for(const mode of ['running','unsupported','blocked','throws']){
        const f=fixture(new Map(),mode), before=JSON.stringify(f.task);
        if(mode==='running') f.alarm.configure({enabled:false});
        f.advance(1000);assert.equal(f.alarm.check().ringing,true);assert.equal(f.pulses(),0);
        f.alarm.snooze();f.advance(300000);assert.equal(f.alarm.check().ringing,true);
        assert.equal(JSON.stringify(f.task),before);
    }
});
