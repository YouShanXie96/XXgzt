'use strict';

const catalog = require('../shared/permissions');

const WORKSPACE_SCHEMA_VERSION = 1;
const ROLE_ORDER = Object.freeze({
  member: 1,
  team_leader: 2,
  department_manager: 3,
  general_manager: 4,
  owner: 5,
});
const ROLE_LABELS = Object.freeze({
  owner: '公司老板',
  general_manager: '总经理',
  department_manager: '部门主管',
  team_leader: '组长',
  member: '组员',
});
const MANAGEMENT_ALIASES = Object.freeze([
  'organization.view',
  'organization.manage',
  'organization.teams.manage',
  'approval.manage',
  'member.manage',
]);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizedId(value) {
  return text(value, 128);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizedId).filter(Boolean))];
}

function activeValue(value, fallback = true) {
  return value === undefined ? fallback : value !== false;
}

function defaultWorkspace(companyId = '') {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    companyId: normalizedId(companyId),
    departments: [],
    users: {},
    positions: [],
    roleLabels: {},
    permissionTemplates: [],
    stores: [],
    storeGrants: [],
  };
}

function normalizeWorkspace(input, companyId = '') {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const workspace = defaultWorkspace(source.companyId || companyId);
  const seenDepartments = new Set();
  for (const raw of Array.isArray(source.departments) ? source.departments : []) {
    const id = normalizedId(raw?.id);
    const name = text(raw?.name, 80);
    if (!id || !name || seenDepartments.has(id)) continue;
    seenDepartments.add(id);
    const seenTeams = new Set();
    const teams = [];
    for (const rawTeam of Array.isArray(raw?.teams) ? raw.teams : []) {
      const teamId = normalizedId(rawTeam?.id);
      const teamName = text(rawTeam?.name, 80);
      if (!teamId || !teamName || seenTeams.has(teamId)) continue;
      seenTeams.add(teamId);
      teams.push({
        id: teamId,
        name: teamName,
        active: activeValue(rawTeam?.active),
        leaders: uniqueStrings(rawTeam?.leaders || rawTeam?.leaderIds),
      });
    }
    workspace.departments.push({
      id,
      name,
      parent_department_id: normalizedId(raw?.parent_department_id || raw?.parentDepartmentId) || null,
      active: activeValue(raw?.active),
      managers: uniqueStrings(raw?.managers || raw?.managerIds),
      teams,
    });
  }

  // Remove cycles and references to unavailable parents so recursive renderers remain safe.
  const departments = new Map(workspace.departments.map(item => [item.id, item]));
  for (const department of workspace.departments) {
    const seen = new Set([department.id]);
    let parentId = department.parent_department_id;
    while (parentId && departments.has(parentId)) {
      if (seen.has(parentId)) {
        department.parent_department_id = null;
        break;
      }
      seen.add(parentId);
      parentId = departments.get(parentId).parent_department_id;
    }
    if (parentId && !departments.has(parentId)) department.parent_department_id = null;
  }

  const seenPositions = new Set();
  for (const raw of Array.isArray(source.positions) ? source.positions : []) {
    const id = normalizedId(raw?.id);
    const name = text(raw?.name, 80);
    const baseRole = text(raw?.base_role || raw?.baseRole, 40);
    if (!id || !name || seenPositions.has(id) || !ROLE_ORDER[baseRole] || baseRole === 'owner') continue;
    seenPositions.add(id);
    const departmentId = normalizedId(raw?.department_id || raw?.departmentId);
    workspace.positions.push({
      id,
      name,
      base_role: baseRole,
      department_id: departmentId && departments.has(departmentId) ? departmentId : null,
      sort_order: Number.isFinite(Number(raw?.sort_order ?? raw?.sortOrder))
        ? Number(raw.sort_order ?? raw.sortOrder)
        : 0,
      active: activeValue(raw?.active),
      permission_codes: catalog.normalizedSelection(raw?.permission_codes || raw?.permissions),
    });
  }
  workspace.positions.sort((left, right) => (
    Number(left.sort_order || 0) - Number(right.sort_order || 0)
    || String(left.name).localeCompare(String(right.name), 'zh-CN')
  ));

  const userEntries = source.users && typeof source.users === 'object' && !Array.isArray(source.users)
    ? Object.entries(source.users)
    : [];
  for (const [rawId, raw] of userEntries) {
    const userId = normalizedId(rawId);
    if (!userId || !raw || typeof raw !== 'object') continue;
    const departmentId = normalizedId(raw.department_id || raw.departmentId);
    const department = departments.get(departmentId);
    const teamId = normalizedId(raw.team_id || raw.teamId);
    const team = department?.teams.find(item => item.id === teamId);
    const role = text(raw.role, 40);
    const positionId = normalizedId(raw.position_id || raw.positionId);
    workspace.users[userId] = {
      department_id: department ? department.id : null,
      team_id: team ? team.id : null,
      role: ROLE_ORDER[role] ? role : 'member',
      position_id: seenPositions.has(positionId) ? positionId : null,
      permissions: Array.isArray(raw.permissions)
        ? catalog.normalizedSelection(raw.permissions)
        : null,
    };
  }

  for (const [role, label] of Object.entries(source.roleLabels || source.role_labels || {})) {
    if (!ROLE_ORDER[text(role, 40)] || !text(label, 40)) continue;
    workspace.roleLabels[text(role, 40)] = text(label, 40);
  }

  const templateKeys = new Set();
  for (const raw of Array.isArray(source.permissionTemplates || source.templates) ? (source.permissionTemplates || source.templates) : []) {
    const departmentId = normalizedId(raw?.department_id || raw?.departmentId);
    const role = text(raw?.role, 120);
    if (!role || (departmentId && !departments.has(departmentId))) continue;
    const key = `${departmentId}\u0000${role}`;
    if (templateKeys.has(key)) continue;
    templateKeys.add(key);
    workspace.permissionTemplates.push({
      department_id: departmentId || null,
      role,
      permissions: catalog.normalizedSelection(raw?.permissions),
    });
  }

  const seenStores = new Set();
  for (const raw of Array.isArray(source.stores) ? source.stores : []) {
    const id = normalizedId(raw?.id || raw?.store_key);
    const name = text(raw?.name, 80);
    if (!id || !name || seenStores.has(id)) continue;
    seenStores.add(id);
    workspace.stores.push({ id, name, active: activeValue(raw?.active) });
  }

  const grantKeys = new Set();
  for (const raw of Array.isArray(source.storeGrants || source.store_grants) ? (source.storeGrants || source.store_grants) : []) {
    const storeId = normalizedId(raw?.store_id || raw?.storeId);
    const scopeType = text(raw?.scope_type || raw?.scopeType, 20);
    const scopeId = normalizedId(raw?.scope_id || raw?.scopeId);
    if (!seenStores.has(storeId) || !['user', 'department', 'team'].includes(scopeType) || !scopeId) continue;
    if (scopeType === 'user' && !workspace.users[scopeId]) continue;
    if (scopeType === 'department' && !departments.has(scopeId)) continue;
    if (scopeType === 'team' && !workspace.departments.some(item => item.teams.some(team => team.id === scopeId))) continue;
    const key = `${storeId}\u0000${scopeType}\u0000${scopeId}`;
    if (!grantKeys.has(key)) {
      grantKeys.add(key);
      workspace.storeGrants.push({ store_id: storeId, scope_type: scopeType, scope_id: scopeId });
    }
  }
  return workspace;
}

