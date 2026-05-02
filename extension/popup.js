class PopupManager {
  constructor() {
    this.rules = [];
    this.groups = [];
    this.syncConfig = null;

    this.initializeElements();
    this.bindEvents();
    this.init();
  }

  initializeElements() {
    this.elements = {
      patternEl: document.getElementById('pattern'),
      targetEl: document.getElementById('target'),
      groupSelectEl: document.getElementById('groupSelect'),
      form: document.getElementById('addForm'),
      settingsLink: document.getElementById('settingsLink'),
      syncStatus: document.getElementById('syncStatus')
    };
  }

  bindEvents() {
    this.bindFormEvents();
    this.bindNavigationEvents();
    this.bindMessageListener();
  }

  bindFormEvents() {
    this.elements.form.addEventListener('submit', (e) => this.handleSubmit(e));
  }

  bindNavigationEvents() {
    this.elements.settingsLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await chrome.runtime.openOptionsPage();
      } catch (error) {
        console.error('Failed to open options page:', error);
      } finally {
        window.close();
      }
    });
  }

  bindMessageListener() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'syncStatusUpdate') {
        this.updateSyncStatus(message.status, message.message);
      }
    });
  }

  async init() {
    try {
      await this.loadData();
      this.updateGroupSelect();
      this.updateSyncStatusVisibility();
      this.updateSyncStatus(SyncStatus.IDLE, '就绪');
      
      // 通知后台 popup 已打开（用于触发自动下载）
      chrome.runtime.sendMessage({ action: 'triggerDownload', trigger: 'popup' }).catch(() => {});
    } catch (error) {
      console.error('Initialization failed:', error);
      this.updateSyncStatus(SyncStatus.ERROR, '初始化错误');
    }
  }

  async loadData() {
    const data = await chrome.storage.sync.get([STORAGE_KEY, GROUPS_KEY, CONFIG_KEY]);
    this.rules = syncManager.validateRules(data[STORAGE_KEY] || []);
    this.groups = syncManager.validateGroups(data[GROUPS_KEY] || []);
    this.syncConfig = data[CONFIG_KEY] || null;
    this.groups = syncManager.ensureDefaultGroup(this.groups);
  }

  async handleSubmit(e) {
    e.preventDefault();
    const from = this.elements.patternEl.value.trim();
    const to = this.elements.targetEl.value.trim();

    if (!from || !to) {
      this.updateSyncStatus(SyncStatus.ERROR, '请填写所有字段');
      return;
    }

    let groupId = this.elements.groupSelectEl.value;
    if (!groupId) {
      groupId = syncManager.determineGroupForRule(from, to, this.groups);
    }

    this.rules.push({
      id: Date.now(),
      from: from,
      to: to,
      enabled: true,
      groupId: groupId
    });

    await this.save();
    this.clearForm();
  }

  clearForm() {
    this.elements.form.reset();
  }

  updateGroupSelect() {
    this.elements.groupSelectEl.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '自动分组';
    this.elements.groupSelectEl.appendChild(defaultOption);
    this.groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group.id;
      option.textContent = group.name;
      this.elements.groupSelectEl.appendChild(option);
    });
  }

  async save() {
    await chrome.storage.sync.set({ 
      [STORAGE_KEY]: this.rules,
      [GROUPS_KEY]: this.groups
    });
    
    // 通过后台执行上传，以便广播状态
    try {
      await chrome.runtime.sendMessage({ 
        action: 'uploadRules', 
        rules: this.rules, 
        groups: this.groups 
      });
    } catch (error) {
      console.error('Upload request failed:', error);
      this.updateSyncStatus(SyncStatus.ERROR, '上传失败');
    }
  }

  updateSyncStatus(status, message) {
    if (!this.elements.syncStatus) return;
    const statusText = message || this.getStatusText(status);
    this.elements.syncStatus.textContent = statusText;
    this.elements.syncStatus.className = 'sync-status';
    switch (status) {
      case SyncStatus.DOWNLOADING:
      case SyncStatus.UPLOADING:
        this.elements.syncStatus.classList.add('syncing');
        break;
      case SyncStatus.DOWNLOADED:
      case SyncStatus.UPLOADED:
        this.elements.syncStatus.classList.add('success');
        break;
      case SyncStatus.ERROR:
        this.elements.syncStatus.classList.add('error');
        break;
      default:
        this.elements.syncStatus.classList.add('idle');
    }
  }

  updateSyncStatusVisibility() {
    if (this.elements.syncStatus) {
      const syncEnabled = this.syncConfig && syncManager.isSyncEnabled(this.syncConfig);
      this.elements.syncStatus.style.display = syncEnabled ? 'block' : 'none';
    }
  }

  getStatusText(status) {
    switch (status) {
      case SyncStatus.DOWNLOADING: return '下载中...';
      case SyncStatus.DOWNLOADED: return '已下载';
      case SyncStatus.UPLOADING: return '上传中...';
      case SyncStatus.UPLOADED: return '已上传';
      case SyncStatus.ERROR: return '错误';
      case SyncStatus.IDLE:
      default: return '就绪';
    }
  }
}

const popupManager = new PopupManager();