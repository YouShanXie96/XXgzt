'use strict';
// 界面小状态（与 settings.json 分开存，避免“保存设置”时被覆盖）。
// 目前用于：记住上次导入文件所在的目录，下次打开导入框默认回到那里。
const FILE='ui-state.json';
function createUiState(storage){
  const read=async()=>{try{const data=await storage.readJson(FILE,{});return data&&typeof data==='object'?data:{};}catch{return {};}};
  const patch=async values=>{try{await storage.writeJson(FILE,{...await read(),...values});return true;}catch{return false;}};
  return {
    read,
    patch,
    async lastImportDir(){return String((await read()).lastImportDir||'');},
    async rememberImportDir(dir){const next=String(dir||'');if(!next)return false;return patch({lastImportDir:next});}
  };
}
module.exports={createUiState,FILE};
