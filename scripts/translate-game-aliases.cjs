'use strict';
// Work files contain game filenames, translation decisions and their batch identity.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {create} = require('../apps/desktop/electron/deepseek-translation');
const protector = require('../apps/desktop/electron/windows-secret-storage');

async function main() {
  const args=process.argv.slice(2),review=args.includes('--review');
  const [library, directory, limitText] = args.filter(x=>x!=='--review');
  if (!library || !directory) throw Error('Usage: node translate-game-aliases.cjs LIBRARY WORK [MAX_BATCHES] [--review]');
  const plan = JSON.parse(await fs.readFile(path.join(directory, 'plan.json'), 'utf8'));
  if (plan.version !== 1 || !Array.isArray(plan.groups)) throw Error('Invalid filename export');
  const destination = path.join(directory, review?'reviewed':'translated');
  await fs.mkdir(destination, {recursive:true});
  const client = create(library, {protector, safeStorage:{isEncryptionAvailable:()=>false}});
  const batches = [];
  for (let start=0; start<plan.groups.length; start+=60) {
    batches.push(plan.groups.slice(start,start+60));
  }
  const jobs=[];
  for (let i=0;i<batches.length;i++) {
    let group=batches[i];
    if(review){
      const draft=JSON.parse(await fs.readFile(path.join(directory,'translated',String(i+1).padStart(4,'0')+'.json'),'utf8'));
      if(draft.items.length!==group.length || draft.items.some(([k],j)=>k!==group[j][0]))throw Error('Draft source batch mismatch');
      group=group.map((r,j)=>[...r,draft.items[j][1]]);
    }
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([review?'review-1':1,plan.runId,group])).digest('hex');
    const file=path.join(destination,String(i+1).padStart(4,'0')+'.json');
    try {
      const saved=JSON.parse(await fs.readFile(file,'utf8'));
      if(saved.fingerprint!==fingerprint || saved.items?.length!==group.length || saved.items.some(([k,v],j)=>k!==group[j][0]||typeof v!=='string'))throw Error('Saved batch differs from the current resource export');
    } catch(error) {
      if(error.code!=='ENOENT')throw error;
      jobs.push({number:i+1,group,fingerprint,file});
    }
  }
  const limit=limitText===undefined?jobs.length:Number(limitText);
  if(!Number.isSafeInteger(limit)||limit<0)throw Error('Invalid batch limit');
  const queue=jobs.slice(0,limit);
  async function translate(group, retry=true) {
    try {return await client.translateAssetNames(group.map(([pattern,source,...draft])=>[source,pattern,...draft]),review);}
    catch(e) {
      if(retry && /网络|超时|HTTP (429|5\d\d)/.test(e.message)){
        await new Promise(r=>setTimeout(r,2500));
        return translate(group,false);
      }
      if(group.length>1 && /格式|条数|编号|完整|JSON/.test(e.message)){
        const mid=Math.ceil(group.length/2);
        return [...await translate(group.slice(0,mid)),...await translate(group.slice(mid))];
      }
      throw e;
    }
  }
  let cursor=0,failed=false;
  async function worker() {
    while(!failed && cursor<queue.length) {
      const job=queue[cursor++];
      try {
        const aliases=await translate(job.group);
        const temp=job.file+'.'+crypto.randomUUID()+'.tmp';
        try{
          await fs.writeFile(temp, JSON.stringify({fingerprint:job.fingerprint,provider:'DeepSeek',items:job.group.map(([k],i)=>[k,aliases[i]])}),{flag:'wx'});
          await fs.rename(temp,job.file);
        } finally {await fs.rm(temp,{force:true});}
        console.log('Batch '+job.number+'/'+batches.length+' saved ('+aliases.filter(Boolean).length+'/'+aliases.length+' named)');
      } catch(e) {failed=true;throw e;}
    }
  }
  // Check the first request before opening parallel requests against this account.
  if(queue.length && jobs.length===batches.length && queue.length>1){
    const remaining=queue.splice(1);await worker();queue.push(...remaining);
  }
  const results=await Promise.allSettled(Array.from({length:Math.min(6,queue.length)},worker));
  const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
