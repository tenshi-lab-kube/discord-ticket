// State
let cfg = {};
let channels = [];
let roles = [];
let tickets = [];
let guilds = [];
let selectedGuildId = localStorage.getItem('selectedGuildId') || '';

// Utilities
const $ = id => document.getElementById(id);
const api = async (method, path, body) => {
  const scopedPath = path === '/guilds' ? path : `/${selectedGuildId}${path}`;
  const res = await fetch('/api' + scopedPath, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};
window.dashboardApi = api;

document.addEventListener('submit', event => {
  if (event.target?.closest?.('#dashboard')) {
    event.preventDefault();
  }
}, true);

function showPage(name) {
  const page = $(`page-${name}`);
  if (!page) return;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  page.classList.remove('hidden');
  document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
}

function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    background: ok ? '#57f287' : '#ed4245',
    color: '#000', padding: '10px 18px', borderRadius: '8px',
    fontWeight: '600', zIndex: '9999', fontSize: '14px',
    boxShadow: '0 4px 12px rgba(0,0,0,.4)',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ──────────── LOGIN ────────────
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  window.location.href = '/auth/discord';
});

$('logout-btn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.reload();
});

// ──────────── INIT ────────────
async function initDashboard() {
  guilds = await api('GET', '/guilds');
  if (!guilds.length) {
    $('dashboard').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-error').textContent = 'Aucun serveur administrable avec ce compte Discord.';
    $('login-error').classList.remove('hidden');
    return;
  }
  if (!guilds.some(g => g.guildId === selectedGuildId)) selectedGuildId = guilds[0].guildId;
  localStorage.setItem('selectedGuildId', selectedGuildId);
  populateGuildSelect();

  [cfg, channels, roles] = await Promise.all([
    api('GET', '/config'),
    api('GET', '/guild/channels').catch(() => []),
    api('GET', '/guild/roles').catch(() => []),
  ]);
  populateChannelSelects();
  populateCategorySelects();
  loadOverview();
  loadPanelForm();
  loadSettings();
  loadTicketSettings();
}

function populateGuildSelect() {
  const select = $('guild-select');
  if (!select) return;
  select.innerHTML = guilds.map(g => `<option value="${g.guildId}">${g.name || g.discordName || g.guildId}</option>`).join('');
  select.value = selectedGuildId;
}

$('guild-select')?.addEventListener('change', async e => {
  selectedGuildId = e.target.value;
  localStorage.setItem('selectedGuildId', selectedGuildId);
  await initDashboard();
  showPage('overview');
});

// ──────────── NAV ────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    showPage(page);
    if (page === 'categories') loadCategories();
    if (page === 'tickets') loadTickets();
    if (page === 'panel') loadDeployChannels();
    if (page === 'transcripts') loadTranscripts();
  });
});