function seedWorkspace({
  companyId,
  organization,
  users,
  positions,
  permissionTemplates,
  stores,
  roleLabels,
}) {
  const workspace = defaultWorkspace(companyId || organization?.company_id);
  for (const item of Array.isArray(organization?.departments) ? organization.departments : []) {
    const teams = (Array.isArray(item.teams) ? item.teams : []).map(team => ({
      id: normalizedId(team.id),
      name: text(team.name, 80),
      active: activeValue(team.active),
      leaders: uniqueStrings((Array.isArray(team.leaders) ? team.leaders : []).map(entry => entry.id || entry.user_id))
        .concat(normalizedId(team.leader_user_id || team.leader_id) || []),
    }));
    workspace.departments.push({
      id: normalizedId(item.id),
      name: text(item.name, 80),
      parent_department_id: normalizedId(item.parent_department_id) || null,
      active: activeValue(item.active),
      managers: uniqueStrings((Array.isArray(item.managers) ? item.managers : []).map(entry => entry.id || entry.user_id))
        .concat(normalizedId(item.manager_user_id || item.manager_id) || []),
      teams,
    });
  }
  const baseOrders = {
    general_manager: 10,
    department_manager: 20,
    team_leader: 30,
    member: 40,
  };
  const customCounts = Object.fromEntries(Object.keys(baseOrders).map(role => [role, 0]));
  for (const item of Array.isArray(positions) ? positions : []) {
    const baseRole = text(item.base_role || item.baseRole, 40);
    if (!baseOrders[baseRole]) continue;
    customCounts[baseRole] += 1;
    workspace.positions.push({
      id: normalizedId(item.id),
      name: text(item.name, 80),
      base_role: baseRole,
      department_id: normalizedId(item.department_id) || null,
      sort_order: baseOrders[baseRole] + Number(item.sort_order || 0) / 1000 + customCounts[baseRole] / 100000,
      active: item.active !== false,
      permission_codes: [],
    });
  }
  for (const item of Array.isArray(users) ? users : []) {
    const id = normalizedId(item.id || item.user_id);
    if (!id) continue;
    workspace.users[id] = {
      department_id: normalizedId(item.department_id) || null,
      team_id: normalizedId(item.team_id) || null,
      role: ROLE_ORDER[item.role] ? item.role : 'member',
      position_id: normalizedId(item.position_id) || null,
      permissions: Array.isArray(item.permissions) ? catalog.normalizedSelection(item.permissions) : null,
    };
  }
  const labels = roleLabels && typeof roleLabels === 'object' ? roleLabels : organization?.role_labels;
  if (labels && typeof labels === 'object') workspace.roleLabels = { ...labels };
  const templates = Array.isArray(permissionTemplates)
    ? permissionTemplates
    : (Array.isArray(permissionTemplates?.templates) ? permissionTemplates.templates : []);
  workspace.permissionTemplates = templates.map(item => ({
    department_id: normalizedId(item.department_id) || null,
    role: text(item.role, 120),
    permissions: catalog.normalizedSelection(item.permissions),
  })).filter(item => item.role);
  for (const item of Array.isArray(stores) ? stores : []) {
    const id = normalizedId(item.store_key || item.storeKey || item.id);
    if (!id) continue;
    workspace.stores.push({ id, name: text(item.name || item.store_name || id, 80), active: true });
    if (item.owner_user_id) workspace.storeGrants.push({ store_id: id, scope_type: 'user', scope_id: normalizedId(item.owner_user_id) });
    else if (item.department_id) workspace.storeGrants.push({ store_id: id, scope_type: 'department', scope_id: normalizedId(item.department_id) });
    else if (item.team_id) workspace.storeGrants.push({ store_id: id, scope_type: 'team', scope_id: normalizedId(item.team_id) });
  }
  return normalizeWorkspace(workspace, companyId);
}

