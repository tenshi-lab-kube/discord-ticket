const os = require('os');

const startedAt = Date.now();
const routeStats = new Map();
const grafanaBaseUrl = process.env.GRAFANA_URL || 'https://grafana.tenshi-lab.fr';

function normalizePath(req) {
  if (req.path === '/metrics') return '/metrics';
  if (req.path === '/observability') return '/observability';
  if (req.path.startsWith('/api/transcripts/')) return '/api/transcripts/:id';
  if (req.path.startsWith('/api/categories/')) return '/api/categories/:id';
  return req.path || '/';
}

function observeHttp(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = normalizePath(req);
    if (route === '/metrics') return;

    const key = `${req.method} ${route} ${res.statusCode}`;
    const current = routeStats.get(key) || {
      method: req.method,
      route,
      status: String(res.statusCode),
      count: 0,
      durationSeconds: 0,
    };
    current.count += 1;
    current.durationSeconds += Number(process.hrtime.bigint() - start) / 1e9;
    routeStats.set(key, current);
  });
  next();
}

function escapeLabel(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function metricLine(name, labels, value) {
  const labelText = Object.entries(labels)
    .map(([key, val]) => `${key}="${escapeLabel(val)}"`)
    .join(',');
  return `${name}{${labelText}} ${Number.isFinite(value) ? value : 0}`;
}

function ticketStats(db, guildId) {
  const stats = db.getGuildStats(guildId) || {};
  const tickets = guildId ? db.getAllTickets(guildId) : [];
  const byStatus = tickets.reduce((acc, ticket) => {
    acc[ticket.status] = (acc[ticket.status] || 0) + 1;
    return acc;
  }, {});
  const byCategory = tickets.reduce((acc, ticket) => {
    const category = ticket.category_id || 'unknown';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  return {
    totalEver: stats.total_created || 0,
    open: byStatus.open || 0,
    closed: byStatus.closed || 0,
    claimed: tickets.filter(ticket => ticket.claimed_by).length,
    byCategory,
    ticketCount: tickets.length,
  };
}

function getObservabilitySnapshot({ db, getConfig, client }) {
  const config = getConfig();
  const guildId = config.guildId || '';
  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  const tickets = ticketStats(db, guildId);
  const uptimeSeconds = Math.floor(process.uptime());
  const memory = process.memoryUsage();

  return {
    service: 'discord-ticket',
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    uptimeSeconds,
    startedAt: new Date(startedAt).toISOString(),
    node: process.version,
    host: os.hostname(),
    guild: {
      id: guildId,
      connected: Boolean(guild),
      name: guild?.name || null,
      members: guild?.memberCount || 0,
      channels: guild?.channels?.cache?.size || 0,
    },
    tickets,
    process: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    routes: [...routeStats.values()].sort((a, b) => b.count - a.count).slice(0, 20),
    grafana: {
      dashboardUid: 'site-discord-ticket',
      url: `${grafanaBaseUrl}/d/site-discord-ticket/site-discord-ticket`,
    },
  };
}

function renderMetrics(deps) {
  const snapshot = getObservabilitySnapshot(deps);
  const lines = [
    '# HELP discord_ticket_up Application health status.',
    '# TYPE discord_ticket_up gauge',
    'discord_ticket_up 1',
    '# HELP discord_ticket_uptime_seconds Application uptime in seconds.',
    '# TYPE discord_ticket_uptime_seconds gauge',
    `discord_ticket_uptime_seconds ${snapshot.uptimeSeconds}`,
    '# HELP discord_ticket_info Static service information.',
    '# TYPE discord_ticket_info gauge',
    metricLine('discord_ticket_info', { service: snapshot.service, version: snapshot.version, node: snapshot.node, host: snapshot.host }, 1),
    '# HELP discord_ticket_guild_connected Discord guild connection status.',
    '# TYPE discord_ticket_guild_connected gauge',
    metricLine('discord_ticket_guild_connected', { guild_id: snapshot.guild.id, guild_name: snapshot.guild.name || 'unknown' }, snapshot.guild.connected ? 1 : 0),
    '# HELP discord_ticket_guild_members Discord guild member count.',
    '# TYPE discord_ticket_guild_members gauge',
    metricLine('discord_ticket_guild_members', { guild_id: snapshot.guild.id }, snapshot.guild.members),
    '# HELP discord_ticket_total_created Total tickets ever created.',
    '# TYPE discord_ticket_total_created gauge',
    `discord_ticket_total_created ${snapshot.tickets.totalEver}`,
    '# HELP discord_ticket_current Tickets currently known by status.',
    '# TYPE discord_ticket_current gauge',
    metricLine('discord_ticket_current', { status: 'open' }, snapshot.tickets.open),
    metricLine('discord_ticket_current', { status: 'closed' }, snapshot.tickets.closed),
    metricLine('discord_ticket_current', { status: 'claimed' }, snapshot.tickets.claimed),
    '# HELP discord_ticket_by_category Tickets currently known by category.',
    '# TYPE discord_ticket_by_category gauge',
    ...Object.entries(snapshot.tickets.byCategory).map(([category, count]) => metricLine('discord_ticket_by_category', { category }, count)),
    '# HELP discord_ticket_process_memory_bytes Process memory usage.',
    '# TYPE discord_ticket_process_memory_bytes gauge',
    metricLine('discord_ticket_process_memory_bytes', { type: 'rss' }, snapshot.process.rssBytes),
    metricLine('discord_ticket_process_memory_bytes', { type: 'heap_used' }, snapshot.process.heapUsedBytes),
    metricLine('discord_ticket_process_memory_bytes', { type: 'heap_total' }, snapshot.process.heapTotalBytes),
    '# HELP discord_ticket_http_requests_total HTTP requests handled by the app.',
    '# TYPE discord_ticket_http_requests_total counter',
    ...[...routeStats.values()].map(stat => metricLine('discord_ticket_http_requests_total', { method: stat.method, route: stat.route, status: stat.status }, stat.count)),
    '# HELP discord_ticket_http_request_duration_seconds_sum Total HTTP request duration.',
    '# TYPE discord_ticket_http_request_duration_seconds_sum counter',
    ...[...routeStats.values()].map(stat => metricLine('discord_ticket_http_request_duration_seconds_sum', { method: stat.method, route: stat.route, status: stat.status }, stat.durationSeconds)),
  ];

  return `${lines.join('\n')}\n`;
}

function observabilityPage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Ticket Observability</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#1e2124;color:#dcddde;font-family:Segoe UI,system-ui,sans-serif} main{max-width:1120px;margin:0 auto;padding:32px} header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:24px} h1{margin:0;font-size:28px} .muted{color:#9aa0a6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.card{background:#282b30;border:1px solid #40444b;border-radius:8px;padding:18px}.value{font-size:28px;font-weight:700;margin-top:8px}.label{font-size:12px;color:#9aa0a6;text-transform:uppercase;letter-spacing:.04em}.ok{color:#57f287}.warn{color:#fee75c} table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border-bottom:1px solid #40444b;padding:10px;text-align:left}a{color:#8ea1ff}.toolbar{display:flex;gap:10px;flex-wrap:wrap}.btn{background:#5865f2;color:white;border:0;border-radius:8px;padding:10px 14px;text-decoration:none;font-weight:600}
  </style>
</head>
<body>
<main>
  <header>
    <div><h1>Discord Ticket Observability</h1><p class="muted">Etat applicatif local, metriques runtime et liens Grafana.</p></div>
    <div class="toolbar"><a class="btn" href="/">Dashboard</a><a class="btn" href="/metrics">Metrics</a><a class="btn" href="${grafanaBaseUrl}/d/site-discord-ticket/site-discord-ticket">Grafana</a></div>
  </header>
  <section class="grid" id="cards"></section>
  <section class="card" style="margin-top:14px"><h2>Routes HTTP</h2><table><thead><tr><th>Route</th><th>Status</th><th>Requetes</th><th>Duree totale</th></tr></thead><tbody id="routes"></tbody></table></section>
</main>
<script>
async function load(){
 const res=await fetch('/observability/data');
 const data=await res.json();
 const cards=[['Status',data.status,'ok'],['Uptime',Math.round(data.uptimeSeconds/60)+' min',''],['Guild',data.guild.connected?'Connecte':'Absent',data.guild.connected?'ok':'warn'],['Membres',data.guild.members,''],['Tickets ouverts',data.tickets.open,''],['Tickets fermes',data.tickets.closed,''],['Tickets crees',data.tickets.totalEver,''],['Heap',Math.round(data.process.heapUsedBytes/1024/1024)+' MiB','']];
 document.getElementById('cards').innerHTML=cards.map(([label,value,cls])=>'<article class="card"><div class="label">'+label+'</div><div class="value '+cls+'">'+value+'</div></article>').join('');
 document.getElementById('routes').innerHTML=(data.routes||[]).map(r=>'<tr><td>'+r.method+' '+r.route+'</td><td>'+r.status+'</td><td>'+r.count+'</td><td>'+r.durationSeconds.toFixed(3)+'s</td></tr>').join('')||'<tr><td colspan="4" class="muted">Aucune requete observee.</td></tr>';
}
load(); setInterval(load,30000);
</script>
</body>
</html>`;
}

module.exports = {
  observeHttp,
  getObservabilitySnapshot,
  renderMetrics,
  observabilityPage,
};