// ──────────── CHANNEL SELECTS ────────────
function populateChannelSelects() {
  const textChs = channels.filter(c => c.type === 0);
  const categories = channels.filter(c => c.type === 4);

  // Deploy select
  const deploySel = $('deploy-channel-select');
  deploySel.innerHTML = '<option value="">Choisir un salon…</option>';
  textChs.forEach(c => {
    deploySel.innerHTML += `<option value="${c.id}">#${c.name}</option>`;
  });

  // Log channel in settings
  const logSel = document.querySelector('select[name="logChannelId"]');
  if (logSel) {
    logSel.innerHTML = '<option value="">Aucun</option>';
    textChs.forEach(c => {
      logSel.innerHTML += `<option value="${c.id}">#${c.name}</option>`;
    });
    if (cfg.logChannelId) logSel.value = cfg.logChannelId;
  }

  // Closed category in ticket settings
  const closedSel = document.querySelector('select[name="closedCategoryId"]');
  if (closedSel) {
    closedSel.innerHTML = '<option value="">Aucune</option>';
    categories.forEach(c => {
      closedSel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
    if (cfg.tickets?.closedCategoryId) closedSel.value = cfg.tickets.closedCategoryId;
  }
}

function populateCategorySelects() {
  // Modal category (Discord category channels)
  const catSel = document.querySelector('#category-form select[name="categoryId"]');
  if (!catSel) return;
  const discordCats = channels.filter(c => c.type === 4);
  catSel.innerHTML = '<option value="">Aucune</option>';
  discordCats.forEach(c => {
    catSel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

// ──────────── OVERVIEW ────────────
async function loadOverview() {
  const [stats, allTickets] = await Promise.all([
    api('GET', '/stats').catch(() => ({})),
    api('GET', '/tickets').catch(() => []),
  ]);
  tickets = allTickets;

  $('stat-ever').textContent = stats.totalEver ?? 0;
  $('stat-open').textContent = stats.open ?? 0;
  $('stat-closed').textContent = stats.closed ?? 0;
  $('stat-claimed').textContent = stats.claimed ?? 0;

  const open = tickets.filter(t => t.status === 'open');
  $('open-count-badge').textContent = open.length;

  const tbody = $('open-tickets-body');
  if (!open.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Aucun ticket ouvert</td></tr>';
    return;
  }
  tbody.innerHTML = open.map(t => `
    <tr>
      <td>#${String(t.ticket_number).padStart(4, '0')}</td>
      <td><code>#${t.category_id}-${String(t.ticket_number).padStart(4, '0')}</code></td>
      <td>${t.category_id}</td>
      <td><code>${t.user_id}</code></td>
      <td>${t.claimed_by ? `<code>${t.claimed_by}</code>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${fmtDate(t.created_at)}</td>
    </tr>
  `).join('');
}

// ──────────── PANEL ────────────
function loadPanelForm() {
  const form = $('panel-form');
  const p = cfg.panel ?? {};
  form.title.value = p.title ?? '';
  form.description.value = p.description ?? '';
  form.buttonLabel.value = p.buttonLabel ?? '';
  form.placeholder.value = p.placeholder ?? '';
  form.color.value = p.color ?? '#5865F2';
  form.colorPicker.value = p.color ?? '#5865F2';
  form.thumbnail.value = p.thumbnail ?? '';
  form.footer.value = p.footer ?? '';
  updatePreview();
}

function updatePreview() {
  const form = $('panel-form');
  const color = form.color.value || '#5865F2';
  $('preview-bar').style.background = color;
  $('embed-preview').style.borderLeftColor = color;
  $('preview-title').textContent = form.title.value || 'OUVRIR UN TICKET';
  $('preview-desc').textContent = form.description.value || 'Description…';
  $('preview-footer').textContent = form.footer.value || '';
}

$('panel-form').addEventListener('input', updatePreview);

$('colorPicker').addEventListener('input', e => {
  $('panel-form').color.value = e.target.value;
  updatePreview();
});

$('panel-form').color.addEventListener('input', e => {
  const val = e.target.value;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) $('colorPicker').value = val;
  updatePreview();
});

$('panel-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = $('panel-form');
  await api('PATCH', '/config/panel', {
    title: form.title.value,
    description: form.description.value,
    buttonLabel: form.buttonLabel.value,
    placeholder: form.placeholder.value,
    color: form.color.value,
    thumbnail: form.thumbnail.value,
    footer: form.footer.value,
  }).then(() => toast('Panel sauvegardé ✓')).catch(err => toast(err.message, false));
});

function loadDeployChannels() {
  populateChannelSelects();
}

$('deploy-btn').addEventListener('click', async () => {
  const channelId = $('deploy-channel-select').value;
  if (!channelId) return toast('Sélectionne un salon', false);
  const statusEl = $('deploy-status');
  statusEl.className = 'status-msg';
  statusEl.textContent = 'Déploiement…';
  statusEl.classList.remove('hidden');
  await api('POST', '/panel/deploy', { channelId })
    .then(() => { statusEl.className = 'status-msg ok'; statusEl.textContent = '✅ Panel déployé !'; })
    .catch(err => { statusEl.className = 'status-msg err'; statusEl.textContent = '❌ ' + err.message; });
});

// ──────────── CATEGORIES ────────────
async function loadCategories() {
  const cats = await api('GET', '/categories').catch(() => []);
  const list = $('categories-list');
  if (!cats.length) {
    list.innerHTML = '<div class="loading">Aucune catégorie — clique sur + Ajouter</div>';
    return;
  }
  list.innerHTML = cats.map(cat => `
    <div class="cat-item" data-id="${cat.id}">
      <div class="cat-emoji">${cat.emoji || '📂'}</div>
      <div class="cat-info">
        <div class="cat-name">${cat.name}</div>
        <div class="cat-desc">${cat.description || ''}</div>
        <div class="cat-id">id: ${cat.id}</div>
      </div>
      <div class="cat-actions">
        <button class="btn-icon" onclick="openCategoryModal('${cat.id}')">✏️</button>
        <button class="btn-icon" onclick="deleteCategory('${cat.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

$('add-category-btn').addEventListener('click', () => openCategoryModal(null));

function openCategoryModal(editId) {
  const form = $('category-form');
  form.reset();
  populateCategorySelects();
  $('modal-title').textContent = editId ? 'Modifier la catégorie' : 'Ajouter une catégorie';
  form.editId.value = editId || '';

  if (editId) {
    api('GET', '/categories').then(cats => {
      const cat = cats.find(c => c.id === editId);
      if (!cat) return;
      form.id.value = cat.id;
      form.id.readOnly = true;
      form.name.value = cat.name;
      form.emoji.value = cat.emoji || '';
      form.description.value = cat.description || '';
      form.categoryId.value = cat.categoryId || '';
      form.requiredRole.value = cat.requiredRole || '';
      form.supportRoles.value = (cat.supportRoles || []).join(',');
      form.maxTickets.value = cat.maxTickets || 1;
    });
  } else {
    form.id.readOnly = false;
  }

  $('category-modal').classList.remove('hidden');
}

function closeCategoryModal() {
  $('category-modal').classList.add('hidden');
}

$('create-discord-cat-btn').addEventListener('click', async () => {
  const form = $('category-form');
  const name = form.name.value.trim();
  const statusEl = $('create-discord-cat-status');

  if (!name) {
    statusEl.textContent = '⚠️ Remplis le nom de la catégorie d\'abord.';
    statusEl.className = 'create-cat-status err';
    statusEl.classList.remove('hidden');
    return;
  }

  const btn = $('create-discord-cat-btn');
  btn.disabled = true;
  btn.textContent = '…';
  statusEl.className = 'create-cat-status';
  statusEl.textContent = '';
  statusEl.classList.add('hidden');

  try {
    const result = await api('POST', '/guild/create-discord-category', { name });
    // Add to channels cache and refresh select
    channels.push({ id: result.id, name: result.name, type: 4, parentId: null });
    populateCategorySelects();
    // Auto-select the new category
    form.querySelector('select[name="categoryId"]').value = result.id;
    statusEl.textContent = `✅ Catégorie "${result.name}" créée et sélectionnée.`;
    statusEl.className = 'create-cat-status ok';
    statusEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.className = 'create-cat-status err';
    statusEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Créer';
  }
});

$('modal-close-btn').addEventListener('click', closeCategoryModal);
$('modal-cancel-btn').addEventListener('click', closeCategoryModal);
$('category-modal').querySelector('.modal-backdrop').addEventListener('click', closeCategoryModal);

$('category-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = $('category-form');
  const editId = form.editId.value;
  const data = {
    id: form.id.value,
    name: form.name.value,
    emoji: form.emoji.value,
    description: form.description.value,
    categoryId: form.categoryId.value,
    requiredRole: form.requiredRole.value.trim() || '',
    supportRoles: form.supportRoles.value ? form.supportRoles.value.split(',').map(s => s.trim()).filter(Boolean) : [],
    maxTickets: parseInt(form.maxTickets.value) || 1,
  };

  try {
    if (editId) {
      await api('PUT', `/categories/${editId}`, data);
    } else {
      await api('POST', '/categories', data);
    }
    toast('Catégorie sauvegardée ✓');
    closeCategoryModal();
    loadCategories();
  } catch (err) {
    toast(err.message, false);
  }
});

async function deleteCategory(id) {
  if (!confirm(`Supprimer la catégorie "${id}" ?`)) return;
  await api('DELETE', `/categories/${id}`)
    .then(() => { toast('Catégorie supprimée'); loadCategories(); })
    .catch(err => toast(err.message, false));
}

// ──────────── TICKETS ────────────
async function loadTickets() {
  tickets = await api('GET', '/tickets').catch(() => []);
  renderTickets();

  // Populate category filter
  const cats = [...new Set(tickets.map(t => t.category_id))];
  const sel = $('ticket-filter-category');
  sel.innerHTML = '<option value="">Toutes les catégories</option>';
  cats.forEach(c => { sel.innerHTML += `<option value="${c}">${c}</option>`; });
}

function renderTickets() {
  const statusFilter = $('ticket-filter-status').value;
  const catFilter = $('ticket-filter-category').value;
  const tbody = $('tickets-body');

  let rows = tickets;
  if (statusFilter) rows = rows.filter(t => t.status === statusFilter);
  if (catFilter) rows = rows.filter(t => t.category_id === catFilter);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Aucun ticket</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(t => `
    <tr>
      <td>#${String(t.ticket_number).padStart(4, '0')}</td>
      <td><code>${t.user_id}</code></td>
      <td>${t.category_id}</td>
      <td><span class="badge badge-${t.claimed_by ? 'claimed' : t.status}">${t.claimed_by ? 'claim' : t.status}</span></td>
      <td>${t.claimed_by ? `<code>${t.claimed_by}</code>` : '—'}</td>
      <td>${fmtDate(t.created_at)}</td>
    </tr>
  `).join('');
}

$('ticket-filter-status').addEventListener('change', renderTickets);
$('ticket-filter-category').addEventListener('change', renderTickets);

// ──────────── SETTINGS ────────────
function loadSettings() {
  const form = $('settings-form');
  form.guildId.value = cfg.guildId ?? '';
  if (form.guildName) form.guildName.value = cfg.name ?? '';
  form.staffRoles.value = (cfg.staffRoles ?? []).join(',');
  form.adminRoles.value = (cfg.adminRoles ?? []).join(',');
  if (cfg.logChannelId) {
    const logSel = form.querySelector('select[name="logChannelId"]');
    if (logSel) logSel.value = cfg.logChannelId;
  }
}

$('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = $('settings-form');
  const patch = {
    name: form.guildName?.value || cfg.name || '',
    logChannelId: form.querySelector('select[name="logChannelId"]').value,
    staffRoles: form.staffRoles.value ? form.staffRoles.value.split(',').map(s => s.trim()).filter(Boolean) : [],
    adminRoles: form.adminRoles.value ? form.adminRoles.value.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
  await api('PUT', '/config', { ...cfg, ...patch })
    .then(() => { cfg = { ...cfg, ...patch }; toast('Paramètres sauvegardés ✓'); })
    .catch(err => toast(err.message, false));
});

function loadTicketSettings() {
  const form = $('ticket-settings-form');
  const t = cfg.tickets ?? {};
  form.nameFormat.value = t.nameFormat ?? '{username}-{number}';
  form.openMessage.value = t.openMessage ?? '';
  form.maxPerUser.value = t.maxPerUser ?? 1;
  form.querySelector('#globalMax-toggle').checked = t.globalMax ?? false;
  const closedSel = form.querySelector('select[name="closedCategoryId"]');
  if (closedSel && t.closedCategoryId) closedSel.value = t.closedCategoryId;
}

$('ticket-settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = $('ticket-settings-form');
  const patch = {
    nameFormat: form.nameFormat.value,
    openMessage: form.openMessage.value,
    closedCategoryId: form.querySelector('select[name="closedCategoryId"]').value,
    maxPerUser: parseInt(form.maxPerUser.value) || 1,
    globalMax: form.querySelector('#globalMax-toggle').checked,
  };
  await api('PATCH', '/config/tickets', patch)
    .then(() => { cfg.tickets = { ...cfg.tickets, ...patch }; toast('Paramètres tickets sauvegardés ✓'); })
    .catch(err => toast(err.message, false));
});

// ──────────── TRANSCRIPTS ────────────
let allTranscripts = [];

async function loadTranscripts() {
  allTranscripts = await api('GET', '/transcripts').catch(() => []);

  // Populate category filter
  const cats = [...new Set(allTranscripts.map(t => t.category_id))];
  const sel = $('tf-category');
  sel.innerHTML = '<option value="">Toutes les catégories</option>';
  cats.forEach(c => { sel.innerHTML += `<option value="${c}">${c}</option>`; });

  renderTranscripts();
}

function renderTranscripts() {
  const catFilter  = $('tf-category').value;
  const fromFilter = $('tf-from').value ? new Date($('tf-from').value).getTime() : null;
  const toFilter   = $('tf-to').value   ? new Date($('tf-to').value).getTime() + 86400000 : null;
  const userFilter = $('tf-user').value.trim().toLowerCase();

  let rows = allTranscripts;
  if (catFilter)  rows = rows.filter(t => t.category_id === catFilter);
  if (fromFilter) rows = rows.filter(t => t.deleted_at >= fromFilter);
  if (toFilter)   rows = rows.filter(t => t.deleted_at <= toFilter);
  if (userFilter) rows = rows.filter(t => t.user_id.includes(userFilter) || t.deleted_by.includes(userFilter));

  const tbody = $('transcripts-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Aucun résultat</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(t => `
    <tr>
      <td>#${String(t.ticket_number).padStart(4, '0')}</td>
      <td><code>#${t.channel_name}</code></td>
      <td>${t.category_id}</td>
      <td><code>${t.user_id}</code></td>
      <td><code>${t.deleted_by}</code></td>
      <td>${t.message_count}</td>
      <td>${fmtDate(t.deleted_at)}</td>
      <td style="display:flex;gap:6px">
        <button class="btn-primary" onclick="openTranscript(${t.id})">👁</button>
        <button class="btn-secondary" onclick="openReopenModal(${t.id})">🔓</button>
      </td>
    </tr>
  `).join('');
}

['tf-category','tf-from','tf-to','tf-user'].forEach(id => {
  $(id)?.addEventListener('change', renderTranscripts);
  $(id)?.addEventListener('input', renderTranscripts);
});

$('tf-reset')?.addEventListener('click', () => {
  $('tf-category').value = '';
  $('tf-from').value = '';
  $('tf-to').value = '';
  $('tf-user').value = '';
  renderTranscripts();
});

async function openTranscript(id) {
  const t = await api('GET', `/transcripts/${id}`).catch(err => { toast(err.message, false); return null; });
  if (!t) return;

  $('transcript-modal-title').textContent = `Transcript — #${t.channel_name} (Ticket #${String(t.ticket_number).padStart(4, '0')})`;
  $('transcript-meta').innerHTML = `
    <span><strong>Catégorie:</strong> ${t.category_id}</span>
    <span><strong>Créateur:</strong> ${t.user_id}</span>
    <span><strong>Supprimé par:</strong> ${t.deleted_by}</span>
    <span><strong>Date:</strong> ${fmtDate(t.deleted_at)}</span>
    <span><strong>Messages:</strong> ${t.message_count}</span>
  `;

  const container = $('transcript-messages');
  if (!t.messages.length) {
    container.innerHTML = '<div class="loading">Aucun message enregistré.</div>';
  } else {
    container.innerHTML = t.messages.map(msg => renderMessage(msg)).join('');
  }

  $('transcript-modal').classList.remove('hidden');
}

function renderMessage(msg) {
  // System / pin messages (bot, no content and no embeds)
  if (msg.bot && !msg.content && !msg.embeds.length) return '';

  const color = avatarColor(msg.authorId);
  const initials = msg.author.slice(0, 2).toUpperCase();
  const time = fmtDate(msg.timestamp);

  const embedsHtml = msg.embeds.map(e => {
    const borderColor = e.color || '#5865f2';
    const fieldsHtml = e.fields?.map(f =>
      `<div class="msg-embed-field">
        <div class="msg-embed-field-name">${esc(f.name)}</div>
        <div class="msg-embed-field-value">${esc(f.value)}</div>
      </div>`
    ).join('') ?? '';
    return `
      <div class="msg-embed" style="border-left-color:${borderColor}">
        ${e.title ? `<div class="msg-embed-title">${esc(e.title)}</div>` : ''}
        ${e.description ? `<div class="msg-embed-desc">${esc(e.description)}</div>` : ''}
        ${fieldsHtml}
        ${e.footer ? `<div class="msg-embed-footer">${esc(e.footer)}</div>` : ''}
      </div>`;
  }).join('');

  const attachmentsHtml = msg.attachments.map(a =>
    `<div class="msg-attachment">📎 <a href="${a.url}" target="_blank" style="color:var(--accent)">${esc(a.name)}</a></div>`
  ).join('');

  const contentHtml = msg.content
    ? `<div class="msg-content">${esc(msg.content)}</div>`
    : `<div class="msg-content empty">(pas de contenu texte)</div>`;

  return `
    <div class="msg-row">
      <div class="msg-avatar" style="background:${color}">${initials}</div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-author${msg.bot ? ' bot' : ''}">${esc(msg.author)}${msg.bot ? ' <small>[BOT]</small>' : ''}</span>
          <span class="msg-time">${time}</span>
        </div>
        ${contentHtml}
        ${embedsHtml}
        ${attachmentsHtml}
      </div>
    </div>`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function avatarColor(id) {
  const colors = ['#5865f2','#57f287','#fee75c','#eb459e','#ed4245','#3ba55c','#faa61a'];
  let hash = 0;
  for (let i = 0; i < (id?.length ?? 0); i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

$('transcript-modal-close').addEventListener('click', () => $('transcript-modal').classList.add('hidden'));
$('transcript-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('transcript-modal').classList.add('hidden'));

// ──────────── REOPEN MODAL ────────────
let reopenUsers = []; // { id, creator: bool }

function openReopenModal(transcriptId) {
  const t = allTranscripts.find(x => x.id === transcriptId);
  if (!t) return;

  reopenUsers = [{ id: t.user_id, creator: true }];

  $('reopen-form').transcriptId.value = transcriptId;
  $('reopen-info').innerHTML = `
    <span><strong>#</strong> ${String(t.ticket_number).padStart(4, '0')}</span>
    <span><strong>Salon:</strong> #${t.channel_name}</span>
    <span><strong>Catégorie d'origine:</strong> ${t.category_id}</span>
    <span><strong>Créateur:</strong> ${t.user_id}</span>
  `;

  // Populate category select
  const sel = $('reopen-category-select');
  sel.innerHTML = (cfg.ticketCategories ?? []).map(c =>
    `<option value="${c.id}" ${c.id === t.category_id ? 'selected' : ''}>${c.emoji || ''} ${c.name}</option>`
  ).join('');

  renderReopenUsers();
  $('reopen-modal').classList.remove('hidden');
}

function renderReopenUsers() {
  $('reopen-users-list').innerHTML = reopenUsers.map(u => `
    <span class="user-tag${u.creator ? ' creator' : ''}">
      ${u.creator ? '👑 ' : ''}<code>${u.id}</code>
      ${u.creator ? '' : `<button type="button" onclick="removeReopenUser('${u.id}')">✕</button>`}
    </span>
  `).join('');
}

function removeReopenUser(id) {
  reopenUsers = reopenUsers.filter(u => u.id !== id);
  renderReopenUsers();
}

$('reopen-add-user-btn').addEventListener('click', () => {
  const input = $('reopen-add-user-input');
  const id = input.value.trim();
  if (!id) return;
  if (reopenUsers.find(u => u.id === id)) { toast('Déjà dans la liste', false); return; }
  reopenUsers.push({ id, creator: false });
  renderReopenUsers();
  input.value = '';
});

$('reopen-add-user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('reopen-add-user-btn').click(); }
});

function closeReopenModal() { $('reopen-modal').classList.add('hidden'); }
$('reopen-modal-close').addEventListener('click', closeReopenModal);
$('reopen-cancel-btn').addEventListener('click', closeReopenModal);
$('reopen-modal').querySelector('.modal-backdrop').addEventListener('click', closeReopenModal);

$('reopen-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = $('reopen-form');
  const transcriptId = parseInt(form.transcriptId.value);
  const categoryId = $('reopen-category-select').value;
  const additionalUsers = reopenUsers.filter(u => !u.creator).map(u => u.id);

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Création…';

  try {
    const res = await api('POST', `/transcripts/${transcriptId}/reopen`, { categoryId, additionalUsers });
    toast(`✅ Ticket réouvert : #${res.channelName}`);
    closeReopenModal();
  } catch (err) {
    toast('❌ ' + err.message, false);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '🔓 Réouvrir';
  }
});

// ──────────── BOOT ────────────
(async () => {
  const res = await fetch('/auth/check');
  const { authenticated } = await res.json();
  if (authenticated) {
    $('login-screen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    await initDashboard();
  }
})();
