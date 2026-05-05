const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config.json");
const EXAMPLE_PATH = path.join(__dirname, "..", "..", "config.example.json");

function ensureConfigExists() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (!fs.existsSync(EXAMPLE_PATH)) {
      throw new Error("[Config] config.example.json introuvable.");
    }

    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.warn("[Config] config.json créé depuis config.example.json. Remplis-le !");
  }
}

function loadConfig() {
  ensureConfigExists();

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");

    if (!raw.trim()) {
      throw new Error("config.json est vide");
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error("[Config] Erreur lors du chargement :", err.message);

    // fallback vers example si possible
    try {
      const fallback = fs.readFileSync(EXAMPLE_PATH, "utf8");
      console.warn("[Config] Fallback vers config.example.json");
      return JSON.parse(fallback);
    } catch {
      console.error("[Config] Impossible de charger un fallback valide.");
      return {};
    }
  }
}

function saveConfig(data) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
    cachedConfig = data; // met à jour le cache immédiatement
  } catch (err) {
    console.error("[Config] Erreur lors de la sauvegarde :", err.message);
  }
}

// cache pour éviter de relire le fichier 1000x
let cachedConfig = null;

function getConfig(forceReload = false) {
  if (!cachedConfig || forceReload) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

module.exports = { getConfig, saveConfig };