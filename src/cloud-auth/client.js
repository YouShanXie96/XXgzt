'use strict';

class LoginCenterError extends Error {
  constructor(code, message, statusCode = 0, details = {}) {
    super(message);
    this.name = 'LoginCenterError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details && typeof details === 'object' ? details : {};
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new LoginCenterError('INVALID_SERVICE_URL', '请填写全域中枢地址');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new LoginCenterError('INVALID_SERVICE_URL', '全域中枢地址格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new LoginCenterError('INVALID_SERVICE_URL', '全域中枢只支持 HTTP 本机地址或 HTTPS 地址');
  if (url.username || url.password) throw new LoginCenterError('INVALID_SERVICE_URL', '全域中枢地址不能包含账号或密码');
  if (url.search || url.hash) throw new LoginCenterError('INVALID_SERVICE_URL', '全域中枢地址不能包含查询参数或片段');
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) throw new LoginCenterError('INVALID_SERVICE_URL', '外网全域中枢必须使用 HTTPS');
  return url.toString().replace(/\/+$/, '');
}

function safeErrorPayload(payload, statusCode) {
  const error = payload && typeof payload === 'object' ? payload.error : null;
  if (error && typeof error === 'object') {
    return new LoginCenterError(
      String(error.code || 'HTTP_ERROR'),
      String(error.message || `全域中枢返回 HTTP ${statusCode}`),
      statusCode,
      error.details,
    );
  }
  return new LoginCenterError('HTTP_ERROR', `全域中枢返回 HTTP ${statusCode}`, statusCode);
}

function createLoginCenterClient({
  baseUrl,
  appId,
  appVersion,
  timeoutMs = 12000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedAppId = String(appId || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(normalizedAppId)) throw new LoginCenterError('INVALID_APP_ID', '工作台应用编号无效');
  if (!normalizedAppId) throw new LoginCenterError('INVALID_APP_ID', '缺少工作台应用编号');
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 HTTPS 请求');

  async function request(method, requestPath, { body, accessToken } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000));
    const headers = { Accept: 'application/json', 'User-Agent': 'LoginCenterClient/1.0' };
    if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response;
    try {
      response = await fetchImpl(`${normalizedBase}${requestPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new LoginCenterError('TIMEOUT', '连接全域中枢超时');
      throw new LoginCenterError('CONNECTION_ERROR', '无法连接全域中枢，请检查服务地址和网络');
    } finally {
      clearTimeout(timeout);
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 2 * 1024 * 1024) throw new LoginCenterError('INVALID_RESPONSE', '全域中枢返回内容过大');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new LoginCenterError('INVALID_RESPONSE', '全域中枢返回内容过大');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new LoginCenterError('INVALID_RESPONSE', `全域中枢返回了无效响应（HTTP ${response.status}）`, response.status);
    }
    if (!response.ok || payload?.ok !== true) throw safeErrorPayload(payload, response.status);
    return payload;
  }

  return Object.freeze({
    baseUrl: normalizedBase,
    appId: normalizedAppId,
    appVersion: String(appVersion || '1.0.0'),
    health: () => request('GET', '/api/v1/health'),
    registrationContext: inviteCode => request('GET', `/api/v1/registration/context?${new URLSearchParams({ invite_code: String(inviteCode || '').trim(), app_id: normalizedAppId })}`),
    register: payload => request('POST', '/api/v1/auth/register', { body: { ...payload, app_id: normalizedAppId } }),
    activateOwner: (activationCode, password, loginId = null) => request('POST', '/api/v1/auth/activate-owner', { body: { activation_code: String(activationCode || '').trim(), password, login_id: loginId || null } }),
    login: ({ loginId, password, machineId, companyId }) => request('POST', '/api/v1/auth/login', {
      body: {
        login_id: String(loginId || '').trim(),
        password,
        app_id: normalizedAppId,
        app_version: String(appVersion || '1.0.0'),
        machine_id: String(machineId || ''),
        ...(companyId ? { company_id: String(companyId) } : {}),
      },
    }),
    refresh: refreshToken => request('POST', '/api/v1/auth/refresh', { body: { refresh_token: refreshToken } }),
    me: accessToken => request('GET', '/api/v1/me', { accessToken }),
    publishPermissionManifest: (accessToken, appId, manifest) => request('PUT', `/api/v1/apps/${encodeURIComponent(appId)}/permission-manifest`, { accessToken, body: { manifest } }),
    permissionManifest: (accessToken, appId) => request('GET', `/api/v1/apps/${encodeURIComponent(appId)}/permission-manifest`, { accessToken }),
    dataCollections: accessToken => request('GET', '/api/v1/data', { accessToken }),
    dataRecords: (accessToken, collection, { limit = 500, offset = 0 } = {}) => request('GET', `/api/v1/data/${encodeURIComponent(collection)}?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`, { accessToken }),
    dataRecord: (accessToken, collection, recordKey) => request('GET', `/api/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(recordKey)}`, { accessToken }),
    putDataRecord: (accessToken, collection, recordKey, value, expectedVersion = null) => request('PUT', `/api/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(recordKey)}`, { accessToken, body: { value, expected_version: expectedVersion } }),
    deleteDataRecord: (accessToken, collection, recordKey, expectedVersion = null) => request('DELETE', `/api/v1/data/${encodeURIComponent(collection)}/${encodeURIComponent(recordKey)}${expectedVersion === null ? '' : `?expected_version=${encodeURIComponent(expectedVersion)}`}`, { accessToken }),
    logout: accessToken => request('POST', '/api/v1/auth/logout', { accessToken }),
    updateMyProfile: (accessToken, payload) => request('PATCH', '/api/v1/me/profile', { accessToken, body: payload }),
    changeMyPassword: (accessToken, payload) => request('POST', '/api/v1/me/password', { accessToken, body: payload }),
    organization: accessToken => request('GET', '/api/v1/management/organization', { accessToken }),
    createDepartment: (accessToken, name, parentDepartmentId = null) => request('POST', '/api/v1/management/departments', { accessToken, body: { name, parent_department_id: parentDepartmentId || null } }),
    moveDepartment: (accessToken, departmentId, parentDepartmentId) => request('PUT', `/api/v1/management/departments/${encodeURIComponent(departmentId)}/move`, { accessToken, body: { parent_department_id: parentDepartmentId || null } }),
    deleteDepartment: (accessToken, departmentId) => request('DELETE', `/api/v1/management/departments/${encodeURIComponent(departmentId)}`, { accessToken }),
    createTeam: (accessToken, departmentId, name) => request('POST', '/api/v1/management/teams', { accessToken, body: { department_id: departmentId, name } }),
    renameDepartment: (accessToken, departmentId, name) => request('PATCH', `/api/v1/management/departments/${encodeURIComponent(departmentId)}`, { accessToken, body: { name } }),
    renameTeam: (accessToken, teamId, name) => request('PATCH', `/api/v1/management/teams/${encodeURIComponent(teamId)}`, { accessToken, body: { name } }),
    deleteTeam: (accessToken, teamId) => request('DELETE', `/api/v1/management/teams/${encodeURIComponent(teamId)}`, { accessToken }),
    setDepartmentActive: (accessToken, departmentId, active) => request('PATCH', `/api/v1/management/departments/${encodeURIComponent(departmentId)}/status`, { accessToken, body: { active: Boolean(active) } }),
    setTeamActive: (accessToken, teamId, active) => request('PATCH', `/api/v1/management/teams/${encodeURIComponent(teamId)}/status`, { accessToken, body: { active: Boolean(active) } }),
    assignDepartmentManager: (accessToken, departmentId, userId) => request('PUT', `/api/v1/management/departments/${encodeURIComponent(departmentId)}/manager`, { accessToken, body: { user_id: userId || null } }),
    assignTeamLeader: (accessToken, teamId, userId) => request('PUT', `/api/v1/management/teams/${encodeURIComponent(teamId)}/leader`, { accessToken, body: { user_id: userId || null } }),
    pendingUsers: accessToken => request('GET', '/api/v1/management/pending', { accessToken }),
    approveUser: (accessToken, userId, payload) => request('POST', `/api/v1/management/pending/${encodeURIComponent(userId)}/approve`, { accessToken, body: payload }),
    rejectUser: (accessToken, userId, reason) => request('POST', `/api/v1/management/pending/${encodeURIComponent(userId)}/reject`, { accessToken, body: { reason: String(reason || '') } }),
    managementUsers: accessToken => request('GET', '/api/v1/management/users', { accessToken }),
    createManagedUser: (accessToken, payload) => request('POST', '/api/v1/management/users', { accessToken, body: payload }),
    moveManagedUsers: (accessToken, payload) => request('PUT', '/api/v1/management/users/batch-organization', { accessToken, body: payload }),
    deleteManagedUsers: (accessToken, userIds) => request('POST', '/api/v1/management/users/batch-delete', { accessToken, body: { user_ids: userIds } }),
    moveManagedUser: (accessToken, userId, payload) => request('PUT', `/api/v1/management/users/${encodeURIComponent(userId)}/organization`, { accessToken, body: payload }),
    updateManagedUser: (accessToken, userId, payload) => request('PATCH', `/api/v1/management/users/${encodeURIComponent(userId)}`, { accessToken, body: payload }),
    deleteManagedUser: (accessToken, userId) => request('DELETE', `/api/v1/management/users/${encodeURIComponent(userId)}`, { accessToken }),
    resetManagedUserPassword: (accessToken, userId, newPassword) => request('POST', `/api/v1/management/users/${encodeURIComponent(userId)}/password`, { accessToken, body: { new_password: newPassword } }),
    moveTeam: (accessToken, teamId, departmentId) => request('PUT', `/api/v1/management/teams/${encodeURIComponent(teamId)}/move`, { accessToken, body: { department_id: departmentId } }),
    positions: accessToken => request('GET', '/api/v1/management/positions', { accessToken }),
    createPosition: (accessToken, payload) => request('POST', '/api/v1/management/positions', { accessToken, body: payload }),
    updatePosition: (accessToken, positionId, payload) => request('PUT', `/api/v1/management/positions/${encodeURIComponent(positionId)}`, { accessToken, body: payload }),
    setSystemRoleLabel: (accessToken, role, label) => request('PUT', `/api/v1/management/system-role-labels/${encodeURIComponent(role)}`, { accessToken, body: { label } }),
    setPositionActive: (accessToken, positionId, active) => request('PATCH', `/api/v1/management/positions/${encodeURIComponent(positionId)}/status`, { accessToken, body: { active: Boolean(active) } }),
    deletePosition: (accessToken, positionId) => request('DELETE', `/api/v1/management/positions/${encodeURIComponent(positionId)}`, { accessToken }),
    assignUserPosition: (accessToken, userId, payload) => request('PUT', `/api/v1/management/users/${encodeURIComponent(userId)}/position`, { accessToken, body: payload }),
    memberPermissions: (accessToken, userId, appId) => request('GET', `/api/v1/management/members/${encodeURIComponent(userId)}/permissions?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken }),
    setMemberPermissions: (accessToken, userId, appId, permissions) => request('PUT', `/api/v1/management/members/${encodeURIComponent(userId)}/permissions?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken, body: { permissions: Array.isArray(permissions) ? permissions : [] } }),
    clearMemberPermissions: (accessToken, userId, appId) => request('DELETE', `/api/v1/management/members/${encodeURIComponent(userId)}/permissions?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken }),
    permissionTemplates: accessToken => request('GET', '/api/v1/management/permission-templates', { accessToken }),
    setPermissionTemplate: (accessToken, payload) => request('PUT', '/api/v1/management/permission-templates', { accessToken, body: payload }),
    syncStores: (accessToken, appId, stores) => request('POST', `/api/v1/management/stores/sync?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken, body: { stores } }),
    registerStore: (accessToken, appId, store) => request('POST', `/api/v1/management/stores?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken, body: store }),
    renameStore: (accessToken, appId, storeKey, name) => request('PATCH', `/api/v1/management/stores/${encodeURIComponent(storeKey)}?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken, body: { id: storeKey, name } }),
    removeStore: (accessToken, appId, storeKey) => request('DELETE', `/api/v1/management/stores/${encodeURIComponent(storeKey)}?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken }),
    assignStore: (accessToken, appId, storeKey, payload) => request('PUT', `/api/v1/management/stores/${encodeURIComponent(storeKey)}/scope?${new URLSearchParams({ app_id: String(appId || '') })}`, { accessToken, body: payload }),
  });
}

module.exports = { LoginCenterError, normalizeBaseUrl, createLoginCenterClient };
