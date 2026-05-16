(() => {
  let customResponses = [];
  let customResponseSettings = {
    allowed_channel_ids: [],
    allowed_category_ids: [],
    denied_channel_ids: [],
    denied_category_ids: [],
  };
  let guildChannels = [];
  let selectedResponseId = null;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const notify = (message, ok = true) => {
    if (typeof toast === 'function') return toast(message, ok);
    window.alert(message);
  };

  const apiRequest = async (method, path, body) => {
    if (typeof window.dashboardApi === 'function') return window.dashboardApi(method, path, body);
    const guildId = byId('guild-select')?.value || body?.guild_id || '';
    const scopedPath = path === '/guilds' ? path : `/${guildId}${path}`;
    const res = await fetch('/api' + scopedPath, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  };

  function currentGuildId() {
    return byId('guild-select')?.value || '';
  }

  function installUi() {
    if (byId('page-custom-responses')) return;

    const ticketsButton = document.querySelector('[data-page="tickets"]');
    if (ticketsButton) {
      const button = document.createElement('button');
      button.className = 'nav-btn';
      button.dataset.page = 'custom-responses';
      button.textContent = 'Reponses custom';
      ticketsButton.insertAdjacentElement('afterend', button);
    }

    const main = document.querySelector('main.content');
    if (!main) return;

    const section = document.createElement('section');
    section.id = 'page-custom-responses';
    section.className = 'page hidden';
    section.innerHTML = `
      <div class="page-header">
        <h2>Reponses custom</h2>
        <button type="button" class="btn-primary" id="new-custom-response-btn">+ Ajouter</button>
      </div>
      <div class="custom-responses-workspace">
        <div class="card custom-responses-list-card">
          <h3>Keywords</h3>
          <div id="custom-responses-list" class="custom-responses-list"><div class="loading">Chargement...</div></div>
        </div>
        <div class="card custom-responses-editor-card">
          <h3>Edition</h3>
          <form id="custom-response-form">
            <input type="hidden" name="id">
            <label>Guild ID
              <input type="text" name="guild_id" readonly required>
            </label>
            <label>Keyword
              <input type="text" name="keyword" maxlength="120" required placeholder="ip serveur">
            </label>
            <label>Reponse
              <textarea name="response" rows="8" maxlength="2000" required placeholder="Voici l'adresse du serveur..."></textarea>
              <small><span id="custom-response-count">0</span>/2000 caracteres</small>
            </label>
            <div class="modal-actions">
              <button type="button" class="btn-danger" id="delete-custom-response-btn">Supprimer</button>
              <button type="button" class="btn-secondary" id="reset-custom-response-btn">Nouveau</button>
              <button type="submit" class="btn-primary">Sauvegarder</button>
            </div>
          </form>
        </div>
        <div class="card custom-responses-settings-card">
          <h3>Restrictions</h3>
          <form id="custom-response-settings-form">
            <p class="custom-response-settings-help">Vide = le bot repond partout quand il est ping.</p>
            <div class="custom-response-rule" data-rule="allowed_channel_ids">
              <label>Salons acceptes
                <div class="custom-response-rule-picker">
                  <select data-rule-select="allowed_channel_ids"></select>
                  <button type="button" class="btn-secondary" data-rule-add="allowed_channel_ids">Ajouter</button>
                </div>
              </label>
              <div class="custom-response-rule-list" data-rule-list="allowed_channel_ids"></div>
            </div>
            <div class="custom-response-rule" data-rule="allowed_category_ids">
              <label>Categories acceptees
                <div class="custom-response-rule-picker">
                  <select data-rule-select="allowed_category_ids"></select>
                  <button type="button" class="btn-secondary" data-rule-add="allowed_category_ids">Ajouter</button>
                </div>
              </label>
              <div class="custom-response-rule-list" data-rule-list="allowed_category_ids"></div>
            </div>
            <div class="custom-response-rule" data-rule="denied_channel_ids">
              <label>Salons refuses
                <div class="custom-response-rule-picker">
                  <select data-rule-select="denied_channel_ids"></select>
                  <button type="button" class="btn-secondary" data-rule-add="denied_channel_ids">Ajouter</button>
                </div>
              </label>
              <div class="custom-response-rule-list" data-rule-list="denied_channel_ids"></div>
            </div>
            <div class="custom-response-rule" data-rule="denied_category_ids">
              <label>Categories refusees
                <div class="custom-response-rule-picker">
                  <select data-rule-select="denied_category_ids"></select>
                  <button type="button" class="btn-secondary" data-rule-add="denied_category_ids">Ajouter</button>
                </div>
              </label>
              <div class="custom-response-rule-list" data-rule-list="denied_category_ids"></div>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn-secondary" id="clear-custom-response-settings-btn">Repondre partout</button>
              <button type="submit" class="btn-primary">Sauvegarder</button>
            </div>
          </form>
        </div>
      </div>`;

    const ticketsPage = byId('page-tickets');
    if (ticketsPage) ticketsPage.insertAdjacentElement('beforebegin', section);
    else main.appendChild(section);
  }

  function installStyles() {
    if (byId('custom-responses-styles')) return;
    const style = document.createElement('style');
    style.id = 'custom-responses-styles';
    style.textContent = `
      .custom-responses-workspace{display:grid;grid-template-columns:280px minmax(360px,1fr) 320px;gap:20px;align-items:start}
      .custom-responses-list-card,.custom-responses-editor-card,.custom-responses-settings-card{min-width:0}
      .custom-responses-list{display:flex;flex-direction:column;gap:8px}
      .custom-response-item{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);cursor:pointer;padding:10px 12px;text-align:left}
      .custom-response-item:hover,.custom-response-item.active{border-color:var(--accent);background:var(--bg4)}
      .custom-response-item strong,.custom-response-item span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .custom-response-item span{color:var(--text-muted);font-size:12px;margin-top:4px}
      .custom-response-settings-help{color:var(--text-muted);font-size:13px;margin:0 0 14px}
      .custom-response-rule{border:1px solid var(--border);border-radius:var(--radius);padding:10px;margin-bottom:10px;background:var(--bg2)}
      .custom-response-rule-picker{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:6px}
      .custom-response-rule-picker select{min-width:0}
      .custom-response-rule-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:28px}
      .custom-response-rule-list .empty{color:var(--text-muted);font-size:12px;line-height:28px}
      .custom-response-rule-chip{align-items:center;background:var(--bg4);border:1px solid var(--border);border-radius:999px;color:var(--text);display:inline-flex;font-size:12px;gap:6px;max-width:100%;padding:5px 8px}
      .custom-response-rule-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .custom-response-rule-chip button{background:transparent;border:0;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;padding:0}
      .custom-response-rule-chip button:hover{color:var(--danger)}
      #custom-response-form small{display:block;margin-top:6px;color:var(--text-muted);text-transform:none;letter-spacing:0;font-weight:400}
      @media(max-width:1100px){.custom-responses-workspace{grid-template-columns:280px minmax(360px,1fr)}.custom-responses-settings-card{grid-column:1 / -1}}
      @media(max-width:760px){.custom-responses-workspace{grid-template-columns:1fr}.custom-responses-settings-card{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function showPage(name) {
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(button => button.classList.remove('active'));
    byId(`page-${name}`)?.classList.remove('hidden');
    document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  }

  function emptyResponse() {
    return { id: '', guild_id: currentGuildId(), keyword: '', response: '' };
  }

  function fillForm(data = emptyResponse()) {
    const form = byId('custom-response-form');
    if (!form) return;
    selectedResponseId = data.id || null;
    form.id.value = data.id || '';
    form.guild_id.value = data.guild_id || currentGuildId();
    form.keyword.value = data.keyword || '';
    form.response.value = data.response || '';
    updateCount();
    renderList();
  }

  function readForm() {
    const form = byId('custom-response-form');
    return {
      guild_id: form.guild_id.value.trim(),
      keyword: form.keyword.value.trim(),
      response: form.response.value.trim(),
    };
  }

  function validateForm(data) {
    if (!data.guild_id) throw new Error('guild_id obligatoire');
    if (!data.keyword) throw new Error('keyword obligatoire');
    if (!data.response) throw new Error('response obligatoire');
    if (data.response.length > 2000) throw new Error('response limitee a 2000 caracteres');
  }

  function updateCount() {
    const count = byId('custom-response-form')?.response?.value?.length || 0;
    const counter = byId('custom-response-count');
    if (counter) counter.textContent = String(count);
  }

  function renderList() {
    const list = byId('custom-responses-list');
    if (!list) return;
    if (!customResponses.length) {
      list.innerHTML = '<div class="loading">Aucune reponse custom</div>';
      return;
    }
    list.innerHTML = customResponses.map(item => `
      <button type="button" class="custom-response-item${item.id === selectedResponseId ? ' active' : ''}" data-custom-response-id="${item.id}">
        <strong>${escapeHtml(item.keyword)}</strong>
        <span>${escapeHtml(item.response)}</span>
      </button>
    `).join('');
  }

  const settingsRules = {
    allowed_channel_ids: { type: 'channel', empty: 'Aucun salon accepte' },
    allowed_category_ids: { type: 'category', empty: 'Aucune categorie acceptee' },
    denied_channel_ids: { type: 'channel', empty: 'Aucun salon refuse' },
    denied_category_ids: { type: 'category', empty: 'Aucune categorie refusee' },
  };

  function getTextChannels() {
    return guildChannels
      .filter(channel => channel.type === 0 || channel.type === 5)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function getCategories() {
    return guildChannels
      .filter(channel => channel.type === 4)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function getChannelLabel(channelId) {
    const channel = guildChannels.find(item => item.id === channelId);
    if (!channel) return channelId;
    const parent = channel.parentId
      ? guildChannels.find(item => item.id === channel.parentId && item.type === 4)?.name
      : '';
    return `# ${channel.name}${parent ? ` (${parent})` : ''}`;
  }

  function getCategoryLabel(categoryId) {
    return guildChannels.find(item => item.id === categoryId && item.type === 4)?.name || categoryId;
  }

  function normalizeSettingsState(settings = customResponseSettings) {
    customResponseSettings = {
      allowed_channel_ids: Array.isArray(settings.allowed_channel_ids) ? settings.allowed_channel_ids : [],
      allowed_category_ids: Array.isArray(settings.allowed_category_ids) ? settings.allowed_category_ids : [],
      denied_channel_ids: Array.isArray(settings.denied_channel_ids) ? settings.denied_channel_ids : [],
      denied_category_ids: Array.isArray(settings.denied_category_ids) ? settings.denied_category_ids : [],
      guild_id: settings.guild_id || currentGuildId(),
    };
  }

  function renderRule(ruleName) {
    const rule = settingsRules[ruleName];
    const select = document.querySelector(`[data-rule-select="${ruleName}"]`);
    const list = document.querySelector(`[data-rule-list="${ruleName}"]`);
    if (!rule || !select || !list) return;

    const selectedIds = new Set(customResponseSettings[ruleName] || []);
    const items = rule.type === 'category' ? getCategories() : getTextChannels();
    select.innerHTML = `<option value="">Choisir...</option>` + items.map(item => {
      const label = rule.type === 'category' ? getCategoryLabel(item.id) : getChannelLabel(item.id);
      return `<option value="${escapeHtml(item.id)}"${selectedIds.has(item.id) ? ' disabled' : ''}>${escapeHtml(label)}</option>`;
    }).join('');

    const selected = customResponseSettings[ruleName] || [];
    if (!selected.length) {
      list.innerHTML = `<span class="empty">${escapeHtml(rule.empty)}</span>`;
      return;
    }

    list.innerHTML = selected.map(id => {
      const label = rule.type === 'category' ? getCategoryLabel(id) : getChannelLabel(id);
      return `
        <span class="custom-response-rule-chip">
          <span>${escapeHtml(label)}</span>
          <button type="button" title="Retirer" data-rule-remove="${escapeHtml(ruleName)}" data-rule-id="${escapeHtml(id)}">x</button>
        </span>
      `;
    }).join('');
  }

  function renderSettings() {
    normalizeSettingsState();
    Object.keys(settingsRules).forEach(renderRule);
  }

  async function loadSettings() {
    const [channels, settings] = await Promise.all([
      apiRequest('GET', '/guild/channels').catch(error => {
        notify(error.message, false);
        return [];
      }),
      apiRequest('GET', '/custom-responses/settings').catch(error => {
        notify(error.message, false);
        return { allowed_channel_ids: [], allowed_category_ids: [], denied_channel_ids: [], denied_category_ids: [] };
      }),
    ]);
    guildChannels = channels;
    normalizeSettingsState(settings);
    renderSettings();
  }

  async function loadCustomResponses() {
    const guildId = currentGuildId();
    const form = byId('custom-response-form');
    if (form) form.guild_id.value = guildId;
    const [responses] = await Promise.all([
      apiRequest('GET', '/custom-responses').catch(error => {
        notify(error.message, false);
        return [];
      }),
      loadSettings(),
    ]);
    customResponses = responses;
    renderList();
    fillForm(customResponses.find(item => item.id === selectedResponseId) || emptyResponse());
  }

  async function saveCustomResponse() {
    const form = byId('custom-response-form');
    const data = readForm();
    validateForm(data);
    const id = form.id.value;
    const saved = id
      ? await apiRequest('PUT', `/custom-responses/${encodeURIComponent(id)}`, data)
      : await apiRequest('POST', '/custom-responses', data);
    selectedResponseId = saved.id;
    notify('Reponse custom sauvegardee');
    await loadCustomResponses();
  }

  async function deleteCustomResponse() {
    const id = byId('custom-response-form')?.id?.value;
    if (!id) return notify('Aucune reponse selectionnee', false);
    if (!window.confirm('Supprimer cette reponse custom ?')) return;
    await apiRequest('DELETE', `/custom-responses/${encodeURIComponent(id)}`);
    selectedResponseId = null;
    notify('Reponse custom supprimee');
    await loadCustomResponses();
  }

  async function saveCustomResponseSettings() {
    customResponseSettings = await apiRequest('PUT', '/custom-responses/settings', {
      guild_id: currentGuildId(),
      allowed_channel_ids: customResponseSettings.allowed_channel_ids,
      allowed_category_ids: customResponseSettings.allowed_category_ids,
      denied_channel_ids: customResponseSettings.denied_channel_ids,
      denied_category_ids: customResponseSettings.denied_category_ids,
    });
    normalizeSettingsState(customResponseSettings);
    renderSettings();
    notify('Restrictions sauvegardees');
  }

  async function clearCustomResponseSettings() {
    customResponseSettings = await apiRequest('PUT', '/custom-responses/settings', {
      guild_id: currentGuildId(),
      allowed_channel_ids: [],
      allowed_category_ids: [],
      denied_channel_ids: [],
      denied_category_ids: [],
    });
    normalizeSettingsState(customResponseSettings);
    renderSettings();
    notify('Le bot repondra partout');
  }

  function addRuleItem(ruleName) {
    const select = document.querySelector(`[data-rule-select="${ruleName}"]`);
    const value = select?.value || '';
    if (!settingsRules[ruleName] || !value) return;
    const current = new Set(customResponseSettings[ruleName] || []);
    current.add(value);
    customResponseSettings[ruleName] = [...current];
    renderSettings();
  }

  function removeRuleItem(ruleName, value) {
    if (!settingsRules[ruleName]) return;
    customResponseSettings[ruleName] = (customResponseSettings[ruleName] || []).filter(item => item !== value);
    renderSettings();
  }

  function bindEvents() {
    byId('custom-response-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopPropagation();
      try { await saveCustomResponse(); } catch (error) { notify(error.message, false); }
    });

    document.addEventListener('click', async event => {
      const nav = event.target.closest('[data-page="custom-responses"]');
      if (nav) {
        showPage('custom-responses');
        await loadCustomResponses();
        return;
      }

      const item = event.target.closest('[data-custom-response-id]');
      if (item) {
        const id = Number(item.dataset.customResponseId);
        fillForm(customResponses.find(response => response.id === id) || emptyResponse());
        return;
      }

      if (event.target?.id === 'new-custom-response-btn' || event.target?.id === 'reset-custom-response-btn') {
        fillForm(emptyResponse());
        return;
      }

      if (event.target?.id === 'delete-custom-response-btn') {
        try { await deleteCustomResponse(); } catch (error) { notify(error.message, false); }
      }

      if (event.target?.id === 'clear-custom-response-settings-btn') {
        try { await clearCustomResponseSettings(); } catch (error) { notify(error.message, false); }
      }

      const addButton = event.target.closest('[data-rule-add]');
      if (addButton) {
        addRuleItem(addButton.dataset.ruleAdd);
        return;
      }

      const removeButton = event.target.closest('[data-rule-remove]');
      if (removeButton) {
        removeRuleItem(removeButton.dataset.ruleRemove, removeButton.dataset.ruleId);
      }
    });

    document.addEventListener('submit', async event => {
      if (event.target?.id === 'custom-response-settings-form') {
        event.preventDefault();
        event.stopPropagation();
        try { await saveCustomResponseSettings(); } catch (error) { notify(error.message, false); }
        return;
      }

      if (event.target?.id !== 'custom-response-form') return;
      event.preventDefault();
      event.stopPropagation();
      try { await saveCustomResponse(); } catch (error) { notify(error.message, false); }
    });

    document.addEventListener('input', event => {
      if (event.target.closest('#custom-response-form')) updateCount();
    });

    byId('guild-select')?.addEventListener('change', () => {
      if (!byId('page-custom-responses')?.classList.contains('hidden')) {
        selectedResponseId = null;
        loadCustomResponses();
      }
    });
  }

  installStyles();
  installUi();
  bindEvents();
})();
