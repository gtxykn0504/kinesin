importScripts('common.js');

// ---------- 状态广播 ----------
function broadcastSyncStatus(status, message) {
  chrome.runtime.sendMessage({ action: 'syncStatusUpdate', status, message }).catch(() => {});
}

// ---------- 规则读取 ----------
async function loadRules() {
  try {
    const { [STORAGE_KEY]: rules = [] } = await chrome.storage.sync.get(STORAGE_KEY);
    return rules;
  } catch (error) {
    console.error('[Storage] 读取规则失败:', error);
    return [];
  }
}

// ---------- 正则转义 ----------
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- 构建单条跳转规则 ----------
function buildDNRule(rule, idx) {
  // 1. 标准化来源 (from)
  let from = rule.from.trim();
  // 如果完全没有协议和通配符，补为 *://domain/*
  if (!from.includes('://') && !from.includes('*')) {
    from = `*://${from}/*`;
  }

  // 2. 构建正则：最后一个 * 作为路径捕获组 (.*)，其余 * 转为 .*
  const parts = from.split('*');
  let regexFilter = '';
  for (let i = 0; i < parts.length; i++) {
    regexFilter += escapeRegex(parts[i]);
    if (i < parts.length - 1) {
      // 最后一个星号 → 捕获组，其他 → 普通通配
      regexFilter += (i === parts.length - 2) ? '(.*)' : '.*';
    }
  }
  regexFilter = '^' + regexFilter + '$';

  // 3. 标准化目标 (to)
  let to = rule.to.trim();
  if (!/^\w+:\/\//.test(to)) {
    to = 'https://' + to;
  }

  // 4. 如果目标未显式包含捕获组引用（例如 \1），自动追加路径占位
  if (!/\\\d/.test(to)) {
    to = to.replace(/\/+$/, '');      // 去掉尾部斜杠
    to += '/\\1';                    // \1 在字符串中写作 "\\1"
  } else {
    // 目标已包含 \N，提醒用户注意数量匹配
    console.log(`[Redirect] 目标 "${to}" 已包含捕获组引用，请确保数量与源通配符匹配`);
  }

  return {
    id: idx + 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: to }
    },
    condition: {
      regexFilter,
      resourceTypes: ['main_frame']
    }
  };
}

// ---------- 同步动态规则 ----------
async function syncDynamicRules() {
  try {
    const rules = await loadRules();
    const enabledRules = rules.filter(r => r.enabled);
    const dnrRules = enabledRules.map((rule, index) => buildDNRule(rule, index));

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map(r => r.id);
    const maxExistingId = existingIds.length > 0 ? Math.max(...existingIds) : 0;

    const newDnrRules = dnrRules.map((rule, idx) => ({
      ...rule,
      id: maxExistingId + idx + 1
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: newDnrRules
    });

    console.log(`[Redirect] 已同步 ${newDnrRules.length} 条动态规则`);
  } catch (error) {
    console.error('[Redirect] 同步规则失败:', error);
  }
}

// ---------- 下载逻辑 ----------
async function performDownload(trigger) {
  try {
    const config = (await chrome.storage.sync.get(CONFIG_KEY))[CONFIG_KEY];
    if (!config || !syncManager.isSyncEnabled(config)) {
      console.log(`[Download] 同步未启用（${trigger} 触发）`);
      return;
    }

    const mode = config.syncMode || SyncMode.MANUAL;
    let shouldDownload = false;

    if (trigger === 'startup') {
      shouldDownload = (mode === SyncMode.STARTUP || mode === SyncMode.BOTH);
    } else if (trigger === 'popup') {
      shouldDownload = (mode === SyncMode.POPUP || mode === SyncMode.BOTH);
    } else if (trigger === 'manual') {
      shouldDownload = true;
    }

    if (!shouldDownload) {
      console.log(`[Download] 当前模式(${mode})下不执行 ${trigger} 下载`);
      return;
    }

    console.log(`[Download] 开始下载 (触发方式: ${trigger})`);
    broadcastSyncStatus(SyncStatus.DOWNLOADING, '下载中...');

    const result = await syncManager.downloadFromServer();
    if (result) {
      await syncDynamicRules();
      broadcastSyncStatus(SyncStatus.DOWNLOADED, '已下载');
      setTimeout(() => broadcastSyncStatus(SyncStatus.IDLE, '就绪'), 2000);
    } else {
      broadcastSyncStatus(SyncStatus.IDLE, '就绪');
    }
  } catch (error) {
    console.error('[Download] 下载失败:', error);
    broadcastSyncStatus(SyncStatus.ERROR, '下载失败');
  }
}

// ---------- 上传逻辑 ----------
async function performUpload(rules, groups) {
  const config = (await chrome.storage.sync.get(CONFIG_KEY))[CONFIG_KEY];
  if (!config || !syncManager.isSyncEnabled(config)) {
    throw new Error('同步未配置');
  }

  broadcastSyncStatus(SyncStatus.UPLOADING, '上传中...');

  try {
    await syncManager.uploadToServer(rules, groups);
    broadcastSyncStatus(SyncStatus.UPLOADED, '已上传');
    setTimeout(() => broadcastSyncStatus(SyncStatus.IDLE, '就绪'), 2000);
  } catch (error) {
    console.error('[Upload] 上传失败:', error);
    broadcastSyncStatus(SyncStatus.ERROR, '上传失败');
    throw error;
  }
}

// ---------- 消息监听 ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'triggerDownload') {
    performDownload(message.trigger || 'manual').then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.action === 'uploadRules') {
    performUpload(message.rules, message.groups)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ---------- 启动处理 ----------
function handleExtensionStart() {
  syncDynamicRules();
  performDownload('startup');
}

chrome.runtime.onStartup.addListener(handleExtensionStart);
chrome.runtime.onInstalled.addListener(handleExtensionStart);

// ---------- 存储变化监听 ----------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEY]) {
    console.log('[Storage] 规则已变更，正在更新动态规则...');
    syncDynamicRules();
  }
});