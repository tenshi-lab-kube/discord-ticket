const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'tickets.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number INTEGER NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    claimed_by TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    panel_message_id TEXT
  );

  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_stats (
    guild_id TEXT PRIMARY KEY,
    total_created INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number INTEGER NOT NULL,
    channel_name TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    deleted_by TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    messages TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, guild_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
  CREATE INDEX IF NOT EXISTS idx_transcripts_guild ON transcripts(guild_id);
`);

module.exports = {
  db,

  createTicket(data) {
    return db.prepare(`
      INSERT INTO tickets (ticket_number, channel_id, guild_id, user_id, category_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?)
    `).run(data.ticketNumber, data.channelId, data.guildId, data.userId, data.categoryId, Date.now());
  },

  getTicketByChannel(channelId) {
    return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
  },

  getOpenTicketsByUser(userId, guildId, categoryId) {
    return db.prepare(`
      SELECT * FROM tickets WHERE user_id = ? AND guild_id = ? AND category_id = ? AND status = 'open'
    `).all(userId, guildId, categoryId);
  },

  getOpenTicketsByUserGlobal(userId, guildId) {
    return db.prepare(`
      SELECT * FROM tickets WHERE user_id = ? AND guild_id = ? AND status = 'open'
    `).all(userId, guildId);
  },

  getAllTickets(guildId) {
    return db.prepare(
      "SELECT * FROM tickets WHERE guild_id = ? AND status != 'deleted' ORDER BY created_at DESC"
    ).all(guildId);
  },

  getNextTicketNumber(guildId) {
    const row = db.prepare('SELECT MAX(ticket_number) as max FROM tickets WHERE guild_id = ?').get(guildId);
    return (row?.max ?? 0) + 1;
  },

  updateTicketStatus(channelId, status, claimedBy = null) {
    return db.prepare(`
      UPDATE tickets SET status = ?, claimed_by = ?, closed_at = ? WHERE channel_id = ?
    `).run(status, claimedBy, status === 'closed' ? Date.now() : null, channelId);
  },

  updateTicketCategory(channelId, categoryId) {
    return db.prepare('UPDATE tickets SET category_id = ? WHERE channel_id = ?').run(categoryId, channelId);
  },

  // Soft-delete: garde la ligne pour que MAX(ticket_number) reste cohérent
  softDeleteTicket(channelId) {
    return db.prepare("UPDATE tickets SET status = 'deleted' WHERE channel_id = ?").run(channelId);
  },

  savePanel(guildId, channelId, messageId) {
    db.prepare('DELETE FROM panels WHERE guild_id = ?').run(guildId);
    return db.prepare(`
      INSERT INTO panels (guild_id, channel_id, message_id, created_at) VALUES (?, ?, ?, ?)
    `).run(guildId, channelId, messageId, Date.now());
  },

  getPanel(guildId) {
    return db.prepare('SELECT * FROM panels WHERE guild_id = ?').get(guildId);
  },

  // ── Compteur global ──────────────────────────────────────
  incrementGuildTotal(guildId) {
    db.prepare(`
      INSERT INTO guild_stats (guild_id, total_created) VALUES (?, 1)
      ON CONFLICT(guild_id) DO UPDATE SET total_created = total_created + 1
    `).run(guildId);
  },

  getGuildStats(guildId) {
    return db.prepare('SELECT * FROM guild_stats WHERE guild_id = ?').get(guildId);
  },

  // ── Transcripts ──────────────────────────────────────────
  saveTranscript(data) {
    return db.prepare(`
      INSERT INTO transcripts (ticket_number, channel_name, guild_id, user_id, category_id, deleted_by, deleted_at, message_count, messages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.ticketNumber,
      data.channelName,
      data.guildId,
      data.userId,
      data.categoryId,
      data.deletedBy,
      data.deletedAt,
      data.messageCount,
      JSON.stringify(data.messages),
    );
  },

  getTranscripts(guildId) {
    return db.prepare(
      'SELECT id, ticket_number, channel_name, user_id, category_id, deleted_by, deleted_at, message_count FROM transcripts WHERE guild_id = ? ORDER BY deleted_at DESC'
    ).all(guildId);
  },

  getTranscriptById(id) {
    return db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
  },
};
