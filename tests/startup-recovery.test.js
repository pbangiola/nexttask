'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function startup({session='saved-session',screen='dashboardScreen',route='home',ready=true}={}){
 const screens=new Set([screen]),inputs=new Map(),calls=[];
 const location={hash:'#app/'+encodeURIComponent(JSON.stringify({screen:route})),pathname:'/',search:''};
 const history={state:{},replaceState(state,unused,url){this.state=state;if(url)location.hash=url.startsWith('#')?url:'';},pushState(state,unused,url){this.replaceState(state,unused,url);}};
 const ctx=vm.createContext({console,location,history,APP_SCRIPTS:[],userId:'owner',importanceDraft:null,
  document:{querySelector(){return null},getElementById:id=>screens.has(id)?{}:null,body:{classList:{remove(){}}}},
  el:id=>{if(!inputs.has(id))inputs.set(id,{value:'',checked:false,addEventListener(){}});return inputs.get(id);},
  sessionStorage:{getItem(){return null},setItem(){}},loadScript:async()=>{},
  FocusDurability:{ready},activeWorkSessionId:session,taskSorterMode:'authenticated',
  showModeSelect(){calls.push('home');screens.clear();screens.add('modeSelect');},
  showDashboard(){calls.push('dashboard');screens.clear();screens.add('dashboardScreen');},
  clearSessionTiming(){calls.push('clear-timing');},addEventListener(){},scrollTo(){},scrollY:0,
  init:async()=>{calls.push('recovered');}});
 vm.runInContext('window=globalThis;',ctx);
 vm.runInContext(fs.readFileSync('frontend/navigation.js','utf8'),ctx);
 const auth=fs.readFileSync('frontend/auth.js','utf8'),start=auth.indexOf('    async function loadApplication()'),end=auth.indexOf('    let applicationStarted',start);
 vm.runInContext(auth.slice(start,end),ctx);
 return {ctx,calls,screens};
}
test('authenticated startup preserves recovered session over stale home and Resume routes',async()=>{
 for(const route of ['home','resume','work','entry']){
  const {ctx,calls,screens}=startup({route});await ctx.loadApplication();
  assert.deepEqual(calls,['recovered']);assert.equal(screens.has('dashboardScreen'),true);
  assert.equal(ctx.activeWorkSessionId,'saved-session');assert.equal(ctx.history.state.route.screen,'dashboard');
 }
});
test('startup keeps expired and completed recovery screens instead of opening setup',async()=>{
 for(const [screen,route]of [['sessionEndedScreen','ended'],['completionScreen','completed']]){
  const {ctx,calls,screens}=startup({session:null,screen});await ctx.loadApplication();
  assert.deepEqual(calls,['recovered']);assert.equal(screens.has(screen),true);assert.equal(ctx.history.state.route.screen,route);
 }
});
test('startup leaves recovery failure visible and normal empty startup still opens Work/Plan',async()=>{
 const failed=startup({ready:false,screen:'recoveryError'});await failed.ctx.loadApplication();assert.deepEqual(failed.calls,['recovered']);assert.equal(failed.screens.has('recoveryError'),true);
 const fresh=startup({session:null,screen:'modeSelect'});await fresh.ctx.loadApplication();assert.equal(fresh.screens.has('modeSelect'),true);assert.equal(fresh.calls.includes('clear-timing'),false);
});
