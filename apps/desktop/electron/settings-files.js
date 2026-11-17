'use strict';
function create({translation,pronunciation,shell,assertWritable}){
 const stores={prompt:translation,rules:pronunciation};
 const files=()=>({prompt:translation.file,rules:pronunciation.file});
 async function open(kind,reveal=false){const store=Object.hasOwn(stores,kind)?stores[kind]:null;if(!store||typeof reveal!=='boolean')throw Error('未知配置文件');const file=await store.ensureFile();await assertWritable(file);if(reveal)shell.showItemInFolder(file);else{const error=await shell.openPath(file);if(error)throw Error('无法打开文件：'+error+'；可使用“在文件夹中显示”');}return file;}
 return {files,open};
}
module.exports={create};
