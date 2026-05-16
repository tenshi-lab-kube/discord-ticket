const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tickets.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

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
    messages TEXT NOT NULL DEFAULT '[]',
    partial INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS custom_response_settings (
    guild_id TEXT PRIMARY KEY,
    allowed_channel_ids TEXT NOT NULL DEFAULT '[]',
    allowed_category_ids TEXT NOT NULL DEFAULT '[]',
    denied_channel_ids TEXT NOT NULL DEFAULT '[]',
    denied_category_ids TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, guild_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
  CREATE INDEX IF NOT EXISTS idx_transcripts_guild ON transcripts(guild_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_responses_guild_keyword ON custom_responses(guild_id, keyword);
  CREATE INDEX IF NOT EXISTS idx_custom_responses_guild ON custom_responses(guild_id);
`);

console.log(`[db] SQLite ready at ${DB_PATH}`);

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_open_user_category
      ON tickets(guild_id, user_id, category_id)
      WHERE status = 'open'
  `);
} catch (error) {
  console.warn('[db] Anti-double-ticket index skipped. Clean duplicate open tickets before enabling it.', error.message);
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

if (!columnExists('transcripts', 'partial')) {
  db.exec('ALTER TABLE transcripts ADD COLUMN partial INTEGER NOT NULL DEFAULT 0');
}
if (!columnExists('transcripts', 'error')) {
  db.exec('ALTER TABLE transcripts ADD COLUMN error TEXT');
}
if (!columnExists('custom_response_settings', 'denied_channel_ids')) {
  db.exec("ALTER TABLE custom_response_settings ADD COLUMN denied_channel_ids TEXT NOT NULL DEFAULT '[]'");
}
if (!columnExists('custom_response_settings', 'denied_category_ids')) {
  db.exec("ALTER TABLE custom_response_settings ADD COLUMN denied_category_ids TEXT NOT NULL DEFAULT '[]'");
}

const createTicketTx = db.transaction((data) => {
  const ticketNumber = db
    .prepare('SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next FROM tickets WHERE guild_id = ?')
    .get(data.guildId).next;

  db.prepare(`
    INSERT INTO tickets (ticket_number, channel_id, guild_id, user_id, category_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(ticketNumber, data.channelId, data.guildId, data.userId, data.categoryId, Date.now());

  db.prepare(`
    INSERT INTO guild_stats (guild_id, total_created) VALUES (?, 1)
    ON CONFLICT(guild_id) DO UPDATE SET total_created = total_created + 1
  `).run(data.guildId);

  return ticketNumber;
});

module.exports = {
  db,

  createTicket(data) {
    return createTicketTx(data);
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
      "SELECT * FROM tickets WHERE guild_id = ? AND status != 'deleted' ORDER BY created_at DESC",
    ).all(guildId);
  },

  getNextTicketNumber(guildId) {
    const row = db.prepare('SELECT MAX(ticket_number) AS max FROM tickets WHERE guild_id = ?').get(guildId);
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

  incrementGuildTotal(guildId) {
    db.prepare(`
      INSERT INTO guild_stats (guild_id, total_created) VALUES (?, 1)
      ON CONFLICT(guild_id) DO UPDATE SET total_created = total_created + 1
    `).run(guildId);
  },

  getGuildStats(guildId) {
    const stored = db.prepare('SELECT * FROM guild_stats WHERE guild_id = ?').get(guildId);
    const ticketHistory = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(ticket_number), 0) AS max_number
      FROM tickets
      WHERE guild_id = ?
    `).get(guildId);
    const transcriptHistory = db.prepare(`
      SELECT COALESCE(MAX(ticket_number), 0) AS max_number
      FROM transcripts
      WHERE guild_id = ?
    `).get(guildId);

    const totalCreated = Math.max(
      stored?.total_created ?? 0,
      ticketHistory?.count ?? 0,
      ticketHistory?.max_number ?? 0,
      transcriptHistory?.max_number ?? 0,
    );

    if (!stored) {
      db.prepare('INSERT INTO guild_stats (guild_id, total_created) VALUES (?, ?)').run(guildId, totalCreated);
    } else if (totalCreated > stored.total_created) {
      db.prepare('UPDATE guild_stats SET total_created = ? WHERE guild_id = ?').run(totalCreated, guildId);
    }

    return { guild_id: guildId, total_created: totalCreated };
  },

  saveTranscript(data) {
    return db.prepare(`
      INSERT INTO transcripts (
        ticket_number, channel_name, guild_id, user_id, category_id,
        deleted_by, deleted_at, message_count, messages, partial, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.ticketNumber,
      data.channelName,
      data.guildId,
      data.userId,
      data.categoryId,
      data.deletedBy,
      data.deletedAt,
      data.messageCount,
      JSON.stringify(data.messages ?? []),
      data.partial ? 1 : 0,
      data.error ?? null,
    );
  },

  getTranscripts(guildId) {
    return db.prepare(`
      SELECT id, ticket_number, channel_name, user_id, category_id, deleted_by,
             deleted_at, message_count, partial, error
      FROM transcripts
      WHERE guild_id = ?
      ORDER BY deleted_at DESC
    `).all(guildId);
  },

  getTranscriptById(id, guildId = null) {
    if (guildId) {
      return db.prepare('SELECT * FROM transcripts WHERE id = ? AND guild_id = ?').get(id, guildId);
    }
    return db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id);
  },
};
