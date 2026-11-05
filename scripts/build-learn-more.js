'use strict';
// Convert the user's article to static HTML without rewriting its text.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'Documentation/content/Learn More.md'),'utf8');
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const diagrams=[['task-landscape','Task mindmap'],['illustrative-day','Task schedule'],['pairwise-sorting','Task sorting']];
let diagram=0,list=null,li=false,html=[];
const closeList=()=>{if(li){html.push('</li>');li=false;}if(list){html.push('</'+list+'>');list=null;}};
const lines=source.split(/\r?\n/);
for(let i=0;i<lines.length;i++){
 const line=lines[i];if(!line.trim())continue;
 if(line.startsWith('```mermaid')){
  while(++i<lines.length&&!lines[i].startsWith('```')){}
  const [name,label]=diagrams[diagram++];html.push(`<div class="diagram-scroll" tabindex="0" role="region" aria-label="${label}"><img class="${name==='task-landscape'?'landscape':name==='illustrative-day'?'gantt':'sorting'}-diagram" src="frontend/diagrams/${name}.svg" alt="${label}"></div>`);continue;
 }
 const heading=line.match(/^(#{2,4})\s+(.+)$/);
 if(heading){closeList();const level=heading[1].length-1;html.push(`<h${level}>${escape(heading[2])}</h${level}>`);continue;}
 if(line.startsWith('|')){
  closeList();const rows=[];while(i<lines.length&&lines[i].startsWith('|')){rows.push(lines[i].split('|').slice(1,-1).map(s=>s.trim()));i++;}i--;
  html.push('<div class="table-scroll" tabindex="0" role="region" aria-label="Tools"><table><thead><tr>'+rows[0].map(cell=>'<th scope="col">'+escape(cell)+'</th>').join('')+'</tr></thead><tbody>');
  for(const row of rows.slice(2))html.push('<tr>'+row.map((cell,index)=>index?'<td>'+escape(cell)+'</td>':'<th scope="row">'+escape(cell)+'</th>').join('')+'</tr>');html.push('</tbody></table></div>');continue;
 }
 const ordered=line.match(/^(\d+)\.\s+(.*)$/),bullet=line.match(/^-\s+(.*)$/);
 if(ordered||bullet){
  const type=ordered?'ol':'ul';if(list!==type){closeList();list=type;html.push('<'+type+(ordered&&ordered[1]!=='1'?' start="'+ordered[1]+'"':'')+'>');}
  if(li)html.push('</li>');li=true;html.push('<li>'+escape((ordered||bullet)[ordered?2:1]));continue;
 }
 closeList();let paragraph=line;while(i+1<lines.length&&lines[i+1].trim()&&!/^(?:#|\||-|\d+\.|```)/.test(lines[i+1]))paragraph+='\n'+lines[++i];html.push('<p>'+escape(paragraph)+'</p>');
}
closeList();
if(diagram!==3)throw new Error('Expected exactly three Mermaid diagrams');
fs.writeFileSync(path.join(root,'learn-more.html'),`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Why this app? — Task Sorter</title><link rel="stylesheet" href="frontend/design.css?v=feedback2"></head>
<body><main class="reading"><nav class="article-nav" aria-label="Navigation"><a href="index.html">Welcome</a><a href="index.html#get-started">Get Started</a></nav>
${html.join('\n')}
</main></body></html>\n`);