function department(workspace, departmentId) {
  return workspace.departments.find(item => String(item.id) === String(departmentId || '')) || null;
}

function departmentTeam(workspace, teamId) {
  for (const item of workspace.departments) {
    const team = item.teams.find(candidate => String(candidate.id) === String(teamId || ''));
    if (team) return { department: item, team };
  }
  return null;
}

function position(workspace, positionId) {
  return workspace.positions.find(item => String(item.id) === String(positionId || '')) || null;
}

function userAssignment(workspace, userId, fallback = {}) {
  const saved = workspace.users[String(userId || '')] || {};
  const chosenPosition = position(workspace, saved.position_id);
  return {
    department_id: saved.department_id ?? fallback.department_id ?? null,
    team_id: saved.team_id ?? fallback.team_id ?? null,
    role: chosenPosition?.base_role || saved.role || fallback.base_role || fallback.role || 'member',
    position_id: chosenPosition?.id || null,
    permissions: Array.isArray(saved.permissions) ? saved.permissions : null,
  };
}

function roleForUser(workspace, userId, fallback = {}) {
  return userAssignment(workspace, userId, fallback).role;
}

function roleRank(role) {
  return ROLE_ORDER[String(role || 'member')] || 1;
}

function descendantDepartmentIds(workspace, departmentId) {
  const root = normalizedId(departmentId);
  if (!root) return new Set();
  const result = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of workspace.departments) {
      if (result.has(String(item.parent_department_id || '')) && !result.has(item.id)) {
        result.add(item.id);
        changed = true;
      }
    }
  }
  return result;
}

