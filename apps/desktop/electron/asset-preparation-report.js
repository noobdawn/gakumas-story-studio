'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
async function collect(catalog){
 const items=[];
 for(const file of ['bundles.jsonl','audio-banks.jsonl','audio-wav.jsonl','audio-unity.jsonl']){
  let text;try{text=await fs.readFile(path.join(catalog,file),'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
  for(const line of text.split(/\r?\n/).filter(Boolean)){const row=JSON.parse(line);if(row.error||row.inspectionError)items.push({source:row.name||row.bank||row.bundle||file,index:row.index,error:row.error||row.inspectionError,...(row.errorCode?{errorCode:row.errorCode}:{})});}
 }
 try{const summary=JSON.parse(await fs.readFile(path.join(catalog,'summary.json'),'utf8'));for(const dependency of summary.missing_dependencies||[])items.push({source:dependency.asset||String(dependency),dependencyId:dependency.id,error:`依赖 ${dependency.id} 在游戏清单中有 ${dependency.matches} 条匹配记录，无法唯一定位`});}catch(e){if(e.code!=='ENOENT')throw e}
 try{const scenes=JSON.parse(await fs.readFile(path.join(catalog,'player-view/scene-report.json'),'utf8'));items.push(...scenes.issues);}catch(e){if(e.code!=='ENOENT')throw e}
 await fs.writeFile(path.join(catalog,'preparation-report.json'),JSON.stringify({version:1,items},null,2));return items;
}
module.exports={collect};
