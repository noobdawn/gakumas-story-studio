'use strict';
async function offer({translation,dialog,window,openSettings,active}){
 const settings=await translation.read();if(settings.exists||!active())return;
 const choice=await dialog.showMessageBox(window(),{type:'info',title:'可选：配置剧本翻译',message:'可使用 DeepSeek 将剧本翻译为日语，供 VOICEVOX 使用。',detail:'可以现在填写 API Key，或稍后在「设置 → DeepSeek 翻译设置」中配置。翻译时对白会发送至 DeepSeek，可能产生费用。',buttons:['现在设置','稍后'],defaultId:1,cancelId:1,noLink:true});
 if(!active())return;if(!(await translation.read()).exists)await translation.save({key:'',prompt:settings.prompt,clearKey:false});
 if(choice.response===0&&active())openSettings();
}
module.exports={offer};
