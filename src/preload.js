'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('xx',{
  call:(action,payload={})=>ipcRenderer.invoke('xx:call',action,payload),
  // 违规扫描的“拖拽 Excel/CSV 到此处导入”：需要把拖入的文件还原成本机路径再交给主进程读取。
  pathForFile:file=>{try{return typeof webUtils?.getPathForFile==='function'?String(webUtils.getPathForFile(file)||''):String(file?.path||'');}catch{return '';}},
  onProgress:fn=>{if(typeof fn!=='function')return ()=>{};const listener=(_event,data)=>fn(data);ipcRenderer.on('xx:progress',listener);return ()=>ipcRenderer.removeListener('xx:progress',listener);},
  onUpdate:fn=>{if(typeof fn!=='function')return ()=>{};const listener=(_event,data)=>fn(data);ipcRenderer.on('xx:update',listener);return ()=>ipcRenderer.removeListener('xx:update',listener);}
});
