'use strict';

// Legacy selector evidence: the user's reference application, static
// dist/main/browser/login-fill-script.js (fm-login and TPL fields).
const legacy = Object.freeze({
  id:'taobao-legacy',origin:'https://login.taobao.com',path:null,
  fields:[
    {username:'input[name="fm-login-id"]',password:'input[name="fm-login-password"]'},
    {username:'input[name="TPL_username"]',password:'input[name="TPL_password"]'}
  ],
  form:null,submit:'button.fm-button.fm-submit',submission:'native-post-or-button',
  passwordSwitch:'button,a,[role="tab"],[class*="switch"]'
});

// Public official sources inspected on 2026-09-16:
// https://g.alicdn.com/qn/qn-login-page/0.0.18/js/index.js embeds
// https://havanalogin.taobao.com/mini_login.htm in #alibaba-login-box.
// https://x.alicdn.com/vip/havana-nlogin/0.10.36/index.js renders this exact
// password form without action/method. Its password-login click handler calls
// preventDefault() before loginSubmit(); native GET must also be prevented by
// our temporary submit guard if the platform handler is not yet attached.
const havana = Object.freeze({
  id:'qianniu-havana-password',origin:'https://havanalogin.taobao.com',path:'/mini_login.htm',
  fields:[
    {username:'input#fm-login-id.fm-text[name="fm-login-id"]',password:'input#fm-login-password.fm-text[name="fm-login-password"]'},
    {username:'input#fm-login-id.fm-text[name="fm-login-id-mobile"]',password:'input#fm-login-password.fm-text[name="fm-login-password"]'}
  ],
  form:'form#login-form.login-form',submit:'button.fm-button.fm-submit.password-login[type="submit"]',
  submission:'guarded-ajax',passwordSwitch:'#login-tabs .login-tabs-tab,div.password-login-link'
});

const LOGIN_ADAPTERS=Object.freeze([legacy,havana]);
function loginAdapterForUrl(value){
  try{
    const url=new URL(value);
    if(url.username||url.password)return null;
    return LOGIN_ADAPTERS.find(adapter=>url.origin===adapter.origin&&(!adapter.path||url.pathname===adapter.path))||null;
  }catch{return null;}
}
module.exports={loginAdapterForUrl};
