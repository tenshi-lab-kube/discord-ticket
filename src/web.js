const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./web/api');

const app = express();

app.use(cors({ origin: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 },
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'web', 'public')));

// Auth middleware for API
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Non authentifié' });
}

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
  req.session.destroy();
  res.json({ success: true });
});

app.get('/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
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
