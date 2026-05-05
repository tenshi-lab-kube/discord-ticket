const express = require('express');
const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const apiRouter = require('./web/api');

const app = express();
let oidcDiscoveryCache = null;

app.use(cors({ origin: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8, sameSite: 'lax' },
}));

function oidcEnabled() {
  return !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
}

function getOidcRedirectUri(req) {
  if (process.env.OIDC_REDIRECT_URI) return process.env.OIDC_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/auth/oidc/callback`;
}

async function getOidcDiscovery() {
  if (oidcDiscoveryCache) return oidcDiscoveryCache;
  const issuer = process.env.OIDC_ISSUER.replace(/\/$/, '');
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  oidcDiscoveryCache = await res.json();
  return oidcDiscoveryCache;
}

app.get('/', (req, res, next) => {
  if (!req.session?.authenticated && oidcEnabled() && process.env.OIDC_AUTO_LOGIN !== 'false') {
    return res.redirect('/auth/oidc/login');
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'web', 'public')));

// Auth middleware for API
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

app.get('/auth/methods', (req, res) => {
  res.json({
    password: !!process.env.WEB_PASSWORD,
    oidc: oidcEnabled(),
  });
});

app.get('/auth/oidc/login', async (req, res) => {
  if (!oidcEnabled()) return res.status(404).send('OIDC disabled');

  try {
    const discovery = await getOidcDiscovery();
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oidcState = state;

    const params = new URLSearchParams({
      client_id: process.env.OIDC_CLIENT_ID,
      redirect_uri: getOidcRedirectUri(req),
      response_type: 'code',
      scope: process.env.OIDC_SCOPES || 'openid profile email',
      state,
    });

    res.redirect(`${discovery.authorization_endpoint}?${params.toString()}`);
  } catch (err) {
    console.error('[OIDC] Login failed:', err.message);
    res.status(500).send('OIDC login failed');
  }
});

app.get('/auth/oidc/callback', async (req, res) => {
  if (!oidcEnabled()) return res.status(404).send('OIDC disabled');
  if (!req.query.code || req.query.state !== req.session?.oidcState) {
    return res.status(400).send('Invalid OIDC state');
  }

  try {
    const discovery = await getOidcDiscovery();
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      redirect_uri: getOidcRedirectUri(req),
      client_id: process.env.OIDC_CLIENT_ID,
      client_secret: process.env.OIDC_CLIENT_SECRET,
    });

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || `token ${tokenRes.status}`);

    let user = {};
    if (tokens.access_token && discovery.userinfo_endpoint) {
      const userRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userRes.ok) user = await userRes.json();
    }

    req.session.authenticated = true;
    req.session.user = {
      sub: user.sub,
      email: user.email,
      name: user.name || user.preferred_username || user.email,
    };
    delete req.session.oidcState;
    res.redirect('/');
  } catch (err) {
    console.error('[OIDC] Callback failed:', err.message);
    res.status(401).send('OIDC callback failed');
  }
});

// Login
app.post('/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.WEB_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated, user: req.session?.user || null });
});

// API routes (protected)
app.use('/api', requireAuth, apiRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'public', 'index.html'));
});

function startWeb() {
  const port = process.env.WEB_PORT || 3000;
  app.listen(port, () => {
    console.log(`[Web] Dashboard disponible sur http://localhost:${port}`);
  });
}

module.exports = { startWeb };
