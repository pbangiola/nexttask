'use strict';
// Render trusted, checked-in Mermaid sources at authoring time. Production
// serves SVGs only: the article works offline without a Mermaid/CDN runtime.
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
async function main(){
    if(!process.env.MERMAID_BUNDLE)throw new Error('Set MERMAID_BUNDLE to mermaid@12.2.0 dist/mermaid.min.js (see delivery notes).');
    const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
    try{
        const page=await browser.newPage({viewport:{width:1400,height:1000}});
        await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>');
        await page.addScriptTag({path:path.resolve(process.env.MERMAID_BUNDLE)});
        await page.evaluate(()=>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Arial, sans-serif',deterministicIds:true,themeVariables:{primaryColor:'#f3f3f3',primaryTextColor:'#171717',primaryBorderColor:'#555555',lineColor:'#555555',secondaryColor:'#e8e8e8',tertiaryColor:'#ffffff',cScale0:'#eeeeee',cScale1:'#dedede',cScale2:'#cecece',cScale3:'#bebebe',cScaleLabel0:'#171717',cScaleLabel1:'#171717',cScaleLabel2:'#171717',cScaleLabel3:'#171717',taskBkgColor:'#dedede',taskTextColor:'#171717',taskTextOutsideColor:'#171717',taskBorderColor:'#555555',sectionBkgColor:'#f1f1f1',altSectionBkgColor:'#ffffff',critBkgColor:'#dedede',critBorderColor:'#333333',critTextColor:'#171717'},gantt:{useMaxWidth:false,leftPadding:170,barHeight:22,barGap:6,fontSize:14,numberSectionStyles:3}}));
        for(const name of ['task-landscape','illustrative-day','pairwise-sorting']){
            const source=await fs.readFile(path.join(root,'frontend/diagrams',name+'.mmd'),'utf8');
            const svg=await page.evaluate(async({name,source})=>{const result=await mermaid.render(name,source);return result.svg;},{name,source});
            await fs.writeFile(path.join(root,'frontend/diagrams',name+'.svg'),svg+'\n');
            process.stdout.write('Rendered '+name+'\n');
        }
    }finally{await browser.close();}
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
