const { db } = require('./database');

const MAX_RESPONSE_LENGTH = 2000;

console.log('[custom-responses] System loaded');

function normalizeKeyword(keyword) {
  return String(keyword || '').trim().toLowerCase();
}

function normalizeContent(content) {
  return String(content || '').trim().toLowerCase();
}

function normalizeInput(input = {}) {
  const guildId = String(input.guild_id || input.guildId || '').trim();
  const keyword = normalizeKeyword(input.keyword);
  const response = String(input.response || '').trim();
  const createdBy = input.created_by || input.createdBy || null;

  if (!guildId) throw new Error('guild_id obligatoire');
  if (!keyword) throw new Error('keyword obligatoire');
  if (!response) throw new Error('response obligatoire');
  if (response.length > MAX_RESPONSE_LENGTH) {
    throw new Error(`response limitee a ${MAX_RESPONSE_LENGTH} caracteres`);
  }

  return { guildId, keyword, response, createdBy };
}

function mapSqlError(error) {
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const duplicate = new Error('Une reponse custom existe deja pour ce keyword sur ce serveur');
    duplicate.status = 409;
    return duplicate;
  }
  return error;
}

function withSqlErrors(fn) {
  try {
    return fn();
  } catch (error) {
    console.error('[custom-responses] SQL error:', error.message);
    throw mapSqlError(error);
  }
}

function listCustomResponses(guildId) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) throw new Error('guild_id obligatoire');

  return withSqlErrors(() => db.prepare(`
    SELECT id, guild_id, keyword, response, created_by, created_at
    FROM custom_responses
    WHERE guild_id = ?
    ORDER BY length(keyword) DESC, keyword ASC
  `).all(normalizedGuildId));
}

function addCustomResponse(input) {
  const data = normalizeInput(input);
  return withSqlErrors(() => {
    const result = db.prepare(`
      INSERT INTO custom_responses (guild_id, keyword, response, created_by)
      VALUES (?, ?, ?, ?)
    `).run(data.guildId, data.keyword, data.response, data.createdBy);
    return getCustomResponseById(result.lastInsertRowid, data.guildId);
  });
}

function updateCustomResponse(id, input) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error('id invalide');

  const data = normalizeInput(input);
  return withSqlErrors(() => {
    const result = db.prepare(`
      UPDATE custom_responses
      SET keyword = ?, response = ?
      WHERE id = ? AND guild_id = ?
    `).run(data.keyword, data.response, numericId, data.guildId);
    if (!result.changes) {
      const notFound = new Error('Reponse custom introuvable');
      notFound.status = 404;
      throw notFound;
    }
    return getCustomResponseById(numericId, data.guildId);
  });
}

function removeCustomResponseById(id, guildId) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error('id invalide');
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) throw new Error('guild_id obligatoire');

  return withSqlErrors(() => {
    const result = db.prepare('DELETE FROM custom_responses WHERE id = ? AND guild_id = ?')
      .run(numericId, normalizedGuildId);
    return result.changes > 0;
  });
}

function removeCustomResponseByKeyword(guildId, keyword) {
  const normalizedGuildId = String(guildId || '').trim();
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedGuildId) throw new Error('guild_id obligatoire');
  if (!normalizedKeyword) throw new Error('keyword obligatoire');

  return withSqlErrors(() => {
    const result = db.prepare('DELETE FROM custom_responses WHERE guild_id = ? AND keyword = ?')
      .run(normalizedGuildId, normalizedKeyword);
    return result.changes > 0;
  });
}

function getCustomResponseById(id, guildId = null) {
  if (guildId) {
    return db.prepare(`
      SELECT id, guild_id, keyword, response, created_by, created_at
      FROM custom_responses
      WHERE id = ? AND guild_id = ?
    `).get(id, guildId);
  }
  return db.prepare(`
    SELECT id, guild_id, keyword, response, created_by, created_at
    FROM custom_responses
    WHERE id = ?
  `).get(id);
}

function findMatchingResponse(guildId, content) {
  const normalizedContent = normalizeContent(content);
  if (!normalizedContent) return null;

  const rows = listCustomResponses(guildId);
  return rows.find(row => normalizedContent.includes(row.keyword)) || null;
}

module.exports = {
  MAX_RESPONSE_LENGTH,
  addCustomResponse,
  findMatchingResponse,
  getCustomResponseById,
  listCustomResponses,
  normalizeContent,
  normalizeKeyword,
  removeCustomResponseById,
  removeCustomResponseByKeyword,
  updateCustomResponse,
};
