'use strict';
const path=require('node:path');
function projectFile(args){
  let file=null;
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(arg!=='--project'&&!arg.startsWith('--project='))continue;
    if(file!==null)throw Error('只能指定一个启动工程');
    file=arg==='--project'?args[++i]:arg.slice('--project='.length);
    if(!file||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.json')throw Error('--project 需要工程 JSON 的绝对路径');
    file=path.resolve(file);
  }
  return file;
}
function create({args,read,onAccept}){
  let taken=false,pending=null;
  return {
    async take(){
      if(taken)return null;taken=true;
      const file=projectFile(args);if(!file)return null;
      const result=await read(file);pending={file,hash:result.hash};
      return {document:result.doc,name:path.basename(file)};
    },
    accept(applied){
      if(typeof applied!=='boolean')throw Error('启动工程确认参数无效');
      const value=pending;pending=null;
      if(applied&&value)onAccept(value);
      return Boolean(applied&&value);
    }
  };
}
module.exports={projectFile,create};
