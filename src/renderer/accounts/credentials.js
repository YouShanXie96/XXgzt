'use strict';

// The account manager keeps metadata only. Passwords are read from the input at
// submit time, removed from the DOM immediately, and never returned by the API.
(() => {
  const types=[['owner','主账号'],['operator','运营'],['support','客服']];
  const array=value=>Array.isArray(value)?value:[];
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function metadata(data) {
    return {available:data?.available===true,accounts:array(data?.accounts).filter(row=>typeof row.id==='string').map(row=>({id:row.id,type:types.some(([value])=>value===row.type)?row.type:'operator',username:String(row.username||''),updatedAt:String(row.updatedAt||'')}))};
  }

  function create(host) {
    const esc=host.esc||escape;
    let current=null,openSequence=0;
    const logins=new Map();
    const list=async storeId=>metadata(await host.api('credentials.list',{storeId}));
    const errorText=error=>error?.message||String(error);
    const clearSecrets=dialog=>dialog?.querySelectorAll('input[type="password"]').forEach(input=>{input.value='';});

    async function submit(store,{id,type,username,passwordInput}) {
      // This object exists only for the in-flight save. Nothing with a password
      // is kept in the dialog model, account cache, module state, or toast text.
      const payload={storeId:store.id,...(id?{id}:{}),type,username:String(username||'').trim(),password:passwordInput.value};
      passwordInput.value='';
      try {
        const invalid=!payload.username?'请输入账号。密码输入已清空，请重新填写后保存。':payload.username.length>160?'账号不能超过160个字符。':payload.password.length>1024?'密码不能超过1024个字符。':!types.some(([value])=>value===type)?'请选择有效账号类型。':!id&&!payload.password?'新增账号需要填写密码。':'';
        if(invalid){const error=new Error(invalid);error.credentialValidation=true;throw error;}
        return metadata(await host.api('credentials.save',payload));
      } finally {payload.password='';}
    }

    function close({restore=true}={}) {
      const session=current;if(!session)return;
      session.restore=restore;clearSecrets(session.dialog);
      session.dialog.close();
    }
    function login(store,credentialId) {
      if(logins.has(store.id))return logins.get(store.id);
      const promise=(async()=>{
        close({restore:false});
        host.onAutoLogin?.(store.id,{status:'running',message:'正在打开官方登录页，准备填写已保存的账号…',submitted:false});
        try {
          await host.setBrowserVisible?.(false);
          const operation=async()=>{
            try {const result=await host.api('accounts.autoLogin',{storeId:store.id,credentialId});host.onAutoLogin?.(store.id,result);return result;}
            catch(error){host.onAutoLogin?.(store.id,{status:'error',message:'自动登录未完成，请检查本机账号并重试。',submitted:false});throw error;}
          };
          const result=host.perform ? await host.perform(`accounts.autoLogin:${store.id}`,operation,{module:'accounts',reload:false}) : await operation();
          if(result?.message)host.toast(result.message);
          return result;
        } catch(error){host.onAutoLogin?.(store.id,{status:'error',message:'自动登录未完成，请检查本机账号并重试。',submitted:false});throw error;}
      })().finally(()=>logins.delete(store.id));
      logins.set(store.id,promise);return promise;
    }

    function render(session) {
      clearSecrets(session.dialog);
      const {store,model,editingId,pending,choose}=session;
      const editing=model.accounts.find(row=>row.id===editingId);
      const disable=pending||!model.available;
      const rows=model.accounts.map(row=>`<article class="credentials-row${row.id===editingId?' editing':''}"><div class="credentials-row-name"><span class="credentials-type">${esc(types.find(([value])=>value===row.type)?.[1]||'运营')}</span><strong title="${esc(row.username)}">${esc(row.username)}</strong><small>${row.updatedAt?`更新于 ${esc(host.dateTime?.(row.updatedAt)||row.updatedAt)}`:'已保存在本机'}</small></div><div class="credentials-row-actions"><button type="button" class="button small primary" data-credential-action="login" data-credential-id="${esc(row.id)}"${disable?' disabled':''}>自动登录</button><button type="button" class="button small" data-credential-action="edit" data-credential-id="${esc(row.id)}"${disable?' disabled':''}>编辑</button><button type="button" class="button small" data-credential-action="remove" data-credential-id="${esc(row.id)}"${pending?' disabled':''}>删除</button></div></article>`).join('');
      session.dialog.innerHTML=`<div class="credentials-heading"><div><h2 id="credentials-title">${choose?'选择本机账号登录':'本机账号'}</h2><p>${esc(store.name||'未命名店铺')} · 账号名称不会改变店铺标签</p></div><button type="button" class="credentials-close" data-credential-action="close" aria-label="关闭本机账号">×</button></div><div class="credentials-content">${!model.available?'<div class="credentials-unavailable" role="status">这台电脑当前无法安全保存或使用账号密码，请先在官方页面手动登录。</div>':''}<div class="credentials-list">${rows||'<p class="credentials-empty">还没有保存账号。在下方添加后，可以自动填写并提交登录。</p>'}</div><form class="credentials-form"><div class="credentials-form-title"><h3>${editing?'编辑账号':'新增账号'}</h3>${editing?'<button type="button" class="button small" data-credential-action="new">改为新增</button>':''}</div><div class="credentials-fields"><label>类型<select name="type"${disable?' disabled':''}>${types.map(([value,label])=>`<option value="${value}"${(editing?.type||'operator')===value?' selected':''}>${label}</option>`).join('')}</select></label><label>账号<input name="username" type="text" value="${esc(editing?.username||'')}" maxlength="160" autocomplete="off" spellcheck="false" required${disable?' disabled':''}></label><label class="credentials-password">密码<input name="password" type="password" value="" maxlength="1024" autocomplete="new-password"${editing?'':' required'}${disable?' disabled':''} placeholder="${editing?'留空则保留原密码':'请输入密码'}"></label></div><p class="credentials-form-note">密码不会显示在账号列表中。${editing?'编辑时密码留空表示不修改。':''}提交后密码框立即清空。</p><p class="credentials-error" role="alert"></p><div class="credentials-form-actions"><span>账号信息只用于你选择的这家店铺。</span><button type="submit" class="button primary"${disable?' disabled':''}>${pending?'正在处理…':editing?'保存修改':'保存到本机'}</button></div></form></div>`;
    }

    async function handle(session,operation,id) {
      if(operation==='close'){close();return;}
      if(session.pending||session.confirming)return;
      if(operation==='new'){session.editingId='';render(session);return;}
      const account=session.model.accounts.find(row=>row.id===id);
      if(!account)return;
      if(operation==='edit'){session.editingId=id;render(session);return;}
      if(operation==='login'){
        try{
          const result=await login(session.store,id);
          if(result&&result.status&&result.status!=='verified')host.toast(result.message||'登录未完成，请查看官方页面提示。',true);
        }catch(error){host.toast(errorText(error),true);}
        return;
      }
      if(operation!=='remove')return;
      let confirmed;session.confirming=true;
      try {
        confirmed=await host.modal({title:'删除本机账号',description:`删除 ${account.username} 的本机账号记录。不会退出已经登录的店铺页面。`,confirm:'删除',danger:true});
        if(current===session)await host.setBrowserVisible?.(false);
      } finally {session.confirming=false;}
      if(!confirmed||current!==session)return;
      session.pending=true;render(session);
      try {
        await host.api('credentials.remove',{storeId:session.store.id,id});
        session.model=await list(session.store.id);
        if(session.editingId===id)session.editingId='';
        host.toast('本机账号已删除。');
      } catch(error){if(current===session)session.error=errorText(error);}
      finally {session.pending=false;if(current===session){render(session);session.dialog.querySelector('.credentials-error').textContent=session.error||'';}}
    }

    async function open(store,{choose=false,data}={}) {
      const sequence=++openSequence;
      close({restore:false});await host.setBrowserVisible?.(false);
      const model=data?metadata(data):await list(store.id);
      if(sequence!==openSequence)return;
      const dialog=document.createElement('dialog');
      dialog.className='credentials-dialog';dialog.setAttribute('aria-labelledby','credentials-title');
      const session={store:{id:store.id,name:store.name},model,dialog,editingId:'',pending:false,confirming:false,choose,restore:true,error:''};
      current=session;render(session);document.body.append(dialog);
      dialog.addEventListener('close',()=>{
        clearSecrets(dialog);dialog.replaceChildren();dialog.remove();
        if(current===session){current=null;if(session.restore&&host.state.page==='browser')Promise.resolve(host.setBrowserVisible?.(true)).catch(error=>host.toast(errorText(error),true));}
      },{once:true});
      dialog.addEventListener('click',event=>{
        const target=event.target.closest('[data-credential-action]');if(!target)return;
        event.preventDefault();event.stopPropagation();
        handle(session,target.dataset.credentialAction,target.dataset.credentialId).catch(error=>host.toast(errorText(error),true));
      });
      dialog.addEventListener('submit',async event=>{
        if(!event.target.matches('.credentials-form'))return;
        event.preventDefault();event.stopPropagation();
        if(session.pending||!session.model.available)return;
        const form=event.target;
        session.pending=true;session.error='';
        const input=form.querySelector('[name="password"]');
        const operation=submit(session.store,{id:session.editingId,type:form.querySelector('[name="type"]').value,username:form.querySelector('[name="username"]').value,passwordInput:input});
        form.querySelector('[type="submit"]').disabled=true;
        try {
          const result=await operation;
          session.model=result;session.editingId='';
          host.toast('账号已保存到本机。');
        } catch(error){session.error=error?.credentialValidation?errorText(error):'账号保存失败。密码框已清空，请重新填写后重试。';}
        finally {session.pending=false;clearSecrets(dialog);if(current===session){render(session);dialog.querySelector('.credentials-error').textContent=session.error;}}
      });
      dialog.showModal();return {opened:true};
    }
    return {list,open,login,close,submit};
  }
  window.XXCredentials=Object.freeze({create});
})();
