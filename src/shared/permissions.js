'use strict';

const GROUPS = [
  {
    id: 'accounts', label: '店铺与账号', category: '店铺登录', base: 'workbench.accounts',
    items: [
      ['workbench.accounts.view', '查看店铺列表'],
      ['workbench.accounts.add', '新增店铺'],
      ['workbench.accounts.edit', '修改店铺资料'],
      ['workbench.accounts.remove', '减少 / 移除店铺'],
      ['workbench.accounts.credentials', '设置本机账号'],
      ['workbench.accounts.login', '登录检查与自动登录'],
    ],
  },
  {
    id: 'browser', label: '浏览器与标签', category: '店铺浏览器', base: 'workbench.browser',
    items: [
      ['workbench.browser.view', '打开店铺浏览器'],
      ['workbench.browser.navigate', '输入网址与页面导航'],
      ['workbench.browser.tabs', '新建和关闭标签页'],
      ['workbench.browser.check', '检查登录状态'],
    ],
  },
  {
    id: 'business-daily', label: '日报', category: '经营数据', base: 'workbench.business.daily',
    items: [
      ['workbench.business.daily.view', '查看店铺日报'],
      ['workbench.business.daily.sync', '同步店铺日报'],
      ['workbench.business.daily.export', '导出店铺日报'],
      ['workbench.business.daily.manual', '录入利润 / 报销'],
    ],
  },
  {
    id: 'business-product', label: '精细化', category: '经营数据', base: 'workbench.business.product',
    items: [
      ['workbench.business.product.view', '查看精细化'],
      ['workbench.business.product.sync', '同步精细化'],
      ['workbench.business.product.export', '导出精细化'],
      ['workbench.business.product.marks', '管理待办和黑名单'],
      ['workbench.business.product.trend', '查看数据趋势'],
    ],
  },
  {
    id: 'business-settings', label: '费用与多店同步', category: '经营数据', base: 'workbench.business',
    items: [
      ['workbench.business.fees', '设置扣费与税费'],
      ['workbench.business.sync.manage', '多店铺一键同步'],
    ],
  },
  {
    id: 'selection-trends', label: '趋势关键词', category: '选品', base: 'workbench.selection.trends',
    items: [
      ['workbench.selection.trends.view', '查看'],
      ['workbench.selection.trends.capture', '采集'],
      ['workbench.selection.trends.export', '导出'],
    ],
  },
  {
    id: 'selection-peers', label: '同行榜单', category: '选品', base: 'workbench.selection.peers',
    items: [
      ['workbench.selection.peers.view', '查看'],
      ['workbench.selection.peers.capture', '采集'],
      ['workbench.selection.peers.export', '导出'],
    ],
  },
  {
    id: 'selection-recommendations', label: '月份推荐', category: '选品', base: 'workbench.selection.recommendations',
    items: [
      ['workbench.selection.recommendations.view', '查看'],
      ['workbench.selection.recommendations.import', '导入'],
      ['workbench.selection.recommendations.export', '导出'],
    ],
  },
  {
    id: 'selectionpool', label: '上品库', category: '上品库', base: 'workbench.selectionpool',
    items: [
      ['workbench.selectionpool.view', '查看上品库与店铺登录状态'],
      ['workbench.selectionpool.edit', '编辑 / 删除 / 接收采集'],
      ['workbench.selectionpool.export', '导出 CSV'],
      ['workbench.selectionpool.publish', '自动上架与回填'],
      ['workbench.selectionpool.config', '接口凭证配置'],
    ],
  },
  {
    id: 'reviews', label: '订单与评价', category: '评价晒图', base: 'workbench.reviews',
    items: [
      ['workbench.reviews.view', '查看订单和评价'],
      ['workbench.reviews.sync', '同步订单和评价'],
      ['workbench.reviews.export', '导出订单和评价'],
      ['workbench.reviews.open', '打开订单 / 评价后台'],
    ],
  },
  {
    id: 'promotion-data', label: '推广数据', category: '自动推广', base: 'workbench.promotion',
    items: [
      ['workbench.promotion.view', '查看推广数据'],
      ['workbench.promotion.sync', '同步推广数据'],
      ['workbench.promotion.export', '导出推广数据'],
    ],
  },
  {
    id: 'promotion-rules', label: '推广规则', category: '自动推广', base: 'workbench.promotion',
    items: [
      ['workbench.promotion.rules', '编辑推广规则'],
      ['workbench.promotion.execute', '执行自动推广操作'],
    ],
  },
  {
    id: 'marketing-purchase', label: '内购会', category: '营销创建', base: 'workbench.marketing.purchase',
    items: [
      ['workbench.marketing.purchase.view', '查看'],
      ['workbench.marketing.purchase.create', '准备和创建'],
      ['workbench.marketing.purchase.import', '导入商品'],
      ['workbench.marketing.purchase.export', '导出'],
    ],
  },
  {
    id: 'marketing-gift', label: '托管礼金', category: '营销创建', base: 'workbench.marketing.gift',
    items: [
      ['workbench.marketing.gift.view', '查看'],
      ['workbench.marketing.gift.enroll', '报名'],
      ['workbench.marketing.gift.export', '导出'],
    ],
  },
  {
    id: 'marketing-complaint', label: '投诉打标', category: '营销创建', base: 'workbench.marketing.complaint',
    items: [
      ['workbench.marketing.complaint.preview', '预览'],
      ['workbench.marketing.complaint.execute', '执行'],
      ['workbench.marketing.complaint.export', '导出'],
    ],
  },
  {
    id: 'compliance-scan', label: '违规扫描', category: '违规排查', base: 'workbench.compliance',
    items: [
      ['workbench.compliance.view', '查看违规扫描'],
      ['workbench.compliance.import', '导入待检查商品'],
      ['workbench.compliance.scan', '开始违规扫描'],
      ['workbench.compliance.issues', '处理违规问题'],
      ['workbench.compliance.export', '导出违规结果'],
    ],
  },
  {
    id: 'compliance-settings', label: '词库与计费', category: '违规排查', base: 'workbench.compliance',
    items: [
      ['workbench.compliance.rules', '编辑违规词库'],
      ['workbench.compliance.billing', '查看或充值计费中心'],
    ],
  },
  {
    id: 'ai', label: '预留功能', category: 'AI助手', base: 'workbench.ai',
    items: [['workbench.ai.view', '进入 AI 助手']],
  },
  {
    id: 'settings-appearance', label: '外观', category: '设置', base: 'workbench.settings',
    items: [
      ['workbench.settings.view', '查看设置'],
      ['workbench.settings.theme', '切换深浅模式'],
    ],
  },
  {
    id: 'settings-paths', label: '数据与路径', category: '设置', base: 'workbench.settings',
    items: [
      ['workbench.settings.paths', '修改文件位置'],
      ['workbench.settings.storeData', '管理店铺数据文件夹'],
    ],
  },
  {
    id: 'settings-maintenance', label: '备份与缓存', category: '设置', base: 'workbench.settings',
    items: [
      ['workbench.settings.backup', '备份与恢复'],
      ['workbench.settings.cache', '清除店铺缓存'],
    ],
  },
  {
    id: 'account-members', label: '成员', category: '账号与权限', base: 'manage.people',
    items: [
      ['manage.people.view', '查看成员'],
      ['manage.people.add', '新增成员'],
      ['manage.approval.review', '审核'],
      ['manage.people.edit', '修改成员信息'],
      ['manage.people.password', '重置成员密码'],
      ['manage.people.move', '移动成员'],
      ['manage.people.delete', '删除成员'],
      ['manage.organization.view', '查看组织架构 / 复制公司邀请码'],
      ['manage.organization.departments', '新建 / 修改 / 移动 / 删除部门'],
      ['manage.organization.teams', '新建 / 修改 / 移动 / 删除小组'],
      ['manage.permissions.assign', '设置功能权限 / 权限模板'],
    ],
  },
  {
    id: 'account-positions', label: '系统层级', category: '账号与权限', base: 'manage.positions',
    items: [
      ['manage.positions.manage', '查看 / 新增 / 修改系统层级'],
    ],
  },
  {
    id: 'account-stores', label: '店铺管理', category: '账号与权限', base: 'manage.stores',
    items: [
      ['manage.stores.view', '查看店铺授权'],
      ['manage.stores.assign', '分配店铺授权'],
    ],
  },
];

