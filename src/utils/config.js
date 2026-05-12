const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', '..', 'config.json');
const EXAMPLE_PATH = path.join(__dirname, '..', '..', 'config.example.json');

const DEFAULT_GUILD_CONFIG = {
  name: '',
  enabled: false,
  logChannelId: '',
  staffRoles: [],
  adminRoles: [],
  ticketCategories: [],
  panel: {
    title: 'OUVRIR UN TICKET',
    description: "Tu as besoin d'aide ou tu as une requete a effectuer ?\n\nClique sur le bouton ci-dessous !",
    color: '#5865F2',
    buttonLabel: 'Ouvrir un ticket',
    placeholder: "Comment pouvons-nous t'aider ?",
    thumbnail: '',
    footer: '',
  },
  tickets: {
    nameFormat: '{username}-{number}',
    openMessage: 'Ton ticket a ete cree.\nFournis-nous toute information supplementaire que tu juges utile.',
    closedCategoryId: '',
    archiveCategoryPrefix: 'Tickets',
    maxPerUser: 1,
    globalMax: false,
    maxTranscriptMessages: 1000,
  },
};

let cachedConfig = null;

function ensureConfigExists() {
  if (fs.existsSync(CONFIG_PATH)) return;
  if (!fs.existsSync(EXAMPLE_PATH)) {
    throw new Error('[Config] config.example.json introuvable.');
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
  console.warn('[Config] config.json cree depuis config.example.json. Remplis-le.');
}

function normalizeGuildConfig(data = {}) {
  return {
    ...DEFAULT_GUILD_CONFIG,
    ...data,
    staffRoles: Array.isArray(data.staffRoles) ? data.staffRoles : [],
    adminRoles: Array.isArray(data.adminRoles) ? data.adminRoles : [],
    ticketCategories: Array.isArray(data.ticketCategories) ? data.ticketCategories : [],
    panel: { ...DEFAULT_GUILD_CONFIG.panel, ...(data.panel ?? {}) },
    tickets: { ...DEFAULT_GUILD_CONFIG.tickets, ...(data.tickets ?? {}) },
  };
}

function normalizeConfig(data = {}) {
  if (data.guilds && typeof data.guilds === 'object') {
    return {
      ...data,
      version: 2,
      guilds: Object.fromEntries(
        Object.entries(data.guilds).map(([guildId, guildConfig]) => [
          guildId,
          normalizeGuildConfig({ ...guildConfig, guildId }),
        ]),
      ),
    };
  }

  if (data.guildId) {
    const { guildId, ...legacy } = data;
    return {
      version: 2,
      guilds: {
        [guildId]: normalizeGuildConfig({
          ...legacy,
          guildId,
          enabled: true,
          name: legacy.name || 'Serveur principal',
        }),
      },
    };
  }

  return { version: 2, guilds: {} };
}

function loadConfig() {
  ensureConfigExists();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    if (!raw.trim()) throw new Error('config.json est vide');
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    console.error('[Config] Erreur lors du chargement:', err.message);
    try {
      const fallback = fs.readFileSync(EXAMPLE_PATH, 'utf8');
      console.warn('[Config] Fallback vers config.example.json');
      return normalizeConfig(JSON.parse(fallback));
    } catch {
      console.error('[Config] Impossible de charger un fallback valide.');
      return { version: 2, guilds: {} };
    }
  }
}

function saveConfig(data) {
  const normalized = normalizeConfig(data);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  cachedConfig = normalized;
}

function getConfig(forceReload = false) {
  if (!cachedConfig || forceReload) cachedConfig = loadConfig();
  return cachedConfig;
}

function listConfiguredGuilds({ enabledOnly = false } = {}) {
  const config = getConfig();
  return Object.entries(config.guilds ?? {})
    .filter(([, guildConfig]) => !enabledOnly || guildConfig.enabled)
    .map(([guildId, guildConfig]) => ({ guildId, ...normalizeGuildConfig(guildConfig) }));
}

function getGuildConfig(guildId, { requireEnabled = true } = {}) {
  if (!guildId) return null;
  const guildConfig = getConfig().guilds?.[guildId];
  if (!guildConfig) return null;
  if (requireEnabled && !guildConfig.enabled) return null;
  return normalizeGuildConfig({ ...guildConfig, guildId });
}

function saveGuildConfig(guildId, patch) {
  if (!guildId) throw new Error('guildId requis');
  const config = getConfig();
  const current = config.guilds?.[guildId] ?? { guildId };
  config.guilds = {
    ...(config.guilds ?? {}),
    [guildId]: normalizeGuildConfig({ ...current, ...patch, guildId }),
  };
  saveConfig(config);
  return config.guilds[guildId];
}

module.exports = {
  DEFAULT_GUILD_CONFIG,
  getConfig,
  getGuildConfig,
  listConfiguredGuilds,
  normalizeConfig,
  saveConfig,
  saveGuildConfig,
};