function ancestorDepartmentIds(workspace, departmentId) {
  const result = [];
  const seen = new Set();
  let current = department(workspace, departmentId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.push(current.id);
    current = department(workspace, current.parent_department_id);
  }
  return result;
}

function isDepartmentManager(workspace, userId, departmentId, actorFallback = {}) {
  const target = department(workspace, departmentId);
  if (!target) return false;
  const actor = userAssignment(workspace, userId, actorFallback);
  if (['owner', 'general_manager'].includes(actor.role)) return true;
  if (actor.role !== 'department_manager') return false;
  return descendantDepartmentIds(workspace, actor.department_id).has(target.id)
    || target.managers.includes(String(userId));
}

function isTeamLeader(workspace, userId, teamId, actorFallback = {}) {
  const found = departmentTeam(workspace, teamId);
  if (!found) return false;
  const actor = userAssignment(workspace, userId, actorFallback);
  if (['owner', 'general_manager'].includes(actor.role)) return true;
  if (actor.role === 'department_manager') {
    return descendantDepartmentIds(workspace, actor.department_id).has(found.department.id);
  }
  return actor.role === 'team_leader'
    && (actor.team_id === found.team.id || found.team.leaders.includes(String(userId)));
}

function canManageUser(workspace, actorId, targetId, actorFallback = {}) {
  const actor = userAssignment(workspace, actorId, actorFallback);
  const target = userAssignment(workspace, targetId);
  if (!actorId || !targetId || String(actorId) === String(targetId)) return false;
  if (actor.role === 'owner') return true;
  if (roleRank(target.role) >= roleRank(actor.role)) return false;
  if (actor.role === 'general_manager') return true;
  if (actor.role === 'department_manager') {
    return Boolean(
      actor.department_id
      && descendantDepartmentIds(workspace, actor.department_id).has(String(target.department_id || ''))
    );
  }
  if (actor.role === 'team_leader') {
    if (!actor.department_id || String(target.department_id || '') !== String(actor.department_id)) return false;
    if (target.role !== 'member') return false;
    return !target.team_id || String(target.team_id) === String(actor.team_id);
  }
  return false;
}

function templateFor(workspace, departmentId, role) {
  const candidates = [];
  if (departmentId) candidates.push(...ancestorDepartmentIds(workspace, departmentId));
  for (const candidate of candidates) {
    const found = workspace.permissionTemplates.find(item => (
      String(item.department_id || '') === String(candidate)
      && String(item.role) === String(role)
    ));
    if (found) return found.permissions;
  }
  return workspace.permissionTemplates.find(item => (
    !item.department_id && String(item.role) === String(role)
  ))?.permissions || null;
}

