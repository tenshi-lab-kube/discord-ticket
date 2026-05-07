(() => {
  let ticketBans = [];

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const apiRequest = async (method, path) => {
    const res = await fetch('/api' + path, { method });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  };

  const formatDate = timestamp => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const notify = (message, ok = true) => {
    if (typeof toast === 'function') return toast(message, ok);
    window.alert(message);
  };

  const statusLabel = status => ({
    active: 'Actif',
    expired: 'Expire',
    revoked: 'Revoque',
  }[status] || '-');

  const renderTicketBans = () => {
    const statusFilter = byId('ban-filter-status')?.value || '';
    const userFilter = (byId('ban-filter-user')?.value || '').trim().toLowerCase();
    const tbody = byId('ticket-bans-body');
    if (!tbody) return;

    let rows = ticketBans;
    if (statusFilter) rows = rows.filter(ban => ban.computed_status === statusFilter);
    if (userFilter) {
      rows = rows.filter(ban =>
        ban.user_id.toLowerCase().includes(userFilter) ||
        ban.banned_by.toLowerCase().includes(userFilter) ||
        (ban.revoked_by || '').toLowerCase().includes(userFilter)
      );
    }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading">Aucun ban ticket</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(ban => {
      const status = ban.computed_status;
      const action = status === 'active'
        ? `<button class="btn-danger" data-ticket-unban="${escapeHtml(ban.user_id)}">Debannir</button>`
        : '';

      return `
        <tr>
          <td><code>${escapeHtml(ban.user_id)}</code></td>
          <td><span class="badge badge-${escapeHtml(status)}">${statusLabel(status)}</span></td>
          <td>${ban.expires_at ? formatDate(ban.expires_at) : 'Permanent'}</td>
          <td>${escapeHtml(ban.reason || 'Aucune raison')}</td>
          <td><code>${escapeHtml(ban.banned_by)}</code></td>
          <td>${formatDate(ban.created_at)}</td>
          <td class="table-actions">${action}</td>
        </tr>
      `;
    }).join('');
  };

  const loadTicketBans = async () => {
    const tbody = byId('ticket-bans-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading">Chargement...</td></tr>';

    try {
      ticketBans = await apiRequest('GET', '/ticket-bans');
      renderTicketBans();
    } catch (error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading">${escapeHtml(error.message)}</td></tr>`;
    }
  };

  const revokeTicketBan = async userId => {
    if (!window.confirm(`Debannir ${userId} de l'ouverture de tickets ?`)) return;

    try {
      await apiRequest('DELETE', `/ticket-bans/${encodeURIComponent(userId)}`);
      notify('Ban ticket retire');
      await loadTicketBans();
    } catch (error) {
      notify(error.message, false);
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    .badge-active { background: rgba(87,242,135,.15); color: var(--green); }
    .badge-expired { background: rgba(254,231,92,.15); color: var(--yellow); }
    .badge-revoked { background: rgba(114,118,125,.2); color: var(--text-muted); }
    .table-actions { text-align: right; white-space: nowrap; }
  `;
  document.head.appendChild(style);

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-page="ticket-bans"]');
    if (nav) loadTicketBans();

    const unbanButton = event.target.closest('[data-ticket-unban]');
    if (unbanButton) revokeTicketBan(unbanButton.dataset.ticketUnban);
  });

  document.addEventListener('input', event => {
    if (event.target?.id === 'ban-filter-user') renderTicketBans();
  });

  document.addEventListener('change', event => {
    if (event.target?.id === 'ban-filter-status') renderTicketBans();
  });

  document.addEventListener('click', event => {
    if (event.target?.id !== 'ban-filter-reset') return;
    byId('ban-filter-status').value = '';
    byId('ban-filter-user').value = '';
    renderTicketBans();
  });
})();
