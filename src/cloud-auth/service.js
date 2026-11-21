'use strict';

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { LoginCenterError, normalizeBaseUrl, createLoginCenterClient } = require('./client');
const { createCloudAuthSessionStore } = require('./session-store');
const permissionCatalog = require('../shared/permissions');
const workspaceModel = require('./workspace-model');

const CONFIG_FILE = 'cloud-auth/config.json';
const OFFLINE_ADMIN_FILE = 'cloud-auth/offline-admin.json';
const WORKBENCH_PREFERENCES_FILE = 'cloud-auth/workbench-preferences.json';
const SYSTEM_LEVEL_COLLECTION = 'xx-workbench-system';
const PROFILE_COLLECTION = 'xx-workbench-profile';
const WORKSPACE_COLLECTION = 'xx-workbench-workspace';
const WORKSPACE_RECORD = 'organization-v1';
const SYSTEM_LEVEL_ROLES = new Set(['owner', 'general_manager', 'department_manager', 'team_leader', 'member']);
const DEFAULT_BASE_URL = 'https://xieys.de5.net';
const DEFAULT_APP_ID = '1001';
// 登录中心（OmniHub／全域中枢）为工作台分配的应用版本号，独立于程序自身版本。
const DEFAULT_APP_VERSION = '0.0.1';
const REFRESH_MARGIN_MS = 60 * 1000;
// 权限本地缓存窗口：登录中心在线上，避免每个动作都等一次网络往返。
const PERMISSION_FRESH_MS = 120 * 1000;
const AUTH_FAILURE_CODES = new Set([
  'INVALID_REFRESH',
  'REFRESH_EXPIRED',
  'ACCOUNT_DISABLED',
  'ACCESS_DISABLED',
  'NO_APP_ACCESS',
  'ROLE_NO_APP_ACCESS',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
]);

function machineFingerprint() {
  let machineGuid = '';
  try {
    const output = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
    });
    machineGuid = String(output.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)?.[1] || '').trim();
  } catch {}
  const raw = [machineGuid, os.hostname(), os.arch(), os.platform()].join('|');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function publicError(error) {
  return {
    code: String(error?.code || 'AUTH_ERROR'),
    message: String(error?.message || error || '登录操作未完成').slice(0, 600),
    details: error?.details && typeof error.details === 'object' ? error.details : {},
  };
}