const ITEMS = Object.freeze(GROUPS.flatMap(group => group.items.map(([code, label]) => ({
  code, label, group: group.label, groupId: group.id, category: group.category,
}))));
const CODES = Object.freeze(ITEMS.map(item => item.code));
const CODE_SET = new Set(CODES);

const PAGE_CODES = Object.freeze({
  accounts: [
    'workbench.accounts.view', 'workbench.accounts.add',
    'workbench.accounts.credentials', 'workbench.accounts.login',
  ],
  browser: ['workbench.browser.view'],
  business: [
    'workbench.business.daily.view', 'workbench.business.product.view',
  ],
  selection: [
    'workbench.selection.trends.view', 'workbench.selection.peers.view',
    'workbench.selection.recommendations.view',
  ],
  trends: ['workbench.selection.trends.view'],
  peers: ['workbench.selection.peers.view'],
  recommendations: ['workbench.selection.recommendations.view'],
  // 兜底挂到「查看店铺」：新权限码尚未由登录中心下发时，页面与 load 也能正常打开。
  // 若后续在登录中心为账号下发了 workbench.selectionpool.* 细粒度权限，可移除兜底项。
  selectionpool: ['workbench.selectionpool.view', 'workbench.accounts.view'],
  reviews: ['workbench.reviews.view'],
  promotion: ['workbench.promotion.view'],
  marketing: [
    'workbench.marketing.purchase.view', 'workbench.marketing.gift.view',
    'workbench.marketing.complaint.preview',
  ],
  purchase: ['workbench.marketing.purchase.view'],
  hostedgift: ['workbench.marketing.gift.view'],
  complaint: ['workbench.marketing.complaint.preview'],
  compliance: ['workbench.compliance.view'],
  ai: ['workbench.ai.view'],
  settings: [
    'workbench.settings.view', 'workbench.settings.theme',
    'workbench.settings.paths', 'workbench.settings.backup',
    'workbench.settings.cache', 'workbench.settings.storeData',
  ],
});

