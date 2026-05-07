(() => {
  let embedMessages = [];
  let channels = [];
  let selectedId = null;

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
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  };

  const emptyEmbed = () => ({
    id: '', name: '', content: '', title: '', description: '', color: '#5865F2', url: '',
    authorName: '', authorIcon: '', thumbnail: '', image: '', footer: '', footerIcon: '', timestamp: false, fields: [],
  });

  function installUi() {
    if (byId('page-embeds')) return;

    const panelButton = document.querySelector('[data-page="panel"]');
    if (panelButton) {
      const button = document.createElement('button');
      button.className = 'nav-btn';
      button.dataset.page = 'embeds';
      button.textContent = 'Embeds';
      panelButton.insertAdjacentElement('afterend', button);
    }

    const main = document.querySelector('main.content');
    if (!main) return;
    const section = document.createElement('section');
    section.id = 'page-embeds';
    section.className = 'page hidden';
    section.innerHTML = `
      <div class="page-header">
        <h2>Embeds</h2>
        <button class="btn-primary" id="add-embed-btn">+ Ajouter</button>
      </div>
      <div class="embed-workspace">
        <div class="card embed-list-card">
          <h3>Messages</h3>
          <div id="embed-messages-list" class="embed-message-list"><div class="loading">Chargement...</div></div>
        </div>
        <div class="card embed-editor-card">
          <h3>Edition</h3>
          <form id="embed-message-form">
            <input type="hidden" name="id">
            <label>Nom interne<input type="text" name="name" placeholder="Aide commandes staff" required></label>
            <label>Message texte au-dessus de l'embed<textarea name="content" rows="2" maxlength="2000" placeholder="Optionnel"></textarea></label>
            <div class="form-grid">
              <label>Titre<input type="text" name="title" maxlength="256" placeholder="Commandes tickets"></label>
              <label>URL du titre<input type="url" name="url" placeholder="https://..."></label>
            </div>
            <label>Description<textarea name="description" rows="5" maxlength="4096" placeholder="/ticket add, /ticket remove, /ticketban ban..."></textarea></label>
            <label>Couleur<div class="color-row"><input type="color" name="colorPicker" id="embedColorPicker" value="#5865F2"><input type="text" name="color" id="embedColorText" placeholder="#5865F2" maxlength="7"></div></label>
            <div class="form-grid">
              <label>Auteur<input type="text" name="authorName" maxlength="256" placeholder="Support Tenshi"></label>
              <label>Icone auteur<input type="url" name="authorIcon" placeholder="https://..."></label>
            </div>
            <div class="form-grid">
              <label>Thumbnail<input type="url" name="thumbnail" placeholder="https://..."></label>
              <label>Image principale<input type="url" name="image" placeholder="https://..."></label>
            </div>
            <div class="form-grid">
              <label>Footer<input type="text" name="footer" maxlength="2048" placeholder="Mis a jour automatiquement"></label>
              <label>Icone footer<input type="url" name="footerIcon" placeholder="https://..."></label>
            </div>
            <label class="toggle-label"><div class="toggle-row"><span>Afficher la date d'envoi</span><input type="checkbox" name="timestamp" role="switch"></div></label>
            <div class="embed-fields-header"><h4>Champs</h4><button type="button" id="add-embed-field-btn" class="btn-secondary">+ Champ</button></div>
            <div id="embed-fields-list" class="embed-fields-list"></div>
            <div class="modal-actions"><button type="button" class="btn-danger" id="delete-embed-btn">Supprimer</button><button type="button" class="btn-secondary" id="reset-embed-form-btn">Nouveau</button><button type="submit" class="btn-primary">Sauvegarder</button></div>
          </form>
        </div>
        <div class="card embed-preview-card">
          <h3>Apercu</h3>
          <div id="custom-embed-preview" class="discord-embed-preview"></div>
          <hr>
          <h3>Envoyer</h3>
          <div class="deploy-row"><select id="embed-send-channel-select"><option value="">Choisir un salon...</option></select><button id="send-embed-btn" class="btn-primary">Envoyer</button></div>
          <p id="embed-send-status" class="status-msg hidden"></p>
        </div>
      </div>`;
    const categories = byId('page-categories');
    if (categories) categories.insertAdjacentElement('beforebegin', section);
    else main.appendChild(section);
  }

  function installStyles() {
    if (byId('embed-builder-styles')) return;
    const style = document.createElement('style');
    style.id = 'embed-builder-styles';
    style.textContent = `
      .embed-workspace{display:grid;grid-template-columns:220px minmax(360px,1fr) minmax(300px,420px);gap:20px;align-items:start}.embed-list-card,.embed-editor-card,.embed-preview-card{min-width:0}.embed-message-list{display:flex;flex-direction:column;gap:8px}.embed-message-item{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);cursor:pointer;padding:10px 12px;text-align:left}.embed-message-item:hover,.embed-message-item.active{border-color:var(--accent);background:var(--bg4)}.embed-message-item span,.embed-message-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.embed-message-item span{font-weight:700}.embed-message-item small{color:var(--text-muted);margin-top:3px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.embed-fields-header{display:flex;justify-content:space-between;align-items:center;margin:4px 0 12px}.embed-fields-header h4{font-size:14px;color:var(--text)}.embed-fields-list{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}.embed-field-row{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px;display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:center}.embed-field-row input,.embed-field-row textarea{margin-top:0}.field-inline-toggle{margin:0;text-transform:none;letter-spacing:0;color:var(--text);display:flex;align-items:center;gap:6px}.loading.compact{padding:8px 0}.discord-embed-preview{background:var(--bg3);border-left:4px solid var(--accent);border-radius:var(--radius);padding:12px;min-height:160px;overflow:hidden}.preview-content{color:var(--text);margin-bottom:10px;white-space:pre-wrap;word-break:break-word}.preview-embed-body{display:flex;gap:12px}.preview-main{min-width:0;flex:1}.preview-author,.preview-footer{display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:12px;margin-bottom:8px}.preview-author img,.preview-footer img{width:18px;height:18px;border-radius:50%;object-fit:cover}.preview-title{color:#fff;font-size:15px;font-weight:700;margin-bottom:6px;word-break:break-word}.preview-description{color:var(--text);font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}.preview-description.muted{color:var(--text-muted)}.preview-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.preview-field:not(.inline){grid-column:1/-1}.preview-field strong,.preview-field span{display:block;font-size:12px;white-space:pre-wrap;word-break:break-word}.preview-field strong{color:#fff;margin-bottom:2px}.preview-field span{color:var(--text-muted)}.preview-thumbnail{width:80px;height:80px;object-fit:cover;border-radius:var(--radius)}.preview-image{width:100%;max-height:260px;object-fit:cover;border-radius:var(--radius);margin-top:12px}.preview-footer{margin-top:12px;margin-bottom:0}@media(max-width:1180px){.embed-workspace{grid-template-columns:220px 1fr}.embed-preview-card{grid-column:1/-1}}@media(max-width:760px){.embed-workspace,.form-grid,.embed-field-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function showPage(name) {
    document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(button => button.classList.remove('active'));
    byId(`page-${name}`)?.classList.remove('hidden');
    document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  }

  async function loadData() {
    [embedMessages, channels] = await Promise.all([
      apiRequest('GET', '/embed-messages').catch(error => { notify(error.message, false); return []; }),
      apiRequest('GET', '/guild/channels').catch(() => []),
    ]);
    renderList();
    renderChannelSelect();
    fillForm(embedMessages.find(item => item.id === selectedId) || embedMessages[0] || emptyEmbed());
  }

  function renderList() {
    const list = byId('embed-messages-list');
    if (!list) return;
    if (!embedMessages.length) {
      list.innerHTML = '<div class="loading">Aucun embed sauvegarde</div>';
      return;
    }
    list.innerHTML = embedMessages.map(item => `<button class="embed-message-item${item.id === selectedId ? ' active' : ''}" type="button" data-embed-select="${escapeHtml(item.id)}"><span>${escapeHtml(item.name || item.title || item.id)}</span><small>${escapeHtml(item.title || 'Sans titre')}</small></button>`).join('');
  }

  function renderChannelSelect() {
    const select = byId('embed-send-channel-select');
    if (!select) return;
    select.innerHTML = '<option value="">Choisir un salon...</option>';
    channels.filter(channel => channel.type === 0).forEach(channel => {
      select.innerHTML += `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`;
    });
  }

  function fillForm(data) {
    const form = byId('embed-message-form');
    if (!form) return;
    selectedId = data.id || null;
    ['id','name','content','title','url','description','color','authorName','authorIcon','thumbnail','image','footer','footerIcon'].forEach(name => { form[name].value = data[name] || ''; });
    form.color.value = data.color || '#5865F2';
    form.colorPicker.value = data.color || '#5865F2';
    form.timestamp.checked = Boolean(data.timestamp);
    renderFields(data.fields || []);
    renderList();
    updatePreview();
  }

  function readFields(keepEmpty = false) {
    const fields = [...document.querySelectorAll('.embed-field-row')].map(row => ({
      name: row.querySelector('[data-field-name]').value,
      value: row.querySelector('[data-field-value]').value,
      inline: row.querySelector('[data-field-inline]').checked,
    }));
    return keepEmpty ? fields : fields.filter(field => field.name.trim() && field.value.trim());
  }

  function readForm() {
    const form = byId('embed-message-form');
    return {
      id: form.id.value,
      name: form.name.value.trim(),
      content: form.content.value,
      title: form.title.value,
      url: form.url.value,
      description: form.description.value,
      color: form.color.value || '#5865F2',
      authorName: form.authorName.value,
      authorIcon: form.authorIcon.value,
      thumbnail: form.thumbnail.value,
      image: form.image.value,
      footer: form.footer.value,
      footerIcon: form.footerIcon.value,
      timestamp: form.timestamp.checked,
      fields: readFields(false),
    };
  }

  function renderFields(fields) {
    const container = byId('embed-fields-list');
    if (!container) return;
    if (!fields.length) {
      container.innerHTML = '<div class="loading compact">Aucun champ</div>';
      return;
    }
    container.innerHTML = fields.map((field, index) => `<div class="embed-field-row" data-index="${index}"><input type="text" data-field-name value="${escapeHtml(field.name)}" placeholder="Nom du champ" maxlength="256"><textarea data-field-value rows="2" placeholder="Valeur du champ" maxlength="1024">${escapeHtml(field.value)}</textarea><label class="field-inline-toggle"><input type="checkbox" data-field-inline ${field.inline ? 'checked' : ''}>Inline</label><button type="button" class="btn-danger" data-remove-field="${index}">Supprimer</button></div>`).join('');
  }

  function updatePreview() {
    const preview = byId('custom-embed-preview');
    const form = byId('embed-message-form');
    if (!preview || !form) return;
    const data = readForm();
    const color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '#5865F2';
    preview.style.borderLeftColor = color;
    const fields = data.fields.map(field => `<div class="preview-field${field.inline ? ' inline' : ''}"><strong>${escapeHtml(field.name)}</strong><span>${escapeHtml(field.value)}</span></div>`).join('');
    preview.innerHTML = `${data.content ? `<div class="preview-content">${escapeHtml(data.content)}</div>` : ''}<div class="preview-embed-body"><div class="preview-main">${data.authorName ? `<div class="preview-author">${data.authorIcon ? `<img src="${escapeHtml(data.authorIcon)}" alt="">` : ''}<span>${escapeHtml(data.authorName)}</span></div>` : ''}${data.title ? `<div class="preview-title">${escapeHtml(data.title)}</div>` : ''}${data.description ? `<div class="preview-description">${escapeHtml(data.description)}</div>` : '<div class="preview-description muted">Description de l embed...</div>'}${fields ? `<div class="preview-fields">${fields}</div>` : ''}${data.image ? `<img class="preview-image" src="${escapeHtml(data.image)}" alt="">` : ''}${data.footer || data.timestamp ? `<div class="preview-footer">${data.footerIcon ? `<img src="${escapeHtml(data.footerIcon)}" alt="">` : ''}<span>${escapeHtml(data.footer || '')}${data.footer && data.timestamp ? ' - ' : ''}${data.timestamp ? 'Aujourd hui' : ''}</span></div>` : ''}</div>${data.thumbnail ? `<img class="preview-thumbnail" src="${escapeHtml(data.thumbnail)}" alt="">` : ''}</div>`;
  }

  async function saveEmbed() {
    const data = readForm();
    if (!data.name) return notify('Donne un nom a cet embed', false);
    const saved = data.id ? await apiRequest('PUT', `/embed-messages/${encodeURIComponent(data.id)}`, data) : await apiRequest('POST', '/embed-messages', data);
    selectedId = saved.id;
    notify('Embed sauvegarde');
    await loadData();
  }

  async function sendEmbed() {
    const id = byId('embed-message-form').id.value;
    const channelId = byId('embed-send-channel-select').value;
    if (!id) return notify('Sauvegarde l embed avant de l envoyer', false);
    if (!channelId) return notify('Selectionne un salon', false);
    const status = byId('embed-send-status');
    status.className = 'status-msg';
    status.textContent = 'Envoi...';
    status.classList.remove('hidden');
    try {
      await apiRequest('POST', `/embed-messages/${encodeURIComponent(id)}/send`, { channelId });
      status.className = 'status-msg ok';
      status.textContent = 'Embed envoye.';
    } catch (error) {
      status.className = 'status-msg err';
      status.textContent = error.message;
    }
  }

  function bindEvents() {
    document.addEventListener('click', async event => {
      const nav = event.target.closest('[data-page="embeds"]');
      if (nav) {
        showPage('embeds');
        await loadData();
      }
      const select = event.target.closest('[data-embed-select]');
      if (select) fillForm(embedMessages.find(item => item.id === select.dataset.embedSelect) || emptyEmbed());
      if (event.target?.id === 'add-embed-btn' || event.target?.id === 'reset-embed-form-btn') fillForm(emptyEmbed());
      if (event.target?.id === 'add-embed-field-btn') {
        const fields = readFields(true);
        fields.push({ name: '', value: '', inline: false });
        renderFields(fields);
        updatePreview();
      }
      const remove = event.target.closest('[data-remove-field]');
      if (remove) {
        const fields = readFields(true);
        fields.splice(Number(remove.dataset.removeField), 1);
        renderFields(fields);
        updatePreview();
      }
      if (event.target?.id === 'delete-embed-btn') {
        const id = byId('embed-message-form').id.value;
        if (!id) return notify('Aucun embed selectionne', false);
        if (!window.confirm('Supprimer cet embed ?')) return;
        await apiRequest('DELETE', `/embed-messages/${encodeURIComponent(id)}`);
        selectedId = null;
        notify('Embed supprime');
        await loadData();
      }
      if (event.target?.id === 'send-embed-btn') await sendEmbed();
    });

    document.addEventListener('input', event => {
      if (!event.target.closest('#embed-message-form')) return;
      if (event.target.id === 'embedColorPicker') byId('embedColorText').value = event.target.value;
      if (event.target.id === 'embedColorText' && /^#[0-9a-fA-F]{6}$/.test(event.target.value)) byId('embedColorPicker').value = event.target.value;
      updatePreview();
    });

    document.addEventListener('submit', async event => {
      if (event.target?.id !== 'embed-message-form') return;
      event.preventDefault();
      try { await saveEmbed(); } catch (error) { notify(error.message, false); }
    });
  }

  installStyles();
  installUi();
  bindEvents();
})();
