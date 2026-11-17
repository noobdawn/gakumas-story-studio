const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('picker',Object.freeze({init:()=>ipcRenderer.invoke('color-picker:init'),confirm:c=>ipcRenderer.invoke('color-picker:confirm',c),screen:()=>ipcRenderer.invoke('color-picker:screen'),sample:(x,y)=>ipcRenderer.invoke('color-picker:sample',x,y),cancelScreen:()=>ipcRenderer.invoke('color-picker:cancel-screen')}));