function permissionsForUser(workspace, userId, fallback = {}) {
  const actorId = normalizedId(userId);
  if (!actorId) return [];
  const assignment = userAssignment(workspace, actorId, fallback);
  if (assignment.role === 'owner') return catalog.CODES.slice();
  if (Array.isArray(assignment.permissions)) return catalog.normalizedSelection(assignment.permissions);
  const positionId = assignment.position_id;
  const roleTemplates = [
    positionId ? templateFor(workspace, assignment.department_id, `position:${positionId}`) : null,
    templateFor(workspace, assignment.department_id, assignment.role),
    positionId ? templateFor(workspace, null, `position:${positionId}`) : null,
    templateFor(workspace, null, assignment.role),
  ];
  const saved = roleTemplates.find(Array.isArray);
  if (saved) return catalog.normalizedSelection(saved);
  return [...(catalog.ROLE_PRESETS[assignment.role] || catalog.ROLE_PRESETS.member)];
}

function managementPermissionsForUser(workspace, userId, fallback = {}) {
  const actor = userAssignment(workspace, userId, fallback);
  const permissions = permissionsForUser(workspace, userId, fallback);
  const management = permissions.filter(code => code.startsWith('manage.') || code === 'approval.manage');
  if (actor.role === 'owner' || actor.role === 'general_manager') {
    return [...new Set([...management, ...catalog.CODES.filter(code => code.startsWith('manage.')), ...MANAGEMENT_ALIASES])];
  }
  if (actor.role === 'department_manager' || actor.role === 'team_leader') {
    management.push('organization.view', 'manage.organization.view', 'manage.people.view');
  }
  return [...new Set(management)];
}

function businessPermissionsForUser(workspace, userId, fallback = {}) {
  return permissionsForUser(workspace, userId, fallback).filter(code => code.startsWith('workbench.'));
}

function projectOrganization(workspaceInput, baseUsers = []) {
  const workspace = normalizeWorkspace(workspaceInput);
  const users = Array.isArray(baseUsers) ? baseUsers : [];
  const userById = new Map(users.map(item => [String(item.id || item.user_id || ''), item]));
  const summary = account => {
    const id = String(account?.id || account?.user_id || '');
    const source = userById.get(id) || {};
    return {
      id,
      display_name: source.display_name || account?.display_name || source.login_id || '',
      login_id: source.login_id || account?.login_id || '',
    };
  };
  return {
    company_id: workspace.companyId,
    role_labels: { ...workspace.roleLabels },
    departments: workspace.departments.map(item => ({
      id: item.id,
      name: item.name,
      parent_department_id: item.parent_department_id,
      active: item.active,
      managers: item.managers.map(id => summary({ id })).filter(entry => entry.id),
      manager_user_id: item.managers[0] || null,
      teams: item.teams.map(team => ({
        id: team.id,
        name: team.name,
        department_id: item.id,
        active: team.active,
        leaders: team.leaders.map(id => summary({ id })).filter(entry => entry.id),
        leader_user_id: team.leaders[0] || null,
      })),
    })),
  };
}

function projectUser(workspaceInput, account = {}) {
  const workspace = normalizeWorkspace(workspaceInput);
  const userId = String(account.id || account.user_id || '');
  const assignment = userAssignment(workspace, userId, account);
  const dept = department(workspace, assignment.department_id);
  const teamInfo = departmentTeam(workspace, assignment.team_id);
  const positionInfo = position(workspace, assignment.position_id);
  const permissions = permissionsForUser(workspace, userId, account);
  const baseRole = assignment.role;
  return {
    ...account,
    id: userId,
    user_id: userId,
    department_id: assignment.department_id,
    department_name: dept?.name || null,
    team_id: assignment.team_id,
    team_name: teamInfo?.team?.name || null,
    role: baseRole,
    base_role: baseRole,
    position_id: positionInfo?.id || null,
    role_name: positionInfo?.name || workspace.roleLabels[baseRole] || ROLE_LABELS[baseRole] || baseRole,
    base_role_name: workspace.roleLabels[baseRole] || ROLE_LABELS[baseRole] || baseRole,
    app_permissions: permissions,
    management_permissions: managementPermissionsForUser(workspace, userId, account),
    app_permission_source: Array.isArray(assignment.permissions)
      ? 'member'
      : (workspace.permissionTemplates.length ? 'department_position' : 'software_default'),
  };
}

