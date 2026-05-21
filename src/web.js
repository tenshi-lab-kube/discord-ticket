const express = require('express');
const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const apiRouter = require('./web/api');
const { db } = require('./database');

const app = express();

class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.originalMaxAge ?? 1000 * 60 * 60 * 8;
      db.prepare(`
        INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data
      `).run(sid, Date.now() + maxAge, JSON.stringify(sess));
      cb();
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb();
    } catch (err) {
      cb(err);
    }
  }
}

app.set('trust proxy', 1);
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

function getPublicBaseUrl(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

function getDiscordOAuthConfig(req) {
  const clientId = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI || `${getPublicBaseUrl(req)}/auth/callback`;
  return { clientId, clientSecret, redirectUri };
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/metrics', (req, res) => {
  const memory = process.memoryUsage();
  res.type('text/plain').send([
    '# HELP discord_ticket_up Bot web process health.',
    '# TYPE discord_ticket_up gauge',
    'discord_ticket_up 1',
    '# HELP discord_ticket_process_memory_bytes Node.js process memory usage.',
    '# TYPE discord_ticket_process_memory_bytes gauge',
    `discord_ticket_process_memory_bytes{type="rss"} ${memory.rss}`,
    `discord_ticket_process_memory_bytes{type="heap_used"} ${memory.heapUsed}`,
    '# HELP discord_ticket_uptime_seconds Node.js process uptime.',
    '# TYPE discord_ticket_uptime_seconds gauge',
    `discord_ticket_uptime_seconds ${process.uptime()}`,
    '',
  ].join('\n'));
});

app.get('/auth/discord', (req, res) => {
  const { clientId, redirectUri } = getDiscordOAuthConfig(req);
  if (!clientId) return res.status(500).send('DISCORD_OAUTH_CLIENT_ID ou CLIENT_ID manquant');

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

async function handleDiscordCallback(req, res) {
  const { code, state } = req.query;
  const { clientId, clientSecret, redirectUri } = getDiscordOAuthConfig(req);
  if (!code || !state || state !== req.session.oauthState) return res.status(400).send('Etat OAuth invalide');
  if (!clientId || !clientSecret) return res.status(500).send('Configuration OAuth incomplete');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error('Echange OAuth refuse');
    const token = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) throw new Error('Profil Discord inaccessible');
    const user = await userRes.json();

    req.session.user = {
      id: user.id,
      username: user.username,
      globalName: user.global_name,
      avatar: user.avatar,
    };
    delete req.session.oauthState;
    res.redirect('/');
  } catch (err) {
    res.status(401).send(err.message);
  }
}

app.get('/auth/callback', handleDiscordCallback);
app.get('/auth/discord/callback', handleDiscordCallback);

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session?.user, user: req.session?.user ?? null });
});

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Non authentifie' });
}

app.use(express.static(path.join(__dirname, 'web', 'public')));
app.use('/api', requireAuth, apiRouter);
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'public', 'index.html'));
});

function startWeb() {
  const configuredPort = process.env.WEB_PORT && !process.env.WEB_PORT.includes('{{')
    ? process.env.WEB_PORT
    : process.env.SERVER_PORT;
  const port = configuredPort || 3000;
  app.listen(port, () => {
    console.log(`[Web] Dashboard disponible sur http://localhost:${port}`);
  });
}

module.exports = { startWeb };
