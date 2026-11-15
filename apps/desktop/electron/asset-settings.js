'use strict';
// Dialog orchestration is separate from cache ownership/deletion checks.
const path=require('node:path');
const same=(a,b)=>a&&b&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function create({cache,gameDirectory,validateGame,dialog,window}){
 const reviewed=new Set();
 const ask=options=>dialog.showMessageBox(window(),{type:'warning',defaultId:0,cancelId:0,noLink:true,...options});
 const protection='只清理创作器管理的解包缓存。工程、导入音频、生成配音、用户设置和游戏文件都会保留。';
 const inUse='正在被 Player 使用的批次会保留到工作台正常退出后清理；新的 Player 资源在重启后生效。';
 async function game(){
  const before=await cache.info(),choice=await dialog.showOpenDialog(window(),{title:'切换游戏安装目录',defaultPath:before.game?.path,properties:['openDirectory']});
  if(choice.canceled||!choice.filePaths.length)return {cancelled:true};
  const target=await validateGame(choice.filePaths[0]);
  await cache.checkGameTarget(target);
  if(same(target,before.game?.path))return {message:'游戏目录未改变。'};
  const answer=await ask({title:'切换游戏目录',message:'切换后是否立即清理缓存并重新解包？',detail:`原目录：${before.game?.path||'尚未选择'}\n新目录：${target}\n\n保留旧缓存时，其他游戏目录的缓存不会自动用于新目录。${protection}\n${inUse}`,buttons:['取消','仅切换，保留缓存','切换并清理、重新解包']});
  if(answer.response===0)return {cancelled:true};
  await gameDirectory.save(target);
  await cache.refreshGame();
  if(answer.response===2){const cleared=await cache.clear({deferInUse:true});await cache.start();return {...cleared,message:'游戏目录已切换，正在重新解包。'+(cleared.deferred?'使用中的旧批次将在退出后清理。':'')};}
  return {message:'游戏目录已切换，旧缓存已保留。可点击“重新解包”准备此目录的资源。'};
 }
 async function directory(){
  const before=await cache.info(),choice=await dialog.showOpenDialog(window(),{title:'切换缓存目录（可新建文件夹）',defaultPath:before.root,properties:['openDirectory','createDirectory']});
  if(choice.canceled||!choice.filePaths.length)return {cancelled:true};
  const target=choice.filePaths[0];
  if(same(target,before.root))return {message:'缓存目录未改变。'};
  const inspected=await cache.inspectDestination(target);
  const explanation=inspected.managedExists?'目标中已有可识别的创作器缓存，将使用其中与当前游戏匹配的资源。':`将在目标内新建 gakumas-creator-cache 文件夹。`;
  const answer=await ask({title:'确认缓存目录',message:'切换缓存目录后，原目录中的缓存如何处理？',detail:`原缓存：${before.managedPath}\n目标缓存：${inspected.managedPath}\n\n${explanation}${inspected.otherEntries?` 目标中另有 ${inspected.otherEntries} 项内容，会原样保留。`:''}\n不会搬移或覆盖旧缓存。${protection}\n${inUse}`,buttons:['取消','切换，保留原缓存','切换，清理原缓存']});
  if(answer.response===0)return {cancelled:true};
  const result=await cache.configure(target,{deferInUse:true,cleanPrevious:answer.response===2});
  return {...result,message:result.cleanupError?`缓存目录已切换，但原缓存未清理完成：${result.cleanupError}`:`缓存目录已切换。${answer.response===2?(result.deferred?'使用中的原缓存将在退出后清理。':'原目录中的受管理缓存已清理。'):'原缓存已保留。'}${result.visualNext?'重启后使用目标中的 Player 资源。':'目标尚无可用 Player 资源，请重新解包。'}`};
 }
 async function clear(){
  const info=await cache.info(),answer=await ask({title:'清除缓存',message:'确定清除当前目录中的解包缓存？',detail:`清理范围：${info.managedPath}\n\n${protection}\n清除后需要重新解包才能恢复缓存资源。\n${inUse}`,buttons:['取消','清除缓存']});
  if(answer.response!==1)return {cancelled:true};
  const result=await cache.clear({deferInUse:true});
  return {...result,message:result.deferred?'其他缓存已清除；Player 使用中的批次将在工作台退出后清理。':'受管理的解包缓存已清除。'};
 }
 async function start(){
  const info=await cache.info();
  if(info.game?.state!=='valid')throw Error('请先在“目录设置”中选择有效的游戏安装目录。');
  const answer=await ask({title:'重新解包',message:'重新解包前是否清除现有缓存？',detail:`缓存：${info.managedPath}\n\n保留缓存：新建批次，失败时保留上次可用资源，但会占用更多空间。\n清除后解包：移除旧批次，解包不完整时无法恢复已删除的缓存。\n本次完整准备角色、动作、表情、2D／3D 场景、对白界面和音频。\n${protection}\n${inUse}`,buttons:['取消','保留缓存并解包','清除缓存后解包']});
  if(answer.response===0)return {cancelled:true};
  const cleared=answer.response===2?await cache.clear({deferInUse:true}):{};
  await cache.refreshGame();await cache.start();
  return {...cleared,message:'正在重新解包。'+(cleared.deferred?'使用中的旧批次将在退出后清理。':'')};
 }
 async function cancel(){const answer=await ask({title:'停止解包',message:'停止当前解包任务？',detail:'本批次已生成的文件会保留，之后可通过“清除缓存”清理。上次仍可用的缓存不会被替换。',buttons:['继续解包','停止解包']});return answer.response===1?cache.cancel():{cancelled:true};}
 async function review({force=false}={}){
  const info=await cache.info(),id=info.partialAudioRun;
  if(!info.partialAudioPending||!id||(!force&&reviewed.has(id)))return null;
  reviewed.add(id);
  const restartNotice=info.visualNext&&(!info.visualActive||info.visualUpdatePending)?'角色与 2D／3D 场景已准备，但当前预览尚未切换；请保存工程并完全退出后重开工作台。':'';
  const answer=await ask({title:'解包结果',message:'部分资源缺失，是否使用本批次成功解码的音频？',detail:`${info.job?.message||''}\n缺失明细可在资产页“解包结果与缺失明细”中查看。\n使用本批次会切换素材浏览器的游戏音频清单；工程中已导入的音频和配音不受影响。\n${restartNotice}`,buttons:['暂不使用','使用已成功解码的音频']});
  if(answer.response!==1)return {message:'已保留解包结果，音频清单未切换。可展开解包结果再次确认。'+restartNotice};
  await cache.usePartialAudio();return {message:'已启用本批次成功解码的音频，缺失明细仍保留。'+restartNotice};
 }
 return {game,directory,clear,start,cancel,review};
}
module.exports={create};
