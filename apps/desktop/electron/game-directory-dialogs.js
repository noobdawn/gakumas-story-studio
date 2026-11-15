'use strict';
function create({store,dialog,window}){
 async function choose(){const current=await store.status();const choice=await dialog.showOpenDialog(window(),{title:'选择游戏安装目录',...(current.path?{defaultPath:current.path}:{}),properties:['openDirectory']});if(choice.canceled||!choice.filePaths.length)return null;try{return await store.save(choice.filePaths[0]);}catch(error){await dialog.showMessageBox(window(),{type:'error',title:'游戏目录不可用',message:error.message});return null;}}
 async function requireDirectory(){const current=await store.status();if(current.state==='valid')return current.path;await dialog.showMessageBox(window(),{type:'info',title:'选择游戏目录',message:current.message,detail:'选择本地游戏安装目录。游戏文件只读；此检查不代表资源已导入。',buttons:['选择目录']});return choose();}
 async function promptOnStartup(){const current=await store.status();if(current.state==='valid')return;const choice=await dialog.showMessageBox(window(),{type:'info',title:'游戏目录',message:current.message,detail:'请选择本地游戏安装目录，游戏文件只读。也可稍后从「素材」菜单选择。此检查不代表资源已导入。',buttons:['选择目录','稍后'],defaultId:0,cancelId:1,noLink:true});if(choice.response===0)return choose();}
 return {choose,requireDirectory,promptOnStartup};
}
module.exports={create};
