'use strict';

// 每个店铺一个独立文件夹：用户数据/店铺数据/<店铺名>_<店铺ID前8位>/…
// 文件夹名只在第一次建立映射时确定并记录在 文件夹映射.json，
// 之后重命名店铺不会改变文件夹，避免既有数据“换目录消失”。
const {identifier}=require('./domain');

const ROOT='店铺数据';
const REGISTRY_FILE=`${ROOT}/文件夹映射.json`;
const MAX_NAME=40;
const INVALID=/[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const FOLDER_PATTERN=/^[^\\/:*?"<>|]{1,60}$/;

function sanitizeFolderName(value){
  let text=String(value??'').replace(INVALID,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
  if(RESERVED.test(text))text='店铺'+text;
  const sliced=[...text].slice(0,MAX_NAME).join('').trim().replace(/[. ]+$/,'');
  return sliced||'店铺';
}
function folderName(store){
  const id=identifier(store?.id);
  return `${sanitizeFolderName(store?.name)}_${id.slice(0,8)}`;
}
function readRegistry(value){
  const registry={};
  if(!value||typeof value!=='object'||Array.isArray(value))return registry;
  for(const [key,entry]of Object.entries(value)){
    if(typeof entry!=='string'||!FOLDER_PATTERN.test(entry)||entry==='.'||entry==='..')continue;
    try{identifier(key);}catch{continue;}
    registry[key]=entry;
  }
  return registry;
}
// 为每个店铺分配稳定的文件夹；已存在的映射保持不变，返回是否发生变化。
function assignFolders(stores,current){
  const registry=readRegistry(current),taken=new Map();
  for(const [id,folder]of Object.entries(registry))taken.set(folder,id);
  let changed=false;
  for(const store of Array.isArray(stores)?stores:[]){
    if(!store||typeof store.id!=='string')continue;
    let folder=registry[store.id];
    if(!folder||taken.get(folder)!==store.id){
      const base=folderName(store);
      folder=base;
      for(let index=2;taken.has(folder);index++)folder=`${base}-${index}`;
      registry[store.id]=folder;taken.set(folder,store.id);changed=true;
    }
  }
  return {registry,changed};
}
// 只保留仍然存在的店铺 + 明确要求保留的孤儿目录（已移除店铺的数据文件夹）。
function pruneRegistry(registry,stores){
  const ids=new Set((Array.isArray(stores)?stores:[]).map(store=>store&&store.id).filter(Boolean));
  const next={};
  for(const [id,folder]of Object.entries(readRegistry(registry)))if(ids.has(id))next[id]=folder;
  return next;
}
const storeFolder=(folder)=>folder?`${ROOT}/${folder}`:null;
module.exports={ROOT,REGISTRY_FILE,MAX_NAME,sanitizeFolderName,folderName,readRegistry,assignFolders,pruneRegistry,storeFolder};