const ROLE_PRESETS = Object.freeze({
  member: [
    'workbench.accounts.view', 'workbench.accounts.credentials', 'workbench.accounts.login',
    'workbench.browser.view',
    'workbench.business.daily.view', 'workbench.business.product.view',
    'workbench.selection.trends.view', 'workbench.reviews.view',
    'workbench.promotion.view', 'workbench.marketing.purchase.view',
    'workbench.marketing.gift.view', 'workbench.marketing.complaint.preview',
    'workbench.compliance.view',
    'workbench.selectionpool.view', 'workbench.selectionpool.edit', 'workbench.selectionpool.export',
  ],
  team_leader: [
    'workbench.accounts.view', 'workbench.accounts.credentials', 'workbench.accounts.login', 'workbench.browser.view',
    'workbench.business.daily.view', 'workbench.business.daily.sync', 'workbench.business.daily.export',
    'workbench.business.product.view', 'workbench.business.product.sync', 'workbench.business.product.export',
    'workbench.business.product.marks', 'workbench.business.product.trend', 'workbench.business.sync.manage',
    'workbench.reviews.view', 'workbench.reviews.sync', 'workbench.reviews.export',
    'manage.organization.view', 'manage.organization.teams', 'manage.people.view',
    'manage.people.add', 'manage.people.edit',
    'manage.permissions.assign', 'manage.approval.review', 'manage.stores.view',
    'workbench.selectionpool.view', 'workbench.selectionpool.edit', 'workbench.selectionpool.export',
    'workbench.selectionpool.publish', 'workbench.selectionpool.config',
  ],
  department_manager: [
    'workbench.accounts.view', 'workbench.accounts.add', 'workbench.accounts.edit',
    'workbench.accounts.credentials',
    'workbench.accounts.remove', 'workbench.accounts.login', 'workbench.browser.view',
    'workbench.business.daily.view', 'workbench.business.daily.sync', 'workbench.business.daily.export',
    'workbench.business.daily.manual', 'workbench.business.product.view',
    'workbench.business.product.sync', 'workbench.business.product.export',
    'workbench.business.product.marks', 'workbench.business.product.trend',
    'workbench.business.fees', 'workbench.business.sync.manage',
    'workbench.reviews.view', 'workbench.reviews.sync', 'workbench.reviews.export',
    'workbench.promotion.view', 'workbench.promotion.sync',
    'manage.organization.view', 'manage.organization.departments', 'manage.organization.teams',
    'manage.people.view', 'manage.people.add', 'manage.people.edit',
    'manage.people.move', 'manage.people.delete', 'manage.people.password',
    'manage.permissions.assign', 'manage.approval.review',
    'manage.stores.view', 'manage.stores.assign',
    'workbench.selectionpool.view', 'workbench.selectionpool.edit', 'workbench.selectionpool.export',
    'workbench.selectionpool.publish', 'workbench.selectionpool.config',
  ],
  general_manager: CODES.slice(),
  owner: CODES.slice(),
});