function projectUsers(workspace, baseUsers = []) {
  return (Array.isArray(baseUsers) ? baseUsers : []).map(item => projectUser(workspace, item));
}

function visibleStoreKeys(workspaceInput, userId, actorFallback = {}) {
  const workspace = normalizeWorkspace(workspaceInput);
  const actor = userAssignment(workspace, userId, actorFallback);
  const stores = workspace.stores.filter(item => item.active !== false);
  if (actor.role === 'owner' || actor.role === 'general_manager') return stores.map(item => item.id);
  const actorDepartments = ancestorDepartmentIds(workspace, actor.department_id);
  const managesDepartment = ['department_manager', 'team_leader'].includes(actor.role);
  const managesTeam = actor.role === 'team_leader' || actor.role === 'department_manager';
  const result = new Set();
  for (const grant of workspace.storeGrants) {
    if (grant.scope_type === 'user' && String(grant.scope_id) === String(userId)) result.add(grant.store_id);
    if (grant.scope_type === 'department' && managesDepartment && actorDepartments.includes(String(grant.scope_id))) {
      result.add(grant.store_id);
    }
    if (grant.scope_type === 'team' && managesTeam) {
      const found = departmentTeam(workspace, grant.scope_id);
      const inScope = actor.role === 'team_leader'
        ? actor.team_id && String(grant.scope_id) === String(actor.team_id)
        : found && descendantDepartmentIds(workspace, actor.department_id).has(found.department.id);
      if (inScope) result.add(grant.store_id);
    }
  }
  return stores.filter(item => result.has(item.id)).map(item => item.id);
}

function applyAssignment(workspace, userId, payload = {}) {
  const id = normalizedId(userId);
  if (!id) return null;
  const current = userAssignment(workspace, id);
  const nextDepartment = payload.department_id !== undefined || payload.departmentId !== undefined
    ? normalizedId(payload.department_id ?? payload.departmentId)
    : current.department_id;
  const dept = department(workspace, nextDepartment);
  const nextTeam = payload.team_id !== undefined || payload.teamId !== undefined
    ? normalizedId(payload.team_id ?? payload.teamId)
    : current.team_id;
  const team = dept?.teams.find(item => item.id === nextTeam) || null;
  const nextPosition = payload.position_id !== undefined || payload.positionId !== undefined
    ? normalizedId(payload.position_id ?? payload.positionId)
    : current.position_id;
  const pos = position(workspace, nextPosition);
  const nextRole = pos?.base_role
    || text(payload.role, 40)
    || current.role
    || 'member';
  const assignment = {
    department_id: dept?.id || null,
    team_id: team?.id || null,
    role: ROLE_ORDER[nextRole] && nextRole !== 'owner' ? nextRole : 'member',
    position_id: pos?.id || null,
    permissions: payload.permissions === null
      ? null
      : (Array.isArray(payload.permissions) ? catalog.normalizedSelection(payload.permissions) : current.permissions),
  };
  workspace.users[id] = assignment;
  return assignment;
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION,
  ROLE_ORDER,
  ROLE_LABELS,
  defaultWorkspace,
  normalizeWorkspace,
  seedWorkspace,
  department,
  departmentTeam,
  position,
  userAssignment,
  roleForUser,
  descendantDepartmentIds,
  ancestorDepartmentIds,
  isDepartmentManager,
  isTeamLeader,
  canManageUser,
  permissionsForUser,
  managementPermissionsForUser,
  businessPermissionsForUser,
  projectOrganization,
  projectUser,
  projectUsers,
  visibleStoreKeys,
  applyAssignment,
};
