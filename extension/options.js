class OptionsManager {
  constructor() {
    this.rules = [];
    this.groups = [];
    this.syncConfig = null;
    this.editingGroupId = null;
    this.editingRuleId = null;
    this.draggedRule = null;

    this.initializeElements();
    this.bindEvents();
    this.init();
  }

  initializeElements() {
    this.elements = {
      navItems: document.querySelectorAll('.nav-item[data-page]'),
      pages: document.querySelectorAll('.page'),
      pageTitle: document.getElementById('pageTitle'),
      groupsContainer: document.getElementById('groupsContainer'),
      statusDiv: document.getElementById('status'),
      syncIndicator: document.getElementById('syncStatus'),
      newFromInput: document.getElementById('newFrom'),
      newToInput: document.getElementById('newTo'),
      newGroupSelect: document.getElementById('newGroup'),
      addRuleBtn: document.getElementById('addRuleBtn'),
      groupModal: document.getElementById('groupModal'),
      groupModalTitle: document.getElementById('groupModalTitle'),
      groupNameInput: document.getElementById('groupName'),
      autoRulesList: document.getElementById('autoRulesList'),
      addAutoRuleBtn: document.getElementById('addAutoRuleBtn'),
      cancelGroupBtn: document.getElementById('cancelGroupBtn'),
      saveGroupBtn: document.getElementById('saveGroupBtn'),
      editRuleModal: document.getElementById('editRuleModal'),
      editFromInput: document.getElementById('editFrom'),
      editToInput: document.getElementById('editTo'),
      editGroupSelect: document.getElementById('editGroup'),
      cancelEditRuleBtn: document.getElementById('cancelEditRuleBtn'),
      saveEditRuleBtn: document.getElementById('saveEditRuleBtn'),
      serverUrlInput: document.getElementById('serverUrl'),
      apiKeyInput: document.getElementById('apiKey'),
      syncModeSelect: document.getElementById('syncMode'),
      saveSettingsBtn: document.getElementById('saveSettingsBtn'),
      downloadBtn: document.getElementById('downloadBtn')
    };
  }

  bindEvents() {
    this.bindNavigationEvents();
    this.bindFormEvents();
    this.bindModalEvents();
    this.bindSyncEvents();
    this.bindMessageListener();
  }

  bindNavigationEvents() {
    this.elements.navItems.forEach(item => {
      item.addEventListener('click', () => this.handleNavClick(item));
      item.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleNavClick(item);
        }
      });
    });
  }

  bindFormEvents() {
    this.elements.addRuleBtn.addEventListener('click', () => this.addRule());
    this.elements.newFromInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addRule();
    });
    this.elements.newToInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addRule();
    });

    const groupForm = document.getElementById('groupForm');
    if (groupForm) {
      groupForm.addEventListener('submit', (e) => e.preventDefault());
    }

    const editRuleForm = document.getElementById('editRuleForm');
    if (editRuleForm) {
      editRuleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveEditRule();
      });
    }
  }

  bindModalEvents() {
    this.elements.cancelGroupBtn.addEventListener('click', () => this.closeGroupModal());
    this.elements.saveGroupBtn.addEventListener('click', () => this.saveGroup());
    this.elements.addAutoRuleBtn.addEventListener('click', () => this.addAutoRuleField());
    this.elements.cancelEditRuleBtn.addEventListener('click', () => this.closeEditRuleModal());
    this.elements.saveEditRuleBtn.addEventListener('click', () => this.saveEditRule());
  }

  bindSyncEvents() {
    this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    this.elements.downloadBtn.addEventListener('click', () => this.manualDownload());
  }

  bindMessageListener() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'syncStatusUpdate') {
        this.updateSyncIndicator(message.status, message.message);
      }
    });
  }

  async init() {
    try {
      await this.loadData();
      this.applyAutoGrouping();
      this.render();
      this.loadSyncSettings();
      this.updateSyncIndicator(SyncStatus.IDLE, '就绪');
    } catch (error) {
      console.error('Initialization failed:', error);
      this.showStatus('加载数据失败', 'error');
    }
  }

  async loadData() {
    const data = await chrome.storage.sync.get([STORAGE_KEY, GROUPS_KEY, CONFIG_KEY]);
    this.rules = syncManager.validateRules(data[STORAGE_KEY] || []);
    this.groups = syncManager.validateGroups(data[GROUPS_KEY] || []);
    this.syncConfig = data[CONFIG_KEY] || null;
    this.groups = syncManager.ensureDefaultGroup(this.groups);
  }

  applyAutoGrouping() {
    this.rules.forEach(rule => {
      if (rule.groupId && rule.groupId !== UNGROUPED_ID) return;
      for (const group of this.groups) {
        if (group.id === UNGROUPED_ID || !group.autoRules) continue;
        for (const autoRule of group.autoRules) {
          if (syncManager.matchesAutoRule(rule, autoRule)) {
            rule.groupId = group.id;
            break;
          }
        }
        if (rule.groupId && rule.groupId !== UNGROUPED_ID) break;
      }
      if (!rule.groupId) rule.groupId = UNGROUPED_ID;
    });
  }

  render() {
    this.renderGroups();
    this.updateGroupSelects();
    this.bindGroupButtons();
  }

  renderGroups() {
    const fragment = document.createDocumentFragment();
    this.groups.forEach(group => {
      const groupRules = this.rules.filter(r => r.groupId === group.id);
      const section = this.createGroupSection(group, groupRules);
      fragment.appendChild(section);
    });
    this.elements.groupsContainer.innerHTML = '';
    this.elements.groupsContainer.appendChild(fragment);
  }

  createGroupSection(group, groupRules) {
    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.groupId = group.id;

    const header = this.createGroupHeader(group, groupRules);
    section.appendChild(header);

    const rulesList = this.createRulesList(group, groupRules);
    section.appendChild(rulesList);

    return section;
  }

  createGroupHeader(group, groupRules) {
    const header = document.createElement('div');
    header.className = 'group-header';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'group-title';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = group.name;
    groupTitle.appendChild(nameSpan);
    const countSpan = document.createElement('span');
    countSpan.className = 'group-count';
    countSpan.textContent = groupRules.length;
    groupTitle.appendChild(countSpan);

    const groupActions = document.createElement('div');
    groupActions.className = 'group-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-group-btn';
    editBtn.title = '编辑分组';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditGroupModal(group.id);
    });
    groupActions.appendChild(editBtn);

    if (group.id !== UNGROUPED_ID) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-group-btn';
      deleteBtn.title = '删除分组';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteGroup(group.id);
      });
      groupActions.appendChild(deleteBtn);
    }

    header.appendChild(groupTitle);
    header.appendChild(groupActions);
    return header;
  }

  createRulesList(group, groupRules) {
    const rulesList = document.createElement('div');
    rulesList.className = 'rules-list';
    rulesList.dataset.groupId = group.id;

    if (groupRules.length === 0) {
      rulesList.innerHTML = '<div class="empty-state">该分组中没有规则</div>';
    } else {
      groupRules.forEach(rule => {
        const card = this.createRuleCard(rule);
        rulesList.appendChild(card);
      });
    }
    this.setupDropZone(rulesList, group.id);
    return rulesList;
  }

  createRuleCard(rule) {
    const card = document.createElement('div');
    card.className = 'rule-card';
    card.draggable = true;
    card.dataset.ruleId = rule.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rule-checkbox';
    checkbox.checked = rule.enabled;
    card.appendChild(checkbox);

    const ruleContent = document.createElement('div');
    ruleContent.className = 'rule-content';
    const ruleFrom = document.createElement('div');
    ruleFrom.className = 'rule-from';
    ruleFrom.textContent = rule.from;
    ruleContent.appendChild(ruleFrom);
    const ruleTo = document.createElement('div');
    ruleTo.className = 'rule-to';
    const ruleArrow = document.createElement('span');
    ruleArrow.className = 'rule-arrow';
    ruleArrow.textContent = '→';
    ruleTo.appendChild(ruleArrow);
    ruleTo.appendChild(document.createTextNode(' ' + rule.to));
    ruleContent.appendChild(ruleTo);
    card.appendChild(ruleContent);

    const ruleActions = document.createElement('div');
    ruleActions.className = 'rule-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.title = '编辑';
    editBtn.textContent = '✏️';
    ruleActions.appendChild(editBtn);
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.title = '删除';
    deleteBtn.textContent = '×';
    ruleActions.appendChild(deleteBtn);
    card.appendChild(ruleActions);

    this.bindRuleCardEvents(card, rule);
    return card;
  }

  bindRuleCardEvents(card, rule) {
    card.querySelector('.rule-checkbox').addEventListener('change', async (e) => {
      rule.enabled = e.target.checked;
      await this.save();
    });
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditRuleModal(rule.id);
    });
    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      this.rules = this.rules.filter(r => r.id !== rule.id);
      await this.save();
    });
    card.addEventListener('dragstart', (e) => {
      this.draggedRule = rule;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      this.draggedRule = null;
      document.querySelectorAll('.rule-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  }

  setupDropZone(element, groupId) {
    element.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      element.classList.add('drag-over');
    });
    element.addEventListener('dragleave', (e) => {
      if (!element.contains(e.relatedTarget)) element.classList.remove('drag-over');
    });
    element.addEventListener('drop', async (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');
      if (this.draggedRule && this.draggedRule.groupId !== groupId) {
        this.draggedRule.groupId = groupId;
        await this.save();
      }
    });
  }

  bindGroupButtons() {
    const addGroupBtn = document.querySelector('.add-group-btn');
    if (addGroupBtn) {
      addGroupBtn.addEventListener('click', () => this.openAddGroupModal());
    }
  }

  updateGroupSelects() {
    const populateSelect = (selectElement, includeDefault = false) => {
      selectElement.innerHTML = '';
      if (includeDefault) {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '自动分组';
        selectElement.appendChild(defaultOption);
      }
      this.groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        selectElement.appendChild(option);
      });
    };
    
    populateSelect(this.elements.newGroupSelect, true);
    populateSelect(this.elements.editGroupSelect);
  }

  async addRule() {
    const from = this.elements.newFromInput.value.trim();
    const to = this.elements.newToInput.value.trim();
    let groupId = this.elements.newGroupSelect.value;

    if (!from || !to) {
      this.showStatus('请填写两个字段', 'error');
      return;
    }
    if (!groupId) {
      groupId = syncManager.determineGroupForRule(from, to, this.groups);
    }
    this.rules.push({
      id: Date.now(),
      from, to,
      enabled: true,
      groupId
    });
    this.clearNewRuleForm();
    await this.save();
    this.showStatus('规则已添加', 'success');
  }

  clearNewRuleForm() {
    this.elements.newFromInput.value = '';
    this.elements.newToInput.value = '';
    this.elements.newGroupSelect.value = '';
  }

  openAddGroupModal() {
    this.editingGroupId = null;
    this.elements.groupModalTitle.textContent = '添加分组';
    this.elements.groupNameInput.value = '';
    this.elements.autoRulesList.innerHTML = '';
    this.elements.groupModal.classList.add('active');
  }

  openEditGroupModal(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;
    this.editingGroupId = groupId;
    this.elements.groupModalTitle.textContent = '编辑分组';
    this.elements.groupNameInput.value = group.name;
    this.elements.autoRulesList.innerHTML = '';
    if (group.autoRules) {
      group.autoRules.forEach(rule => this.addAutoRuleField(rule));
    }
    this.elements.groupModal.classList.add('active');
  }

  closeGroupModal() {
    this.elements.groupModal.classList.remove('active');
    this.editingGroupId = null;
  }

  addAutoRuleField(existingRule = null) {
    const item = document.createElement('div');
    item.className = 'auto-rule-item';
    const field = existingRule ? existingRule.field : 'from';
    const keyword = existingRule ? existingRule.keyword : '';
    
    const select = document.createElement('select');
    select.className = 'auto-rule-field';
    AUTO_RULE_FIELDS.forEach(f => {
      const option = document.createElement('option');
      option.value = f;
      if (field === f) option.selected = true;
      option.textContent = f === 'from' ? '源URL' : f === 'to' ? '目标URL' : '两者都';
      select.appendChild(option);
    });
    item.appendChild(select);
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'auto-rule-keyword';
    input.placeholder = '包含...';
    input.value = keyword;
    item.appendChild(input);
    
    const button = document.createElement('button');
    button.className = 'remove-auto-rule-btn';
    button.textContent = '×';
    button.addEventListener('click', () => item.remove());
    item.appendChild(button);
    
    this.elements.autoRulesList.appendChild(item);
  }

  async saveGroup() {
    const name = this.elements.groupNameInput.value.trim();
    if (!name) {
      this.showStatus('请输入分组名称', 'error');
      return;
    }
    const autoRules = [];
    this.elements.autoRulesList.querySelectorAll('.auto-rule-item').forEach(item => {
      const field = item.querySelector('.auto-rule-field').value;
      const keyword = item.querySelector('.auto-rule-keyword').value.trim();
      if (keyword) autoRules.push({ field, keyword });
    });

    if (this.editingGroupId) {
      const group = this.groups.find(g => g.id === this.editingGroupId);
      if (group) {
        group.name = name;
        group.autoRules = autoRules;
      }
    } else {
      this.groups.push({
        id: 'group_' + Date.now(),
        name,
        autoRules
      });
    }
    this.closeGroupModal();
    this.applyAutoGrouping();
    await this.save();
    this.showStatus('分组已保存', 'success');
  }

  async deleteGroup(groupId) {
    if (groupId === UNGROUPED_ID) return;
    this.rules.filter(r => r.groupId === groupId).forEach(r => r.groupId = UNGROUPED_ID);
    this.groups = this.groups.filter(g => g.id !== groupId);
    await this.save();
    this.showStatus('分组已删除', 'success');
  }

  openEditRuleModal(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;
    this.editingRuleId = ruleId;
    this.elements.editFromInput.value = rule.from;
    this.elements.editToInput.value = rule.to;
    this.elements.editGroupSelect.value = rule.groupId || UNGROUPED_ID;
    this.elements.editRuleModal.classList.add('active');
  }

  closeEditRuleModal() {
    this.elements.editRuleModal.classList.remove('active');
    this.editingRuleId = null;
  }

  async saveEditRule() {
    const rule = this.rules.find(r => r.id === this.editingRuleId);
    if (!rule) return;
    const from = this.elements.editFromInput.value.trim();
    const to = this.elements.editToInput.value.trim();
    const groupId = this.elements.editGroupSelect.value;
    if (!from || !to) {
      this.showStatus('请填写两个字段', 'error');
      return;
    }
    rule.from = from;
    rule.to = to;
    rule.groupId = groupId || UNGROUPED_ID;
    this.closeEditRuleModal();
    await this.save();
    this.showStatus('规则已更新', 'success');
  }

  async save() {
    await chrome.storage.sync.set({ 
      [STORAGE_KEY]: this.rules,
      [GROUPS_KEY]: this.groups
    });
    this.render();
    
    // 通过后台执行上传，以便广播状态
    try {
      await chrome.runtime.sendMessage({ 
        action: 'uploadRules', 
        rules: this.rules, 
        groups: this.groups 
      });
    } catch (error) {
      console.error('Upload request failed:', error);
      this.showStatus('上传失败', 'error');
    }
  }

  loadSyncSettings() {
    if (this.syncConfig) {
      this.elements.serverUrlInput.value = this.syncConfig.serverUrl || '';
      this.elements.apiKeyInput.value = this.syncConfig.apiKey || '';
      this.elements.syncModeSelect.value = this.syncConfig.syncMode || SyncMode.MANUAL;
    }
    this.updateSyncStatusVisibility();
  }

  async saveSettings() {
    this.syncConfig = {
      serverUrl: this.elements.serverUrlInput.value.trim(),
      apiKey: this.elements.apiKeyInput.value.trim(),
      syncMode: this.elements.syncModeSelect.value
    };
    await chrome.storage.sync.set({ [CONFIG_KEY]: this.syncConfig });
    this.updateSyncStatusVisibility();
    this.showStatus('设置已保存', 'success');
  }

  async manualDownload() {
    const config = this.syncConfig;
    if (!config || !syncManager.isSyncEnabled(config)) {
      this.showStatus('同步未配置完整', 'error');
      return;
    }
    try {
      await chrome.runtime.sendMessage({ action: 'triggerDownload', trigger: 'manual' });
      this.showStatus('正在下载...', 'success');
    } catch (error) {
      this.showStatus('下载请求失败: ' + error.message, 'error');
    }
  }

  handleNavClick(item) {
    this.elements.navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const pageName = item.dataset.page;
    this.elements.pages.forEach(p => p.classList.remove('active'));
    document.getElementById(pageName + 'Page').classList.add('active');
    this.elements.pageTitle.textContent = item.querySelector('span:last-child').textContent;
  }

  updateSyncStatusVisibility() {
    if (this.elements.syncIndicator) {
      const syncEnabled = this.syncConfig && syncManager.isSyncEnabled(this.syncConfig);
      this.elements.syncIndicator.style.display = syncEnabled ? 'flex' : 'none';
    }
  }

  updateSyncIndicator(status, message) {
    if (!this.elements.syncIndicator) return;
    const dot = this.elements.syncIndicator.querySelector('.sync-dot');
    const text = this.elements.syncIndicator.querySelector('.sync-text');
    if (text) text.textContent = message || this.getStatusText(status);
    this.elements.syncIndicator.className = 'sync-indicator';
    dot.className = 'sync-dot';
    switch (status) {
      case SyncStatus.DOWNLOADING:
      case SyncStatus.UPLOADING:
        this.elements.syncIndicator.classList.add('syncing');
        dot.classList.add('syncing');
        break;
      case SyncStatus.DOWNLOADED:
      case SyncStatus.UPLOADED:
        this.elements.syncIndicator.classList.add('success');
        dot.classList.add('success');
        break;
      case SyncStatus.ERROR:
        this.elements.syncIndicator.classList.add('error');
        dot.classList.add('error');
        break;
      default:
        this.elements.syncIndicator.classList.add('idle');
        dot.classList.add('idle');
    }
  }

  getStatusText(status) {
    switch (status) {
      case SyncStatus.DOWNLOADING: return '正在下载...';
      case SyncStatus.DOWNLOADED: return '已下载';
      case SyncStatus.UPLOADING: return '正在上传...';
      case SyncStatus.UPLOADED: return '已上传';
      case SyncStatus.ERROR: return '错误';
      case SyncStatus.IDLE:
      default: return '就绪';
    }
  }

  showStatus(msg, type = 'success') {
    this.elements.statusDiv.textContent = msg;
    this.elements.statusDiv.className = 'status ' + type;
    setTimeout(() => { 
      this.elements.statusDiv.textContent = ''; 
      this.elements.statusDiv.className = 'status'; 
    }, 3000);
  }
}

const optionsManager = new OptionsManager();