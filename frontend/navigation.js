'use strict';
// History stores view context; task state stays in the canonical graph/journal.
window.AppNavigation=(()=>{
    // Keep the shared tokens after feature styles loaded during bootstrap.
    const design=document.querySelector('link[href*="design.css"]');if(design)document.head.append(design);
    let restoring=false,ready=false;
    function route(){
        if(!location.hash.startsWith('#app/'))return null;
        try{return JSON.parse(decodeURIComponent(location.hash.slice(5)));}catch(_){return null;}
    }
    function go(screen,context={},replace=false){
        if(restoring||!ready)return;
        const next={screen,...context};
        const hash='#app/'+encodeURIComponent(JSON.stringify(next));
        if(location.hash===hash)return;
        history.replaceState({...history.state,scrollY:window.scrollY,planContext:window.NextPlan?.context()},'');
        history[replace?'replaceState':'pushState']({route:next},'',hash);
    }
    async function restore(){
        const target=route();if(!target){ready=true;return;}
        if(!window.FocusDurability.ready||document.getElementById('sessionEndedScreen')||document.getElementById('completionScreen')){ready=true;return;}
        restoring=true;
        try{
            if(document.getElementById('focusScreen')&&target.screen!=='focus')await window.FocusDurability.pause(currentTask());
            document.querySelector('.plan-dialog')?.remove();
            document.body.classList.remove('planning');
            if(target.screen==='plan'){
                window.NextPlan.restoreContext(history.state?.planContext);
                await window.NextPlan.open(target.view||'inbox',target.project||null);
                if(target.edit)await window.NextPlan.edit(target.edit==='new'?null:target.edit,target.type||'task',target.initial||'');
            }else if(target.screen==='calendar')await window.Agenda.calendar();
            else if(target.screen==='agenda')await window.Agenda.show();
            else if(target.screen==='entry')showTaskInput();
            else if(target.screen==='resume')await window.WorkPlanner.resume();
            else if(target.screen==='work-project')await window.WorkPlanner.overview(target.project);
            else if(target.screen==='work')showWorkChoice();
            else if(['dashboard','focus','sorting'].includes(target.screen)){if(!document.getElementById('dashboardScreen'))showDashboard();}
            else showModeSelect();
            window.scrollTo(0,history.state?.scrollY||0);
        }finally{restoring=false;ready=true;}
    }
    for(const [name,screen]of [['showModeSelect','home'],['showWorkChoice','work'],['showTaskInput','entry'],['showDashboard','dashboard'],['prepareSortingDisplay','sorting'],['renderFocus','focus'],['showSessionEnded','ended'],['showCompletion','completed']]){
        const original=window[name];if(typeof original!=='function')continue;
        window[name]=function(...args){go(screen);const result=original.apply(this,args);if(screen==='dashboard'&&importanceDraft){const resume=document.createElement('button');resume.id='resumeImportanceSort';resume.textContent='Resume importance sorting';resume.onclick=()=>resumeImportanceSort().catch(error=>alert(error.message));document.getElementById('dashboardScreen')?.append(resume);}return result;};
    }
    const draftKey='nexttaskEntryDraft_'+userId;
    try{const saved=JSON.parse(sessionStorage.getItem(draftKey));if(saved){el('tasks').value=saved.text;el('skipSortCheckbox').checked=saved.skip;}}catch(_){}
    const saveDraft=()=>sessionStorage.setItem(draftKey,JSON.stringify({text:el('tasks').value,skip:el('skipSortCheckbox').checked}));
    el('tasks').addEventListener('input',saveDraft);el('skipSortCheckbox').addEventListener('change',saveDraft);
    window.addEventListener('popstate',()=>restore().catch(error=>alert(error.message)));
    return {go,restore,get restoring(){return restoring;}};
})();