function manifestCatalog() {
  return {
    schema_version: 1,
    permission_groups: GROUPS.map(group => ({
      id: group.id,
      label: group.label,
      category: group.category,
      base: group.base,
      items: group.items.map(([code, label]) => ({ code, label })),
    })),
    role_defaults: Object.fromEntries(
      Object.entries(ROLE_PRESETS).map(([role, permissions]) => [role, [...permissions]]),
    ),
    page_permissions: Object.fromEntries(
      Object.entries(PAGE_CODES).map(([page, permissions]) => [page, [...permissions]]),
    ),
  };
}

function explicitPermissionList(value) {
  return Array.isArray(value) ? value.filter(code => typeof code === 'string').map(code => code.trim()).filter(Boolean) : [];
}

function matches(granted, required) {
  const list = explicitPermissionList(granted);
  if (!required) return true;
  if (list.includes('*') || list.includes(required)) return true;
  if (required.startsWith('workbench.') && list.includes('workbench.*')) return true;
  if (required.startsWith('manage.') && list.includes('manage.*')) return true;
  const parts = required.split('.');
  for (let index = 1; index < parts.length; index += 1) {
    if (list.includes(parts.slice(0, index).join('.'))) return true;
  }
  return false;
}

function detailed(list) {
  return explicitPermissionList(list).some(code => code.startsWith('workbench.') || code.startsWith('manage.'));
}

function pageAllowed(granted, page) {
  const list = explicitPermissionList(granted);
  if (list.includes('*')) return true;
  const required = PAGE_CODES[page] || [];
  if (required.some(code => matches(list, code))) return true;
  if (!detailed(list) && list.includes('login')) return true;
  return false;
}

function normalizedSelection(list) {
  return [...new Set(explicitPermissionList(list).filter(code => CODE_SET.has(code)))].sort();
}

const api = Object.freeze({
  GROUPS,
  ITEMS,
  CODES,
  CODE_SET,
  PAGE_CODES,
  ROLE_PRESETS,
  matches,
  detailed,
  pageAllowed,
  normalizedSelection,
  manifestCatalog,
});

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.XXPermissionCatalog = api;