function createCloudAuthService({
  dataDir,
  storage,
  safeStorage,
  appVersion,
  env = process.env,
  fetchImpl = globalThis.fetch,
  machineId = env.XX_TEST_MACHINE_ID || machineFingerprint(),
  standalone = false,
  listLocalStores = null,
  createLocalStore = null,
  removeLocalStore = null,
  renameLocalStore = null,
}) {
  if (!dataDir || !storage) throw new Error('云端身份服务缺少本地存储');
  const sessionStore = createCloudAuthSessionStore({ dataDir, storage, safeStorage });
  let session = null;
  let config = null;
  let loginPromise = null;
  let refreshPromise = null;
  let statusPromise = null;
  const offlineFailures = new Map();
  let workspaceCache = null;
  let workspaceReadPromise = null;
  let workspaceMutatePromise = null;
  let baseUsersCache = null;
  let lastPermissionRefreshAt = 0;

  async function readLocalPreferences() {
    const value = await storage.readJson(WORKBENCH_PREFERENCES_FILE, {}).catch(() => ({}));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async function writeLocalPreferences(value) {
    const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    await storage.writeJson(WORKBENCH_PREFERENCES_FILE, next);
    return next;
  }

  function profileRecordKey(userId) {
    return `profile-${crypto.createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 32)}`;
  }

  async function readConfig() {
    const saved = await storage.readJson(CONFIG_FILE, {}).catch(() => ({}));
    // 旧版本把本机 127.0.0.1 当成默认服务地址并存进了配置；登录中心已迁到线上，
    // 这台机器上的旧地址只会连不上，因此本机回环地址一律按“未配置”处理，回落到新地址。
    const savedBaseUrl = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(saved.baseUrl || '').trim())
      ? ''
      : saved.baseUrl;
    const baseUrl = normalizeBaseUrl(env.XX_LOGIN_CENTER_URL || savedBaseUrl || DEFAULT_BASE_URL);
    const appId = String(env.XX_LOGIN_APP_ID || saved.appId || DEFAULT_APP_ID).trim();
    return { baseUrl, appId, appVersion: String(env.XX_LOGIN_APP_VERSION || DEFAULT_APP_VERSION) };
  }

  async function getConfig() {
    if (!config) config = await readConfig();
    return { ...config };
  }

  function clientFor(serviceConfig) {
    return createLoginCenterClient({ ...serviceConfig, fetchImpl });
  }

  function offlinePasswordHash(password, salt) {
    return crypto.scryptSync(String(password), salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString('hex');
  }

  async function readOfflineAdmin() {
    const value = await storage.readJson(OFFLINE_ADMIN_FILE, null).catch(() => null);
    if (!value || typeof value !== 'object') return null;
    if (!value.loginId || !value.salt || !value.passwordHash) return null;
    return value;
  }

  function offlineSession(serviceConfig, loginId, name = '离线超级管理员') {
    const now = Date.now();
    return {
      baseUrl: serviceConfig.baseUrl,
      appId: serviceConfig.appId,
      appVersion: serviceConfig.appVersion,
      accessToken: `offline-admin-${crypto.randomUUID()}`,
      refreshToken: '',
      accessExpiresAt: now + 12 * 3600 * 1000,
      refreshExpiresAt: now + 12 * 3600 * 1000,
      offlineAdmin: true,
      data: {
        user: {
          id: `offline:${loginId}`,
          login_id: loginId,
          display_name: name,
          role: 'owner',
          role_name: '离线超级管理员',
          base_role: 'owner',
          base_role_name: '公司老板',
        },
        company: { id: 'local', name: '本地工作空间' },
        application: {
          app_id: serviceConfig.appId,
          name: '谢谢工作台',
          permissions: ['*'],
          permission_source: 'offline-admin',
        },
        management_permissions: ['*'],
        department: null,
        team: null,
      },
    };
  }

  async function offlineAdminStatus() {
    const configured = Boolean(await readOfflineAdmin());
    return { configured };
  }

  async function configureOfflineAdmin({ loginId, password } = {}) {
    const id = String(loginId || '').trim();
    const secret = String(password || '');
    if (id.length < 3) throw new LoginCenterError('INVALID_LOGIN_ID', '离线超级管理员账号至少需要 3 个字符');
    if (secret.length < 8) throw new LoginCenterError('WEAK_PASSWORD', '离线超级管理员密码至少需要 8 个字符');
    const existing = await readOfflineAdmin();
    if (existing) throw new LoginCenterError('OFFLINE_ADMIN_EXISTS', '离线超级管理员已经设置，不能从登录页覆盖');
    const salt = crypto.randomBytes(16).toString('hex');
    await storage.writeJson(OFFLINE_ADMIN_FILE, {
      formatVersion: 1,
      loginId: id,
      salt,
      passwordHash: offlinePasswordHash(secret, salt),
      createdAt: new Date().toISOString(),
    });
    return { configured: true, loginId: id };
  }

  async function offlineLogin({ loginId, password } = {}) {
    const id = String(loginId || '').trim();
    const key = id.toLowerCase();
    const failure = offlineFailures.get(key);
    if (failure && failure.until > Date.now()) {
      throw new LoginCenterError('LOGIN_RATE_LIMITED', '离线登录失败次数过多，请稍后再试', 429);
    }
    const saved = await readOfflineAdmin();
    if (!saved) throw new LoginCenterError('OFFLINE_ADMIN_NOT_CONFIGURED', '尚未设置离线超级管理员');
    const candidate = offlinePasswordHash(String(password || ''), saved.salt);
    const expected = Buffer.from(saved.passwordHash, 'hex');
    const actual = Buffer.from(candidate, 'hex');
    if (saved.loginId.toLowerCase() !== key || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      const count = (failure?.count || 0) + 1;
      offlineFailures.set(key, { count, until: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      throw new LoginCenterError('INVALID_CREDENTIALS', '账号或密码错误', 401);
    }
    offlineFailures.delete(key);
    const serviceConfig = await getConfig();
    session = offlineSession(serviceConfig, saved.loginId);
    return { ...summary(session, serviceConfig, false), offlineAdmin: true };
  }

  function sessionFromLogin(payload, serviceConfig) {
    const data = payload || {};
    const now = Date.now();
    return {
      baseUrl: serviceConfig.baseUrl,
      appId: serviceConfig.appId,
      appVersion: serviceConfig.appVersion,
      accessToken: String(data.access_token || ''),
      refreshToken: String(data.refresh_token || ''),
      accessExpiresAt: now + Math.max(1, Number(data.expires_in) || 900) * 1000,
      refreshExpiresAt: now + Math.max(1, Number(data.refresh_expires_in) || 2592000) * 1000,
      data: {
        ...Object.fromEntries(Object.entries(data).filter(([key]) => !['access_token', 'refresh_token', 'expires_in', 'refresh_expires_in'].includes(key))),
        authoritative_role: String(data.user?.base_role || data.user?.role || 'member'),
      },
    };
  }

  function summary(current, serviceConfig, persisted = true) {
    const data = current?.data || {};
    return {
      authenticated: Boolean(current?.accessToken),
      config: { ...serviceConfig, canEditBaseUrl: true },
      persisted,
      offlineAdmin: Boolean(current?.offlineAdmin),
      session: current ? {
        user: data.user || null,
        company: data.company || null,
        application: data.application || { app_id: serviceConfig.appId, permissions: [] },
        management_permissions: Array.isArray(data.management_permissions) ? data.management_permissions : [],
        department: data.department || null,
        team: data.team || null,
        accessExpiresAt: new Date(current.accessExpiresAt).toISOString(),
        refreshExpiresAt: new Date(current.refreshExpiresAt).toISOString(),
      } : null,
    };
  }

  function permissionManifestPayload(serviceConfig) {
    const catalog = permissionCatalog.manifestCatalog();
    const base = {
      ...catalog,
      app_id: serviceConfig.appId,
      app_version: serviceConfig.appVersion,
    };
    return {
      ...base,
      catalog_version: crypto.createHash('sha256')
        .update(JSON.stringify({
          schema_version: base.schema_version,
          permission_groups: base.permission_groups,
          role_defaults: base.role_defaults,
          page_permissions: base.page_permissions,
        }))
        .digest('hex'),
    };
  }

  async function syncPermissionManifest(current = session, serviceConfig = null) {
    if (!current?.accessToken) throw new LoginCenterError('NO_SESSION', '请先登录工作台', 401);
    const configValue = serviceConfig || await getConfig();
    const client = clientFor(configValue);
    const response = await client.publishPermissionManifest(
      current.accessToken,
      configValue.appId,
      permissionManifestPayload(configValue),
    );
    current.data = {
      ...(current.data || {}),
      permission_manifest: {
        schema_version: response.data?.schema_version || 1,
        app_version: response.data?.app_version || configValue.appVersion,
        catalog_version: response.data?.catalog_version || '',
        permission_count: Array.isArray(response.data?.permission_codes)
          ? response.data.permission_codes.length
          : permissionCatalog.CODES.length,
      },
    };
    return response.data;
  }

  async function syncPermissionManifestSafely(current, serviceConfig) {
    try {
      return await syncPermissionManifest(current, serviceConfig);
    } catch (error) {
      current.data = {
        ...(current.data || {}),
        permission_manifest_error: String(error?.code || error?.message || 'MANIFEST_SYNC_FAILED'),
      };
      return null;
    }
  }

  async function persist() {
    return sessionStore.write(session).catch(() => false);
  }

  async function clearSession() {
    session = null;
    invalidateWorkspace();
    await sessionStore.clear().catch(() => {});
  }

  async function mergeMe(current, serviceConfig) {
    const payload = await clientFor(serviceConfig).me(current.accessToken);
    const me = payload.data || {};
    const data = current.data || {};
    current.data = {
      ...data,
      user: {
        ...(data.user || {}),
        id: me.user_id,
        display_name: me.display_name,
        role: me.role,
        role_name: me.role_name,
        position_id: me.position_id || null,
        base_role: me.base_role || me.role,
        base_role_name: me.base_role_name || me.role_name,
      },
      authoritative_role: String(me.base_role || me.role || data.authoritative_role || data.user?.base_role || data.user?.role || 'member'),
      company: {
        ...(data.company || {}),
        id: me.company_id,
      },
      application: {
        ...(data.application || { app_id: serviceConfig.appId }),
        permissions: Array.isArray(me.application_permissions)
          ? me.application_permissions
          : (Array.isArray(data.application?.permissions) ? data.application.permissions : []),
        permission_source: String(me.application_permission_source || data.application?.permission_source || 'application'),
      },
      management_permissions: Array.isArray(me.management_permissions) ? me.management_permissions : [],
      department: me.department_id ? { id: me.department_id } : null,
      team: me.team_id ? { id: me.team_id } : null,
    };
    return current;
  }

  function currentSessionUser() {
    return session?.data?.user || {};
  }

  function currentSessionRole() {
    return String(
      session?.data?.authoritative_role
      || currentSessionUser().base_role
      || currentSessionUser().role
      || 'member'
    );
  }


  function isOwnerSession() {
    return currentSessionRole() === 'owner';
  }

  function currentActorFallback() {
    return {
      ...(session?.data || {}),
      role: currentSessionRole(),
      base_role: currentSessionRole(),
    };
  }

  function requireDepartmentManager(workspace, departmentId) {
    const actorId = String(currentSessionUser().id || '');
    const role = workspaceModel.roleForUser(workspace, actorId, currentActorFallback());
    if (['owner', 'general_manager'].includes(role)) return;
    if (role !== 'department_manager') {
      throw new LoginCenterError('FORBIDDEN', '只有公司管理或部门主管可以管理部门', 403);
    }
    const departmentIdOfActor = workspaceModel.userAssignment(workspace, actorId, currentActorFallback()).department_id;
    if (!workspaceModel.descendantDepartmentIds(workspace, departmentIdOfActor).has(String(departmentId || ''))) {
      throw new LoginCenterError('FORBIDDEN', '只能管理自己部门及下级部门', 403);
    }
  }

  function requireTeamManager(workspace, teamId) {
    const actorId = String(currentSessionUser().id || '');
    if (!workspaceModel.isTeamLeader(workspace, actorId, teamId, currentActorFallback())) {
      throw new LoginCenterError('FORBIDDEN', '只能管理自己负责的小组', 403);
    }
  }

  function requireMemberManager(workspace, userId) {
    const actorId = String(currentSessionUser().id || '');
    if (!workspaceModel.canManageUser(workspace, actorId, userId, currentActorFallback())) {
      throw new LoginCenterError('FORBIDDEN', '只能给本部门、下级部门或本小组的下级成员授权', 403);
    }
  }

  function ensureCurrentWorkspaceAssignment(workspace) {
    const userId = String(currentSessionUser().id || '');
    if (!userId) return workspace;
    const role = currentSessionRole();
    const current = workspace.users[userId];
    if (isOwnerSession()) {
      workspace.users[userId] = {
        department_id: current?.department_id ?? session?.data?.department?.id ?? null,
        team_id: current?.team_id ?? session?.data?.team?.id ?? null,
        role: 'owner',
        position_id: null,
        permissions: null,
      };
    } else if (!current) {
      const assignment = workspaceModel.userAssignment(workspace, userId, currentActorFallback());
      workspace.users[userId] = {
        department_id: assignment.department_id,
        team_id: assignment.team_id,
        role: ['owner', 'general_manager', 'department_manager', 'team_leader'].includes(role)
          ? role
          : assignment.role,
        position_id: assignment.position_id,
        permissions: null,
      };
    }
    return workspace;
  }

  function localStoresSnapshot() {
    try {
      const rows = typeof listLocalStores === 'function' ? listLocalStores() : [];
      return Array.isArray(rows)
        ? rows.map(item => ({ id: String(item?.id || ''), name: String(item?.name || '') }))
          .filter(item => item.id && item.name)
        : [];
    } catch {
      return [];
    }
  }

  function invalidateWorkspace() {
    workspaceCache = null;
    workspaceReadPromise = null;
    baseUsersCache = null;
    lastPermissionRefreshAt = 0;
  }

  async function readWorkspaceRecord(accessToken, client) {
    try {
      const record = (await client.dataRecord(accessToken, WORKSPACE_COLLECTION, WORKSPACE_RECORD)).data;
      return {
        version: Number(record?.version || 0),
        workspace: ensureCurrentWorkspaceAssignment(
          workspaceModel.normalizeWorkspace(record?.value, session?.data?.company?.id || '')
        ),
      };
    } catch (error) {
      if (error?.code === 'DATA_NOT_FOUND' || Number(error?.statusCode) === 404) return null;
      throw error;
    }
  }

  async function baseUsers(accessToken, client, { refresh = false } = {}) {
    if (!refresh && baseUsersCache && Date.now() - baseUsersCache.at < 5000) return baseUsersCache.rows;
    const rows = (await client.managementUsers(accessToken)).data;
    baseUsersCache = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
    return baseUsersCache.rows;
  }

  async function seedWorkspace(accessToken, client) {
    const centerRole = currentSessionRole();
    if (!['owner', 'general_manager'].includes(centerRole)) {
      throw new LoginCenterError(
        'WORKSPACE_NOT_INITIALIZED',
        '当前软件的组织数据尚未初始化，请先由公司老板登录一次工作台',
        409,
      );
    }
    const [organization, users, positions, templates] = await Promise.all([
      client.organization(accessToken).then(result => result.data),
      baseUsers(accessToken, client, { refresh: true }),
      client.positions(accessToken).then(result => result.data),
      client.permissionTemplates(accessToken).then(result => result.data).catch(() => ({ templates: [] })),
    ]);
    const permissions = {};
    await Promise.all((Array.isArray(users) ? users : []).map(async user => {
      const userId = String(user?.id || user?.user_id || '');
      if (!userId) return;
      try {
        const result = (await client.memberPermissions(accessToken, userId, client.appId)).data;
        permissions[userId] = Array.isArray(result?.permissions) ? result.permissions : null;
      } catch {
        permissions[userId] = null;
      }
    }));
    const usersWithPermissions = (Array.isArray(users) ? users : []).map(user => ({
      ...user,
      permissions: permissions[String(user.id || user.user_id)] ?? null,
    }));
    let storeRows = [];
    try {
      storeRows = (await client.syncStores(accessToken, client.appId, localStoresSnapshot())).data?.stores || [];
    } catch {}
    let workspace = workspaceModel.seedWorkspace({
      companyId: session?.data?.company?.id || '',
      organization,
      users: usersWithPermissions,
      positions,
      permissionTemplates: templates,
      stores: storeRows,
      roleLabels: organization?.role_labels,
    });
    const actorId = String(currentSessionUser().id || '');
    if (actorId && !workspace.users[actorId]) {
      workspace.users[actorId] = {
        department_id: session?.data?.department?.id || null,
        team_id: session?.data?.team?.id || null,
        role: currentSessionRole(),
        position_id: currentSessionUser().position_id || null,
        permissions: null,
      };
    }
    const saved = (await client.putDataRecord(
      accessToken,
      WORKSPACE_COLLECTION,
      WORKSPACE_RECORD,
      workspace,
      null,
    )).data;
    const result = {
      version: Number(saved?.version || 1),
      workspace: ensureCurrentWorkspaceAssignment(
        workspaceModel.normalizeWorkspace(saved?.value || workspace)
      ),
    };
    workspaceCache = result;
    return result;
  }

  async function loadWorkspace(accessToken, client, { refresh = false, seed = true } = {}) {
    if (!refresh && workspaceCache && Date.now() - workspaceCache.at < 5000) return workspaceCache;
    if (!refresh && workspaceReadPromise) return workspaceReadPromise;
    workspaceReadPromise = (async () => {
      let record = await readWorkspaceRecord(accessToken, client);
      if (!record && seed) record = await seedWorkspace(accessToken, client);
      if (!record) {
        throw new LoginCenterError(
          'WORKSPACE_NOT_INITIALIZED',
          '当前软件的组织数据尚未初始化，请先由公司老板登录一次工作台',
          409,
        );
      }
      workspaceCache = { ...record, at: Date.now() };
      return workspaceCache;
    })().finally(() => {
      workspaceReadPromise = null;
    });
    return workspaceReadPromise;
  }

  async function mutateWorkspace(operation) {
    const run = async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await withAuth((accessToken, client) => (
          loadWorkspace(accessToken, client, { refresh: true })
        ));
        const workspace = JSON.parse(JSON.stringify(current.workspace));
        const result = await operation(workspace, current);
        try {
          const saved = await withAuth(async (accessToken, client) => (
            (await client.putDataRecord(
              accessToken,
              WORKSPACE_COLLECTION,
              WORKSPACE_RECORD,
              workspaceModel.normalizeWorkspace(workspace),
              current.version,
            )).data
          ));
          workspaceCache = {
            version: Number(saved?.version || current.version + 1),
            workspace: ensureCurrentWorkspaceAssignment(
              workspaceModel.normalizeWorkspace(saved?.value || workspace)
            ),
            at: Date.now(),
          };
          baseUsersCache = null;
          return result;
        } catch (error) {
          if (error?.code !== 'DATA_VERSION_CONFLICT') throw error;
          lastError = error;
          workspaceCache = null;
        }
      }
      throw lastError || new LoginCenterError('DATA_VERSION_CONFLICT', '组织数据已被其他终端修改，请重试', 409);
    };
    const previous = workspaceMutatePromise || Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    const settled = next.then(() => undefined, () => undefined);
    workspaceMutatePromise = settled;
    settled.finally(() => {
      if (workspaceMutatePromise === settled) workspaceMutatePromise = null;
    });
    return next;
  }

  async function hydrateWorkspaceSession(accessToken, client) {
    if (!session?.accessToken || session.offlineAdmin) return;
    try {
      const current = await loadWorkspace(accessToken, client, { seed: true });
      const user = currentSessionUser();
      const userId = String(user.id || '');
      if (!userId) return;
      ensureCurrentWorkspaceAssignment(current.workspace);
      const projected = workspaceModel.projectUser(current.workspace, {
        ...user,
        role: currentSessionRole(),
        base_role: currentSessionRole(),
      });
      const departmentInfo = workspaceModel.department(current.workspace, projected.department_id);
      const teamInfo = workspaceModel.departmentTeam(current.workspace, projected.team_id);
      session.data = {
        ...(session.data || {}),
        user: {
          ...user,
          role: projected.role,
          base_role: projected.base_role,
          role_name: projected.role_name,
          base_role_name: projected.base_role_name,
          position_id: projected.position_id,
        },
        department: departmentInfo ? { id: departmentInfo.id, name: departmentInfo.name } : null,
        team: teamInfo ? { id: teamInfo.team.id, name: teamInfo.team.name } : null,
        application: {
          ...(session.data?.application || {}),
          permissions: workspaceModel.businessPermissionsForUser(current.workspace, userId, currentActorFallback()),
          permission_source: projected.app_permission_source,
        },
        management_permissions: projected.management_permissions,
      };
      // 这里已经完整拉过一次权限，记下时间，避免用户紧接着点开页面又等一轮网络。
      lastPermissionRefreshAt = Date.now();
    } catch (error) {
      const privilegedFallback = ['owner', 'general_manager'].includes(currentSessionRole());
      session.data = {
        ...(session.data || {}),
        workspace_sync_error: String(error?.code || error?.message || 'WORKSPACE_SYNC_FAILED'),
        ...(privilegedFallback ? {} : {
          application: {
            ...(session.data?.application || {}),
            permissions: [],
            permission_source: 'workspace_unavailable',
          },
          management_permissions: [],
        }),
      };
    }
  }

  async function refreshInternal(baseSession, serviceConfig) {
    if (!baseSession?.refreshToken) throw new LoginCenterError('NO_SESSION', '当前没有可刷新的登录会话', 401);
    if (Number(baseSession.refreshExpiresAt) <= Date.now()) throw new LoginCenterError('REFRESH_EXPIRED', '登录已过期，请重新登录', 401);
    const payload = await clientFor(serviceConfig).refresh(baseSession.refreshToken);
    const token = payload.data || {};
    const now = Date.now();
    const next = {
      ...baseSession,
      baseUrl: serviceConfig.baseUrl,
      appId: serviceConfig.appId,
      appVersion: serviceConfig.appVersion,
      accessToken: String(token.access_token || ''),
      refreshToken: String(token.refresh_token || ''),
      accessExpiresAt: now + Math.max(1, Number(token.expires_in) || 900) * 1000,
      refreshExpiresAt: now + Math.max(1, Number(token.refresh_expires_in) || 2592000) * 1000,
    };
    if (!next.accessToken || !next.refreshToken) throw new LoginCenterError('INVALID_RESPONSE', '全域中枢未返回完整令牌');
    return next;
  }

  async function refreshSession() {
    if (!refreshPromise) refreshPromise = (async () => {
      const serviceConfig = await getConfig();
      if (!session) throw new LoginCenterError('NO_SESSION', '当前没有登录会话', 401);
      if (session.offlineAdmin) throw new LoginCenterError('OFFLINE_MODE', '离线超级管理员不连接云端服务', 503);
      session = await refreshInternal(session, serviceConfig);
      await persist();
      await mergeMe(session, serviceConfig);
      await hydrateWorkspaceSession(session.accessToken, clientFor(serviceConfig));
      await syncPermissionManifestSafely(session, serviceConfig);
      const persisted = await persist();
      return summary(session, serviceConfig, persisted);
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function withAuth(operation) {
    const serviceConfig = await getConfig();
    if (!session) throw new LoginCenterError('NO_SESSION', '请先登录工作台', 401);
    if (session.offlineAdmin) {
      throw new LoginCenterError('OFFLINE_MODE', '当前为离线超级管理员，不能访问云端管理中心', 503);
    }
    if (Number(session.accessExpiresAt) <= Date.now() + REFRESH_MARGIN_MS) {
      await refreshSession();
    }
    try {
      return await operation(session.accessToken, clientFor(serviceConfig));
    } catch (error) {
      if (!['TOKEN_EXPIRED', 'UNAUTHORIZED'].includes(String(error?.code || ''))) throw error;
      await refreshSession();
      return operation(session.accessToken, clientFor(serviceConfig));
    }
  }

  async function readSharedPreference(collection, recordKey, fallbackValue) {
    return withAuth(async (accessToken, client) => {
      try {
        const record = (await client.dataRecord(accessToken, collection, recordKey)).data;
        return record?.value && typeof record.value === 'object' ? record.value : fallbackValue;
      } catch (error) {
        if (error?.code === 'DATA_NOT_FOUND' || Number(error?.statusCode) === 404) return fallbackValue;
        throw error;
      }
    });
  }

  async function writeSharedPreference(collection, recordKey, value) {
    return withAuth(async (accessToken, client) => {
      let current = null;
      try {
        current = (await client.dataRecord(accessToken, collection, recordKey)).data;
      } catch (error) {
        if (!(error?.code === 'DATA_NOT_FOUND' || Number(error?.statusCode) === 404)) throw error;
      }
      return (await client.putDataRecord(
        accessToken,
        collection,
        recordKey,
        value,
        current?.version ?? null,
      )).data;
    });
  }

  async function systemLevelPreferences() {
    if (!hasPermission('manage.positions.manage')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有管理系统层级的权限', 403);
    }
    if (session?.offlineAdmin) {
      const local = await readLocalPreferences();
      return {
        labels: local.systemLevelLabels && typeof local.systemLevelLabels === 'object' ? local.systemLevelLabels : {},
        mode: 'local',
      };
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      return { labels: { ...current.workspace.roleLabels }, mode: 'workspace' };
    });
  }

  async function saveSystemLevelLabel({ role, label } = {}) {
    if (!hasPermission('manage.positions.manage')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有管理系统层级的权限', 403);
    }
    const normalizedRole = String(role || '').trim();
    const normalizedLabel = String(label || '').trim();
    if (!SYSTEM_LEVEL_ROLES.has(normalizedRole)) throw new LoginCenterError('INVALID_ROLE', '系统层级不能识别');
    if (!normalizedLabel || normalizedLabel.length > 40) throw new LoginCenterError('INVALID_LABEL', '层级名称需要 1–40 个字符');
    if (session?.offlineAdmin) {
      const local = await readLocalPreferences();
      const labels = {
        ...(local.systemLevelLabels && typeof local.systemLevelLabels === 'object' ? local.systemLevelLabels : {}),
        [normalizedRole]: normalizedLabel,
      };
      await writeLocalPreferences({ ...local, systemLevelLabels: labels });
      return { labels, mode: 'local' };
    }
    return mutateWorkspace(workspace => {
      workspace.roleLabels[normalizedRole] = normalizedLabel;
      return { labels: { ...workspace.roleLabels }, mode: 'workspace' };
    });
  }

  async function profilePreferences() {
    const userId = String(session?.data?.user?.id || '').trim();
    if (!userId) throw new LoginCenterError('NO_SESSION', '请先登录工作台', 401);
    if (session?.offlineAdmin) {
      const local = await readLocalPreferences();
      const profiles = local.profiles && typeof local.profiles === 'object' ? local.profiles : {};
      return { ...(profiles[userId] || {}), mode: 'local' };
    }
    try {
      const value = await readSharedPreference(PROFILE_COLLECTION, profileRecordKey(userId), {});
      return { ...value, mode: 'shared' };
    } catch (error) {
      if (!['CONNECTION_ERROR', 'TIMEOUT', 'DATA_NOT_FOUND', 'HTTP_ERROR'].includes(String(error?.code || ''))) throw error;
      const local = await readLocalPreferences();
      const profiles = local.profiles && typeof local.profiles === 'object' ? local.profiles : {};
      return { ...(profiles[userId] || {}), mode: 'local' };
    }
  }

  async function saveProfilePreferences({ displayName, avatarDataUrl } = {}) {
    const userId = String(session?.data?.user?.id || '').trim();
    if (!userId) throw new LoginCenterError('NO_SESSION', '请先登录工作台', 401);
    const name = String(displayName || '').trim();
    const avatar = String(avatarDataUrl || '').trim();
    if (!name || name.length > 80) throw new LoginCenterError('INVALID_DISPLAY_NAME', '姓名需要 1–80 个字符');
    if (avatar && (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) || avatar.length > 700000)) {
      throw new LoginCenterError('INVALID_AVATAR', '头像需要是 700 KB 以内的 PNG、JPG、WEBP 或 GIF 图片');
    }
    const value = { displayName: name, avatarDataUrl: avatar };
    if (session?.offlineAdmin) {
      const local = await readLocalPreferences();
      const profiles = local.profiles && typeof local.profiles === 'object' ? local.profiles : {};
      await writeLocalPreferences({ ...local, profiles: { ...profiles, [userId]: value } });
      return { ...value, mode: 'local' };
    }
    try {
      await writeSharedPreference(PROFILE_COLLECTION, profileRecordKey(userId), value);
      return { ...value, mode: 'shared' };
    } catch (error) {
      if (!['CONNECTION_ERROR', 'TIMEOUT', 'HTTP_ERROR'].includes(String(error?.code || ''))) throw error;
      const local = await readLocalPreferences();
      const profiles = local.profiles && typeof local.profiles === 'object' ? local.profiles : {};
      await writeLocalPreferences({ ...local, profiles: { ...profiles, [userId]: value } });
      return { ...value, mode: 'local' };
    }
  }

  async function statusInternal() {
    let serviceConfig;
    try {
      serviceConfig = await getConfig();
    } catch (error) {
      return { authenticated: false, config: { baseUrl: DEFAULT_BASE_URL, appId: DEFAULT_APP_ID, appVersion, canEditBaseUrl: true }, error: publicError(error) };
    }
    if (standalone) {
      if (!session?.offlineAdmin) session = offlineSession(serviceConfig, 'standalone', '单机版管理员');
      return { ...summary(session, serviceConfig, false), standalone: true, offlineAdmin: true };
    }
    const offline = await offlineAdminStatus().catch(() => ({ configured: false }));
    let saved;
    try {
      saved = session || await sessionStore.read();
    } catch (error) {
      return { authenticated: false, ...summary(null, serviceConfig, false), error: publicError(error) };
    }
    if (!saved) {
      try {
        await clientFor(serviceConfig).health();
        return { ...summary(null, serviceConfig, false), offlineAdminConfigured: offline.configured };
      } catch (error) {
        return {
          ...summary(null, serviceConfig, false),
          error: publicError(error),
          offlineAdminConfigured: offline.configured,
        };
      }
    }
    if (saved.baseUrl !== serviceConfig.baseUrl || saved.appId !== serviceConfig.appId) {
      await clearSession();
      return summary(null, serviceConfig, false);
    }
    try {
      const accessUsable = Boolean(saved.accessToken)
        && Number(saved.accessExpiresAt) > Date.now() + REFRESH_MARGIN_MS;
      if (accessUsable) {
        session = saved;
        try {
          await mergeMe(session, serviceConfig);
        } catch (error) {
          if (!['TOKEN_EXPIRED', 'UNAUTHORIZED'].includes(String(error?.code || ''))) throw error;
          session = await refreshInternal(saved, serviceConfig);
          await persist();
          await mergeMe(session, serviceConfig);
        }
      } else {
        session = await refreshInternal(saved, serviceConfig);
        await persist();
        await mergeMe(session, serviceConfig);
      }
      await hydrateWorkspaceSession(session.accessToken, clientFor(serviceConfig));
      await syncPermissionManifestSafely(session, serviceConfig);
      const persisted = await persist();
      return summary(session, serviceConfig, persisted);
    } catch (error) {
      if (AUTH_FAILURE_CODES.has(String(error?.code || ''))) {
        await clearSession();
        return summary(null, serviceConfig, false);
      }
      session = null;
      return {
        ...summary(null, serviceConfig, true),
        restorePending: true,
        error: publicError(error),
        offlineAdminConfigured: offline.configured,
      };
    }
  }

  async function status() {
    if (!statusPromise) {
      statusPromise = statusInternal().finally(() => {
        statusPromise = null;
      });
    }
    return statusPromise;
  }

  async function ensureSession() {
    if (session?.accessToken) return true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await status().catch(() => null);
      if (result?.authenticated && session?.accessToken) return true;
      if (!result?.restorePending) break;
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    return Boolean(session?.accessToken);
  }

  async function ensurePermissionsFresh(maxAgeMs = PERMISSION_FRESH_MS) {
    if (!session?.accessToken || session.offlineAdmin) return false;
    // 登录中心在线上时单次往返约 0.6~1.2 秒；这里用本地缓存窗口避免每次动作都联网。
    // 权限真被收回时，main 侧在“判定无权限”后会再强制核对一次，不会误放行。
    const limit = Number.isFinite(Number(maxAgeMs)) ? Math.max(0, Number(maxAgeMs)) : PERMISSION_FRESH_MS;
    if (Date.now() - lastPermissionRefreshAt < limit) {
      return true;
    }
    await withAuth(async (accessToken, client) => {
      await hydrateWorkspaceSession(accessToken, client);
      lastPermissionRefreshAt = Date.now();
    });
    await persist();
    return true;
  }

  async function login({ loginId, password, companyId } = {}) {
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      const serviceConfig = await getConfig();
      const id = String(loginId || '').trim();
      if (!id) throw new LoginCenterError('INVALID_LOGIN_ID', '请输入登录账号');
      if (!password) throw new LoginCenterError('INVALID_PASSWORD', '请输入密码');
      const payload = await clientFor(serviceConfig).login({
        loginId: id,
        password,
        machineId,
        companyId: companyId || null,
      });
      session = sessionFromLogin(payload.data, serviceConfig);
      // 登录接口已经返回完整身份和权限。详情接口短暂异常时不能把刚成功的登录
      // 又显示成“没有登录”；后续操作仍会通过受保护接口做真实校验。
      try {
        await mergeMe(session, serviceConfig);
      } catch (error) {
        if (AUTH_FAILURE_CODES.has(String(error?.code || ''))) throw error;
      }
      await hydrateWorkspaceSession(session.accessToken, clientFor(serviceConfig));
      await syncPermissionManifestSafely(session, serviceConfig);
      const persisted = await persist();
      if (!persisted) throw new LoginCenterError('STORAGE_UNAVAILABLE', 'Windows 安全存储不可用，无法安全保存登录凭据');
      return summary(session, serviceConfig, true);
    })().finally(() => { loginPromise = null; });
    return loginPromise;
  }

  async function logout() {
    const current = session;
    try {
      if (current?.accessToken) await clientFor(await getConfig()).logout(current.accessToken);
    } catch {}
    await clearSession();
    return { authenticated: false };
  }

  async function saveConfig({ baseUrl } = {}) {
    const current = await getConfig();
    const normalized = normalizeBaseUrl(baseUrl);
    const next = { ...current, baseUrl: normalized };
    await clientFor(next).health();
    if (normalized !== current.baseUrl) await clearSession();
    config = next;
    await storage.writeJson(CONFIG_FILE, next);
    return { ...next, canEditBaseUrl: true };
  }

  async function health() {
    const serviceConfig = await getConfig();
    const payload = await clientFor(serviceConfig).health();
    return { ...payload, config: { ...serviceConfig, canEditBaseUrl: true } };
  }

  async function registrationContext({ inviteCode } = {}) {
    const payload = await clientFor(await getConfig()).registrationContext(inviteCode);
    const context = payload.data || {};
    const departments = Array.isArray(context.departments) ? context.departments : [];
    return {
      ...context,
      departments,
      teams: departments.flatMap(department => (
        Array.isArray(department?.teams)
          ? department.teams.map(team => ({ ...team, department_id: department.id, department_name: department.name }))
          : []
      )),
      assignment_mode: 'self_select',
      assignment_message: '邀请码已验证，请选择所属部门和小组；最终职位仍由公司管理员审核时确认',
    };
  }

  async function register(payload = {}) {
    const response = await clientFor(await getConfig()).register({
      invite_code: String(payload.inviteCode || '').trim(),
      login_id: String(payload.loginId || '').trim(),
      password: payload.password,
      display_name: String(payload.displayName || '').trim(),
      department_id: String(payload.departmentId || '').trim() || null,
      team_id: String(payload.teamId || '').trim() || null,
    });
    return response.data;
  }

  async function companyInviteCode() {
    if (session?.offlineAdmin) {
      throw new LoginCenterError('OFFLINE_MODE', '单机版或离线管理员没有公司邀请码', 503);
    }
    if (!hasPermission('manage.organization.view')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看或复制公司邀请码的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const payload = await client.organization(accessToken);
      const inviteCode = String(payload.data?.company?.invite_code || '').trim();
      if (!inviteCode) {
        throw new LoginCenterError('INVITE_NOT_AVAILABLE', '没有读取到公司邀请码，请检查全域中枢的公司信息');
      }
      return { inviteCode };
    });
  }

  async function activateOwner({ activationCode, password, loginId } = {}) {
    const response = await clientFor(await getConfig()).activateOwner(
      activationCode,
      password,
      loginId || null,
    );
    return response.data;
  }

  async function me() {
    return withAuth(async (accessToken, client) => {
      const [profilePayload, current] = await Promise.all([
        client.me(accessToken),
        loadWorkspace(accessToken, client),
      ]);
      const profile = profilePayload.data || {};
      const userId = String(profile.user_id || currentSessionUser().id || '');
      const projected = workspaceModel.projectUser(current.workspace, {
        ...profile,
        id: userId,
        user_id: userId,
        role: profile.base_role || profile.role || currentSessionRole(),
        base_role: profile.base_role || profile.role || currentSessionRole(),
      });
      session.data = {
        ...(session.data || {}),
        user: {
          ...(session.data?.user || {}),
          ...profile,
          id: userId,
          role: projected.role,
          base_role: projected.base_role,
          role_name: projected.role_name,
          base_role_name: projected.base_role_name,
          position_id: projected.position_id,
        },
        department: projected.department_id
          ? { id: projected.department_id, name: projected.department_name || '' }
          : null,
        team: projected.team_id
          ? { id: projected.team_id, name: projected.team_name || '' }
          : null,
        application: {
          ...(session.data?.application || {}),
          permissions: workspaceModel.businessPermissionsForUser(
            current.workspace,
            userId,
            currentActorFallback(),
          ),
          permission_source: projected.app_permission_source,
        },
        management_permissions: projected.management_permissions,
      };
      // me() 每次都结合工作区重新算过权限，等同一次刷新，记下来供后续动作复用。
      lastPermissionRefreshAt = Date.now();
      await persist();
      return {
        ...profile,
        user_id: userId,
        id: userId,
        role: projected.role,
        base_role: projected.base_role,
        role_name: projected.role_name,
        base_role_name: projected.base_role_name,
        position_id: projected.position_id,
        department_id: projected.department_id,
        department_name: projected.department_name,
        team_id: projected.team_id,
        team_name: projected.team_name,
        application_permissions: session.data.application.permissions,
        application_permission_source: projected.app_permission_source,
        management_permissions: projected.management_permissions,
      };
    });
  }

  async function organization() {
    if (![
      'manage.organization.view', 'manage.people.view', 'manage.stores.view',
      'manage.stores.assign', 'manage.approval.review',
    ].some(code => hasPermission(code))) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看组织架构或人员信息的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      const users = await baseUsers(accessToken, client);
      return workspaceModel.projectOrganization(current.workspace, users);
    });
  }

  async function pendingUsers() {
    if (!hasPermission('manage.approval.review')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看待审核成员的权限', 403);
    }
    return withAuth(async accessToken => (await clientFor(await getConfig()).pendingUsers(accessToken)).data);
  }

  async function managementUsers() {
    if (!hasPermission('manage.people.view')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看成员的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const [current, users] = await Promise.all([
        loadWorkspace(accessToken, client),
        baseUsers(accessToken, client),
      ]);
      const actorId = String(currentSessionUser().id || '');
      return workspaceModel.projectUsers(current.workspace, users)
        .filter(item => item.is_hidden !== true)
        .filter(item => item.role !== 'owner' || item.id === actorId)
        .map(item => {
          const canManage = String(item.id) !== actorId
            && workspaceModel.canManageUser(current.workspace, actorId, item.id, currentActorFallback());
          return {
            ...item,
            can_manage: canManage,
            ...(String(item.id) === actorId || canManage ? {} : { management_permissions: [] }),
          };
        });
    });
  }

  function currentPermissionCodes() {
    const data = session?.data || {};
    const business = Array.isArray(data.application?.permissions) ? data.application.permissions : [];
    const management = Array.isArray(data.management_permissions) ? data.management_permissions : [];
    return [...new Set([...business, ...management])];
  }

  function hasPermission(code) {
    if (!session?.accessToken || !code) return false;
    if (isOwnerSession()) return true;
    const required = String(code);
    const business = Array.isArray(session?.data?.application?.permissions)
      ? session.data.application.permissions
      : [];
    if (required.startsWith('workbench.') && business.includes('login') && !permissionCatalog.detailed(business)) {
      return true;
    }
    return permissionCatalog.matches(currentPermissionCodes(), required);
  }

  function canAccessPage(page) {
    if (!session?.accessToken) return false;
    if (page === 'cloudaccount') return true;
    if (isOwnerSession()) return true;
    const business = Array.isArray(session?.data?.application?.permissions)
      ? session.data.application.permissions
      : [];
    return permissionCatalog.pageAllowed(business, String(page || ''));
  }

  async function memberPermissions(payload = {}) {
    if (!hasPermission('manage.people.view') && !hasPermission('manage.permissions.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看成员权限的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      const assignment = workspaceModel.userAssignment(current.workspace, payload.userId);
      return {
        user_id: String(payload.userId || ''),
        department_id: assignment.department_id,
        position_id: assignment.position_id,
        role: assignment.role,
        permissions: workspaceModel.permissionsForUser(current.workspace, payload.userId),
        inherited: !Array.isArray(assignment.permissions),
      };
    });
  }

  async function clearMemberPermissions(payload = {}) {
    if (!hasPermission('manage.permissions.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有设置成员权限的权限', 403);
    }
    return mutateWorkspace(workspace => {
      requireMemberManager(workspace, payload.userId);
      workspaceModel.applyAssignment(workspace, payload.userId, { permissions: null });
      return { userId: String(payload.userId || ''), permissions: null };
    });
  }

  async function managementWrite(method, payload) {
    const actorId = () => String(currentSessionUser().id || '');
    const actorRole = () => currentSessionRole();
    const methodPermission = {
      createDepartment: 'manage.organization.departments',
      moveDepartment: 'manage.organization.departments',
      deleteDepartment: 'manage.organization.departments',
      renameDepartment: 'manage.organization.departments',
      setDepartmentActive: 'manage.organization.departments',
      assignDepartmentManager: 'manage.organization.departments',
      createTeam: 'manage.organization.teams',
      renameTeam: 'manage.organization.teams',
      deleteTeam: 'manage.organization.teams',
      setTeamActive: 'manage.organization.teams',
      assignTeamLeader: 'manage.organization.teams',
      moveTeam: 'manage.organization.teams',
      createPosition: 'manage.positions.manage',
      updatePosition: 'manage.positions.manage',
      setPositionActive: 'manage.positions.manage',
      deletePosition: 'manage.positions.manage',
      assignUserPosition: 'manage.permissions.assign',
      setMemberPermissions: 'manage.permissions.assign',
      moveManagedUser: 'manage.people.move',
      moveManagedUsers: 'manage.people.move',
      createManagedUser: 'manage.people.add',
      approveUser: 'manage.approval.review',
      rejectUser: 'manage.approval.review',
      deleteManagedUsers: 'manage.people.delete',
      updateManagedUserInfo: 'manage.people.edit',
      resetManagedUserPassword: 'manage.people.password',
    }[method];
    if (methodPermission && !hasPermission(methodPermission)) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有执行这个管理功能的权限', 403);
    }
    const newId = prefix => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
    const locateTeam = (workspace, teamId) => {
      for (const department of workspace.departments) {
        const team = department.teams.find(item => String(item.id) === String(teamId || ''));
        if (team) return { department, team };
      }
      return null;
    };
    const nextPositionOrder = (workspace, baseRole, afterId = '') => {
      const baseOrder = { general_manager: 10, department_manager: 20, team_leader: 30, member: 40 }[baseRole] || 40;
      if (afterId) {
        const target = workspace.positions.find(item => String(item.id) === String(afterId));
        if (target) {
          const higher = workspace.positions
            .map(item => Number(item.sort_order || 0))
            .filter(order => order > Number(target.sort_order || 0))
            .sort((left, right) => left - right)[0];
          return higher === undefined
            ? Number(target.sort_order || 0) + 0.5
            : (Number(target.sort_order || 0) + higher) / 2;
        }
      }
      const orders = workspace.positions
        .filter(item => item.base_role === baseRole)
        .map(item => Number(item.sort_order || 0));
      return baseOrder + 0.001 * (orders.length + 1);
    };
    const baseRoleFor = (workspace, role, positionId) => (
      workspaceModel.position(workspace, positionId)?.base_role
      || (workspaceModel.ROLE_ORDER[role] && role !== 'owner' ? role : 'member')
    );

    if (method === 'createDepartment') {
      return mutateWorkspace(workspace => {
        const parentId = String(payload.parentDepartmentId || '');
        if (parentId) requireDepartmentManager(workspace, parentId);
        else if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以新建顶级部门', 403);
        }
        const name = String(payload.name || '').trim().slice(0, 80);
        if (!name) throw new LoginCenterError('INVALID_NAME', '部门名称不能为空');
        const item = {
          id: newId('dept'),
          name,
          parent_department_id: parentId || null,
          active: true,
          managers: [],
          teams: [],
        };
        workspace.departments.push(item);
        return { ...item };
      });
    }
    if (method === 'moveDepartment') {
      return mutateWorkspace(workspace => {
        const item = workspaceModel.department(workspace, payload.id);
        if (!item) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
        requireDepartmentManager(workspace, item.id);
        const parentId = String(payload.parentDepartmentId || '');
        if (parentId) {
          requireDepartmentManager(workspace, parentId);
          if (workspaceModel.descendantDepartmentIds(workspace, item.id).has(parentId)) {
            throw new LoginCenterError('INVALID_MOVE', '不能把部门移动到自己的下级部门');
          }
        } else if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以把部门移动到顶级', 403);
        }
        item.parent_department_id = parentId || null;
        return { ...item };
      });
    }
    if (method === 'deleteDepartment') {
      return mutateWorkspace(workspace => {
        const item = workspaceModel.department(workspace, payload.id);
        if (!item) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
        requireDepartmentManager(workspace, item.id);
        if (workspace.departments.some(child => String(child.parent_department_id || '') === item.id)) {
          throw new LoginCenterError('DEPARTMENT_NOT_EMPTY', '请先删除或移走子部门');
        }
        if (Object.values(workspace.users).some(user => String(user.department_id || '') === item.id)) {
          throw new LoginCenterError('DEPARTMENT_NOT_EMPTY', '请先移走部门中的成员');
        }
        workspace.departments = workspace.departments.filter(candidate => candidate.id !== item.id);
        workspace.storeGrants = workspace.storeGrants.filter(grant => !(grant.scope_type === 'department' && grant.scope_id === item.id));
        return { ok: true };
      });
    }
    if (method === 'createTeam') {
      return mutateWorkspace(workspace => {
        const departmentId = String(payload.departmentId || '');
        requireDepartmentManager(workspace, departmentId);
        const parent = workspaceModel.department(workspace, departmentId);
        if (!parent) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '所属部门不存在', 404);
        const name = String(payload.name || '').trim().slice(0, 80);
        if (!name) throw new LoginCenterError('INVALID_NAME', '小组名称不能为空');
        const team = { id: newId('team'), name, active: true, leaders: [] };
        parent.teams.push(team);
        return { ...team, department_id: parent.id };
      });
    }
    if (method === 'renameDepartment') {
      return mutateWorkspace(workspace => {
        const item = workspaceModel.department(workspace, payload.id);
        if (!item) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
        requireDepartmentManager(workspace, item.id);
        const name = String(payload.name || '').trim().slice(0, 80);
        if (!name) throw new LoginCenterError('INVALID_NAME', '部门名称不能为空');
        item.name = name;
        return { ...item };
      });
    }
    if (method === 'renameTeam') {
      return mutateWorkspace(workspace => {
        const found = locateTeam(workspace, payload.id);
        if (!found) throw new LoginCenterError('TEAM_NOT_FOUND', '小组不存在', 404);
        requireTeamManager(workspace, found.team.id);
        const name = String(payload.name || '').trim().slice(0, 80);
        if (!name) throw new LoginCenterError('INVALID_NAME', '小组名称不能为空');
        found.team.name = name;
        return { ...found.team, department_id: found.department.id };
      });
    }
    if (method === 'deleteTeam') {
      return mutateWorkspace(workspace => {
        const found = locateTeam(workspace, payload.id);
        if (!found) throw new LoginCenterError('TEAM_NOT_FOUND', '小组不存在', 404);
        requireDepartmentManager(workspace, found.department.id);
        if (Object.values(workspace.users).some(user => String(user.team_id || '') === found.team.id)) {
          throw new LoginCenterError('TEAM_NOT_EMPTY', '请先移走小组中的成员');
        }
        found.department.teams = found.department.teams.filter(team => team.id !== found.team.id);
        workspace.storeGrants = workspace.storeGrants.filter(grant => !(grant.scope_type === 'team' && grant.scope_id === found.team.id));
        return { ok: true };
      });
    }
    if (method === 'setDepartmentActive') {
      return mutateWorkspace(workspace => {
        const item = workspaceModel.department(workspace, payload.id);
        if (!item) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
        requireDepartmentManager(workspace, item.id);
        item.active = payload.active === true;
        return { ...item };
      });
    }
    if (method === 'setTeamActive') {
      return mutateWorkspace(workspace => {
        const found = locateTeam(workspace, payload.id);
        if (!found) throw new LoginCenterError('TEAM_NOT_FOUND', '小组不存在', 404);
        requireTeamManager(workspace, found.team.id);
        found.team.active = payload.active === true;
        return { ...found.team, department_id: found.department.id };
      });
    }
    if (method === 'assignDepartmentManager') {
      return mutateWorkspace(workspace => {
        const item = workspaceModel.department(workspace, payload.id);
        if (!item) throw new LoginCenterError('DEPARTMENT_NOT_FOUND', '部门不存在', 404);
        requireDepartmentManager(workspace, item.id);
        const userIds = Array.isArray(payload.userIds)
          ? [...new Set(payload.userIds.map(String).filter(Boolean))]
          : (payload.userId ? [String(payload.userId)] : []);
        item.managers = payload.clear === true ? [] : [...new Set(userIds)];
        return { ...item };
      });
    }
    if (method === 'assignTeamLeader') {
      return mutateWorkspace(workspace => {
        const found = locateTeam(workspace, payload.id);
        if (!found) throw new LoginCenterError('TEAM_NOT_FOUND', '小组不存在', 404);
        requireDepartmentManager(workspace, found.department.id);
        const userIds = Array.isArray(payload.userIds)
          ? [...new Set(payload.userIds.map(String).filter(Boolean))]
          : (payload.userId ? [String(payload.userId)] : []);
        found.team.leaders = payload.clear === true ? [] : [...new Set(userIds)];
        return { ...found.team, department_id: found.department.id };
      });
    }
    if (method === 'createPosition') {
      return mutateWorkspace(workspace => {
        if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以维护公司系统层级', 403);
        }
        const name = String(payload.name || '').trim().slice(0, 80);
        const baseRole = String(payload.baseRole || 'member');
        if (!name || !workspaceModel.ROLE_ORDER[baseRole] || baseRole === 'owner') {
          throw new LoginCenterError('INVALID_POSITION', '层级名称或组织能力无效');
        }
        const item = {
          id: newId('position'),
          name,
          base_role: baseRole,
          department_id: payload.departmentId || null,
          sort_order: payload.afterId
            ? nextPositionOrder(workspace, baseRole, payload.afterId)
            : (Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : nextPositionOrder(workspace, baseRole)),
          active: true,
          permission_codes: [],
        };
        workspace.positions.push(item);
        return { ...item };
      });
    }
    if (method === 'updatePosition') {
      return mutateWorkspace(workspace => {
        if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以维护公司系统层级', 403);
        }
        const item = workspaceModel.position(workspace, payload.id);
        if (!item) throw new LoginCenterError('POSITION_NOT_FOUND', '层级不存在', 404);
        const name = String(payload.name || '').trim().slice(0, 80);
        const baseRole = String(payload.baseRole || item.base_role);
        if (!name || !workspaceModel.ROLE_ORDER[baseRole] || baseRole === 'owner') {
          throw new LoginCenterError('INVALID_POSITION', '层级名称或组织能力无效');
        }
        item.name = name;
        item.base_role = baseRole;
        item.department_id = payload.departmentId || null;
        if (Number.isFinite(Number(payload.sortOrder))) item.sort_order = Number(payload.sortOrder);
        return { ...item };
      });
    }
    if (method === 'setPositionActive') {
      return mutateWorkspace(workspace => {
        if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以启停系统层级', 403);
        }
        const item = workspaceModel.position(workspace, payload.id);
        if (!item) throw new LoginCenterError('POSITION_NOT_FOUND', '层级不存在', 404);
        item.active = payload.active === true;
        return { ...item };
      });
    }
    if (method === 'deletePosition') {
      return mutateWorkspace(workspace => {
        if (!['owner', 'general_manager'].includes(actorRole())) {
          throw new LoginCenterError('FORBIDDEN', '只有公司管理可以删除系统层级', 403);
        }
        const item = workspaceModel.position(workspace, payload.id);
        if (!item) throw new LoginCenterError('POSITION_NOT_FOUND', '层级不存在', 404);
        if (Object.values(workspace.users).some(user => String(user.position_id || '') === item.id)) {
          throw new LoginCenterError('POSITION_IN_USE', '该层级仍有成员使用，不能删除');
        }
        workspace.positions = workspace.positions.filter(candidate => candidate.id !== item.id);
        workspace.permissionTemplates = workspace.permissionTemplates.filter(template => template.role !== `position:${item.id}`);
        return { ok: true };
      });
    }
    if (method === 'assignUserPosition') {
      return mutateWorkspace(workspace => {
        requireMemberManager(workspace, payload.userId);
        return workspaceModel.applyAssignment(workspace, payload.userId, {
          positionId: payload.positionId,
          role: payload.role,
          departmentId: payload.departmentId,
          teamId: payload.teamId,
        });
      });
    }
    if (method === 'setMemberPermissions') {
      return mutateWorkspace(workspace => {
        requireMemberManager(workspace, payload.userId);
        const assignment = workspaceModel.applyAssignment(workspace, payload.userId, {
          permissions: permissionCatalog.normalizedSelection(payload.permissions),
        });
        return { userId: String(payload.userId || ''), permissions: assignment.permissions };
      });
    }
    if (method === 'moveManagedUser' || method === 'moveManagedUsers') {
      const userIds = method === 'moveManagedUser' ? [String(payload.userId || '')] : (Array.isArray(payload.userIds) ? payload.userIds : []);
      return mutateWorkspace(workspace => {
        if (!userIds.length) throw new LoginCenterError('INVALID_USERS', '请选择需要移动的成员');
        for (const userId of userIds) requireMemberManager(workspace, userId);
        const changed = userIds.map(userId => ({
          userId,
          assignment: workspaceModel.applyAssignment(workspace, userId, {
            departmentId: payload.departmentId,
            teamId: payload.teamId,
          }),
        }));
        return changed;
      });
    }
    if (method === 'moveTeam') {
      return mutateWorkspace(workspace => {
        const found = locateTeam(workspace, payload.teamId);
        const target = workspaceModel.department(workspace, payload.departmentId);
        if (!found || !target) throw new LoginCenterError('TEAM_NOT_FOUND', '小组或目标部门不存在', 404);
        requireDepartmentManager(workspace, found.department.id);
        requireDepartmentManager(workspace, target.id);
        found.department.teams = found.department.teams.filter(team => team.id !== found.team.id);
        target.teams.push(found.team);
        for (const assignment of Object.values(workspace.users)) {
          if (String(assignment.team_id || '') === found.team.id) assignment.department_id = target.id;
        }
        return { ...found.team, department_id: target.id };
      });
    }
    if (method === 'createManagedUser') {
      const result = await withAuth(async (accessToken, client) => (
        (await client.createManagedUser(accessToken, {
          login_id: String(payload.loginId || '').trim(),
          password: payload.password,
          display_name: String(payload.displayName || '').trim(),
          department_id: null,
          team_id: null,
          position_id: null,
          role: 'member',
        })).data
      ));
      await mutateWorkspace(workspace => {
        const userId = String(result.id || result.user_id || '');
        if (!userId) throw new LoginCenterError('INVALID_RESPONSE', '新增成员后没有返回成员编号');
        workspaceModel.applyAssignment(workspace, userId, {
          departmentId: payload.departmentId,
          teamId: payload.teamId,
          positionId: payload.positionId,
          role: baseRoleFor(workspace, payload.role, payload.positionId),
        });
      });
      return result;
    }
    if (method === 'approveUser') {
      const role = baseRoleFor(await withAuth((accessToken, client) => loadWorkspace(accessToken, client)).then(current => current.workspace), payload.role, payload.positionId);
      const result = await withAuth(async (accessToken, client) => (
        (await client.approveUser(accessToken, payload.id, {
          role: 'member',
          department_id: null,
          team_id: null,
          position_id: null,
        })).data
      ));
      await mutateWorkspace(workspace => {
        workspaceModel.applyAssignment(workspace, payload.id, {
          departmentId: payload.departmentId,
          teamId: payload.teamId,
          positionId: payload.positionId,
          role,
        });
      });
      return result;
    }
    if (method === 'rejectUser') {
      return withAuth((accessToken, client) => client.rejectUser(accessToken, payload.id, payload.reason || ''));
    }
    if (method === 'deleteManagedUsers') {
      const userIds = Array.isArray(payload.userIds) ? [...new Set(payload.userIds.map(String).filter(Boolean))] : [];
      if (!userIds.length) throw new LoginCenterError('INVALID_USERS', '请选择需要删除的成员');
      const current = await withAuth((accessToken, client) => loadWorkspace(accessToken, client));
      for (const userId of userIds) requireMemberManager(current.workspace, userId);
      const result = await withAuth((accessToken, client) => client.deleteManagedUsers(accessToken, userIds));
      await mutateWorkspace(workspace => {
        for (const userId of userIds) delete workspace.users[userId];
      });
      return result;
    }
    if (method === 'deleteManagedUser') {
      return managementWrite('deleteManagedUsers', { userIds: [payload.userId] });
    }
    if (method === 'updateManagedUserInfo') {
      const current = await withAuth((accessToken, client) => loadWorkspace(accessToken, client));
      requireMemberManager(current.workspace, payload.userId);
      const displayName = String(payload.displayName || '').trim();
      if (!displayName || displayName.length > 80) throw new LoginCenterError('INVALID_DISPLAY_NAME', '姓名需要 1–80 个字符');
      const newPassword = String(payload.newPassword || '');
      if (newPassword && newPassword.length < 8) throw new LoginCenterError('WEAK_PASSWORD', '新密码至少需要 8 个字符');
      if (newPassword && !hasPermission('manage.people.password')) {
        throw new LoginCenterError('FORBIDDEN', '当前账号没有重置成员密码的权限', 403);
      }
      const updated = await withAuth(async (accessToken, client) => (
        (await client.updateManagedUser(accessToken, payload.userId, { display_name: displayName })).data
      ));
      if (newPassword) {
        await withAuth((accessToken, client) => client.resetManagedUserPassword(accessToken, payload.userId, newPassword));
      }
      baseUsersCache = null;
      return updated;
    }
    if (method === 'updateManagedUserName') {
      return managementWrite('updateManagedUserInfo', payload);
    }
    if (method === 'resetManagedUserPassword') {
      const current = await withAuth((accessToken, client) => loadWorkspace(accessToken, client));
      requireMemberManager(current.workspace, payload.userId);
      if (String(payload.newPassword || '').length < 8) {
        throw new LoginCenterError('WEAK_PASSWORD', '新密码至少需要 8 个字符');
      }
      return withAuth((accessToken, client) => (
        client.resetManagedUserPassword(accessToken, payload.userId, payload.newPassword)
      ));
    }
    throw new LoginCenterError('UNKNOWN_ACTION', '不支持的组织管理操作');
  }

  async function updateMyProfile(payload = {}) {
    const result = await withAuth(async (accessToken, client) => (
      await client.updateMyProfile(accessToken, {
        display_name: String(payload.displayName || '').trim(),
      })
    ).data);
    if (session?.data?.user) {
      session.data.user.display_name = result.display_name;
      await persist();
    }
    return result;
  }

  async function changeMyPassword(payload = {}) {
    return withAuth(async (accessToken, client) => (
      await client.changeMyPassword(accessToken, {
        current_password: String(payload.currentPassword || ''),
        new_password: String(payload.newPassword || ''),
      })
    ));
  }

  async function positions() {
    if (![
      'manage.people.view', 'manage.approval.review',
      'manage.permissions.assign', 'manage.positions.manage',
    ].some(code => hasPermission(code))) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看系统层级的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      const users = workspaceModel.projectUsers(current.workspace, await baseUsers(accessToken, client));
      return current.workspace.positions
        .map(item => ({
          ...item,
          base_role_name: workspaceModel.ROLE_LABELS[item.base_role] || item.base_role,
          department_name: workspaceModel.department(current.workspace, item.department_id)?.name || '',
          assigned_count: users.filter(user => String(user.position_id || '') === String(item.id)).length,
        }))
        .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
    });
  }

  async function permissionTemplates() {
    if (!hasPermission('manage.permissions.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有设置功能权限的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      return {
        templates: current.workspace.permissionTemplates,
        positions: current.workspace.positions,
        grantable_permissions: workspaceModel.permissionsForUser(
          current.workspace,
          currentSessionUser().id,
          session?.data || {},
        ),
      };
    });
  }

  async function permissionManifest() {
    return withAuth(async (accessToken, client) => (
      await client.permissionManifest(accessToken, client.appId)
    ).data);
  }

  async function dataCollections() {
    return withAuth(async (accessToken, client) => (
      await client.dataCollections(accessToken)
    ).data);
  }

  async function dataRecords(payload = {}) {
    return withAuth(async (accessToken, client) => (
      await client.dataRecords(accessToken, payload.collection, {
        limit: payload.limit,
        offset: payload.offset,
      })
    ).data);
  }

  async function dataRecord(payload = {}) {
    return withAuth(async (accessToken, client) => (
      await client.dataRecord(accessToken, payload.collection, payload.recordKey)
    ).data);
  }

  async function putDataRecord(payload = {}) {
    return withAuth(async (accessToken, client) => (
      await client.putDataRecord(
        accessToken,
        payload.collection,
        payload.recordKey,
        payload.value,
        payload.expectedVersion ?? null,
      )
    ).data);
  }

  async function deleteDataRecord(payload = {}) {
    return withAuth(async (accessToken, client) => (
      await client.deleteDataRecord(
        accessToken,
        payload.collection,
        payload.recordKey,
        payload.expectedVersion ?? null,
      )
    ));
  }

  async function savePermissionTemplate(payload = {}) {
    return mutateWorkspace(workspace => {
      const departmentId = String(payload.departmentId || '');
      const role = String(payload.role || '*').trim();
      if (!role) throw new LoginCenterError('INVALID_TEMPLATE', '请选择权限模板对应职位');
      if (departmentId && !workspaceModel.department(workspace, departmentId)) {
        throw new LoginCenterError('INVALID_DEPARTMENT', '权限模板所属部门不存在');
      }
      const permissions = permissionCatalog.normalizedSelection(payload.permissions);
      const current = workspace.permissionTemplates.find(item => (
        String(item.department_id || '') === departmentId && String(item.role) === role
      ));
      if (current) current.permissions = permissions;
      else workspace.permissionTemplates.push({ department_id: departmentId || null, role, permissions });
      return { department_id: departmentId || null, role, permissions };
    });
  }

  async function syncStores(payload = {}) {
    const stores = Array.isArray(payload.stores)
      ? payload.stores.map(store => ({ id: String(store.id || ''), name: String(store.name || '') }))
      : [];
    if (session?.offlineAdmin) {
      return {
        store_keys: stores.map(store => store.id).filter(Boolean),
        stores: stores.filter(store => store.id).map(store => ({ store_key: store.id, name: store.name })),
      };
    }
    return withAuth(async (accessToken, client) => {
      const current = await loadWorkspace(accessToken, client);
      const workspace = JSON.parse(JSON.stringify(current.workspace));
      let changed = false;
      for (const store of stores.filter(item => item.id && item.name)) {
        const existing = workspace.stores.find(item => item.id === store.id);
        if (!existing) {
          workspace.stores.push({ id: store.id, name: store.name, active: true });
          changed = true;
        } else if (existing.name !== store.name) {
          existing.name = store.name;
          changed = true;
        }
      }
      if (changed) {
        await mutateWorkspace(target => {
          for (const store of stores.filter(item => item.id && item.name)) {
            const existing = target.stores.find(item => item.id === store.id);
            if (!existing) target.stores.push({ id: store.id, name: store.name, active: true });
            else existing.name = store.name;
          }
        });
        const refreshed = await loadWorkspace(accessToken, client, { refresh: true });
        Object.assign(workspace, refreshed.workspace);
      }
      const actorId = String(currentSessionUser().id || '');
      const defaultAll = ['owner', 'general_manager'].includes(currentSessionRole());
      const visible = workspaceModel.visibleStoreKeys(workspace, actorId, currentActorFallback());
      const visibleSet = new Set(visible);
      return {
        stores: workspace.stores.filter(store => visibleSet.has(store.id)).map(store => ({
          store_key: store.id,
          name: store.name,
          default_all: defaultAll,
          owner_user_id: workspace.storeGrants.find(grant => grant.store_id === store.id && grant.scope_type === 'user')?.scope_id || null,
          department_id: workspace.storeGrants.find(grant => grant.store_id === store.id && grant.scope_type === 'department')?.scope_id || null,
          team_id: workspace.storeGrants.find(grant => grant.store_id === store.id && grant.scope_type === 'team')?.scope_id || null,
        })),
        store_keys: visible,
      };
    });
  }

  async function registerStore(payload = {}) {
    if (session?.offlineAdmin) return { store_keys: [String(payload.id || '')], stores: [] };
    const storeId = String(payload.id || '').trim();
    const storeName = String(payload.name || '').trim();
    if (!storeId || !storeName) throw new LoginCenterError('INVALID_STORE', '店铺编号或名称无效');
    await mutateWorkspace(workspace => {
      const existing = workspace.stores.find(item => item.id === storeId);
      if (existing) existing.name = storeName;
      else workspace.stores.push({ id: storeId, name: storeName, active: true });
      if (!['owner', 'general_manager'].includes(currentSessionRole())
        && !workspace.storeGrants.some(grant => grant.store_id === storeId)) {
        const actorId = String(currentSessionUser().id || '');
        const actor = workspaceModel.userAssignment(workspace, actorId, session?.data || {});
        if (actor.team_id) workspace.storeGrants.push({ store_id: storeId, scope_type: 'team', scope_id: actor.team_id });
        else if (actor.department_id) workspace.storeGrants.push({ store_id: storeId, scope_type: 'department', scope_id: actor.department_id });
        else workspace.storeGrants.push({ store_id: storeId, scope_type: 'user', scope_id: actorId });
      }
    });
    return syncStores({ stores: localStoresSnapshot() });
  }

  async function renameStore(payload = {}) {
    if (session?.offlineAdmin) return { ok: true };
    const storeId = String(payload.id || '').trim();
    const name = String(payload.name || '').trim().slice(0, 80);
    if (!storeId || !name) throw new LoginCenterError('INVALID_STORE', '店铺名称不能为空');
    return mutateWorkspace(workspace => {
      const store = workspace.stores.find(item => item.id === storeId);
      if (!store) throw new LoginCenterError('STORE_NOT_FOUND', '店铺不存在', 404);
      store.name = name;
      return { ok: true };
    });
  }

  async function removeStore(payload = {}) {
    if (session?.offlineAdmin) return { ok: true };
    const storeId = String(payload.id || '').trim();
    return mutateWorkspace(workspace => {
      workspace.stores = workspace.stores.filter(item => item.id !== storeId);
      workspace.storeGrants = workspace.storeGrants.filter(item => item.store_id !== storeId);
      return { ok: true };
    });
  }

  async function assignStore(payload = {}) {
    if (session?.offlineAdmin) return { ok: true, offline: true };
    return mutateWorkspace(workspace => {
      const storeId = String(payload.id || '').trim();
      const scopeType = String(payload.scopeType || '').trim();
      const scopeId = String(payload.scopeId || '').trim();
      if (!workspace.stores.some(item => item.id === storeId)) {
        throw new LoginCenterError('STORE_NOT_FOUND', '店铺不存在', 404);
      }
      if (!['user', 'department', 'team'].includes(scopeType) || !scopeId) {
        throw new LoginCenterError('INVALID_STORE_SCOPE', '店铺授权范围无效');
      }
      workspace.storeGrants = workspace.storeGrants.filter(item => (
        item.store_id !== storeId || item.scope_type !== scopeType || item.scope_id !== scopeId
      ));
      workspace.storeGrants.push({ store_id: storeId, scope_type: scopeType, scope_id: scopeId });
      return { store_id: storeId, scope_type: scopeType, scope_id: scopeId };
    });
  }

  async function managedStores() {
    if (!hasPermission('manage.stores.view') && !hasPermission('manage.stores.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有查看店铺管理的权限', 403);
    }
    return withAuth(async (accessToken, client) => {
      const [current, users] = await Promise.all([
        loadWorkspace(accessToken, client),
        baseUsers(accessToken, client),
      ]);
      const defaultAll = ['owner', 'general_manager'].includes(currentSessionRole());
      const actorId = String(currentSessionUser().id || '');
      const visibleSet = new Set(workspaceModel.visibleStoreKeys(
        current.workspace,
        actorId,
        currentActorFallback(),
      ));
      const userNames = new Map(users.map(item => [String(item.id || item.user_id || ''), String(item.display_name || item.login_id || '')]));
      return current.workspace.stores.filter(store => visibleSet.has(store.id)).map(store => ({
        ...store,
        default_all: defaultAll,
        grants: current.workspace.storeGrants
          .filter(grant => grant.store_id === store.id)
          .map(grant => {
            if (grant.scope_type === 'user') {
              return { ...grant, scope_name: userNames.get(String(grant.scope_id)) || '成员' };
            }
            if (grant.scope_type === 'department') {
              return { ...grant, scope_name: workspaceModel.department(current.workspace, grant.scope_id)?.name || '部门' };
            }
            return { ...grant, scope_name: workspaceModel.departmentTeam(current.workspace, grant.scope_id)?.team?.name || '小组' };
          }),
      }));
    });
  }

  async function grantUserDirectory(userIds = []) {
    const wanted = new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean));
    if (!wanted.size) return new Map();
    const users = await withAuth((accessToken, client) => baseUsers(accessToken, client));
    return new Map(users
      .filter(item => wanted.has(String(item.id || item.user_id || '')))
      .map(item => [String(item.id || item.user_id), item]));
  }

  function ensureWorkspaceGrantUsers(workspace, userIds, directory) {
    for (const userId of new Set((Array.isArray(userIds) ? userIds : []).map(String).filter(Boolean))) {
      if (workspace.users[userId]) continue;
      const account = directory.get(userId);
      if (!account) throw new LoginCenterError('USER_NOT_FOUND', '店铺授权成员不存在，请刷新成员列表后重试', 404);
      workspaceModel.applyAssignment(workspace, userId, {
        department_id: account.department_id ?? null,
        team_id: account.team_id ?? null,
        role: account.base_role || account.role || 'member',
        position_id: account.position_id ?? null,
        permissions: Array.isArray(account.permissions) ? account.permissions : null,
      });
    }
  }

  async function saveManagedStoreGrants(payload = {}) {
    if (!hasPermission('manage.stores.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有分配店铺的权限', 403);
    }
    const requestedScopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    const requestedUserIds = requestedScopes
      .filter(scope => String(scope?.type || '') === 'user')
      .map(scope => String(scope?.id || ''))
      .filter(Boolean);
    const directory = await grantUserDirectory(requestedUserIds);
    return mutateWorkspace(workspace => {
      const storeId = String(payload.storeId || '');
      const store = workspace.stores.find(item => item.id === storeId);
      if (!store) throw new LoginCenterError('STORE_NOT_FOUND', '店铺不存在', 404);
      const visibleSet = new Set(workspaceModel.visibleStoreKeys(
        workspace,
        String(currentSessionUser().id || ''),
        currentActorFallback(),
      ));
      if (!visibleSet.has(storeId)) {
        throw new LoginCenterError('STORE_FORBIDDEN', '当前账号无权管理这家店铺的授权', 403);
      }
      const scopes = requestedScopes;
      const normalized = [];
      for (const scope of scopes) {
        const type = String(scope?.type || '');
        const id = String(scope?.id || '');
        if (!['user', 'department', 'team'].includes(type) || !id) continue;
        let allowed = false;
        if (type === 'user') {
          ensureWorkspaceGrantUsers(workspace, [id], directory);
          try { requireMemberManager(workspace, id); allowed = true; } catch {}
        } else if (type === 'department') {
          try { requireDepartmentManager(workspace, id); allowed = true; } catch {}
        } else if (type === 'team') {
          try { requireTeamManager(workspace, id); allowed = true; } catch {}
        }
        if (!allowed) continue;
        normalized.push({ store_id: storeId, scope_type: type, scope_id: id });
      }
      const preserved = workspace.storeGrants.filter(grant => {
        if (grant.store_id !== storeId) return true;
        try {
          if (grant.scope_type === 'user') requireMemberManager(workspace, grant.scope_id);
          else if (grant.scope_type === 'department') requireDepartmentManager(workspace, grant.scope_id);
          else if (grant.scope_type === 'team') requireTeamManager(workspace, grant.scope_id);
          else return true;
          return false;
        } catch {
          return true;
        }
      });
      workspace.storeGrants = preserved;
      const seen = new Set();
      for (const grant of normalized) {
        const key = `${grant.scope_type}\u0000${grant.scope_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          workspace.storeGrants.push(grant);
        }
      }
      return { storeId, scopes: normalized };
    });
  }

  async function setManagedStoreUserAccess(payload = {}) {
    if (!hasPermission('manage.stores.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有分配店铺的权限', 403);
    }
    const storeId = String(payload.storeId || '');
    const userId = String(payload.userId || '');
    const authorized = payload.authorized === true;
    if (!storeId || !userId) throw new LoginCenterError('INVALID_STORE_GRANT', '缺少店铺或成员');
    const directory = await grantUserDirectory([userId]);
    return mutateWorkspace(workspace => {
      const store = workspace.stores.find(item => item.id === storeId);
      if (!store) throw new LoginCenterError('STORE_NOT_FOUND', '店铺不存在', 404);
      const visibleSet = new Set(workspaceModel.visibleStoreKeys(
        workspace,
        String(currentSessionUser().id || ''),
        currentActorFallback(),
      ));
      if (!visibleSet.has(storeId)) {
        throw new LoginCenterError('STORE_FORBIDDEN', '只能授权自己已有权限的店铺', 403);
      }
      ensureWorkspaceGrantUsers(workspace, [userId], directory);
      requireMemberManager(workspace, userId);
      const match = grant => String(grant.store_id) === storeId
        && grant.scope_type === 'user'
        && String(grant.scope_id) === userId;
      workspace.storeGrants = workspace.storeGrants.filter(grant => !match(grant));
      if (authorized) workspace.storeGrants.push({ store_id: storeId, scope_type: 'user', scope_id: userId });
      return { storeId, userId, authorized };
    });
  }

  async function addManagedStore(payload = {}) {
    if (!hasPermission('manage.stores.assign')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有新增或授权店铺的权限', 403);
    }
    if (typeof createLocalStore !== 'function') {
      throw new LoginCenterError('STORE_STORAGE_UNAVAILABLE', '当前版本不能从账号与权限新增店铺');
    }
    const name = String(payload.name || '').trim().slice(0, 80);
    if (!name) throw new LoginCenterError('INVALID_STORE', '请输入店铺名称');
    const result = await createLocalStore(name);
    const created = Array.isArray(result) ? result.find(item => String(item.name || '') === name) : (result?.store || result);
    const storeId = String(created?.id || created?.store?.id || '');
    if (!storeId) throw new LoginCenterError('STORE_CREATE_FAILED', '店铺已创建，但没有返回店铺编号');
    await mutateWorkspace(workspace => {
      if (!workspace.stores.some(item => item.id === storeId)) {
        workspace.stores.push({ id: storeId, name, active: true });
      }
    });
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    if (scopes.length) await saveManagedStoreGrants({ storeId, scopes });
    return { id: storeId, name };
  }

  async function removeManagedStore(payload = {}) {
    if (!hasPermission('workbench.accounts.remove')) {
      throw new LoginCenterError('FORBIDDEN', '当前账号没有减少店铺的权限', 403);
    }
    if (typeof removeLocalStore !== 'function') {
      throw new LoginCenterError('STORE_STORAGE_UNAVAILABLE', '当前版本不能从账号与权限减少店铺');
    }
    const storeId = String(payload.storeId || payload.id || '');
    if (!storeId) throw new LoginCenterError('INVALID_STORE', '缺少店铺编号');
    await mutateWorkspace(workspace => {
      workspace.stores = workspace.stores.filter(item => item.id !== storeId);
      workspace.storeGrants = workspace.storeGrants.filter(item => item.store_id !== storeId);
    });
    await removeLocalStore(storeId);
    return { ok: true };
  }

  async function handle(method, payload = {}) {
    const actions = {
      status,
      login,
      offlineLogin,
      configureOfflineAdmin,
      offlineAdminStatus,
      logout,
      refresh: refreshSession,
      config: async () => ({ ...await getConfig(), canEditBaseUrl: true }),
      saveConfig,
      health,
      registrationContext,
      register,
      companyInviteCode,
      activateOwner,
      me,
      organization,
      pendingUsers,
      managementUsers,
      positions,
      memberPermissions,
      clearMemberPermissions,
      permissionTemplates,
      permissionManifest,
      systemLevelPreferences,
      saveSystemLevelLabel,
      profilePreferences,
      saveProfilePreferences,
      updateMyProfile,
      changeMyPassword,
      dataCollections,
      dataRecords,
      dataRecord,
      putDataRecord,
      deleteDataRecord,
      savePermissionTemplate,
      syncStores,
      registerStore,
      renameStore,
      removeStore,
      assignStore,
      managedStores,
      saveManagedStoreGrants,
      setManagedStoreUserAccess,
      addManagedStore,
      removeManagedStore,
      createDepartment: p => managementWrite('createDepartment', p),
      moveDepartment: p => managementWrite('moveDepartment', p),
      deleteDepartment: p => managementWrite('deleteDepartment', p),
      createTeam: p => managementWrite('createTeam', p),
      renameDepartment: p => managementWrite('renameDepartment', p),
      renameTeam: p => managementWrite('renameTeam', p),
      deleteTeam: p => managementWrite('deleteTeam', p),
      setDepartmentActive: p => managementWrite('setDepartmentActive', p),
      setTeamActive: p => managementWrite('setTeamActive', p),
      assignDepartmentManager: p => managementWrite('assignDepartmentManager', p),
      assignTeamLeader: p => managementWrite('assignTeamLeader', p),
      createPosition: p => managementWrite('createPosition', p),
      updatePosition: p => managementWrite('updatePosition', p),
      setPositionActive: p => managementWrite('setPositionActive', p),
      deletePosition: p => managementWrite('deletePosition', p),
      assignUserPosition: p => managementWrite('assignUserPosition', p),
      setSystemRoleLabel: saveSystemLevelLabel,
      createManagedUser: p => managementWrite('createManagedUser', p),
      updateManagedUserInfo: p => managementWrite('updateManagedUserInfo', p),
      moveManagedUser: p => managementWrite('moveManagedUser', p),
      moveManagedUsers: p => managementWrite('moveManagedUsers', p),
      deleteManagedUsers: p => managementWrite('deleteManagedUsers', p),
      updateManagedUserName: p => managementWrite('updateManagedUserName', p),
      deleteManagedUser: p => managementWrite('deleteManagedUser', p),
      resetManagedUserPassword: p => managementWrite('resetManagedUserPassword', p),
      moveTeam: p => managementWrite('moveTeam', p),
      approveUser: p => managementWrite('approveUser', p),
      rejectUser: p => managementWrite('rejectUser', p),
      setMemberPermissions: p => managementWrite('setMemberPermissions', p),
      hasPermission: async p => hasPermission(p?.code),
      canAccessPage: async p => canAccessPage(p?.page),
    };
    if (!actions[method]) throw new LoginCenterError('UNKNOWN_ACTION', '不支持的身份中心操作');
    return actions[method](payload);
  }

  return Object.freeze({
    handle,
    hasSession: () => Boolean(session?.accessToken),
    ensureSession,
    ensurePermissionsFresh,
    hasPermission,
    canAccessPage,
    currentPermissionCodes,
    syncStores,
    machineId,
    dispose: async () => { session = null; },
  });
}

module.exports = {
  CONFIG_FILE,
  DEFAULT_APP_ID,
  DEFAULT_BASE_URL,
  createCloudAuthService,
  machineFingerprint,
  publicError,
};
