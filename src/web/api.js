const express = require('express');
const router = express.Router();
const { getConfig, saveConfig } = require('../utils/config');
const { buildPanelMessage } = require('../utils/panel');
const db = require('../database');
const { client } = require('../bot');

// GET full config
router.get('/config', (req, res) => {
  res.json(getConfig());
});

// PUT full config
router.put('/config', (req, res) => {
  try {
    const current = getConfig();
    const updated = { ...current, ...req.body };
    saveConfig(updated);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH panel config only
router.patch('/config/panel', (req, res) => {
  const config = getConfig();
  config.panel = { ...config.panel, ...req.body };
  saveConfig(config);
  res.json({ success: true });
});

// PATCH tickets config only
router.patch('/config/tickets', (req, res) => {
  const config = getConfig();
  config.tickets = { ...config.tickets, ...req.body };
  saveConfig(config);
  res.json({ success: true });
});

// GET categories
router.get('/categories', (req, res) => {
  const config = getConfig();
  res.json(config.ticketCategories ?? []);
});

// POST add category
router.post('/categories', (req, res) => {
  const config = getConfig();
  const { id, name, emoji, description, categoryId, supportRoles, maxTickets } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id et name requis' });
  if (config.ticketCategories.find(c => c.id === id)) {
    return res.status(409).json({ error: 'ID déjà utilisé' });
  }
  config.ticketCategories.push({ id, name, emoji: emoji || '', description: description || '', categoryId: categoryId || '', supportRoles: supportRoles || [], maxTickets: maxTickets || 1 });
  saveConfig(config);
  res.json({ success: true });
});

// PUT update category
router.put('/categories/:id', (req, res) => {
  const config = getConfig();
  const idx = config.ticketCategories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Catégorie introuvable' });
  config.ticketCategories[idx] = { ...config.ticketCategories[idx], ...req.body, id: req.params.id };
  saveConfig(config);
  res.json({ success: true });
});

// DELETE category
router.delete('/categories/:id', (req, res) => {
  const config = getConfig();
  config.ticketCategories = config.ticketCategories.filter(c => c.id !== req.params.id);
  saveConfig(config);
  res.json({ success: true });
});

// Reorder categories
router.patch('/categories/reorder', (req, res) => {
  const config = getConfig();
  const { order } = req.body; // array of ids
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order doit être un tableau' });
  config.ticketCategories = order.map(id => config.ticketCategories.find(c => c.id === id)).filter(Boolean);
  saveConfig(config);
  res.json({ success: true });
});

// GET stats (compteur global + breakdown)
router.get('/stats', (req, res) => {
  const config = getConfig();
  const guildId = config.guildId;
  const stats = db.getGuildStats(guildId);
  const tickets = db.getAllTickets(guildId);
  res.json({
    totalEver: stats?.total_created ?? 0,
    open: tickets.filter(t => t.status === 'open').length,
    closed: tickets.filter(t => t.status === 'closed').length,
    claimed: tickets.filter(t => t.claimed_by).length,
  });
});

// GET tickets list
router.get('/tickets', (req, res) => {
  const config = getConfig();
  const tickets = db.getAllTickets(config.guildId);
  res.json(tickets);
});

// GET ticket bans list
router.get('/ticket-bans', (req, res) => {
  const config = getConfig();
  res.json(db.getTicketBans(config.guildId));
});

// DELETE active ticket ban
router.delete('/ticket-bans/:userId', (req, res) => {
  const config = getConfig();
  const revokedBy = req.session?.user?.id || req.session?.user?.username || 'dashboard';
  const result = db.revokeTicketBan(req.params.userId, config.guildId, revokedBy);
  if (!result.changes) return res.status(404).json({ error: 'Aucun ban ticket actif pour cet utilisateur' });
  res.json({ success: true });
});

// GET transcripts list
router.get('/transcripts', (req, res) => {
  const config = getConfig();
  res.json(db.getTranscripts(config.guildId));
});

// GET single transcript (with messages)
router.get('/transcripts/:id', (req, res) => {
  const t = db.getTranscriptById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transcript introuvable' });
  t.messages = JSON.parse(t.messages);
  res.json(t);
});

// POST reopen a ticket from transcript
router.post('/transcripts/:id/reopen', async (req, res) => {
  const t = db.getTranscriptById(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transcript introuvable' });

  const config = getConfig();
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const { categoryId, additionalUsers = [] } = req.body;
  const targetCatId = categoryId || t.category_id;
  const category = config.ticketCategories.find(c => c.id === targetCatId);
  if (!category) return res.status(400).json({ error: 'Catégorie introuvable' });

  const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

  const ticketNumber = db.getNextTicketNumber(config.guildId);

  let creatorUsername = 'user';
  try {
    const member = await guild.members.fetch(t.user_id);
    creatorUsername = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  } catch {}

  const channelName = (config.tickets?.nameFormat ?? '{username}-{number}')
    .replace('{number}', String(ticketNumber).padStart(4, '0'))
    .replace('{username}', creatorUsername)
    .replace('{category}', category.id);

  // Créateur original toujours inclus, dédoublonnage
  const userIds = [t.user_id, ...additionalUsers.filter(id => id && id !== t.user_id)];

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
  ];

  for (const userId of userIds) {
    permissionOverwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const roleIds = [...new Set([...(config.staffRoles ?? []), ...(config.adminRoles ?? []), ...(category.supportRoles ?? [])])];
  for (const roleId of roleIds) {
    permissionOverwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  let discordCategory = null;
  if (category.categoryId) discordCategory = guild.channels.cache.get(category.categoryId);

  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: discordCategory ?? undefined,
      permissionOverwrites,
      topic: `Ticket réouvert (transcript #${t.id}) | Créateur: ${t.user_id}`,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('👑').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );

    const mentions = userIds.map(id => `<@${id}>`).join(' ');
    const embed = new EmbedBuilder()
      .setColor(config.panel?.color ?? '#5865F2')
      .setDescription(
        `🔓 **Ticket réouvert depuis le transcript #${String(t.ticket_number).padStart(4, '0')}**\n\n` +
        `**Catégorie:** ${category.emoji} ${category.name}\n` +
        `**Créateur original:** <@${t.user_id}>\n` +
        `**Membres:** ${mentions}`
      )
      .setFooter({ text: `Ticket #${String(ticketNumber).padStart(4, '0')} • Réouvert depuis dashboard` })
      .setTimestamp();

    const msg = await channel.send({ content: mentions, embeds: [embed], components: [row] });
    await msg.pin().catch(() => {});

    db.createTicket({ ticketNumber, channelId: channel.id, guildId: config.guildId, userId: t.user_id, categoryId: category.id });
    db.incrementGuildTotal(config.guildId);

    // Rejouer l'historique en arrière-plan (sans bloquer la réponse API)
    const messages = JSON.parse(t.messages);
    res.json({ success: true, channelId: channel.id, channelName });
    replayTranscript(channel, messages, t).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET guild channels (for channel pickers in dashboard)
router.get('/guild/channels', async (req, res) => {
  const config = getConfig();
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const channels = guild.channels.cache.map(ch => ({
    id: ch.id,
    name: ch.name,
    type: ch.type,
    parentId: ch.parentId ?? null,
  }));
  res.json(channels);
});

// GET guild roles
router.get('/guild/roles', async (req, res) => {
  const config = getConfig();
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
  res.json(roles);
});

// POST create Discord category channel
router.post('/guild/create-discord-category', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });

  const config = getConfig();
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const { ChannelType } = require('discord.js');
  try {
    const category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
    });
    res.json({ id: category.id, name: category.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST deploy panel (re-send to a channel)
router.post('/panel/deploy', async (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId requis' });

  const config = getConfig();
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Salon introuvable' });

  try {
    const msg = await channel.send(buildPanelMessage(config));
    db.savePanel(config.guildId, channelId, msg.id);
    res.json({ success: true, messageId: msg.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Replay transcript messages into a reopened channel ────────────────────────
async function replayTranscript(channel, messages, transcript) {
  const { EmbedBuilder } = require('discord.js');

  const real = messages.filter(m => m.content || m.embeds?.length || m.attachments?.length);
  if (!real.length) return;

  // Header séparateur
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('📜 Historique du ticket précédent')
        .setDescription(
          `Ticket **#${String(transcript.ticket_number).padStart(4, '0')}** · \`#${transcript.channel_name}\`\n` +
          `${real.length} message(s) archivé(s)`
        )
        .setFooter({ text: 'Les messages ci-dessous proviennent de l\'historique sauvegardé.' })
        .setTimestamp(transcript.deleted_at),
    ],
  });

  // Formater les messages en blocs texte groupés par auteur consécutif
  const blocks = [];
  let currentBlock = null;

  for (const msg of real) {
    const isNewAuthor = !currentBlock || currentBlock.authorId !== msg.authorId;

    if (isNewAuthor) {
      currentBlock = { authorId: msg.authorId, author: msg.author, bot: msg.bot, lines: [] };
      blocks.push(currentBlock);
    }

    const time = new Date(msg.timestamp).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    const parts = [];
    if (msg.content) parts.push(msg.content);
    for (const e of (msg.embeds ?? [])) {
      if (e.title)       parts.push(`> **${e.title}**`);
      if (e.description) parts.push(`> ${e.description.slice(0, 300).replace(/\n/g, '\n> ')}`);
      for (const f of (e.fields ?? [])) parts.push(`> **${f.name}:** ${f.value}`);
      if (e.footer)      parts.push(`> *${e.footer}*`);
    }
    for (const a of (msg.attachments ?? [])) parts.push(`📎 \`${a.name}\``);

    currentBlock.lines.push({ time, text: parts.join('\n') });
  }

  // Envoyer les blocs en chunks ≤ 1900 chars
  let buffer = '';

  const flush = async () => {
    if (buffer.trim()) await channel.send(buffer.trim());
    buffer = '';
  };

  for (const block of blocks) {
    const botTag = block.bot ? ' `[BOT]`' : '';
    const header = `**${block.author}**${botTag}`;

    for (const { time, text } of block.lines) {
      const line = `${header} · \`${time}\`\n${text}\n`;
      if ((buffer + line).length > 1900) await flush();
      buffer += line;
      // Réinitialiser le header après la première ligne du bloc
      // pour les suivantes du même auteur (pas besoin de répéter le nom)
    }
  }

  await flush();
}

module.exports = router;
