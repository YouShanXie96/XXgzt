'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIRECTORY = '用户数据';

function hasNonemptyStores(directory) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, 'stores.json'), 'utf8'));
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

function hasLoginCenterSession(directory) {
  return fs.existsSync(path.join(directory, 'cloud-auth', 'session.json'));
}

function isSubstantiveDataDirectory(directory) {
  if (!fs.existsSync(directory)) return false;
  try {
    if (!fs.statSync(directory).isDirectory()) return false;
  } catch {
    return false;
  }
  return hasNonemptyStores(directory) || hasLoginCenterSession(directory);
}

function selectPackagedDataDir(executableDir, { maxAncestorLevels = 2 } = {}) {
  const executable = path.resolve(executableDir);
  const local = path.join(executable, DATA_DIRECTORY);
  if (isSubstantiveDataDirectory(local)) return local;

  let ancestor = path.dirname(executable);
  for (let level = 0; level < maxAncestorLevels; level += 1) {
    const candidate = path.join(ancestor, DATA_DIRECTORY);
    if (isSubstantiveDataDirectory(candidate)) return candidate;
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return local;
}

module.exports = { DATA_DIRECTORY, hasNonemptyStores, hasLoginCenterSession, isSubstantiveDataDirectory, selectPackagedDataDir };
