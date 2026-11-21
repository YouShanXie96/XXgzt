'use strict';

(() => {
  const catalog = window.XXPermissionCatalog;
  if (!catalog) throw new Error('权限目录未加载');
  const PAGE_PERMISSION_CODES = Object.freeze(catalog.GROUPS.filter(group => group.category === '工作台').map(group => group.base));
  const PAGE_PERMISSIONS = Object.freeze(Object.fromEntries(
    Object.entries(catalog.PAGE_CODES).map(([page, codes]) => [page, codes[0] || '']),
  ));
  const PERMISSION_LABELS = Object.freeze(Object.fromEntries([
    ['login', '登录工作台'],
    ...catalog.ITEMS.map(item => [item.code, item.label]),
    ...catalog.GROUPS.map(group => [group.base, group.label]),
    ['organization.view', '查看组织'],
    ['organization.manage', '管理组织'],
    ['organization.teams.manage', '管理小组'],
    ['approval.manage', '审核账号'],
    ['member.manage', '管理成员'],
  ]));
  const ROLE_LABELS = Object.freeze({
    member: '组员',
    team_leader: '组长',
    department_manager: '部门主管',
    general_manager: '总经理',
    owner: '公司老板',
  });

  function create({
    api,
    esc,
    svg,
    heading,
    button,
    panel,
    notice,
    empty,
    badge,
    modal,
    toast,
    render,
    onAuthenticated,
    onLoggedOut,
    onStoresChanged,
  }) {
    const state = {
      checking: true,
      authenticated: false,
      config: null,
      session: null,
      error: '',
      info: '',
      busy: false,
      mode: 'login',
      registrationContext: null,
      registrationDraft: {},
      tab: 'account',
      loading: false,
      loadError: '',
      organization: null,
      pending: [],
      users: [],
      positions: [],
      managedStores: [],
      storeOrgFilter: '',
      storeMemberSelection: new Set(),
      storeSelection: new Set(),
      storeDepartmentSearch: '',
      storePeopleSearch: '',
      storeNameSearch: '',
      storeAccessMode: 'organization',
      storeAccessPersonId: '',
      storeAccessStoreId: '',
      storeAccessPersonSearch: '',
      storeAccessStoreSearch: '',
      storeAccessAvailableSearch: '',
      permissionTemplates: null,
      memberSearch: '',
      orgFilter: 'all',
      memberStatusFilter: 'all',
      offlineAdminConfigured: false,
      memberSelection: new Set(),
      contextMenu: null,
      systemLevelLabels: {},
      systemLevelLabelsMode: 'shared',
      profilePreferences: {},
      permissionEditContext: null,
      offlineAdmin: false,
      companyLogin: null,
    };
    let permissionSyncPromise = null;
    let lastPermissionSyncAt = 0;
    let lastStoreAccessSyncAt = 0;
    let permissionSyncTimer = null;

    const q = selector => document.querySelector(selector);
    const val = selector => String(q(selector)?.value || '').trim();
    const permissions = () => Array.isArray(state.session?.application?.permissions) ? state.session.application.permissions : [];
    const management = () => Array.isArray(state.session?.management_permissions) ? state.session.management_permissions : [];
    const allPermissions = () => [...new Set([...permissions(), ...management()])];
    const isOwnerAccount = () => String(state.session?.user?.base_role || state.session?.user?.role || '') === 'owner';
    const hasManagement = permission => isOwnerAccount() || catalog.matches(management(), permission);
    const hasPermission = code => {
      const required=String(code||'').trim();
      if (!required) return false;
      if (isOwnerAccount()) return true;
      if (required.startsWith('workbench.') && permissions().includes('login') && !catalog.detailed(permissions())) return true;
      return catalog.matches(allPermissions(), required);
    };
    const canManageTeams = () => hasManagement('manage.organization.teams') || hasManagement('organization.teams.manage') || hasManagement('organization.manage');
    const canManageDepartments = () => hasManagement('manage.organization.departments') || hasManagement('organization.manage');
    const canViewOrganization = () => hasManagement('manage.organization.view') || hasManagement('organization.view');
    const canViewPeople = () => hasManagement('manage.people.view') || hasManagement('member.manage');
    const canReviewApprovals = () => hasManagement('manage.approval.review') || hasManagement('approval.manage');
    const canAssignPermissions = () => hasManagement('manage.permissions.assign') || hasManagement('member.manage');
    const canAddMembers = () => hasManagement('manage.people.add');
    const canEditMembers = () => hasManagement('manage.people.edit');
    const canMoveMembers = () => hasManagement('manage.people.move');
    const canDeleteMembers = () => hasManagement('manage.people.delete');
    const canManagePositions = () => hasManagement('manage.positions.manage');
    const canListPositions = () => canViewPeople() || canReviewApprovals() || canAssignPermissions() || canManagePositions();
    const canAssignStores = () => hasManagement('manage.stores.assign');
    const canViewStores = () => canAssignStores() || hasManagement('manage.stores.view');
    const roleRank = role => ({member:1,team_leader:2,department_manager:3,general_manager:4,owner:5}[String(role||'member')] || 1);
    const systemRoleLabel = (role, fallback = '') => String(
      state.systemLevelLabels?.[role] || fallback || ROLE_LABELS[role] || role || ''
    );
    const actorBaseRole = () => String(state.session?.user?.base_role || state.session?.user?.role || 'member');
    const profileName = () => String(state.profilePreferences?.displayName || state.session?.user?.display_name || state.session?.user?.login_id || '').trim();
    const profileAvatar = () => String(state.profilePreferences?.avatarDataUrl || '').trim();
    const memberName = item => item?.id === state.session?.user?.id && profileName()
      ? profileName()
      : String(item?.display_name || item?.login_id || '—');
    const memberRoleName = item => item?.position_id
      ? String(item?.role_name || ROLE_LABELS[item?.role] || item?.role || '')
      : systemRoleLabel(item?.role, item?.role_name);
    const displayInitial = value => String(value || '账').trim().slice(0, 1) || '账';
    const assignableBaseRoles = () => Object.entries(ROLE_LABELS).filter(([role]) => role !== 'owner' && roleRank(role) < roleRank(actorBaseRole()));
    const departmentMap = () => new Map((state.organization?.departments || []).map(item => [String(item.id), item]));
    const descendantDepartmentIds = departmentId => {
      const departments = departmentMap();
      const result = new Set();
      if (!departmentId) return result;
      result.add(String(departmentId));
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of departments.values()) {
          if (result.has(String(item.parent_department_id || '')) && !result.has(String(item.id))) {
            result.add(String(item.id));
            changed = true;
          }
        }
      }
      return result;
    };
    const ancestorDepartmentIds = departmentId => {
      const departments = departmentMap();
      const result = new Set();
      let current = departments.get(String(departmentId || ''));
      while (current && !result.has(String(current.id))) {
        result.add(String(current.id));
        current = departments.get(String(current.parent_department_id || ''));
      }
      return result;
    };
    const actorDepartmentId = () => String(state.session?.department?.id || '');
    const canManageMember = item => {
      if (!item || item.role === 'owner' || item.id === state.session?.user?.id) return false;
      if (typeof item.can_manage === 'boolean') return item.can_manage;
      if (roleRank(item.role) >= roleRank(actorBaseRole())) return false;
      if (['owner', 'general_manager'].includes(actorBaseRole())) return true;
      if (actorBaseRole() === 'department_manager') {
        return descendantDepartmentIds(actorDepartmentId()).has(String(item.department_id || ''));
      }
      if (actorBaseRole() === 'team_leader') {
        const sameDepartment = String(item.department_id || '') === actorDepartmentId();
        const sameTeamOrUnassigned = !item.team_id || String(item.team_id) === String(state.session?.team?.id || '');
        return sameDepartment && sameTeamOrUnassigned && item.role === 'member';
      }
      return false;
    };
    const copySources = targetIds => {
      const excluded = new Set((Array.isArray(targetIds) ? targetIds : [targetIds]).map(String));
      return state.users.filter(item => (
        item.status === 'active'
        && !excluded.has(String(item.id))
        && item.role !== 'owner'
        && roleRank(item.role) < roleRank(actorBaseRole())
      ));
    };
    const selectedMemberIds = () => [...state.memberSelection].filter(id => state.users.some(item => String(item.id) === String(id) && canManageMember(item)));
    const ownedCatalogCodes = () => roleRank(actorBaseRole()) >= 4
      ? catalog.CODES.slice()
      : catalog.CODES.filter(code => hasPermission(code));
    const canAccessPage = page => {
      if (!state.authenticated) return false;
      if (page === 'cloudaccount') return true;
      // 软件更新对所有账号开放，不参与权限校验。
      if (page === 'update') return true;
      if (isOwnerAccount()) return true;
      return catalog.pageAllowed(permissions(), page);
    };
    const firstAccessiblePage = () => ['accounts', 'browser', 'business', 'trends', 'peers', 'recommendations', 'reviews', 'promotion', 'purchase', 'hostedgift', 'complaint', 'compliance', 'ai', 'settings'].find(canAccessPage) || 'cloudaccount';
    const hasApplicationPermission = code => hasPermission(code);

    function errorHtml() {
      return state.error ? `<div class="cloud-auth-error" role="alert">${svg('info')}<span>${esc(state.error)}</span></div>` : '';
    }

    function infoHtml() {
      return state.info ? `<div class="cloud-auth-info" role="status">${svg('info')}<span>${esc(state.info)}</span></div>` : '';
    }

    function modeTabs() {
      return '';
    }

    function loginForm() {
      const companyLogin = state.companyLogin;
      if (companyLogin) {
        return `<div class="cloud-modern-heading"><h2>选择登录公司</h2><p>${esc(companyLogin.loginId)} 可登录多个公司</p></div>
        <form class="cloud-auth-form cloud-modern-form" data-cloud-form="login">
          <label>登录公司<select id="cloud-company-select" required>${companyLogin.companies.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label>
          <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在登录…' : '登录所选公司'}</button>
        </form>
        <div class="cloud-auth-switch"><button type="button" data-action="cloud-clear-company-login">返回重新输入账号</button></div>`;
      }
      return `<div class="cloud-modern-heading"><h2>欢迎回来</h2><p>使用公司账号登录</p></div>
      <form class="cloud-auth-form cloud-modern-form" data-cloud-form="login">
        <label>用户名<input id="cloud-login-id" autocomplete="username" maxlength="128" placeholder="请输入用户名" autofocus></label>
        <label>密码<input id="cloud-password" type="password" autocomplete="current-password" maxlength="256" placeholder="输入密码"></label>
        <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在登录…' : '登录'}</button>
      </form>
      <div class="cloud-auth-switch">还没有账号？<button type="button" data-action="cloud-mode" data-value="register">注册账号</button></div>`;
    }

    function registerForm() {
      const context = state.registrationContext;
      const departments = Array.isArray(context?.departments) ? context.departments : [];
      const draft = state.registrationDraft || {};
      const selectedDepartmentId = String(draft.departmentId || '');
      const selectedDepartment = departments.find(item => String(item.id) === selectedDepartmentId);
      const teams = Array.isArray(selectedDepartment?.teams) ? selectedDepartment.teams : [];
      const departmentSelectable = context?.company?.allow_department_self_select !== false;
      const teamSelectable = context?.company?.allow_team_self_select !== false && Boolean(selectedDepartment);
      return `<div class="cloud-modern-heading"><h2>注册账号</h2><p>提交后由公司管理员审核</p></div>
      <form class="cloud-auth-form" data-cloud-form="register">
        ${context ? `<div class="cloud-context-company">${svg('store')}<span><b>${esc(context.company?.name || '')}</b><small>${departments.length ? '邀请码已验证，请选择所属部门和小组' : '邀请码已验证，该公司暂无可用部门，可在审核时由管理员分配'}</small></span></div>` : ''}
        <div class="cloud-inline-field"><label>公司邀请码<input id="cloud-invite-code" maxlength="64" value="${esc(q('#cloud-invite-code')?.value || draft.inviteCode || '')}" placeholder="输入公司邀请码"></label><button type="button" class="button" data-action="cloud-registration-context" ${state.busy ? 'disabled' : ''}>查询公司</button></div>
        <div class="cloud-form-grid">
          <label>登录账号<input id="cloud-register-id" autocomplete="username" maxlength="128" value="${esc(q('#cloud-register-id')?.value || draft.loginId || '')}" placeholder="3–128 个字符"></label>
          <label>显示姓名<input id="cloud-display-name" maxlength="80" value="${esc(q('#cloud-display-name')?.value || draft.displayName || '')}" placeholder="例如：张三"></label>
        </div>
        <label>密码<input id="cloud-register-password" type="password" autocomplete="new-password" minlength="8" maxlength="256" value="${esc(q('#cloud-register-password')?.value || draft.password || '')}" placeholder="至少 8 个字符"></label>
        <div class="cloud-form-grid">
          <label>所属部门<select id="cloud-department"${departmentSelectable ? '' : ' disabled'}><option value="">${departmentSelectable ? '请选择部门（可由管理员指定）' : '由管理员审核时指定'}</option>${departments.map(item => `<option value="${esc(item.id)}"${String(item.id) === selectedDepartmentId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
          <label>所属小组<select id="cloud-team"${teamSelectable ? '' : ' disabled'}><option value="">${selectedDepartment ? `请选择小组（可由管理员指定）` : '请先选择部门'}</option>${teams.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(draft.teamId || '') ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
        </div>
        <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在提交…' : '提交注册申请'}</button>
      </form>
      <div class="cloud-auth-switch"><button type="button" data-action="cloud-mode" data-value="login">返回登录</button><span>·</span><button type="button" data-action="cloud-mode" data-value="activate">激活BOSS</button></div>`;
    }

    function activateForm() {
      return `<div class="cloud-modern-heading"><h2>激活BOSS</h2><p>使用公司激活码设置自己的老板账号</p></div>
      <form class="cloud-auth-form" data-cloud-form="activate">
        <label>一次性激活码<input id="cloud-activation-code" maxlength="64" placeholder="输入老板激活码"></label>
        <label>设置登录账号<input id="cloud-owner-login-id" autocomplete="username" maxlength="128" placeholder="至少 3 个字符"></label>
        <label>设置新密码<input id="cloud-owner-password" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="至少 8 个字符"></label>
        <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在激活…' : '激活BOSS'}</button>
      </form>
      <div class="cloud-auth-switch"><button type="button" data-action="cloud-mode" data-value="register">返回注册</button></div>`;
    }

    function offlineLoginForm() {
      return `<div class="cloud-modern-heading"><h2>离线超级管理员</h2><p>全域中枢不可用时使用本机管理员进入</p></div>
      <form class="cloud-auth-form" data-cloud-form="offline-login">
        <label>管理员账号<input id="cloud-offline-login-id" autocomplete="username" maxlength="128" placeholder="输入离线管理员账号"></label>
        <label>密码<input id="cloud-offline-password" type="password" autocomplete="current-password" maxlength="256" placeholder="输入密码"></label>
        <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在验证…' : '离线登录'}</button>
      </form>
      <div class="cloud-auth-switch"><button type="button" data-action="cloud-mode" data-value="login">返回账号登录</button></div>`;
    }

    function offlineSetupForm() {
      return `<div class="cloud-modern-heading"><h2>设置离线超级管理员</h2><p>仅保存在本机并加密校验，不保存明文密码</p></div>
      <form class="cloud-auth-form" data-cloud-form="offline-setup">
        <label>管理员账号<input id="cloud-offline-setup-id" autocomplete="username" maxlength="128" placeholder="至少 3 个字符"></label>
        <label>管理员密码<input id="cloud-offline-setup-password" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="至少 8 个字符"></label>
        <label>确认密码<input id="cloud-offline-setup-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="再次输入密码"></label>
        <button type="submit" class="button cloud-auth-submit cloud-login-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在保存…' : '保存离线管理员'}</button>
      </form>
      <div class="cloud-auth-switch"><button type="button" data-action="cloud-mode" data-value="login">返回账号登录</button></div>`;
    }

    function renderGate() {
      const gate = q('#auth-gate');
      if (!gate) return;
      document.body.classList.add('auth-locked');
      if (state.checking) {
        gate.innerHTML = `<section class="cloud-auth-card cloud-auth-checking"><span class="spinner"></span><strong>正在自动登录…</strong><p>正在确认本机登录状态，请稍候</p></section>`;
        return;
      }
      gate.innerHTML = `<section class="cloud-auth-card">
        <header class="cloud-auth-brand"><span class="brand-mark">谢</span><div><strong>谢谢工作台</strong></div><span class="cloud-auth-service ${state.error ? 'offline' : 'online'}"><i></i>${state.error ? '服务待确认' : '全域中枢'}</span></header>
        <div class="cloud-auth-content">
          <aside class="cloud-auth-welcome"><span class="eyebrow">THANK YOU WORKBENCH</span><h1>欢迎主人回来，<br>今天也要开心哦！</h1><p>爆单！爆单！爆单！<br>面包牛奶通通都有！</p></aside>
          <div class="cloud-auth-panel cloud-modern-panel">${modeTabs()}${errorHtml()}${infoHtml()}${state.mode === 'login' ? loginForm() : state.mode === 'register' ? registerForm() : state.mode === 'offline' ? offlineLoginForm() : state.mode === 'offlineSetup' ? offlineSetupForm() : activateForm()}</div>
        </div>
      </section>`;
    }

    function managementTabs() {
      const items = [['mine', '我的']];
      if (canViewPeople()) items.push(['users', '成员']);
      if (canManagePositions()) items.push(['positions', '系统层级']);
      if (canViewStores()) items.push(['stores', '店铺管理']);
      return `<div class="segmented cloud-account-tabs">${items.map(([id, label]) => `<button type="button" data-action="cloud-tab" data-value="${id}" class="${state.tab === id ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>`;
    }

    function mineView() {
      const session = state.session || {};
      const user = session.user || {};
      const company = session.company || {};
      const department = session.department?.name || session.department?.id || '未分配部门';
      const team = session.team?.name || session.team?.id || '未分配小组';
      const currentName = String(state.profilePreferences?.displayName || user.display_name || user.login_id || '').trim();
      const avatar = profileAvatar();
      return panel('我的', '', `<div class="panel-body cloud-profile">
        <div class="cloud-profile-hero">
          <label class="cloud-profile-avatar" title="选择头像">
            ${avatar ? `<img src="${esc(avatar)}" alt="当前头像">` : `<span>${esc(displayInitial(currentName))}</span>`}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-profile-avatar aria-label="选择头像">
            <em>更换头像</em>
          </label>
          <div class="cloud-profile-identity">
            <strong>${esc(currentName || '当前用户')}</strong>
            <span>${esc(user.login_id || '')}</span>
            <small>${esc(company.name || '')} · ${esc(department)} / ${esc(team)}</small>
          </div>
        </div>
        <div class="cloud-profile-form">
          <div class="field">
            <label for="cloud-profile-name">姓名</label>
            <input id="cloud-profile-name" value="${esc(currentName)}" maxlength="80" placeholder="输入工作台显示姓名">
          </div>
          <div class="field">
            <label>登录账号</label>
            <input value="${esc(user.login_id || '')}" readonly aria-readonly="true">
          </div>
        </div>
        <div class="actions cloud-profile-actions">
          ${button('保存头像和姓名', 'cloud-save-profile', { primary: true })}
          ${avatar ? button('恢复默认头像', 'cloud-clear-avatar', { small: true }) : ''}
        </div>
        <div class="cloud-profile-security">
          <div><strong>登录密码</strong></div>
          ${button(state.offlineAdmin ? '单机版无需登录密码' : '修改密码', 'cloud-change-password', { small: true, disabled: state.offlineAdmin })}
        </div>
        <div class="cloud-profile-security">
          <div><strong>退出工作台账号</strong></div>
          ${button('退出工作台账号', 'cloud-logout', { danger: true, small: true })}
        </div>
      </div>`);
    }

    function positionsView() {
      if (state.loading) return `<div class="loading"><span class="spinner"></span>正在读取职位…</div>`;
      const roleOrder = [['general_manager', '总经理'], ['department_manager', '部门主管'], ['team_leader', '组长'], ['member', '组员']];
      const ownerLabel = systemRoleLabel('owner', '老板');
      const baseOrders = { owner: 0, general_manager: 10, department_manager: 20, team_leader: 30, member: 40 };
      const nodes = [
        { kind: 'owner', id: 'owner', role: 'owner', name: ownerLabel, order: 0, caption: state.session?.company?.name || '本公司' },
        ...roleOrder.map(([role, label]) => ({ kind: 'base', id: `base:${role}`, role, name: systemRoleLabel(role, label), order: baseOrders[role], caption: `组织能力：${label}` })),
        ...state.positions.map(item => ({
          kind: 'custom',
          id: item.id,
          role: item.base_role,
          name: item.name,
          order: Number(item.sort_order || baseOrders[item.base_role] || 40),
          caption: `${item.department_name || '公司通用'} · ${Number(item.assigned_count || 0)} 人`,
          item,
        })),
      ].sort((left, right) => left.order - right.order || String(left.name).localeCompare(String(right.name), 'zh-CN'));
      const chain = nodes.map((node, index) => {
        const nextOrder = nodes.slice(index + 1).map(item => item.order).find(order => order > node.order);
        const insertOrder = nextOrder === undefined ? node.order + 0.5 : (node.order + nextOrder) / 2;
        const insertAttrs = `data-role="${esc(node.role)}" data-after-id="${esc(node.kind === 'custom' ? node.id : '')}" data-sort-order="${insertOrder}"`;
        if (node.kind === 'owner') {
          return `<div class="cloud-level-chain-node owner"><span class="cloud-level-chain-icon">司</span><div class="cloud-level-node-copy"><strong>${esc(node.name)}</strong><small>${esc(node.caption)}</small></div><div class="actions">${button('重命名', 'cloud-edit-system-level', { small: true, attrs: `data-role="owner" data-label="${esc(node.name)}"` })}</div></div>`;
        }
        if (node.kind === 'base') {
          return `<div class="cloud-level-chain-node base"><span class="cloud-level-chain-icon">层</span><div class="cloud-level-node-copy"><strong>${esc(node.name)}</strong><small>${esc(node.caption)}</small></div><div class="actions">${button('重命名', 'cloud-edit-system-level', { small: true, attrs: `data-role="${esc(node.role)}" data-label="${esc(node.name)}"` })}${button('下方插入层级', 'cloud-insert-position', { small: true, attrs: insertAttrs })}</div></div>`;
        }
        const item = node.item;
        const actions = [
          button('重命名', 'cloud-edit-position', { small: true, attrs: `data-id="${esc(item.id)}"` }),
          button('统一权限', 'cloud-position-permissions', { small: true, attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name)}" data-department="${esc(item.department_id || '')}"` }),
          button('下方插入层级', 'cloud-insert-position', { small: true, attrs: insertAttrs }),
          button(item.active === false ? '启用' : '停用', 'cloud-toggle-position', { small: true, attrs: `data-id="${esc(item.id)}" data-active="${item.active === false ? 'false' : 'true'}"` }),
          button('删除', 'cloud-delete-position', { small: true, danger: true, attrs: `data-id="${esc(item.id)}" data-name="${esc(item.name)}"` }),
        ].join('');
        return `<div class="cloud-level-chain-node custom${item.active === false ? ' disabled' : ''}"><span class="cloud-level-chain-dot"></span><div class="cloud-level-node-copy"><strong>${esc(node.name)}</strong><small>${esc(node.caption)}</small></div>${badge(item.active === false ? '已停用' : '使用中', item.active === false ? '' : 'good')}<div class="actions">${actions}</div></div>`;
      }).join('');
      return `<div class="cloud-org-head"><span>${state.positions.length} 个自定义层级 · 上下顺序可调整</span><div class="actions">${button('新增系统层级', 'cloud-new-position', { primary: true, small: true })}</div></div>
        <div class="cloud-position-note">${svg('info')}<span>层级按从上到下排列。基础组织能力可以重命名；自定义层级可以重命名、插入、调序、停用和删除。</span></div>
        <div class="cloud-level-chain-wrap"><div class="cloud-level-chain">${chain}</div></div>`;
    }

    function manageableStorePeople() {
      return state.users.filter(item => (
        item.status === 'active'
        && canManageMember(item)
      ));
    }

    function storeAccessForUser(store, user) {
      const role = String(user?.base_role || user?.role || 'member');
      if (['owner', 'general_manager'].includes(role)) {
        return { authorized: true, direct: false, source: role === 'owner' ? '公司老板默认' : '总经理默认' };
      }
      const grants = Array.isArray(store?.grants) ? store.grants : [];
      const direct = grants.find(grant => grant.scope_type === 'user' && String(grant.scope_id) === String(user?.id || ''));
      if (direct) return { authorized: true, direct: true, source: direct.scope_name || '直接授权', grant: direct };
      const departmentIds = ancestorDepartmentIds(user?.department_id || '');
      if (['department_manager', 'team_leader'].includes(role)) {
        const departmentGrant = grants.find(grant => grant.scope_type === 'department' && departmentIds.has(String(grant.scope_id || '')));
        if (departmentGrant) return { authorized: true, direct: false, source: `部门：${departmentGrant.scope_name || '已授权'}`, grant: departmentGrant };
      }
      if (role === 'team_leader') {
        const teamGrant = grants.find(grant => grant.scope_type === 'team' && user?.team_id && String(grant.scope_id) === String(user.team_id));
        if (teamGrant) return { authorized: true, direct: false, source: `小组：${teamGrant.scope_name || '已授权'}`, grant: teamGrant };
      }
      if (role === 'department_manager') {
        const departmentTeamIds = new Set((state.organization?.departments || [])
          .filter(item => descendantDepartmentIds(user.department_id).has(String(item.id)))
          .flatMap(item => (item.teams || []).map(team => String(team.id))));
        const teamGrant = grants.find(grant => grant.scope_type === 'team' && departmentTeamIds.has(String(grant.scope_id || '')));
        if (teamGrant) return { authorized: true, direct: false, source: `小组：${teamGrant.scope_name || '已授权'}`, grant: teamGrant };
      }
      return { authorized: false, direct: false, source: '' };
    }

    function selectedOrganizationPeople() {
      const selected = new Set([...state.storeMemberSelection].map(String));
      return state.users.filter(item => selected.has(String(item.id)) && canManageMember(item));
    }

    function organizationStoreSelection() {
      const stores = state.managedStores;
      const people = selectedOrganizationPeople();
      const active = String(state.storeOrgFilter || '');
      const selected = new Set();
      if (people.length === 1) {
        const person = people[0];
        for (const store of stores) {
          if (storeAccessForUser(store, person).authorized) selected.add(String(store.id));
        }
      } else if (people.length > 1) {
        for (const store of stores) {
          if (people.every(person => {
            const access = storeAccessForUser(store, person);
            return access.authorized && access.direct;
          })) selected.add(String(store.id));
        }
      } else if (active.startsWith('department:') || active.startsWith('team:')) {
        const [scopeType, scopeId] = active.split(':');
        for (const store of stores) {
          if ((store.grants || []).some(grant => (
            String(grant.scope_type || '') === scopeType
            && String(grant.scope_id || '') === scopeId
          ))) selected.add(String(store.id));
        }
      }
      return selected;
    }

    function syncOrganizationStoreSelection() {
      state.storeSelection = organizationStoreSelection();
    }

    function storeAccessTabsHtml() {
      const mode = state.storeAccessMode === 'store' ? 'store' : state.storeAccessMode === 'person' ? 'person' : 'organization';
      return `<nav class="cloud-store-access-tabs" aria-label="店铺授权方式">${[
        ['organization', '按组织授权'],
        ['person', '按人授权'],
        ['store', '按店授权'],
      ].map(([value, label]) => button(label, 'cloud-store-access-mode', {
        small: true,
        primary: mode === value,
        attrs: `data-value="${value}" aria-pressed="${mode === value ? 'true' : 'false'}"`,
      })).join('')}</nav>`;
    }

    function storePersonAccessView() {
      const people = manageableStorePeople();
      const personQuery = String(state.storeAccessPersonSearch || '').trim().toLowerCase();
      const availableQuery = String(state.storeAccessAvailableSearch || '').trim().toLowerCase();
      const visiblePeople = people.filter(item => !personQuery || [
        memberName(item), item.login_id, item.department_name, item.team_name, memberRoleName(item),
      ].some(value => String(value || '').toLowerCase().includes(personQuery)));
      const selectedPerson = people.find(item => String(item.id) === String(state.storeAccessPersonId))
        || visiblePeople[0]
        || people[0]
        || null;
      const stores = state.managedStores;
      const accessRows = selectedPerson
        ? stores.map(store => ({ store, access: storeAccessForUser(store, selectedPerson) }))
        : [];
      const authorized = accessRows.filter(row => row.access.authorized);
      const unauthorized = accessRows.filter(row => (
        !row.access.authorized
        && (!availableQuery || String(row.store.name || '').toLowerCase().includes(availableQuery))
      ));
      const personCard = item => {
        const selected = String(item.id) === String(selectedPerson?.id || '');
        return `<button type="button" class="cloud-store-access-person${selected ? ' active' : ''}" data-action="cloud-store-access-person" data-id="${esc(item.id)}"><span class="cloud-member-avatar">${esc(displayInitial(memberName(item)))}</span><span><b>${esc(memberName(item))}</b></span></button>`;
      };
      const authorizedStore = ({ store, access }) => `<div class="cloud-store-access-store authorized"><span class="store-avatar">${esc(displayInitial(store.name))}</span><span class="cloud-store-access-copy"><b>${esc(store.name)}</b></span>${access.direct && canAssignStores() ? `<button type="button" class="cloud-store-card-action danger-link" data-action="cloud-store-user-revoke" data-store-id="${esc(store.id)}" data-user-id="${esc(selectedPerson.id)}">移除</button>` : ''}</div>`;
      const unauthorizedStore = ({ store }) => `<div class="cloud-store-access-store"><span class="store-avatar">${esc(displayInitial(store.name))}</span><span class="cloud-store-access-copy"><b>${esc(store.name)}</b></span>${canAssignStores() ? `<button type="button" class="button small primary cloud-store-card-action" data-action="cloud-store-user-grant" data-store-id="${esc(store.id)}" data-user-id="${esc(selectedPerson.id)}">添加</button>` : ''}</div>`;
      return `<div class="cloud-store-query-layout">
        <section class="cloud-store-query-column"><header><b>员工</b><span>${people.length} 人</span></header><input type="search" data-store-access-search="person" value="${esc(state.storeAccessPersonSearch || '')}" placeholder="搜索员工、部门或职位"><div class="cloud-store-query-list">${visiblePeople.map(personCard).join('') || '<div class="cloud-members-empty">没有可授权的下级员工</div>'}</div></section>
        <section class="cloud-store-query-column"><header><b>已授权店铺</b><span>${selectedPerson ? memberName(selectedPerson) : '请选择员工'} · ${authorized.length} 家</span></header><div class="cloud-store-query-list">${authorized.map(authorizedStore).join('') || '<div class="cloud-members-empty">该员工还没有已授权店铺</div>'}</div></section>
        <section class="cloud-store-query-column"><header><b>未授权店铺</b><span>仅显示你有权限的店铺</span></header><input type="search" data-store-access-search="available" value="${esc(state.storeAccessAvailableSearch || '')}" placeholder="搜索未授权店铺"><div class="cloud-store-query-list">${unauthorized.map(unauthorizedStore).join('') || '<div class="cloud-members-empty">没有可添加的店铺</div>'}</div></section>
      </div>`;
    }

    function storePeopleAccessView() {
      const people = manageableStorePeople();
      const storeQuery = String(state.storeAccessStoreSearch || '').trim().toLowerCase();
      const peopleQuery = String(state.storeAccessAvailableSearch || '').trim().toLowerCase();
      const visibleStores = state.managedStores.filter(item => (
        !storeQuery || [item.name, ...(item.grants || []).map(grant => grant.scope_name)]
          .some(value => String(value || '').toLowerCase().includes(storeQuery))
      ));
      const selectedStore = visibleStores.find(item => String(item.id) === String(state.storeAccessStoreId))
        || visibleStores[0]
        || state.managedStores[0]
        || null;
      const accessRows = selectedStore
        ? people.map(user => ({ user, access: storeAccessForUser(selectedStore, user) }))
        : [];
      const authorized = accessRows.filter(row => row.access.authorized);
      const unauthorized = accessRows
        .filter(row => !row.access.authorized)
        .filter(row => !peopleQuery || [memberName(row.user), row.user.login_id, row.user.department_name, row.user.team_name, memberRoleName(row.user)]
          .some(value => String(value || '').toLowerCase().includes(peopleQuery)));
      const storeCard = item => {
        const selected = String(item.id) === String(selectedStore?.id || '');
        return `<button type="button" class="cloud-store-access-person${selected ? ' active' : ''}" data-action="cloud-store-access-store" data-id="${esc(item.id)}"><span class="store-avatar">${esc(displayInitial(item.name))}</span><span><b>${esc(item.name)}</b></span></button>`;
      };
      const personInfo = item => `<span class="cloud-member-avatar">${esc(displayInitial(memberName(item)))}</span><span class="cloud-store-access-copy"><b>${esc(memberName(item))}</b></span>`;
      const authorizedPerson = ({ user, access }) => `<div class="cloud-store-access-store authorized">${personInfo(user)}${access.direct && canAssignStores() ? `<button type="button" class="cloud-store-card-action danger-link" data-action="cloud-store-user-revoke" data-store-id="${esc(selectedStore.id)}" data-user-id="${esc(user.id)}">移除</button>` : ''}</div>`;
      const unauthorizedPerson = ({ user }) => `<div class="cloud-store-access-store">${personInfo(user)}${canAssignStores() ? `<button type="button" class="button small primary cloud-store-card-action" data-action="cloud-store-user-grant" data-store-id="${esc(selectedStore.id)}" data-user-id="${esc(user.id)}">添加</button>` : ''}</div>`;
      return `<div class="cloud-store-query-layout">
        <section class="cloud-store-query-column"><header><b>店铺</b><span>${state.managedStores.length} 家</span></header><input type="search" data-store-access-search="store" value="${esc(state.storeAccessStoreSearch || '')}" placeholder="搜索店铺或授权范围"><div class="cloud-store-query-list">${visibleStores.map(storeCard).join('') || '<div class="cloud-members-empty">没有可管理的授权店铺</div>'}</div></section>
        <section class="cloud-store-query-column"><header><b>已授权人员</b><span>${selectedStore ? selectedStore.name : '请选择店铺'} · ${authorized.length} 人</span></header><div class="cloud-store-query-list">${authorized.map(authorizedPerson).join('') || '<div class="cloud-members-empty">这家店铺还没有授权人员</div>'}</div></section>
        <section class="cloud-store-query-column"><header><b>未授权人员</b><span>只显示你可以授权的下级</span></header><input type="search" data-store-access-search="available" value="${esc(state.storeAccessAvailableSearch || '')}" placeholder="搜索未授权人员"><div class="cloud-store-query-list">${unauthorized.map(unauthorizedPerson).join('') || '<div class="cloud-members-empty">没有可添加的人员</div>'}</div></section>
      </div>`;
    }

    function storeManagementView() {
      if (state.loading) return `<div class="loading"><span class="spinner"></span>正在读取店铺授权…</div>`;
      const accessTabs = storeAccessTabsHtml();
      if (state.storeAccessMode === 'person') return `${accessTabs}${storePersonAccessView()}`;
      if (state.storeAccessMode === 'store') return `${accessTabs}${storePeopleAccessView()}`;
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const departmentQuery = String(state.storeDepartmentSearch || '').trim().toLowerCase();
      const peopleQuery = String(state.storePeopleSearch || '').trim().toLowerCase();
      const storeQuery = String(state.storeNameSearch || '').trim().toLowerCase();
      const departmentChildren = new Map();
      for (const item of departments) {
        const parent = String(item.parent_department_id || '');
        if (!departmentChildren.has(parent)) departmentChildren.set(parent, []);
        departmentChildren.get(parent).push(item);
      }
      const activeScope = String(state.storeOrgFilter || '');
      const scopedDepartmentIds = activeScope.startsWith('department:')
        ? descendantDepartmentIds(activeScope.slice('department:'.length))
        : new Set();
      const storeMembers = state.users.filter(item => {
        if (!canManageMember(item)) return false;
        if (peopleQuery && ![memberName(item), item.login_id, memberRoleName(item)]
          .some(value => String(value || '').toLowerCase().includes(peopleQuery))) return false;
        if (!activeScope) return true;
        if (activeScope.startsWith('department:')) return scopedDepartmentIds.has(String(item.department_id || ''));
        if (activeScope.startsWith('team:')) return String(item.team_id || '') === activeScope.slice('team:'.length);
        return true;
      });
      const renderStoreDepartment = (department, level = 0) => {
        const children = departmentChildren.get(String(department.id)) || [];
        const teams = (Array.isArray(department.teams) ? department.teams : [])
          .filter(team => !departmentQuery || String(team.name || '').toLowerCase().includes(departmentQuery));
        const matchingChildren = children.filter(child => departmentSearchMatches(child));
        if (departmentQuery && !String(department.name || '').toLowerCase().includes(departmentQuery)
          && !teams.length && !matchingChildren.length) return '';
        return `<div class="cloud-store-tree-group" style="--store-level:${level}">
          <button type="button" class="cloud-store-tree-row${activeScope === `department:${department.id}` ? ' active' : ''}" data-action="cloud-store-scope" data-value="department:${esc(department.id)}">${esc(department.name)}<small>部门</small></button>
          <div class="cloud-store-tree-children">
            ${teams.map(team => `<button type="button" class="cloud-store-tree-row team${activeScope === `team:${team.id}` ? ' active' : ''}" data-action="cloud-store-scope" data-value="team:${esc(team.id)}">${esc(team.name)}<small>小组</small></button>`).join('')}
            ${children.map(child => renderStoreDepartment(child, level + 1)).join('')}
          </div>
        </div>`;
      };
      const departmentSearchMatches = department => {
        if (!departmentQuery) return true;
        if (String(department.name || '').toLowerCase().includes(departmentQuery)) return true;
        if ((department.teams || []).some(team => String(team.name || '').toLowerCase().includes(departmentQuery))) return true;
        return departments
          .filter(item => String(item.parent_department_id || '') === String(department.id))
          .some(departmentSearchMatches);
      };
      const departmentIds = new Set(departments.map(item => String(item.id)));
      const rootDepartments = departments.filter(item => !item.parent_department_id || !departmentIds.has(String(item.parent_department_id)));
      const selectedStores = state.storeSelection;
      const selectedMembers = state.storeMemberSelection;
      const allStoreSelected = state.managedStores.length > 0 && state.managedStores.every(item => selectedStores.has(String(item.id)));
      const visibleStores = state.managedStores.filter(item => (
        !storeQuery
        || String(item.name || '').toLowerCase().includes(storeQuery)
        || (item.default_all && '全公司老板默认'.includes(storeQuery))
        || (item.grants || []).some(grant => String(grant.scope_name || '').toLowerCase().includes(storeQuery))
      ));
      const scopeLabel = activeScope.startsWith('department:')
        ? `部门：${departments.find(item => `department:${item.id}` === activeScope)?.name || '未选择'}`
        : activeScope.startsWith('team:')
          ? `小组：${departments.flatMap(item => item.teams || []).find(item => `team:${item.id}` === activeScope)?.name || '未选择'}`
          : '全公司';
      const selectedPeople = selectedOrganizationPeople();
      const canSaveForTarget = Boolean(
        selectedMembers.size
        || activeScope.startsWith('department:')
        || activeScope.startsWith('team:')
      );
      return `${accessTabs}<div class="cloud-org-head"><span>按部门或小组批量授权；未选择成员时，授权给当前部门或小组。</span><div class="actions">${hasPermission('workbench.accounts.add') ? button('新增店铺', 'cloud-store-add', { primary: true, small: true }) : ''}</div></div>
        <div class="cloud-store-management">
          <aside class="cloud-store-organizations">
            <div class="cloud-store-column-title">组织结构</div>
            <input class="cloud-store-search" type="search" data-store-search="department" value="${esc(state.storeDepartmentSearch || '')}" placeholder="搜索部门或小组">
            <button type="button" class="cloud-store-tree-row${!activeScope ? ' active' : ''}" data-action="cloud-store-scope" data-value="">全公司<small>公司</small></button>
            ${rootDepartments.map(item => renderStoreDepartment(item)).join('') || '<span class="cloud-members-tree-empty">暂无部门</span>'}
          </aside>
          <section class="cloud-store-people">
            <div class="cloud-store-column-title">人员<button type="button" data-action="cloud-store-members-all">全选当前人员</button></div>
            <input class="cloud-store-search" type="search" data-store-search="people" value="${esc(state.storePeopleSearch || '')}" placeholder="搜索姓名、账号或职位">
            <div class="cloud-store-choice-list">
              ${storeMembers.map(item => `<label class="cloud-store-choice${selectedMembers.has(String(item.id)) ? ' selected' : ''}"><input type="checkbox" data-action="cloud-store-member-select" data-id="${esc(item.id)}"${selectedMembers.has(String(item.id)) ? ' checked' : ''}><span class="cloud-member-avatar">${esc(displayInitial(memberName(item)))}</span><span><b>${esc(memberName(item))}</b><small>${esc(memberRoleName(item))}</small></span></label>`).join('') || '<div class="cloud-members-empty">当前层级没有可授权成员</div>'}
            </div>
          </section>
          <section class="cloud-store-list-panel">
            <div class="cloud-store-column-title">店铺<button type="button" data-action="cloud-store-select-all">${allStoreSelected ? '清空店铺' : '全选店铺'}</button></div>
            <input class="cloud-store-search" type="search" data-store-search="store" value="${esc(state.storeNameSearch || '')}" placeholder="搜索店铺或授权范围">
            <div class="cloud-store-choice-list">
              ${visibleStores.map(item => {
                const inheritedLocked = selectedPeople.length === 1 && (() => {
                  const access = storeAccessForUser(item, selectedPeople[0]);
                  return access.authorized && !access.direct;
                })();
                return `<div class="cloud-store-choice store${selectedStores.has(String(item.id)) ? ' selected' : ''}"><input type="checkbox" data-action="cloud-store-select" data-id="${esc(item.id)}"${selectedStores.has(String(item.id)) ? ' checked' : ''}${canAssignStores() && !inheritedLocked ? '' : ' disabled'}${inheritedLocked ? ' title="该店铺由部门或小组继承授权，请在对应组织范围调整"' : ''}><span class="store-avatar">${esc(displayInitial(item.name))}</span><span><b>${esc(item.name)}</b></span>${hasPermission('workbench.accounts.remove') ? `<button type="button" class="danger-link" data-action="cloud-store-remove" data-id="${esc(item.id)}" data-name="${esc(item.name)}">移除</button>` : ''}</div>`;
              }).join('') || '<div class="cloud-members-empty">没有符合条件的店铺</div>'}
            </div>
          </section>
        </div>
        <div class="cloud-store-actions"><span>当前授权范围：<b>${esc(scopeLabel)}</b>${selectedMembers.size ? ` · ${selectedMembers.size} 位成员` : ' · 整个范围'}</span>${canAssignStores() ? `<button type="button" class="button primary" data-action="cloud-store-save"${!canSaveForTarget ? ' disabled' : ''}>保存店铺授权</button>` : '<span class="cloud-readonly-badge">只读</span>'}</div>`;
    }

    function pendingView() {
      if (state.loading) return `<div class="loading"><span class="spinner"></span>正在读取待审核账号…</div>`;
      if (!state.pending.length) return empty('没有待审核账号', '员工提交注册申请后会出现在这里。');
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const departmentNames = new Map(departments.map(item => [item.id, item.name]));
      const teamNames = new Map(departments.flatMap(department => (department.teams || []).map(team => [team.id, team.name])));
      return `<div class="cloud-review-list">${state.pending.map(item => {
        const department = departmentNames.get(item.department_id) || (item.department_id ? `部门 ${item.department_id}` : '未选择部门');
        const team = teamNames.get(item.team_id) || (item.team_id ? `小组 ${item.team_id}` : '未选择小组');
        return `<article class="cloud-review-item"><div><strong>${esc(item.display_name || item.login_id || '—')}</strong><small>${esc(item.login_id || '')} · ${esc(item.application_name || item.app_id || '谢谢工作台')}</small></div><div class="cloud-review-meta"><span>${esc(department)} / ${esc(team)}</span><small>${esc(item.created_at || item.createdAt || '—')}</small></div><div class="actions">${button('审核通过', 'cloud-approve', { primary: true, small: true, attrs: `data-id="${esc(item.id || item.user_id || '')}"` })}${button('拒绝', 'cloud-reject', { danger: true, small: true, attrs: `data-id="${esc(item.id || item.user_id || '')}"` })}</div></article>`;
      }).join('')}</div>`;
    }

    async function openPendingReview() {
      if (!canReviewApprovals()) return;
      await modal({
        title: `审核注册成员${state.pending.length ? ` · ${state.pending.length}` : ''}`,
        fields: `<div class="cloud-review-dialog">${pendingView()}</div>`,
        confirm: '关闭',
      });
    }

    function usersView() {
      if (state.loading) return `<div class="loading"><span class="spinner"></span>正在读取成员…</div>`;
      if (!state.users.length) return empty('还没有可管理成员', '可以新增成员，或等待注册申请审核通过。', canAddMembers() ? button('新增成员', 'cloud-create-user', { primary: true }) : '', 'users');
      const query = String(state.memberSearch || '').trim().toLowerCase();
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const departmentMap = new Map(departments.map(item => [item.id, item]));
      const teamMap = new Map(departments.flatMap(department => (department.teams || []).map(team => [String(team.id), { ...team, departmentId: String(department.id), departmentName: department.name }])));
      const orgVisible = state.users.filter(item => {
        const filter = String(state.orgFilter || 'all');
        if (filter === 'all') return true;
        if (filter === 'department:unassigned') return !item.department_id;
        if (filter.startsWith('department:')) return String(item.department_id || '') === filter.slice('department:'.length);
        if (filter.startsWith('team:')) return String(item.team_id || '') === filter.slice('team:'.length);
        return true;
      });
      const visibleUsers = orgVisible.filter(item => {
        if (state.memberStatusFilter !== 'all' && String(item.status || '') !== String(state.memberStatusFilter)) return false;
        if (!query) return true;
        return [memberName(item), item.display_name, item.login_id, memberRoleName(item), item.role, item.department_name, item.team_name]
          .some(value => String(value || '').toLowerCase().includes(query));
      });
      const selectedIds = selectedMemberIds();
      const selectedSet = new Set(selectedIds.map(String));
      const selectionBox = item => `<input class="cloud-tree-select" type="checkbox" data-action="cloud-member-select" data-id="${esc(item.id)}"${selectedSet.has(String(item.id)) ? ' checked' : ''}${canManageMember(item) ? '' : ' disabled'} aria-label="选择 ${esc(memberName(item))}">`;
      const departmentChildren = new Map();
      for (const department of departments) {
        const parentId = String(department.parent_department_id || '');
        if (!departmentChildren.has(parentId)) departmentChildren.set(parentId, []);
        departmentChildren.get(parentId).push(department);
      }
      const renderDepartmentTree = (department, level = 0) => {
        const deptUsers = state.users.filter(item => String(item.department_id || '') === String(department.id));
        const teams = (department.teams || []).map(team => ({ ...team, count: deptUsers.filter(item => String(item.team_id || '') === String(team.id)).length }));
        const unassignedCount = deptUsers.filter(item => !item.team_id).length;
        const children = departmentChildren.get(String(department.id)) || [];
        const descendantIds = descendantDepartmentIds(department.id);
        const totalCount = state.users.filter(item => descendantIds.has(String(item.department_id || ''))).length;
        return `<div class="cloud-members-tree-department" style="--tree-level:${level}">
          <div class="cloud-members-tree-row" data-cloud-context="department" data-id="${esc(department.id)}" data-parent-id="${esc(department.parent_department_id || '')}" data-label="${esc(department.name)}" data-active="${department.active === false ? 'false' : 'true'}">
            <span class="cloud-members-tree-caret" aria-hidden="true">${children.length || teams.length ? '⌄' : '•'}</span>
            <button type="button" class="cloud-members-tree-item department${state.orgFilter === `department:${department.id}` ? ' active' : ''}" data-action="cloud-org-filter" data-value="department:${esc(department.id)}" data-cloud-context="department" data-id="${esc(department.id)}" data-parent-id="${esc(department.parent_department_id || '')}" data-label="${esc(department.name)}" data-active="${department.active === false ? 'false' : 'true'}">
              <span>${esc(department.name)}</span><b>${totalCount}</b>
            </button>
            ${canManageDepartments() ? `<button type="button" class="cloud-tree-more" data-action="cloud-tree-menu" data-context-type="department" data-id="${esc(department.id)}" data-parent-id="${esc(department.parent_department_id || '')}" data-label="${esc(department.name)}" data-active="${department.active === false ? 'false' : 'true'}" aria-label="编辑部门" aria-haspopup="menu">☰</button>` : ''}
          </div>
          <div class="cloud-members-tree-children">
            ${teams.map(team => `<div class="cloud-members-tree-team-row" data-cloud-context="team" data-id="${esc(team.id)}" data-label="${esc(team.name)}" data-department-id="${esc(department.id)}" data-active="${team.active === false ? 'false' : 'true'}"><button type="button" class="cloud-members-tree-item team${state.orgFilter === `team:${team.id}` ? ' active' : ''}" data-action="cloud-org-filter" data-value="team:${esc(team.id)}" data-cloud-context="team" data-id="${esc(team.id)}" data-label="${esc(team.name)}" data-department-id="${esc(department.id)}" data-active="${team.active === false ? 'false' : 'true'}"><span>${esc(team.name)}</span><b>${team.count}</b></button>${canManageTeams() ? `<button type="button" class="cloud-tree-more" data-action="cloud-tree-menu" data-context-type="team" data-id="${esc(team.id)}" data-label="${esc(team.name)}" data-department-id="${esc(department.id)}" data-active="${team.active === false ? 'false' : 'true'}" aria-label="编辑小组" aria-haspopup="menu">☰</button>` : ''}</div>`).join('')}
            ${unassignedCount ? `<button type="button" class="cloud-members-tree-item team" data-action="cloud-org-filter" data-value="department:${esc(department.id)}"><span>未分配小组</span><b>${unassignedCount}</b></button>` : ''}
            ${children.map(child => renderDepartmentTree(child, level + 1)).join('')}
          </div>
        </div>`;
      };
      const departmentIds = new Set(departments.map(item => String(item.id)));
      const rootDepartments = departments.filter(item => !item.parent_department_id || !departmentIds.has(String(item.parent_department_id)));
      const departmentTree = rootDepartments.map(department => renderDepartmentTree(department)).join('');
      const unassignedUsers = state.users.filter(item => !item.department_id);
      const treeSidebar = `<aside class="cloud-members-sidebar">
        ${canManageDepartments() ? `<button type="button" class="cloud-members-new-department" data-action="cloud-new-department">＋ 新建部门</button>` : ''}
        <div class="cloud-members-tree-title"><span>我的团队</span><small>${state.users.length} 人</small></div>
        <button type="button" class="cloud-members-tree-item all${state.orgFilter === 'all' ? ' active' : ''}" data-action="cloud-org-filter" data-value="all"><span>全部成员</span><b>${state.users.length}</b></button>
        ${departmentTree}
        ${unassignedUsers.length ? `<div class="cloud-members-tree-department"><button type="button" class="cloud-members-tree-item department${state.orgFilter === 'department:unassigned' ? ' active' : ''}" data-action="cloud-org-filter" data-value="department:unassigned"><span>未分配部门</span><b>${unassignedUsers.length}</b></button></div>` : ''}
      </aside>`;
      const rows = visibleUsers.map(item => {
        const departmentName = departmentMap.get(item.department_id)?.name || item.department_name || '未分配部门';
        const team = teamMap.get(String(item.team_id || ''));
        const teamName = team?.name || item.team_name || '未分配小组';
        const canSetPermissions = item.status === 'active' && canAssignPermissions() && canManageMember(item);
        const canSetPosition = item.status === 'active' && canAssignPermissions() && canManageMember(item);
        return `<tr class="${selectedSet.has(String(item.id)) ? 'selected' : ''}" data-cloud-context="member" data-id="${esc(item.id)}" data-label="${esc(memberName(item))}">
          <td class="select-cell">${selectionBox(item)}</td>
          <td><div class="cloud-member-table-person"><span class="cloud-member-avatar">${item.id === state.session?.user?.id && profileAvatar() ? `<img src="${esc(profileAvatar())}" alt="">` : esc(displayInitial(memberName(item)))}</span><div><strong>${esc(memberName(item))}</strong><small>${esc(item.login_id || '')}</small></div></div></td>
          <td><span class="cell-main">${esc(departmentName)}</span><span class="cell-sub">${esc(teamName)}</span></td>
          <td>${esc(memberRoleName(item))}</td>
          <td>${badge(item.status === 'active' ? '已启用' : (item.status_name || item.status || '—'), item.status === 'active' ? 'good' : item.status === 'pending' ? 'warn' : '')}</td>
          <td class="cloud-member-last-login">${esc(item.last_login_at || '最近未登录')}</td>
          <td class="cloud-member-operation">${canSetPermissions ? `<button type="button" data-action="cloud-member-permissions" data-id="${esc(item.id)}" data-name="${esc(memberName(item))}">设置权限</button>` : ''}${canSetPosition ? `<button type="button" data-action="cloud-member-position" data-id="${esc(item.id)}" data-name="${esc(memberName(item))}" data-role="${esc(item.role || '')}" data-position="${esc(item.position_id || '')}">调整职位</button>` : ''}${canEditMembers() && canManageMember(item) ? `<button type="button" data-action="cloud-edit-member-info" data-id="${esc(item.id)}" data-name="${esc(memberName(item))}">修改信息</button>` : ''}${canMoveMembers() && canManageMember(item) ? `<button type="button" data-action="cloud-move-members" data-id="${esc(item.id)}">移动</button>` : ''}</td>
        </tr>`;
      }).join('');
      const selectableVisible = visibleUsers.filter(canManageMember);
      const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(item => selectedSet.has(String(item.id)));
      return `<div class="cloud-members-layout">${treeSidebar}<section class="cloud-members-main">
        <div class="cloud-members-filters"><label>状态<select data-member-status-filter><option value="all"${state.memberStatusFilter === 'all' ? ' selected' : ''}>全部状态</option><option value="active"${state.memberStatusFilter === 'active' ? ' selected' : ''}>已启用</option><option value="pending"${state.memberStatusFilter === 'pending' ? ' selected' : ''}>待审核</option><option value="disabled"${state.memberStatusFilter === 'disabled' ? ' selected' : ''}>已停用</option></select></label><label class="cloud-members-search">姓名 / 子账号<input type="search" data-member-search value="${esc(state.memberSearch || '')}" placeholder="搜索成员姓名、账号、部门或职位"></label><span>显示 ${visibleUsers.length} / ${state.users.length} 人</span></div>
        <div class="cloud-members-buttons"><div class="actions">${canReviewApprovals() ? button(`审核${state.pending.length ? ` ${state.pending.length}` : ''}`, 'cloud-open-review', { primary: true, small: true }) : ''}${canAddMembers() ? button('新增成员', 'cloud-create-user', { small: true }) : ''}${canViewOrganization() ? button('复制公司邀请码', 'cloud-copy-invite-code', { small: true }) : ''}${canManageDepartments() ? button('新建部门', 'cloud-new-department', { small: true }) : ''}${canManageTeams() ? button('新建组', 'cloud-new-team', { small: true }) : ''}${canAssignPermissions() ? button('权限模板', 'cloud-permission-templates', { small: true }) : ''}${canAssignPermissions() ? button('批量设置权限', 'cloud-batch-permissions', { small: true, disabled: !selectedIds.length }) : ''}${canAssignPermissions() ? button('批量调整职位', 'cloud-batch-position', { small: true, disabled: !selectedIds.length }) : ''}${canMoveMembers() ? button('批量移动', 'cloud-move-members', { small: true, disabled: !selectedIds.length }) : ''}${canDeleteMembers() ? button('批量删除', 'cloud-delete-members', { small: true, danger: true, disabled: !selectedIds.length }) : ''}</div><span>${selectedIds.length ? `已选择 ${selectedIds.length} 人` : '未选择成员'}</span></div>
        <div class="table-wrap cloud-members-table-wrap"><table class="cloud-members-table"><thead><tr><th class="select-cell"><input class="table-select" type="checkbox" data-action="cloud-member-group-select" data-ids="${esc(selectableVisible.map(item => item.id).join(','))}"${allVisibleSelected ? ' checked' : ''}${selectableVisible.length ? '' : ' disabled'} aria-label="选择当前表格全部成员"></th><th>姓名 / 子账号</th><th>部门</th><th>岗位</th><th>认证状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="cloud-members-empty">没有符合条件的成员</div></td></tr>'}</tbody></table></div>
      </section></div>`;
    }

    function renderPage() {
      if (!state.authenticated) return empty('尚未登录', '请先登录全域中枢。');
      const validTabs = ['mine', 'users', 'positions', 'stores'];
      if (!validTabs.includes(state.tab)) state.tab = 'mine';
      if (state.tab === 'users' && !canViewPeople()) state.tab = 'mine';
      if (state.tab === 'positions' && !canManagePositions()) state.tab = 'mine';
      if (state.tab === 'stores' && !canViewStores()) state.tab = 'mine';
      const errorBar = state.loadError
        ? `<div class="cloud-auth-inline-error">${notice(esc(state.loadError), 'warning')}${button('重新读取', 'cloud-refresh', { small: true })}</div>`
        : '';
      return managementTabs() + errorBar +
        (state.tab === 'mine' ? mineView() : state.tab === 'users' ? usersView() : state.tab === 'positions' ? positionsView() : storeManagementView());
    }

    function accountChipHtml() {
      if (!state.authenticated) return '';
      const user = state.session?.user || {}, company = state.session?.company || {};
      const name = profileName() || user.display_name || user.login_id || '当前用户';
      return `<button type="button" class="cloud-account-chip" data-action="navigate" data-page="cloudaccount" title="账号与权限 · ${esc(company.name || '')} · ${esc(user.login_id || '')}"><span>${profileAvatar() ? `<img src="${esc(profileAvatar())}" alt="">` : esc(displayInitial(name))}</span><span class="cloud-account-copy"><b>账号与权限</b><small>${esc(name)} · ${esc(company.name || '')}</small></span></button>`;
    }

    async function finishAuthentication(result) {
      state.authenticated = true;
      state.checking = false;
      state.session = result.session;
      state.config = result.config;
      state.offlineAdmin = Boolean(result.offlineAdmin || result.standalone);
      state.error = '';
      state.info = '';
      q('#auth-gate').innerHTML = '';
      document.body.classList.remove('auth-locked');
      if (permissionSyncTimer) clearInterval(permissionSyncTimer);
      permissionSyncTimer = setInterval(() => {
        void syncPermissionState().catch(() => {});
      }, 15000);
      await onAuthenticated();
      render();
    }

    async function syncPermissionState(force = false) {
      if (!state.authenticated || state.busy) return false;
      if (!force && Date.now() - lastPermissionSyncAt < 8000) return false;
      if (permissionSyncPromise) return permissionSyncPromise;
      permissionSyncPromise = (async () => {
        const me = await api('cloudauth.me');
        const previous = state.session || {};
        state.session = {
          ...previous,
          user: { ...(previous.user || {}), ...me, id: me.user_id || me.id },
          company: { ...(previous.company || {}), id: me.company_id },
          application: {
            ...(previous.application || {}),
            permissions: Array.isArray(me.application_permissions)
              ? me.application_permissions
              : (Array.isArray(previous.application?.permissions) ? previous.application.permissions : []),
            permission_source: me.application_permission_source || previous.application?.permission_source || 'workspace',
          },
          management_permissions: Array.isArray(me.management_permissions)
            ? me.management_permissions
            : (Array.isArray(previous.management_permissions) ? previous.management_permissions : []),
          department: me.department_id ? { id: me.department_id, name: me.department_name || '' } : null,
          team: me.team_id ? { id: me.team_id, name: me.team_name || '' } : null,
        };
        lastPermissionSyncAt = Date.now();
        if ((force || Date.now() - lastStoreAccessSyncAt > 30000) && typeof onStoresChanged === 'function') {
          await Promise.resolve(onStoresChanged()).catch(() => {});
          lastStoreAccessSyncAt = Date.now();
        }
        render();
        return true;
      })().finally(() => {
        permissionSyncPromise = null;
      });
      return permissionSyncPromise;
    }

    async function initialize() {
      state.checking = true;
      renderGate();
      try {
        const result = await api('cloudauth.status');
        state.config = result?.config || state.config;
        state.offlineAdminConfigured = Boolean(result?.offlineAdminConfigured || result?.offlineAdmin);
        if (result?.authenticated && result.session) await finishAuthentication(result);
        else {
          state.authenticated = false;
          state.session = null;
          state.error = result?.error?.message || (result?.restorePending ? '全域中枢暂时不可用，恢复登录后再试。' : '');
          state.checking = false;
          renderGate();
        }
      } catch (error) {
        state.checking = false;
        state.error = error.message;
        renderGate();
      }
    }

    async function login() {
      if (state.busy) return;
      const pendingCompany = state.companyLogin;
      const loginId = pendingCompany?.loginId || val('#cloud-login-id');
      const password = pendingCompany?.password || q('#cloud-password')?.value || '';
      const companyId = pendingCompany ? val('#cloud-company-select') : '';
      if (!loginId || !password) {
        state.error = '请输入登录账号和密码';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      renderGate();
      try {
        const result = await api('cloudauth.login', { loginId, password, companyId });
        state.companyLogin = null;
        state.busy = false;
        await finishAuthentication(result);
      } catch (error) {
        state.busy = false;
        const companies = Array.isArray(error?.details?.companies) ? error.details.companies : [];
        if (error?.code === 'COMPANY_SELECTION_REQUIRED' && companies.length) {
          state.companyLogin = { loginId, password, companies };
          state.error = '';
          state.info = '该超级管理员可登录多个公司，请选择本次进入的公司。';
          renderGate();
          return;
        }
        state.companyLogin = null;
        state.error = error.message;
        renderGate();
      }
    }

    async function offlineLogin() {
      if (state.busy) return;
      const loginId = val('#cloud-offline-login-id');
      const password = q('#cloud-offline-password')?.value || '';
      if (!loginId || !password) {
        state.error = '请输入离线管理员账号和密码';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      renderGate();
      try {
        const result = await api('cloudauth.offlineLogin', { loginId, password });
        state.busy = false;
        await finishAuthentication(result);
      } catch (error) {
        state.busy = false;
        state.error = error.message;
        renderGate();
      }
    }

    async function configureOfflineAdmin() {
      if (state.busy) return;
      const loginId = val('#cloud-offline-setup-id');
      const password = q('#cloud-offline-setup-password')?.value || '';
      const confirm = q('#cloud-offline-setup-confirm')?.value || '';
      if (loginId.length < 3 || password.length < 8) {
        state.error = '管理员账号至少 3 个字符，密码至少 8 个字符';
        renderGate();
        return;
      }
      if (password !== confirm) {
        state.error = '两次输入的密码不一致';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      renderGate();
      try {
        await api('cloudauth.configureOfflineAdmin', { loginId, password });
        state.offlineAdminConfigured = true;
        state.mode = 'offline';
        state.info = '离线超级管理员已设置，请使用刚才的账号密码登录';
      } catch (error) {
        state.error = error.message;
      } finally {
        state.busy = false;
        renderGate();
      }
    }

    async function registrationContext() {
      if (state.busy) return;
      const inviteCode = val('#cloud-invite-code');
      if (!inviteCode) {
        state.error = '请输入公司邀请码';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      state.registrationDraft = {
        inviteCode,
        loginId: val('#cloud-register-id'),
        displayName: val('#cloud-display-name'),
        password: q('#cloud-register-password')?.value || '',
        departmentId: val('#cloud-department'),
        teamId: val('#cloud-team'),
      };
      try {
        state.registrationContext = await api('cloudauth.registrationContext', { inviteCode });
      } catch (error) {
        state.error = error.message;
      } finally {
        state.busy = false;
        renderGate();
      }
    }

    async function register() {
      if (state.busy) return;
      const payload = {
        inviteCode: val('#cloud-invite-code'),
        loginId: val('#cloud-register-id'),
        displayName: val('#cloud-display-name'),
        password: q('#cloud-register-password')?.value || '',
        departmentId: val('#cloud-department'),
        teamId: val('#cloud-team'),
      };
      if (!payload.inviteCode || !payload.loginId || !payload.displayName || payload.password.length < 8) {
        state.error = '请填写邀请码、账号、姓名和至少 8 位密码';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      try {
        await api('cloudauth.register', payload);
        state.busy = false;
        state.mode = 'login';
        state.registrationContext = null;
        state.registrationDraft = {};
        state.info = '注册申请已提交，请等待上级审核通过后登录。';
        renderGate();
      } catch (error) {
        state.busy = false;
        state.error = error.message;
        renderGate();
      }
    }

    async function activateOwner() {
      if (state.busy) return;
      const activationCode = val('#cloud-activation-code');
      const loginId = val('#cloud-owner-login-id');
      const password = q('#cloud-owner-password')?.value || '';
      if (!activationCode || loginId.length < 3 || password.length < 8) {
        state.error = '请输入激活码、至少 3 个字符的登录账号和至少 8 位新密码';
        renderGate();
        return;
      }
      state.busy = true;
      state.error = '';
      try {
        await api('cloudauth.activateOwner', { activationCode, password, loginId });
        state.busy = false;
        state.mode = 'login';
        state.info = '老板账号已激活，请使用预先登记的登录账号和新密码登录。';
        renderGate();
      } catch (error) {
        state.busy = false;
        state.error = error.message;
        renderGate();
      }
    }

    async function saveService() {
      if (state.busy) return;
      state.busy = true;
      state.error = '';
      try {
        state.config = await api('cloudauth.saveConfig', { baseUrl: val('#cloud-base-url') });
        state.info = '服务地址已保存并验证成功';
      } catch (error) {
        state.error = error.message;
      } finally {
        state.busy = false;
        renderGate();
      }
    }

    async function health() {
      if (state.busy) return;
      state.busy = true;
      state.error = '';
      try {
        const result = await api('cloudauth.health');
        state.config = result.config || state.config;
        state.info = `连接成功：${result.name || '全域中枢'} ${result.version || ''}`;
      } catch (error) {
        state.error = error.message;
      } finally {
        state.busy = false;
        renderGate();
      }
    }

    async function load() {
      if (!state.authenticated) return;
      state.loading = true;
      state.loadError = '';
      render();
      try {
        const tasks = [api('cloudauth.me')];
        if (canViewOrganization() || canViewPeople() || canViewStores() || canReviewApprovals()) tasks.push(api('cloudauth.organization'));
        if (canReviewApprovals()) tasks.push(api('cloudauth.pendingUsers'));
        if (canViewPeople()) tasks.push(api('cloudauth.managementUsers'));
        if (canListPositions()) tasks.push(api('cloudauth.positions'));
        if (canViewStores()) tasks.push(api('cloudauth.managedStores'));
        tasks.push(api('cloudauth.profilePreferences'));
        if (canManagePositions()) tasks.push(api('cloudauth.systemLevelPreferences'));
        // 服务端或网络异常时，请求可能长时间不返回；这里加硬超时，避免页面一直转圈。
        let watchdog;
        const results = await Promise.race([
          Promise.allSettled(tasks),
          new Promise((_, reject) => {
            watchdog = setTimeout(() => reject(new Error('读取账号与权限信息超时：服务在 20 秒内没有返回，请检查网络后点“重新读取”。')), 20000);
          }),
        ]).finally(() => clearTimeout(watchdog));
        if (results[0].status === 'rejected') throw results[0].reason;
        const me = results[0].value;
        const previousSession = state.session || {};
        state.session = {
          ...previousSession,
          user: { ...(previousSession.user || {}), ...me, id: me.user_id },
          company: { ...(previousSession.company || {}), id: me.company_id },
          application: {
            ...(previousSession.application || {}),
            permissions: Array.isArray(me.application_permissions)
              ? me.application_permissions
              : (Array.isArray(previousSession.application?.permissions) ? previousSession.application.permissions : []),
            permission_source: me.application_permission_source || previousSession.application?.permission_source || 'application',
          },
          management_permissions: Array.isArray(me.management_permissions)
            ? me.management_permissions
            : (Array.isArray(previousSession.management_permissions) ? previousSession.management_permissions : []),
        };
        let index = 1;
        if (canViewOrganization() || canViewPeople() || canViewStores() || canReviewApprovals()) {
          const result = results[index++];
          if (result.status === 'fulfilled') {
            state.organization = result.value;
            if (result.value?.role_labels && typeof result.value.role_labels === 'object') {
              state.systemLevelLabels = { ...state.systemLevelLabels, ...result.value.role_labels };
              state.systemLevelLabelsMode = 'shared';
            }
          } else state.loadError = result.reason?.message || '组织架构读取失败';
        }
        if (canReviewApprovals()) { const result = results[index++]; state.pending = result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []; }
        if (canViewPeople()) {
          const result = results[index++];
          state.users = result.status === 'fulfilled' && Array.isArray(result.value)
            ? result.value.filter(item => item?.is_hidden !== true)
            : [];
        }
        if (canListPositions()) { const result = results[index++]; state.positions = result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []; }
        if (canViewStores()) { const result = results[index++]; state.managedStores = result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []; }
        const profileResult = results[index++];
        state.profilePreferences = profileResult.status === 'fulfilled' && profileResult.value && typeof profileResult.value === 'object'
          ? profileResult.value
          : {};
        if (canManagePositions()) {
          const labelsResult = results[index++];
          const localLabels = labelsResult.status === 'fulfilled' && labelsResult.value?.labels && typeof labelsResult.value.labels === 'object'
            ? labelsResult.value.labels
            : {};
          const centerLabels = state.organization?.role_labels && typeof state.organization.role_labels === 'object'
            ? state.organization.role_labels
            : {};
          state.systemLevelLabels = labelsResult.status === 'fulfilled'
            ? { ...localLabels, ...centerLabels }
            : state.systemLevelLabels || {};
          state.systemLevelLabelsMode = labelsResult.status === 'fulfilled' ? String(labelsResult.value?.mode || 'shared') : state.systemLevelLabelsMode;
          if (!state.offlineAdmin) {
            const missingCentralLabels = Object.entries(localLabels).filter(([role, label]) => (
              label && !centerLabels[role] && ['owner', 'general_manager', 'department_manager', 'team_leader', 'member'].includes(role)
            ));
            if (missingCentralLabels.length) {
              await Promise.all(missingCentralLabels.map(([role, label]) => api('cloudauth.setSystemRoleLabel', { role, label })));
              state.organization = {
                ...(state.organization || {}),
                role_labels: { ...centerLabels, ...Object.fromEntries(missingCentralLabels) },
              };
              state.systemLevelLabels = { ...state.systemLevelLabels, ...Object.fromEntries(missingCentralLabels) };
              state.systemLevelLabelsMode = 'shared';
            }
          }
        }
        const availableIds = new Set(state.users.map(item => String(item.id)));
        state.memberSelection = new Set([...state.memberSelection].filter(id => availableIds.has(String(id))));
        state.storeMemberSelection = new Set([...state.storeMemberSelection].filter(id => availableIds.has(String(id))));
        state.storeSelection = new Set([...state.storeSelection].filter(id => state.managedStores.some(item => String(item.id) === String(id))));
      } catch (error) {
        state.loadError = error.message;
      } finally {
        state.loading = false;
        render();
      }
    }

    async function refreshCurrent() {
      if (state.busy) return;
      state.busy = true;
      try {
        const result = await api('cloudauth.refresh');
        if (result?.session) state.session = result.session;
        await load();
        toast('账号和组织信息已刷新');
      } catch (error) {
        toast(error.message, true);
      } finally {
        state.busy = false;
      }
    }

    async function logout() {
      if (state.busy) return;
      state.busy = true;
      try {
        await api('cloudauth.logout');
      } catch {}
      state.authenticated = false;
      state.session = null;
      state.companyLogin = null;
      if (permissionSyncTimer) {
        clearInterval(permissionSyncTimer);
        permissionSyncTimer = null;
      }
      state.organization = null;
      state.pending = [];
      state.users = [];
      state.positions = [];
      state.managedStores = [];
      state.storeOrgFilter = '';
      state.storeMemberSelection = new Set();
      state.storeSelection = new Set();
      state.offlineAdmin = false;
      state.tab = 'account';
      state.busy = false;
      state.mode = 'login';
      state.info = '已退出工作台账号';
      document.body.classList.add('auth-locked');
      await onLoggedOut();
      renderGate();
    }

    async function saveProfile() {
      const displayName = String(q('#cloud-profile-name')?.value || '').trim();
      if (!displayName) {
        toast('请输入工作台显示姓名', true);
        return;
      }
      if (!state.offlineAdmin) {
        const profile = await api('cloudauth.updateMyProfile', { displayName });
        state.session = {
          ...(state.session || {}),
          user: { ...(state.session?.user || {}), display_name: profile.display_name },
        };
      }
      const result = await api('cloudauth.saveProfilePreferences', {
        displayName,
        avatarDataUrl: state.profilePreferences?.avatarDataUrl || '',
      });
      state.profilePreferences = { ...(state.profilePreferences || {}), ...(result || {}), displayName };
      render();
      toast(result?.mode === 'local' ? '头像和姓名已保存在本机' : '头像和姓名已保存并同步到当前软件');
    }

    async function changeMyPassword() {
      if (state.offlineAdmin) {
        toast('单机版不需要登录密码', true);
        return;
      }
      const values = await modal({
        title: '修改登录密码',
        description: '请输入当前密码和新密码。修改后，其他设备上的工作台登录会退出。',
        fields: `<div class="field"><label>当前密码</label><input name="currentPassword" type="password" required maxlength="256" autocomplete="current-password"></div><div class="field"><label>新密码</label><input name="newPassword" type="password" required minlength="8" maxlength="256" autocomplete="new-password"></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" required minlength="8" maxlength="256" autocomplete="new-password"></div>`,
        confirm: '确认修改',
        validate: input => {
          if (String(input.newPassword || '').length < 8) return '新密码至少需要 8 个字符';
          if (input.newPassword !== input.confirmPassword) return '两次输入的新密码不一致';
          return '';
        },
      });
      if (!values) return;
      await api('cloudauth.changeMyPassword', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast('登录密码已修改，其他设备已退出');
    }

    async function clearProfileAvatar() {
      const user = state.session?.user || {};
      const displayName = String(q('#cloud-profile-name')?.value || state.profilePreferences?.displayName || user.display_name || user.login_id || '').trim();
      const result = await api('cloudauth.saveProfilePreferences', { displayName, avatarDataUrl: '' });
      state.profilePreferences = { ...(state.profilePreferences || {}), ...(result || {}), displayName, avatarDataUrl: '' };
      render();
      toast('已恢复默认头像');
    }

    async function changeProfileAvatar(file) {
      if (!file) return;
      if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(String(file.type || ''))) {
        toast('请选择 PNG、JPG、WEBP 或 GIF 图片', true);
        return;
      }
      if (Number(file.size || 0) > 512 * 1024) {
        toast('头像图片不能超过 512 KB', true);
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('头像读取失败'));
        reader.readAsDataURL(file);
      });
      state.profilePreferences = { ...(state.profilePreferences || {}), avatarDataUrl: dataUrl };
      render();
      toast('头像已载入，点击“保存头像和姓名”后生效');
    }

    async function editSystemLevelLabel(role, currentLabel) {
      const values = await modal({
        title: '编辑系统层级显示名称',
        description: '修改后会显示在成员表格、职位选择和权限设置中，并保存到当前软件的数据中心。',
        fields: `<div class="field"><label>层级名称</label><input name="label" maxlength="40" required value="${esc(currentLabel)}"></div>`,
        confirm: '保存名称',
      });
      if (!values) return;
      const result = state.offlineAdmin
        ? await api('cloudauth.saveSystemLevelLabel', { role, label: values.label || '' })
        : { role, label: String(values.label || '').trim(), mode: 'shared' };
      if (!state.offlineAdmin) {
        await api('cloudauth.setSystemRoleLabel', { role, label: result.label });
        state.organization = { ...(state.organization || {}), role_labels: { ...(state.organization?.role_labels || {}), [role]: result.label } };
      }
      state.systemLevelLabels = result?.labels && typeof result.labels === 'object'
        ? result.labels
        : { ...state.systemLevelLabels, [role]: result.label };
      state.systemLevelLabelsMode = String(result?.mode || state.systemLevelLabelsMode || 'shared');
      render();
      toast(result?.mode === 'local' ? '显示名称已保存在本机' : '显示名称已保存并同步');
    }

    async function promptName(title, current = '') {
      const values = await modal({ title, fields: `<div class="field"><label>名称</label><input name="name" maxlength="80" required value="${esc(current)}"></div>`, confirm: '保存' });
      return values?.name?.trim() || '';
    }

    async function editPosition(position = null, insertRole = '', insertSortOrder = 0) {
      const roles = assignableBaseRoles();
      if (!roles.length) {
        toast('当前账号下面没有可创建的系统层级', true);
        return;
      }
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const selectedRole = position?.base_role || insertRole || roles[0][0];
      const levelChoices = roles.map(([role, label]) => (
        `<label class="cloud-level-choice"><input type="radio" name="baseRole" value="${esc(role)}"${selectedRole === role ? ' checked' : ''}><span><b>${esc(systemRoleLabel(role, label))}</b><small>${role === 'member' ? '普通成员能力' : role === 'team_leader' ? '可管理小组' : role === 'department_manager' ? '可管理部门' : '公司管理能力'}</small></span></label>`
      )).join('');
      const departmentOptions = `<option value=""${position?.department_id ? '' : ' selected'}>公司通用</option>${departments.map(item => (
        `<option value="${esc(item.id)}"${String(position?.department_id || '') === String(item.id) ? ' selected' : ''}>${esc(item.name)}</option>`
      )).join('')}`;
      const values = await modal({
        title: position ? `编辑层级：${position.name}` : '新增层级 / 职位',
        description: position?.assigned_count
          ? '该职位已有成员使用，只能修改名称或启停，不能修改系统层级和所属部门。'
          : '组织能力决定审批、上下级和店铺范围；保存后可在“默认权限”中设置该层级统一的软件权限。',
        fields: `<div class="field"><label>层级 / 职位名称</label><input name="name" maxlength="40" required value="${esc(position?.name || '')}" placeholder="例如：总监、主管、直播运营"></div><div class="field"><label>组织能力节点</label><div class="cloud-level-picker">${levelChoices}</div></div><div class="cloud-form-grid"><div class="field"><label>所属部门</label><select name="departmentId">${departmentOptions}</select></div><div class="field"><label>上下顺序</label><input name="sortOrder" type="number" step="any" min="-100000" max="100000" value="${esc(String(position?.sort_order ?? insertSortOrder ?? 0))}"></div></div>`,
        confirm: position ? '保存层级' : '创建层级',
      });
      if (!values) return;
      const payload = {
        name: String(values.name || '').trim(),
        baseRole: values.baseRole || roles[0][0],
        departmentId: values.departmentId || null,
        sortOrder: Number(values.sortOrder || 0),
      };
      if (!payload.name) {
        toast('请输入职位名称', true);
        return;
      }
      if (position) await api('cloudauth.updatePosition', { id: position.id, ...payload });
      else await api('cloudauth.createPosition', payload);
      await load();
      toast(position ? '系统层级已更新' : '系统层级已创建，可继续设置默认权限');
    }

    async function editMemberPosition(id, name = '', selected = '') {
      const member = state.users.find(item => String(item.id) === String(id));
      const values = await modal({
        title: `调整职位：${name || '成员'}`,
        description: '职位层级必须低于你本人；部门和小组可以同时调整。',
        fields: `<div class="field"><label>新职位</label><select name="positionTarget">${positionOptions(selected || 'role:member')}</select></div>${departmentTeamFields(member?.department_id || '', member?.team_id || '')}`,
        confirm: '调整职位',
      });
      if (!values) return;
      const target = String(values.positionTarget || 'role:member');
      const positionId = target.startsWith('position:') ? target.slice('position:'.length) : null;
      const role = target.startsWith('role:') ? target.slice('role:'.length) : null;
      await api('cloudauth.assignUserPosition', {
        userId: id,
        positionId,
        role,
        departmentId: values.departmentId || null,
        teamId: values.teamId || null,
      });
      await load();
      toast('成员职位已调整');
    }

    async function editBatchMemberPosition() {
      const ids = selectedMemberIds();
      if (!ids.length) {
        toast('请先选择成员', true);
        return;
      }
      const values = await modal({
        title: `批量调整职位：${ids.length} 位成员`,
        description: '所选成员会统一调整到同一个系统层级或自定义职位；不能选择高于你自己的层级。',
        fields: `<div class="field"><label>新职位</label><select name="positionTarget">${positionOptions('role:member')}</select></div>${departmentTeamFields()}`,
        confirm: '批量调整职位',
      });
      if (!values) return;
      const target = String(values.positionTarget || 'role:member');
      const positionId = target.startsWith('position:') ? target.slice('position:'.length) : null;
      const role = target.startsWith('role:') ? target.slice('role:'.length) : null;
      for (const userId of ids) await api('cloudauth.assignUserPosition', {
        userId,
        positionId,
        role,
        departmentId: values.departmentId || null,
        teamId: values.teamId || null,
      });
      state.memberSelection = new Set();
      await load();
      toast(`已调整 ${ids.length} 位成员的职位`);
    }

    function organizationTargetOptions(selectedDepartmentId = '', selectedTeamId = '') {
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      return departments.filter(item => item.active !== false).map(department => {
        const departmentValue = String(department.id);
        const departmentSelected = String(selectedDepartmentId) === departmentValue && !selectedTeamId;
        const departmentOption = `<option value="${esc(departmentValue)}"${departmentSelected ? ' selected' : ''}>${esc(department.name)} · 仅部门</option>`;
        const teams = (department.teams || []).filter(team => team.active !== false).map(team => {
          const value = `${department.id}::${team.id}`;
          const selected = String(selectedDepartmentId) === String(department.id) && String(selectedTeamId) === String(team.id);
          return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(department.name)} / ${esc(team.name)}</option>`;
        }).join('');
        return departmentOption + teams;
      }).join('');
    }

    function departmentTeamFields(selectedDepartmentId = '', selectedTeamId = '') {
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const selectedDepartment = departments.find(item => String(item.id) === String(selectedDepartmentId || ''));
      const teams = selectedDepartment
        ? (selectedDepartment.teams || []).filter(item => item.active !== false)
        : [];
      return `<div class="cloud-form-grid">
        <div class="field"><label>部门</label><select name="departmentId" data-cloud-move-department><option value="">未分配部门</option>${departments.filter(item => item.active !== false).map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selectedDepartmentId || '') ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
        <div class="field"><label>小组</label><select name="teamId" data-cloud-move-team${selectedDepartment ? '' : ' disabled'}><option value="">未分配小组</option>${teams.map(item => `<option value="${esc(item.id)}"${String(item.id) === String(selectedTeamId || '') ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
      </div>`;
    }

    function parseOrganizationTarget(value) {
      const [departmentId = '', teamId = ''] = String(value || '').split('::');
      return { departmentId: departmentId || null, teamId: teamId || null };
    }

    async function createManagedUser(preselected = {}) {
      if (!canAddMembers()) return;
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const initialDepartment = preselected.departmentId || departments[0]?.id || '';
      const initialTeam = preselected.teamId || '';
      const values = await modal({
        title: '新增成员',
        description: '新增后账号立即可用。部门和小组会决定该成员在工作台中可以看到的店铺范围。',
        fields: `<div class="cloud-form-grid"><div class="field"><label>登录账号</label><input name="loginId" required minlength="3" maxlength="128" autocomplete="off" placeholder="例如：运营小王"></div><div class="field"><label>姓名</label><input name="displayName" required maxlength="80" placeholder="成员显示姓名"></div></div><div class="field"><label>初始密码</label><input name="password" type="password" required minlength="8" maxlength="256" autocomplete="new-password" placeholder="至少 8 个字符"></div><div class="cloud-form-grid"><div class="field"><label>部门 / 小组</label><select name="organizationTarget" required><option value="">请选择</option>${organizationTargetOptions(initialDepartment, initialTeam)}</select></div><div class="field"><label>职位</label><select name="positionTarget">${positionOptions('role:member')}</select></div></div>`,
        confirm: '创建成员',
        validate: input => {
          if (String(input.loginId || '').trim().length < 3) return '登录账号至少需要 3 个字符';
          if (!String(input.displayName || '').trim()) return '请输入成员姓名';
          if (String(input.password || '').length < 8) return '初始密码至少需要 8 个字符';
          if (!input.organizationTarget) return '请选择成员的部门和小组';
          return '';
        },
      });
      if (!values) return;
      const organization = parseOrganizationTarget(values.organizationTarget);
      const target = String(values.positionTarget || 'role:member');
      const payload = {
        loginId: values.loginId,
        displayName: values.displayName,
        password: values.password,
        departmentId: organization.departmentId,
        teamId: organization.teamId,
        positionId: target.startsWith('position:') ? target.slice('position:'.length) : null,
        role: target.startsWith('role:') ? target.slice('role:'.length) : 'member',
      };
      await api('cloudauth.createManagedUser', payload);
      state.memberSelection = new Set();
      await load();
      toast(`成员 ${String(values.displayName || '').trim()} 已创建`);
    }

    async function moveSelectedMembers() {
      const ids = selectedMemberIds();
      if (!ids.length || !canMoveMembers()) return;
      const values = await modal({
        title: `移动成员：${ids.length} 人`,
        description: '部门和小组均可留空；只选部门时，成员进入该部门的未分配小组。',
        fields: departmentTeamFields(),
        confirm: '确认移动',
      });
      if (!values) return;
      await api('cloudauth.moveManagedUsers', {
        userIds: ids,
        departmentId: values.departmentId || null,
        teamId: values.teamId || null,
      });
      state.memberSelection = new Set();
      await load();
      toast(`已将 ${ids.length} 位成员移动到新组织`);
    }

    async function moveTeamToDepartment(teamId, teamName = '') {
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const values = await modal({
        title: `移动小组：${teamName || ''}`,
        description: '整组移动会同时移动组内全部成员，并保留组长职位。目标部门中不能已有同名小组。',
        fields: `<div class="field"><label>目标部门</label><select name="departmentId" required><option value="">请选择部门</option>${departments.filter(item => item.active !== false).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></div>`,
        confirm: '移动整个小组',
        validate: input => input.departmentId ? '' : '请选择目标部门',
      });
      if (!values) return;
      const result = await api('cloudauth.moveTeam', { teamId, departmentId: values.departmentId });
      await load();
      toast(`小组已移动，包含 ${Number(result?.moved_users || 0)} 名成员`);
    }

    async function deleteSelectedMembers() {
      const ids = selectedMemberIds();
      if (!ids.length || !canDeleteMembers()) return;
      const names = ids.map(id => memberName(state.users.find(item => String(item.id) === String(id)))).filter(Boolean);
      const values = await modal({
        title: `删除成员：${ids.length} 人`,
        description: `成员账号及其登录会话会被删除，此操作不能撤回。\n${names.slice(0, 8).join('、')}${names.length > 8 ? '…' : ''}`,
        fields: `<label class="checkline"><input type="checkbox" name="confirmed" value="on"><span>我已核对将要删除的成员</span></label>`,
        confirm: '确认删除',
        danger: true,
        validate: input => input.confirmed === 'on' ? '' : '请先勾选确认',
      });
      if (!values) return;
      await api('cloudauth.deleteManagedUsers', { userIds: ids });
      state.memberSelection = new Set();
      await load();
      toast(`已删除 ${ids.length} 位成员`);
    }

    async function editManagedUserInfo(id, name = '') {
      const values = await modal({
        title: `修改成员信息：${name || ''}`,
        description: '可以修改姓名和登录密码；密码留空表示本次不修改。只能修改自己部门或小组下一层级的成员。',
        fields: `<div class="field"><label>姓名</label><input name="displayName" required maxlength="80" value="${esc(name)}"></div><div class="cloud-form-grid"><div class="field"><label>新密码（选填）</label><input name="newPassword" type="password" minlength="8" maxlength="256" autocomplete="new-password" placeholder="留空则不修改"></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" maxlength="256" autocomplete="new-password"></div></div>`,
        confirm: '保存成员信息',
        validate: input => {
          if (!String(input.displayName || '').trim()) return '姓名不能为空';
          if (input.newPassword && String(input.newPassword).length < 8) return '新密码至少需要 8 个字符';
          if (input.newPassword !== input.confirmPassword) return '两次输入的新密码不一致';
          return '';
        },
      });
      if (!values) return;
      await api('cloudauth.updateManagedUserInfo', {
        userId: id,
        displayName: values.displayName,
        newPassword: values.newPassword || '',
      });
      await load();
      toast(values.newPassword ? '成员姓名和密码已更新' : '成员姓名已更新');
    }

    async function resetManagedUserPassword(id, name = '') {
      const values = await modal({
        title: `重置成员密码：${name || ''}`,
        description: '重置后该成员在所有设备上的工作台登录会立即退出。',
        fields: `<div class="field"><label>新密码</label><input name="newPassword" type="password" required minlength="8" maxlength="256" autocomplete="new-password"></div>`,
        confirm: '确认重置',
        validate: input => String(input.newPassword || '').length >= 8 ? '' : '新密码至少需要 8 个字符',
      });
      if (!values) return;
      await api('cloudauth.resetManagedUserPassword', { userId: id, newPassword: values.newPassword });
      toast('成员密码已重置');
    }

    function options(rows, label, selected = '') {
      return `<option value="">不指定</option>${rows.map(item => `<option value="${esc(item.id)}"${String(selected) === String(item.id) ? ' selected' : ''}>${esc(label(item))}</option>`).join('')}`;
    }

    function positionOptions(selected = '') {
      const builtIns = assignableBaseRoles().map(([role, label]) => (
        `<option value="role:${esc(role)}"${String(selected) === `role:${role}` ? ' selected' : ''}>${esc(systemRoleLabel(role, label))}</option>`
      )).join('');
      const custom = state.positions
        .filter(item => item.active !== false && assignableBaseRoles().some(([role]) => role === item.base_role))
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(item => `<option value="position:${esc(item.id)}"${String(selected) === `position:${item.id}` ? ' selected' : ''}>${esc(item.name)} · ${esc(systemRoleLabel(item.base_role, item.base_role_name))}${item.department_name ? ` · ${esc(item.department_name)}` : ''}</option>`)
        .join('');
      return `${builtIns}${custom}`;
    }

    async function assignUser(kind, id) {
      if (!state.users.length) {
        toast('当前没有可指定的成员，请先审批成员', true);
        return;
      }
      const candidates = state.users.filter(item => item.status === 'active' && item.role !== 'owner');
      const values = await modal({
        title: kind === 'department' ? '指定部门主管' : '指定小组组长',
        description: '同一个部门或小组可以同时指定多个负责人；全部不勾选表示清空负责人。',
        fields: `<div class="cloud-principal-list">${candidates.map(item => `<label><input type="checkbox" name="user_${esc(item.id)}" value="on"><span>${esc(memberName(item))}<small>${esc(memberRoleName(item))}</small></span></label>`).join('') || '<span class="cloud-members-tree-empty">没有可指定的成员</span>'}</div>`,
        confirm: '保存',
      });
      if (!values) return;
      const userIds = Object.keys(values)
        .filter(key => key.startsWith('user_') && values[key] === 'on')
        .map(key => key.slice('user_'.length));
      const method = kind === 'department' ? 'cloudauth.assignDepartmentManager' : 'cloudauth.assignTeamLeader';
      await api(method, { id, userIds });
      await load();
      toast('负责人已更新');
    }

    function permissionPickerHtml(selected = new Set(), {
      template = false,
      allowInherit = false,
      initialDepartmentId = '',
      initialRole = '*',
      availableCodes = null,
      copySourceRows = [],
    } = {}) {
      const available = Array.isArray(availableCodes) ? new Set(availableCodes) : null;
      const categories = [...new Set(catalog.GROUPS.map(group => group.category))].map(category => {
        const fixedProfileGroup = category === '账号与权限' ? `<section class="cloud-permission-group cloud-permission-fixed-group">
          <div class="cloud-permission-group-head">
            <label class="cloud-permission-primary"><span class="cloud-permission-fixed-check">✓</span><span><b>我的</b><small>account.profile</small></span></label>
            <em>固定可用</em>
          </div>
          <div class="cloud-permission-items"><div class="cloud-permission-choice system"><input type="checkbox" checked disabled aria-label="查看我的资料固定可用"><span><b>查看我的资料 / 修改密码</b><small>所有登录账号固定可用</small></span></div></div>
        </section>` : '';
        const groups = catalog.GROUPS.filter(group => group.category === category).map(group => {
          const items = group.items.filter(([code]) => !available || available.has(code));
          if (!items.length) return '';
          const checked = items.every(([code]) => selected.has(code));
          return `<section class="cloud-permission-group" data-permission-group-block="${esc(group.id)}">
            <div class="cloud-permission-group-head">
              <label class="cloud-permission-primary"><input type="checkbox" data-action="cloud-permission-group" data-group="${esc(group.id)}"${checked ? ' checked' : ''}><span><b>${esc(group.label)}</b><small>${esc(group.base)}</small></span></label>
              <em>${items.length} 项</em>
            </div>
            <div class="cloud-permission-items">${items.map(([code, label]) => {
              const index = catalog.CODES.indexOf(code);
              return `<label class="cloud-permission-choice" data-permission-text="${esc(`${group.label} ${group.category} ${label} ${code}`.toLowerCase())}">
                <input type="checkbox" name="permission_${index}" data-cloud-permission="${esc(code)}" data-permission-group-id="${esc(group.id)}"${selected.has(code) ? ' checked' : ''}>
                <span><b>${esc(label)}</b><small>${esc(code)}</small></span>
              </label>`;
            }).join('')}</div>
          </section>`;
        }).filter(Boolean).join('');
        if (!groups) return '';
        return `<section class="cloud-permission-category" data-permission-category-block><div class="cloud-permission-category-name"><strong>${esc(category)}</strong></div><div class="cloud-permission-category-groups">${fixedProfileGroup}${groups}</div></section>`;
      }).filter(Boolean).join('');
      const frequent = [
        ['workbench.accounts.add', '新增店铺'],
        ['workbench.business.daily.view', '日报'],
        ['workbench.business.product.view', '精细化'],
        ['workbench.reviews.sync', '评价同步'],
        ['workbench.marketing.purchase.create', '内购会'],
        ['workbench.compliance.scan', '违规扫描'],
        ['manage.permissions.assign', '权限分配'],
        ['manage.stores.assign', '店铺分配'],
      ].map(([code, label]) => `<button type="button" data-action="cloud-permission-frequent" data-code="${esc(code)}">${esc(label)}</button>`).join('');
      const copyControls = !template && copySourceRows.length
        ? `<div class="cloud-copy-permissions">
            <div><strong>复制下级权限</strong></div>
            <div class="cloud-copy-permission-actions"><select data-copy-permission-source aria-label="选择权限来源成员"><option value="">选择下级成员</option>${copySourceRows.map(item => `<option value="${esc(item.id)}">${esc(memberName(item))} · ${esc(memberRoleName(item))}${item.department_name ? ` · ${esc(item.department_name)}` : ''}</option>`).join('')}</select><button type="button" class="button small" data-action="cloud-copy-permissions">复制到此成员</button></div>
            <span class="cloud-copy-permission-status" data-copy-permission-status></span>
          </div>`
        : '';
      return `<div class="cloud-permission-picker" data-permission-picker>
        ${template ? '' : `<div class="cloud-permission-picker-head compact"><div class="actions">${button('全选','cloud-permission-all',{small:true,attrs:'data-value="all"'})}${button('清空','cloud-permission-all',{small:true,attrs:'data-value="none"'})}</div></div>`}
        ${allowInherit ? `<label class="checkline cloud-member-inherit"><input type="checkbox" name="inheritPermissions" value="on"><span>恢复继承部门和职位默认权限（会删除该成员的个人权限配置）</span></label>` : ''}
        ${template ? `<div class="cloud-permission-template-controls"><div class="field"><label>部门</label><select id="cloud-template-department" name="templateDepartment"><option value=""${initialDepartmentId ? '' : ' selected'}>公司默认</option>${(state.organization?.departments || []).map(item => `<option value="${esc(item.id)}"${String(initialDepartmentId) === String(item.id) ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>职位</label><select id="cloud-template-role" name="templateRole"><option value="*"${initialRole === '*' ? ' selected' : ''}>部门全部职位</option>${Object.entries(ROLE_LABELS).filter(([role]) => role !== 'owner' && roleRank(role) < roleRank(actorBaseRole())).map(([role, label]) => `<option value="${role}"${initialRole === role ? ' selected' : ''}>${esc(systemRoleLabel(role, label))}</option>`).join('')}${state.positions.filter(item => item.active !== false && roleRank(item.base_role) < roleRank(actorBaseRole())).map(item => `<option value="position:${esc(item.id)}"${initialRole === `position:${item.id}` ? ' selected' : ''}>${esc(item.name)} · ${esc(systemRoleLabel(item.base_role, item.base_role_name))}</option>`).join('')}</select></div>${button('加载当前模板','cloud-template-load',{small:true})}</div>` : ''}
        ${copyControls}
        <div class="cloud-permission-toolbar"><label>搜索权限<input type="search" data-cloud-permission-search placeholder="输入功能名称或权限编码"></label><div class="cloud-permission-frequent"><span>常用：</span>${frequent}</div></div>
        <div class="cloud-permission-catalog-head"><span>一级分类</span><span>二级分类</span><span>三级分类（功能与按钮）</span></div>
        <div class="cloud-permission-tree">${categories}</div>
      </div>`;
    }

    function selectedPermissionCodes(values) {
      return catalog.CODES.filter((code, index) => values[`permission_${index}`] === 'on');
    }

    function applyPermissionChecks(codes) {
      const wanted = new Set(Array.isArray(codes) ? codes : []);
      document.querySelectorAll('[data-cloud-permission]').forEach(input => { input.checked = wanted.has(input.dataset.cloudPermission); });
      document.querySelectorAll('[data-permission-group-block]').forEach(block => {
        const boxes = [...block.querySelectorAll('[data-cloud-permission]')];
        const group = block.querySelector('[data-action="cloud-permission-group"]');
        if (group) group.checked = boxes.length > 0 && boxes.every(box => box.checked);
      });
    }

    async function editMemberPermissions(id, name = '', targetIds = null) {
      const ids = [...new Set((Array.isArray(targetIds) && targetIds.length ? targetIds : [id]).map(String).filter(Boolean))];
      const details = await Promise.all(ids.map(userId => api('cloudauth.memberPermissions', { userId })));
      const actorOwned = new Set(ownedCatalogCodes());
      const normalizeAvailable = current => {
        const configured = Array.isArray(current?.grantable_permissions) && current.grantable_permissions.length
          ? current.grantable_permissions
          : ownedCatalogCodes();
        return new Set(configured.filter(code => catalog.CODE_SET.has(code) && actorOwned.has(code)));
      };
      const availableSets = details.map(normalizeAvailable);
      const available = [...availableSets[0]].filter(code => availableSets.every(set => set.has(code)));
      const availableSet = new Set(available);
      const selected = new Set();
      details.forEach(current => {
        const business = Array.isArray(current?.permissions) ? current.permissions : [];
        const managementCodes = Array.isArray(current?.management_permissions) ? current.management_permissions : [];
        const known = [...business, ...managementCodes].filter(code => catalog.CODE_SET.has(code));
        const detailedBusiness = business.some(code => code.startsWith('workbench.'));
        const rowSelected = current?.source === 'application' && business.includes('login') && !detailedBusiness
          ? available
          : (current?.source === 'member' || known.length ? known : []);
        rowSelected.filter(code => availableSet.has(code)).forEach(code => selected.add(code));
      });
      const isBatch = ids.length > 1;
      const label = isBatch ? `${ids.length} 位成员` : (name || '成员');
      state.permissionEditContext = {
        targetIds: ids,
        availableCodes: available,
        copySourceRows: copySources(ids),
      };
      let values;
      try {
        values = await modal({
          title: `${isBatch ? '批量设置' : '设置'}功能权限：${label}`,
          fields: permissionPickerHtml(selected, {
            allowInherit: details.every(current => current?.can_reset_to_inherited !== false),
            availableCodes: available,
            copySourceRows: copySources(ids),
          }),
          confirm: isBatch ? '保存到所选成员' : '保存权限',
        });
      } finally {
        state.permissionEditContext = null;
      }
      if (!values) return;
      const permissions = selectedPermissionCodes(values);
      for (const userId of ids) {
        if (values.inheritPermissions === 'on') await api('cloudauth.clearMemberPermissions', { userId });
        else await api('cloudauth.setMemberPermissions', { userId, permissions });
      }
      state.memberSelection = new Set();
      await load();
      toast(`已保存 ${label} 的功能权限`);
    }

    async function copyPermissionsToTarget() {
      const context = state.permissionEditContext;
      const sourceId = String(q('[data-copy-permission-source]')?.value || '');
      const status = q('[data-copy-permission-status]');
      if (!context || !sourceId) {
        if (status) status.textContent = '请先选择一个下级成员';
        return;
      }
      const source = state.users.find(item => String(item.id) === sourceId);
      if (!source || source.role === 'owner' || roleRank(source.role) >= roleRank(actorBaseRole())) {
        if (status) status.textContent = '只能复制低于自己层级的成员权限';
        return;
      }
      const current = await api('cloudauth.memberPermissions', { userId: sourceId });
      const sourceCodes = [
        ...(Array.isArray(current?.permissions) ? current.permissions : []),
        ...(Array.isArray(current?.management_permissions) ? current.management_permissions : []),
      ].filter(code => catalog.CODE_SET.has(code));
      const available = new Set(context.availableCodes || []);
      const copied = [...new Set(sourceCodes.filter(code => available.has(code)))];
      applyPermissionChecks(copied);
      if (status) {
        status.textContent = copied.length
          ? `已从 ${memberName(source) || '下级成员'} 复制 ${copied.length} 项可授予权限，请核对后保存`
          : `${memberName(source) || '下级成员'} 当前没有你可复制的权限`;
      }
    }

    function updateMemberSelection(ids, checked) {
      const next = new Set(state.memberSelection);
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        const member = state.users.find(item => String(item.id) === String(id));
        if (checked && member && canManageMember(member)) next.add(String(id));
        else next.delete(String(id));
      }
      state.memberSelection = next;
      render();
    }

    function dismissContextMenu(target = null) {
      const menu = q('#cloud-context-menu');
      if (menu && target && menu.contains?.(target)) return;
      menu?.remove();
      state.contextMenu = null;
    }

    function contextMenuButton(label, action, { id = '', danger = false, disabled = false, attrs = '' } = {}) {
      return `<button type="button" class="cloud-context-item${danger ? ' danger' : ''}" data-action="${esc(action)}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''} ${attrs}>${esc(label)}</button>`;
    }

    function contextMenuHtml(context) {
      if (context.type === 'member') {
        const ids = selectedMemberIds();
        const single = ids.length === 1 ? state.users.find(item => String(item.id) === ids[0]) : null;
        return `<div class="cloud-context-title">${single ? esc(memberName(single)) : `已选择 ${ids.length} 位成员`}</div>
          ${single && canAssignPermissions() && canManageMember(single) ? contextMenuButton('设置功能权限', 'cloud-member-permissions', { id: single.id, attrs: `data-name="${esc(memberName(single))}"` }) : ''}
          ${ids.length > 1 && canAssignPermissions() ? contextMenuButton(`批量设置权限（${ids.length} 人）`, 'cloud-batch-permissions') : ''}
          ${single && canAssignPermissions() && canManageMember(single) ? contextMenuButton('调整职位', 'cloud-member-position', { id: single.id, attrs: `data-name="${esc(memberName(single))}" data-role="${esc(single.role || '')}" data-position="${esc(single.position_id || '')}"` }) : ''}
          ${ids.length > 1 && canAssignPermissions() ? contextMenuButton(`批量调整职位（${ids.length} 人）`, 'cloud-batch-position') : ''}
          ${single && canEditMembers() && canManageMember(single) ? contextMenuButton('修改信息', 'cloud-edit-member-info', { id: single.id, attrs: `data-name="${esc(memberName(single))}"` }) : ''}
          ${ids.length > 1 && canMoveMembers() ? contextMenuButton(`移动所选成员（${ids.length} 人）`, 'cloud-move-members') : ''}
          ${single && canMoveMembers() && canManageMember(single) ? contextMenuButton('移动成员', 'cloud-move-members') : ''}
          <span class="cloud-context-separator"></span>
          ${ids.length > 1 && canDeleteMembers() ? contextMenuButton(`删除所选成员（${ids.length} 人）`, 'cloud-delete-members', { danger: true }) : ''}
          ${single && canDeleteMembers() && canManageMember(single) ? contextMenuButton('删除成员', 'cloud-delete-members', { danger: true }) : ''}`;
      }
      if (context.type === 'department') {
        const active = context.active !== false;
        return `<div class="cloud-context-title">部门：${esc(context.label || '')}</div>
          ${canAddMembers() ? contextMenuButton('在此部门新增成员', 'cloud-create-user', { attrs: `data-department-id="${esc(context.id)}"` }) : ''}
          ${canManageDepartments() ? contextMenuButton('新建子部门', 'cloud-new-department', { attrs: `data-parent-id="${esc(context.id)}"` }) : ''}
          ${canManageTeams() ? contextMenuButton('新建组', 'cloud-new-team', { id: context.id }) : ''}
          ${canManageDepartments() ? contextMenuButton('编辑部门信息', 'cloud-rename-department', { id: context.id, attrs: `data-name="${esc(context.label || '')}"` }) : ''}
          ${canManageDepartments() ? contextMenuButton('移动部门', 'cloud-move-department', { id: context.id, attrs: `data-name="${esc(context.label || '')}"` }) : ''}
          ${canAssignPermissions() ? contextMenuButton('设置部门默认权限', 'cloud-department-permissions', { id: context.id, attrs: `data-name="${esc(context.label || '')}"` }) : ''}
          ${canManageDepartments() ? contextMenuButton('指定部门主管', 'cloud-assign-department', { id: context.id }) : ''}
          ${canManageDepartments() ? contextMenuButton(active ? '停用部门' : '启用部门', 'cloud-toggle-department', { id: context.id, attrs: `data-active="${active ? 'true' : 'false'}"` }) : ''}
          ${canManageDepartments() ? contextMenuButton('删除部门', 'cloud-delete-department', { id: context.id, attrs: `data-name="${esc(context.label || '')}"`, danger: true }) : ''}
          <span class="cloud-context-separator"></span>`;
      }
      if (context.type === 'team') {
        const active = context.active !== false;
        return `<div class="cloud-context-title">小组：${esc(context.label || '')}</div>
          ${canAddMembers() ? contextMenuButton('在此小组新增成员', 'cloud-create-user', { attrs: `data-department-id="${esc(context.departmentId || '')}" data-team-id="${esc(context.id)}"` }) : ''}
          ${canManageTeams() ? contextMenuButton('编辑小组名称', 'cloud-rename-team', { id: context.id, attrs: `data-name="${esc(context.label || '')}"` }) : ''}
          ${canManageTeams() ? contextMenuButton('指定组长', 'cloud-assign-team', { id: context.id }) : ''}
          ${canManageTeams() ? contextMenuButton(active ? '停用小组' : '启用小组', 'cloud-toggle-team', { id: context.id, attrs: `data-active="${active ? 'true' : 'false'}"` }) : ''}
          ${canManageTeams() ? contextMenuButton('删除小组', 'cloud-delete-team', { id: context.id, attrs: `data-name="${esc(context.label || '')}"`, danger: true }) : ''}
          <span class="cloud-context-separator"></span>
          ${canMoveMembers() ? contextMenuButton('移动整个小组', 'cloud-move-team', { id: context.id, attrs: `data-name="${esc(context.label || '')}"` }) : ''}`;
      }
      return `<div class="cloud-context-title">本公司</div>${canAddMembers() ? contextMenuButton('新增成员', 'cloud-create-user') : ''}${contextMenuButton('全选当前成员', 'cloud-member-select-all')}${contextMenuButton('清空选择', 'cloud-member-clear-selection', { disabled: !state.memberSelection.size })}`;
    }

    function handleContextMenu(target, event = {}) {
      const host = target?.closest?.('[data-cloud-context]');
      if (!host) {
        dismissContextMenu();
        return false;
      }
      const type = host.dataset.cloudContext;
      if (type === 'member') {
        const id = String(host.dataset.id || '');
        if (!state.memberSelection.has(id)) state.memberSelection = new Set([id]);
        render();
      }
      const context = {
        type,
        id: String(host.dataset.id || ''),
        label: String(host.dataset.label || ''),
        active: host.dataset.active === 'false' ? false : true,
        departmentId: String(host.dataset.departmentId || ''),
      };
      return openContextMenu(context, event.clientX, event.clientY);
    }

    function openContextMenu(context, clientX = 0, clientY = 0) {
      dismissContextMenu();
      const x = Math.max(8, Math.min(Number(clientX || 0), Math.max(8, Number(window.innerWidth || 1280) - 238)));
      const y = Math.max(8, Math.min(Number(clientY || 0), Math.max(8, Number(window.innerHeight || 800) - 280)));
      const menu = document.createElement('div');
      menu.id = 'cloud-context-menu';
      menu.className = 'cloud-context-menu';
      menu.setAttribute('role', 'menu');
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.innerHTML = contextMenuHtml(context);
      document.body.appendChild(menu);
      state.contextMenu = context;
      return true;
    }

    async function handleChange(event) {
      const target = event.target;
      if (target?.matches?.('#cloud-department')) {
        const departmentId = String(target.value || '');
        const departments = Array.isArray(state.registrationContext?.departments) ? state.registrationContext.departments : [];
        const department = departments.find(item => String(item.id) === departmentId);
        const teamSelect = q('#cloud-team');
        if (teamSelect) {
          const teams = Array.isArray(department?.teams) ? department.teams : [];
          const enabled = Boolean(department)
            && state.registrationContext?.company?.allow_team_self_select !== false;
          teamSelect.innerHTML = `<option value="">${department ? '请选择小组（可由管理员审核时指定）' : '请先选择部门'}</option>${teams.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
          teamSelect.value = '';
          teamSelect.disabled = !enabled;
        }
        state.registrationDraft = { ...(state.registrationDraft || {}), departmentId, teamId: '' };
        return true;
      }
      if (target?.matches?.('#cloud-team')) {
        state.registrationDraft = { ...(state.registrationDraft || {}), teamId: String(target.value || '') };
        return true;
      }
      if (target?.matches?.('[data-member-status-filter]')) {
        state.memberStatusFilter = String(target.value || 'all');
        render();
        return true;
      }
      if (target?.matches?.('[data-cloud-move-department]')) {
        const teamSelect = q('[data-cloud-move-team]');
        const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
        const department = departments.find(item => String(item.id) === String(target.value || ''));
        if (teamSelect) {
          const teams = department ? (department.teams || []).filter(item => item.active !== false) : [];
          teamSelect.innerHTML = `<option value="">未分配小组</option>${teams.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
          teamSelect.value = '';
          teamSelect.disabled = !department;
        }
        return true;
      }
      if (!target?.matches?.('[data-profile-avatar]')) return false;
      await changeProfileAvatar(target.files?.[0]);
      return true;
    }

    async function editPermissionTemplate(departmentId = '', departmentName = '', initialRole = '*') {
      state.permissionTemplates = await api('cloudauth.permissionTemplates');
      if (Array.isArray(state.permissionTemplates?.positions)) state.positions = state.permissionTemplates.positions;
      const templates = Array.isArray(state.permissionTemplates?.templates) ? state.permissionTemplates.templates : [];
      const initial = templates.find(item => (item.department_id || '') === String(departmentId) && item.role === initialRole);
      const selected = new Set(initial?.permissions || []);
      const available = (Array.isArray(state.permissionTemplates?.grantable_permissions) && state.permissionTemplates.grantable_permissions.length
        ? state.permissionTemplates.grantable_permissions
        : ownedCatalogCodes()).filter(code => catalog.CODE_SET.has(code));
      const values = await modal({
        title: departmentName ? `部门权限：${departmentName}` : '权限模板与职位默认',
        description: '先选择部门和职位，再加载或设置模板。模板也只能使用你本人已经拥有的权限；自定义职位优先于系统层级模板。',
        fields: permissionPickerHtml(selected, { template: true, initialDepartmentId: departmentId, initialRole, availableCodes: available }),
        confirm: '保存模板',
      });
      if (!values) return;
      const targetDepartment = String(values['cloud-template-department'] || departmentId || '');
      const targetRole = String(values['cloud-template-role'] || initialRole);
      const permissions = selectedPermissionCodes(values);
      await api('cloudauth.savePermissionTemplate', {
        departmentId: targetDepartment || null,
        role: targetRole,
        permissions,
      });
      state.permissionTemplates = null;
      toast('权限模板已保存；未单独设置权限的对应成员会默认继承');
    }

    function handleInput(event) {
      const input = event.target;
      if (input?.matches?.('[data-member-search]')) {
        state.memberSearch = String(input.value || '');
        render();
        const restored = q('[data-member-search]');
        if (restored) {
          restored.focus();
          restored.setSelectionRange?.(state.memberSearch.length, state.memberSearch.length);
        }
        return true;
      }
      if (input?.matches?.('[data-store-search]')) {
        const kind = String(input.dataset.storeSearch || '');
        const value = String(input.value || '');
        if (kind === 'department') state.storeDepartmentSearch = value;
        else if (kind === 'people') state.storePeopleSearch = value;
        else if (kind === 'store') state.storeNameSearch = value;
        render();
        const restored = q(`[data-store-search="${kind}"]`);
        if (restored) {
          restored.focus();
          restored.setSelectionRange?.(value.length, value.length);
        }
        return true;
      }
      if (input?.matches?.('[data-store-access-search]')) {
        const kind = String(input.dataset.storeAccessSearch || '');
        const value = String(input.value || '');
        if (kind === 'person') state.storeAccessPersonSearch = value;
        else if (kind === 'store') state.storeAccessStoreSearch = value;
        else if (kind === 'available') state.storeAccessAvailableSearch = value;
        render();
        const restored = q(`[data-store-access-search="${kind}"]`);
        if (restored) {
          restored.focus();
          restored.setSelectionRange?.(value.length, value.length);
        }
        return true;
      }
      if (!input?.matches?.('[data-cloud-permission-search]')) return false;
      const query = String(input.value || '').trim().toLowerCase();
      let firstMatch = null;
      document.querySelectorAll('[data-permission-text]').forEach(label => {
        const match = query && label.dataset.permissionText.includes(query);
        label.hidden = false;
        label.classList.toggle('search-match', Boolean(match));
        label.classList.toggle('search-dim', Boolean(query) && !match);
        if (match) firstMatch ||= label;
      });
      document.querySelectorAll('[data-permission-group-block]').forEach(block => {
        block.classList.toggle('search-hit-group', Boolean(block.querySelector('.search-match')));
      });
      document.querySelectorAll('[data-permission-category-block]').forEach(block => {
        block.hidden = false;
      });
      if (firstMatch) firstMatch.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }

    async function approve(id) {
      const item = state.pending.find(entry => String(entry.id || entry.user_id) === String(id)) || {};
      const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
      const teams = departments.flatMap(department => (department.teams || []).map(team => ({ ...team, departmentName: department.name })));
      let preferredDepartment = item.department_id || '';
      if (!preferredDepartment && item.team_id) preferredDepartment = teams.find(team => String(team.id) === String(item.team_id))?.department_id || '';
      const values = await modal({
        title: '审核通过账号',
        description: '已默认带入员工注册时选择的部门和小组，可在审核前手动修改。可以分配系统职位或自定义职位，但不能选择高于自己的层级。',
        fields: `<div class="field"><label>职位</label><select name="positionTarget">${positionOptions('role:member')}</select></div><div class="field"><label>部门</label><select name="departmentId">${options(departments, entry => entry.name, preferredDepartment)}</select></div><div class="field"><label>小组</label><select name="teamId">${options(teams, entry => `${entry.departmentName} / ${entry.name}`, item.team_id || '')}</select></div>`,
        confirm: '审核通过',
        validate: values => {
          const selectedTeam = teams.find(entry => String(entry.id) === String(values.teamId || ''));
          if (selectedTeam && values.departmentId && selectedTeam.department_id && String(selectedTeam.department_id) !== String(values.departmentId)) return '所选小组不属于当前部门，请重新选择。';
          return '';
        },
      });
      if (!values) return;
      const target = String(values.positionTarget || 'role:member');
      const positionId = target.startsWith('position:') ? target.slice('position:'.length) : null;
      const role = target.startsWith('role:') ? target.slice('role:'.length) : 'member';
      await api('cloudauth.approveUser', { id, positionId, role, departmentId: values.departmentId || null, teamId: values.teamId || null });
      await load();
      toast('账号已审核通过');
    }

    async function copyPlainText(value) {
      const text = String(value || '');
      if (!text) throw new Error('没有可复制的公司邀请码');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select?.();
      area.setSelectionRange?.(0, text.length);
      const copied = document.execCommand?.('copy') === true;
      area.remove();
      if (!copied) throw new Error('浏览器未允许写入剪贴板，请重试');
    }

    async function dispatch(target) {
      const action = target.dataset.action;
      if (!String(action || '').startsWith('cloud-')) return false;
      if (action === 'cloud-mode') { state.mode = target.dataset.value; state.error = ''; state.info = ''; renderGate(); return true; }
      if (action === 'cloud-clear-company-login') {
        state.companyLogin = null;
        state.error = '';
        state.info = '';
        renderGate();
        return true;
      }
      if (action === 'cloud-login') { await login(); return true; }
      if (action === 'cloud-registration-context') { await registrationContext(); return true; }
      if (action === 'cloud-register') { await register(); return true; }
      if (action === 'cloud-activate') { await activateOwner(); return true; }
      if (action === 'cloud-offline-login') { await offlineLogin(); return true; }
      if (action === 'cloud-offline-setup') { await configureOfflineAdmin(); return true; }
      if (action === 'cloud-health') { await health(); return true; }
      if (action === 'cloud-save-service') { await saveService(); return true; }
      if (action === 'cloud-tab') {
        state.tab = target.dataset.value || 'account';
        if (state.tab !== 'users') state.memberSelection = new Set();
        if (state.tab !== 'stores') {
          state.storeMemberSelection = new Set();
          state.storeSelection = new Set();
        }
        dismissContextMenu();
        render();
        return true;
      }
      if (action === 'cloud-tree-menu') {
        const rect = target.getBoundingClientRect?.() || { left: 20, bottom: 20 };
        openContextMenu({
          type: String(target.dataset.contextType || ''),
          id: String(target.dataset.id || ''),
          label: String(target.dataset.label || ''),
          active: target.dataset.active !== 'false',
          departmentId: String(target.dataset.departmentId || ''),
        }, rect.left || 20, (rect.bottom || 20) + 4);
        return true;
      }
      if (action === 'cloud-copy-invite-code') {
        const result = await api('cloudauth.companyInviteCode');
        await copyPlainText(result?.inviteCode);
        toast(`公司邀请码 ${result.inviteCode} 已复制`);
        return true;
      }
      if (action === 'cloud-open-review') {
        await openPendingReview();
        return true;
      }
      if (action === 'cloud-store-access-mode') {
        state.storeAccessMode = ['person', 'store', 'organization'].includes(target.dataset.value)
          ? target.dataset.value
          : 'organization';
        state.storeAccessAvailableSearch = '';
        if (state.storeAccessMode === 'organization') syncOrganizationStoreSelection();
        render();
        return true;
      }
      if (action === 'cloud-store-access-person') {
        state.storeAccessPersonId = String(target.dataset.id || '');
        state.storeAccessAvailableSearch = '';
        render();
        return true;
      }
      if (action === 'cloud-store-access-store') {
        state.storeAccessStoreId = String(target.dataset.id || '');
        state.storeAccessAvailableSearch = '';
        render();
        return true;
      }
      if (action === 'cloud-store-user-grant' || action === 'cloud-store-user-revoke') {
        if (!canAssignStores()) {
          toast('当前账号没有分配店铺的权限', true);
          return true;
        }
        const authorized = action === 'cloud-store-user-grant';
        await api('cloudauth.setManagedStoreUserAccess', {
          storeId: target.dataset.storeId,
          userId: target.dataset.userId,
          authorized,
        });
        await load();
        if (typeof onStoresChanged === 'function') await onStoresChanged();
        return true;
      }
      if (action === 'cloud-store-scope') {
        state.storeOrgFilter = String(target.dataset.value || '');
        state.storeMemberSelection = new Set();
        syncOrganizationStoreSelection();
        render();
        return true;
      }
      if (action === 'cloud-store-member-select') {
        const id = String(target.dataset.id || '');
        const next = new Set(state.storeMemberSelection);
        if (target.checked === true) next.add(id);
        else next.delete(id);
        state.storeMemberSelection = next;
        syncOrganizationStoreSelection();
        render();
        return true;
      }
      if (action === 'cloud-store-members-all') {
        state.storeMemberSelection = new Set(
          state.users.filter(item => {
            const active = String(state.storeOrgFilter || '');
            if (!canManageMember(item)) return false;
            if (active.startsWith('department:')) return descendantDepartmentIds(active.slice('department:'.length)).has(String(item.department_id || ''));
            if (active.startsWith('team:')) return String(item.team_id || '') === active.slice('team:'.length);
            return true;
          }).map(item => String(item.id)),
        );
        syncOrganizationStoreSelection();
        render();
        return true;
      }
      if (action === 'cloud-store-select') {
        const id = String(target.dataset.id || '');
        const next = new Set(state.storeSelection);
        if (target.checked === true) next.add(id);
        else next.delete(id);
        state.storeSelection = next;
        render();
        return true;
      }
      if (action === 'cloud-store-select-all') {
        const all = state.managedStores.length > 0 && state.managedStores.every(item => state.storeSelection.has(String(item.id)));
        state.storeSelection = all ? new Set() : new Set(state.managedStores.map(item => String(item.id)));
        render();
        return true;
      }
      if (action === 'cloud-store-save') {
        const active = String(state.storeOrgFilter || '');
        const selectedMembers = [...state.storeMemberSelection];
        if (!active && !selectedMembers.length) {
          toast('请先选择部门、小组或成员', true);
          return true;
        }
        let targetScope = null;
        if (active.startsWith('department:')) {
          targetScope = { type: 'department', id: active.slice('department:'.length) };
        } else if (active.startsWith('team:')) {
          targetScope = { type: 'team', id: active.slice('team:'.length) };
        }
        const selectedPeople = selectedMembers
          .map(id => state.users.find(item => String(item.id) === String(id)))
          .filter(Boolean);
        const changes = [];
        for (const store of state.managedStores) {
          const scopes = (store.grants || []).map(grant => ({ type: grant.scope_type, id: grant.scope_id }));
          const includes = (type, id) => scopes.some(scope => scope.type === type && String(scope.id) === String(id));
          let changed = false;
          const targets = selectedPeople.length
            ? selectedPeople.map(user => ({ type: 'user', id: user.id, user }))
            : (targetScope ? [targetScope] : []);
          for (const target of targets) {
            if (target.user) {
              const access = storeAccessForUser(store, target.user);
              if (access.authorized && !access.direct) continue;
            }
            const wanted = state.storeSelection.has(String(store.id));
            const index = scopes.findIndex(scope => scope.type === target.type && String(scope.id) === String(target.id));
            if (wanted && index < 0) {
              scopes.push({ type: target.type, id: String(target.id) });
              changed = true;
            } else if (!wanted && index >= 0) {
              scopes.splice(index, 1);
              changed = true;
            }
          }
          if (changed) changes.push({ storeId: store.id, scopes });
        }
        if (!changes.length) {
          toast('店铺授权没有需要保存的变更');
          return true;
        }
        await Promise.all(changes.map(change => (
          api('cloudauth.saveManagedStoreGrants', { storeId: change.storeId, scopes: change.scopes })
        )));
        state.storeSelection = new Set();
        state.storeMemberSelection = new Set();
        await load();
        if (typeof onStoresChanged === 'function') await onStoresChanged();
        toast('店铺授权已保存');
        return true;
      }
      if (action === 'cloud-store-add') {
        const values = await modal({
          title: '新增店铺',
          description: '这里只填写店铺名称。保存后会同时出现在店铺登录和当前店铺管理中。',
          fields: `<div class="field"><label>店铺名称</label><input name="name" required maxlength="80" placeholder="例如：荣锦初宇旗舰店"></div>`,
          confirm: '新增店铺',
        });
        if (!values?.name?.trim()) return true;
        await api('cloudauth.addManagedStore', { name: values.name.trim() });
        if (typeof onStoresChanged === 'function') await onStoresChanged();
        await load();
        toast('店铺已新增，请选择部门、成员和店铺后保存授权');
        return true;
      }
      if (action === 'cloud-store-remove') {
        const values = await modal({
          title: `减少店铺：${target.dataset.name || ''}`,
          description: '该店铺会从店铺登录和店铺管理中移除，店铺历史数据文件夹仍保留。',
          fields: `<label class="checkline"><input type="checkbox" name="confirmed" value="on"><span>我确认减少这家店铺</span></label>`,
          confirm: '确认减少',
          danger: true,
          validate: input => input.confirmed === 'on' ? '' : '请先勾选确认',
        });
        if (values) {
          await api('cloudauth.removeManagedStore', { storeId: target.dataset.id });
          if (typeof onStoresChanged === 'function') await onStoresChanged();
          await load();
          toast('店铺已减少');
        }
        return true;
      }
      if (action === 'cloud-refresh') { await refreshCurrent(); return true; }
      if (action === 'cloud-logout') { await logout(); return true; }
      if (action === 'cloud-org-filter') {
        state.orgFilter = String(target.dataset.value || 'all');
        state.memberSelection = new Set();
        render();
        return true;
      }
      if (action === 'cloud-save-profile') { await saveProfile(); return true; }
      if (action === 'cloud-clear-avatar') { await clearProfileAvatar(); return true; }
      if (action === 'cloud-change-password') { await changeMyPassword(); return true; }
      if (action === 'cloud-edit-system-level') { await editSystemLevelLabel(target.dataset.role, target.dataset.label || ''); return true; }
      if (action === 'cloud-member-select') { updateMemberSelection(target.dataset.id, target.checked === true); return true; }
      if (action === 'cloud-member-group-select') {
        const ids = String(target.dataset.ids || '').split(',').filter(Boolean);
        updateMemberSelection(ids, target.checked === true);
        return true;
      }
      if (action === 'cloud-member-select-all') {
        state.memberSelection = new Set(state.users.filter(item => item.status === 'active' && canManageMember(item)).map(item => String(item.id)));
        dismissContextMenu();
        render();
        return true;
      }
      if (action === 'cloud-member-clear-selection') {
        state.memberSelection = new Set();
        dismissContextMenu();
        render();
        return true;
      }
      if (action === 'cloud-batch-permissions') {
        const ids = selectedMemberIds();
        dismissContextMenu();
        if (ids.length) await editMemberPermissions(ids[0], '', ids);
        return true;
      }
      if (action === 'cloud-batch-position') {
        dismissContextMenu();
        await editBatchMemberPosition();
        return true;
      }
      if (action === 'cloud-create-user') {
        dismissContextMenu();
        await createManagedUser({
          departmentId: target.dataset.departmentId || '',
          teamId: target.dataset.teamId || '',
        });
        return true;
      }
      if (action === 'cloud-move-members') {
        if (target.dataset.id) {
          state.memberSelection = new Set([String(target.dataset.id)]);
        }
        dismissContextMenu();
        await moveSelectedMembers();
        return true;
      }
      if (action === 'cloud-move-team') {
        dismissContextMenu();
        await moveTeamToDepartment(target.dataset.id, target.dataset.name || '');
        return true;
      }
      if (action === 'cloud-delete-members') {
        dismissContextMenu();
        await deleteSelectedMembers();
        return true;
      }
      if (action === 'cloud-edit-member-info' || action === 'cloud-edit-member-name') {
        dismissContextMenu();
        await editManagedUserInfo(target.dataset.id, target.dataset.name || '');
        return true;
      }
      if (action === 'cloud-copy-permissions') {
        await copyPermissionsToTarget();
        return true;
      }
      if (action === 'cloud-unsupported') {
        toast('这个操作需要全域中枢新增成员移动或删除接口，本版先保留入口，不会在本地假修改组织。', true);
        dismissContextMenu();
        return true;
      }
      if (action === 'cloud-permission-all') {
        const checked = target.dataset.value === 'all';
        document.querySelectorAll('[data-cloud-permission]').forEach(input => { input.checked = checked; });
        document.querySelectorAll('[data-action="cloud-permission-group"]').forEach(input => { input.checked = checked; });
        return true;
      }
      if (action === 'cloud-permission-group') {
        const checked = target.checked === true;
        document.querySelectorAll(`[data-permission-group-id="${target.dataset.group || ''}"]`).forEach(input => { input.checked = checked; });
        return true;
      }
      if (action === 'cloud-permission-frequent') {
        const input = document.querySelector(`[data-cloud-permission="${target.dataset.code || ''}"]`);
        if (input) {
          input.checked = true;
          const choice = input.closest('.cloud-permission-choice');
          choice?.classList.add('search-match');
          choice?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return true;
      }
      if (action === 'cloud-permission-preset') {
        const preset = catalog.ROLE_PRESETS[target.dataset.role] || [];
        applyPermissionChecks(preset);
        const roleSelect = q('#cloud-template-role');
        if (roleSelect) roleSelect.value = target.dataset.role || '*';
        return true;
      }
      if (action === 'cloud-template-load') {
        const departmentId = String(q('#cloud-template-department')?.value || '');
        const role = String(q('#cloud-template-role')?.value || '*');
        const templates = Array.isArray(state.permissionTemplates?.templates) ? state.permissionTemplates.templates : [];
        const saved = templates.find(item => String(item.department_id || '') === departmentId && String(item.role) === role);
        const position = role.startsWith('position:') ? state.positions.find(item => `position:${item.id}` === role) : null;
        const fallback = position ? (catalog.ROLE_PRESETS[position.base_role] || []) : (catalog.ROLE_PRESETS[role] || []);
        applyPermissionChecks(saved ? saved.permissions : fallback);
        toast(saved ? '已加载保存的权限模板' : (fallback.length ? '已应用层级预设，尚未保存' : '当前模板为空'));
        return true;
      }
      if (action === 'cloud-member-permissions') {
        await editMemberPermissions(target.dataset.id, target.dataset.name || '');
        return true;
      }
      if (action === 'cloud-member-position') {
        const selected = target.dataset.position ? `position:${target.dataset.position}` : `role:${target.dataset.role || 'member'}`;
        await editMemberPosition(target.dataset.id, target.dataset.name || '', selected);
        return true;
      }
      if (action === 'cloud-permission-templates') { await editPermissionTemplate(); return true; }
      if (action === 'cloud-department-permissions') { await editPermissionTemplate(target.dataset.id, target.dataset.name || ''); return true; }
      if (action === 'cloud-new-position') { await editPosition(); return true; }
      if (action === 'cloud-insert-position') {
        await editPosition(null, target.dataset.role || '', Number(target.dataset.sortOrder || 0));
        return true;
      }
      if (action === 'cloud-edit-position') {
        const position = state.positions.find(item => String(item.id) === String(target.dataset.id));
        if (position) await editPosition(position);
        return true;
      }
      if (action === 'cloud-position-permissions') {
        const position = state.positions.find(item => String(item.id) === String(target.dataset.id));
        if (position) {
          const departmentName = position.department_name || '';
          await editPermissionTemplate(position.department_id || '', departmentName, `position:${position.id}`);
        }
        return true;
      }
      if (action === 'cloud-toggle-position') {
        const active = target.dataset.active === 'false';
        await api('cloudauth.setPositionActive', { id: target.dataset.id, active });
        await load();
        toast(active ? '职位已启用' : '职位已停用');
        return true;
      }
      if (action === 'cloud-delete-position') {
        const values = await modal({
          title: `删除职位：${target.dataset.name || ''}`,
          description: '只有没有成员使用的职位可以删除；如果仍在使用，请先调整成员职位。',
          fields: '',
          confirm: '确认删除',
          danger: true,
        });
        if (values) {
          await api('cloudauth.deletePosition', { id: target.dataset.id });
          await load();
          toast('职位已删除');
        }
        return true;
      }
      if (action === 'cloud-new-department') {
        const name = await promptName(target.dataset.parentId ? '新建子部门' : '新建部门');
        if (name) {
          await api('cloudauth.createDepartment', {
            name,
            parentDepartmentId: target.dataset.parentId || null,
          });
          await load();
          toast('部门已创建');
        }
        return true;
      }
      if (action === 'cloud-new-team') {
        let departmentId = target.dataset.id || '';
        if (!departmentId) {
          const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
          const selectedDepartment = String(state.orgFilter || '').startsWith('department:')
            ? String(state.orgFilter).slice('department:'.length)
            : '';
          const targetValues = await modal({
            title: '新建组',
            fields: `<div class="field"><label>所属部门</label><select name="departmentId" required><option value="">请选择部门</option>${departments.filter(item => item.active !== false).map(item => `<option value="${esc(item.id)}"${item.id === selectedDepartment ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>`,
            confirm: '下一步',
            validate: input => input.departmentId ? '' : '请选择所属部门',
          });
          if (!targetValues?.departmentId) return true;
          departmentId = targetValues.departmentId;
        }
        const name = await promptName('新建小组');
        if (name) { await api('cloudauth.createTeam', { departmentId, name }); await load(); toast('小组已创建'); }
        return true;
      }
      if (action === 'cloud-rename-department' || action === 'cloud-rename-team') {
        const name = await promptName('修改名称', target.dataset.name || '');
        if (name) {
          await api(action === 'cloud-rename-department' ? 'cloudauth.renameDepartment' : 'cloudauth.renameTeam', { id: target.dataset.id, name });
          await load(); toast('名称已更新');
        }
        return true;
      }
      if (action === 'cloud-move-department') {
        const departments = Array.isArray(state.organization?.departments) ? state.organization.departments : [];
        const values = await modal({
          title: `移动部门：${target.dataset.name || ''}`,
          fields: `<div class="field"><label>上级部门</label><select name="parentDepartmentId"><option value="">公司根级</option>${departments.filter(item => String(item.id) !== String(target.dataset.id) && item.active !== false).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></div>`,
          confirm: '移动部门',
        });
        if (values) {
          await api('cloudauth.moveDepartment', {
            id: target.dataset.id,
            parentDepartmentId: values.parentDepartmentId || null,
          });
          await load();
          toast('部门已移动');
        }
        return true;
      }
      if (action === 'cloud-delete-department') {
        const values = await modal({
          title: `删除部门：${target.dataset.name || ''}`,
          description: '仅空部门可以删除；部门内不能有成员、子部门或小组。',
          fields: '',
          confirm: '确认删除',
          danger: true,
        });
        if (values) {
          await api('cloudauth.deleteDepartment', { id: target.dataset.id });
          await load();
          toast('部门已删除');
        }
        return true;
      }
      if (action === 'cloud-delete-team') {
        const values = await modal({
          title: `删除小组：${target.dataset.name || ''}`,
          description: '仅空小组可以删除；请先移动或删除组内成员。',
          fields: '',
          confirm: '确认删除',
          danger: true,
        });
        if (values) {
          await api('cloudauth.deleteTeam', { id: target.dataset.id });
          await load();
          toast('小组已删除');
        }
        return true;
      }
      if (action === 'cloud-toggle-department' || action === 'cloud-toggle-team') {
        const active = target.dataset.active === 'false';
        await api(action === 'cloud-toggle-department' ? 'cloudauth.setDepartmentActive' : 'cloudauth.setTeamActive', { id: target.dataset.id, active });
        await load(); toast(active ? '已启用' : '已停用');
        return true;
      }
      if (action === 'cloud-assign-department') { await assignUser('department', target.dataset.id); return true; }
      if (action === 'cloud-assign-team') { await assignUser('team', target.dataset.id); return true; }
      if (action === 'cloud-approve') { await approve(target.dataset.id); return true; }
      if (action === 'cloud-reject') {
        const values = await modal({ title: '拒绝注册申请', fields: `<div class="field"><label>原因</label><textarea name="reason" maxlength="500" placeholder="可选"></textarea></div>`, confirm: '确认拒绝', danger: true });
        if (values) { await api('cloudauth.rejectUser', { id: target.dataset.id, reason: values.reason || '' }); await load(); toast('申请已拒绝'); }
        return true;
      }
      return false;
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => {
        void syncPermissionState(true).catch(() => {});
      });
    }

    return Object.freeze({
      initialize,
      renderPage,
      renderGate,
      load,
      hasSessionView: () => Boolean(state.authenticated && state.session),
      dispatch,
      accountChipHtml,
      canAccessPage,
      firstAccessiblePage,
      hasApplicationPermission,
      hasPermission,
      hasManagement,
      canAssignPermissions,
      canAssignStores,
      handleInput,
      handleChange,
      handleContextMenu,
      dismissContextMenu,
      syncPermissionState,
      isAuthenticated: () => state.authenticated,
      session: () => state.session,
      activeTab: () => state.tab,
    });
  }

  window.XXCloudAuth = Object.freeze({ create, PAGE_PERMISSIONS, PAGE_PERMISSION_CODES });
})();
