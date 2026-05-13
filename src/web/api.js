const express = require('express');
const router = express.Router();
const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
const { DEFAULT_GUILD_CONFIG, getGuildConfig, listConfiguredGuilds, saveGuildConfig } = require('../utils/config');
const { getCommands } = require('../commands/index');
const { buildPanelMessage } = require('../utils/panel');
const db = require('../database');
const { client } = require('../bot');

function isGuildAdmin(member, guildConfig) {
  if (member.id === member.guild.ownerId) return true;
  const adminRoles = guildConfig.adminRoles ?? [];
  if (!adminRoles.length) return member.permissions.has(PermissionFlagsBits.Administrator);
  return adminRoles.some(roleId => member.roles.cache.has(roleId));
}

async function getAuthorizedGuilds(userId) {
  const result = [];
  const configuredById = new Map(listConfiguredGuilds().map(configured => [configured.guildId, configured]));

  for (const [, guild] of client.guilds.cache) {
    const configured = configuredById.get(guild.id) ?? {
      ...DEFAULT_GUILD_CONFIG,
      guildId: guild.id,
      name: guild.name,
      enabled: false,
    };
    if (!guild) continue;
    try {
      const member = await guild.members.fetch(userId);
      if (isGuildAdmin(member, configured)) {
        result.push({
          guildId: configured.guildId,
          name: configured.name || guild.name,
          discordName: guild.name,
          enabled: !!configured.enabled,
          owner: member.id === guild.ownerId,
        });
      }
    } catch {
      // User is not a member of this guild, or Discord refused the fetch.
    }
  }
  return result;
}

async function registerGuildCommands(guildId) {
  const commands = getCommands();
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
    { body: commands.map(command => command.data.toJSON()) },
  );
}

async function pickTicketParent(guild, guildConfig, category) {
  if (category.categoryId) {
    const configured = guild.channels.cache.get(category.categoryId);
    if (configured && configured.children?.cache?.size < 48) return configured;
  }

  const prefix = guildConfig.tickets?.archiveCategoryPrefix || 'Tickets';
  const candidates = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => a.position - b.position);

  const available = candidates.find(ch => ch.children?.cache?.size < 48);
  if (available) return available;

  return guild.channels.create({
    name: `${prefix} ${candidates.size + 1}`,
    type: ChannelType.GuildCategory,
  });
}

router.get('/guilds', async (req, res) => {
  res.json(await getAuthorizedGuilds(req.session.user.id));
});

router.param('guildId', async (req, res, next, guildId) => {
  let guildConfig = getGuildConfig(guildId, { requireEnabled: false });
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Serveur introuvable' });

  try {
    const member = await guild.members.fetch(req.session.user.id);
    const effectiveConfig = guildConfig ?? {
      ...DEFAULT_GUILD_CONFIG,
      guildId,
      name: guild.name,
      enabled: true,
    };

    if (!isGuildAdmin(member, effectiveConfig)) {
      return res.status(403).json({ error: 'Acces refuse pour ce serveur' });
    }

    if (!guildConfig) {
      guildConfig = saveGuildConfig(guildId, effectiveConfig);
      registerGuildCommands(guildId).catch(err => {
        console.error(`[Bot] Erreur enregistrement commands pour ${guildId}:`, err);
      });
    }

    req.guildId = guildId;
    req.guild = guild;
    req.guildConfig = guildConfig;
    req.member = member;
    next();
  } catch {
    res.status(403).json({ error: 'Tu ne fais pas partie de ce serveur' });
  }
});

router.get('/:guildId/config', (req, res) => {
  res.json(req.guildConfig);
});

router.put('/:guildId/config', (req, res) => {
  const patch = { ...req.body, guildId: req.guildId };
  res.json(saveGuildConfig(req.guildId, patch));
});

router.patch('/:guildId/config/panel', (req, res) => {
  res.json(saveGuildConfig(req.guildId, {
    panel: { ...(req.guildConfig.panel ?? {}), ...req.body },
  }));
});

router.patch('/:guildId/config/tickets', (req, res) => {
  res.json(saveGuildConfig(req.guildId, {
    tickets: { ...(req.guildConfig.tickets ?? {}), ...req.body },
  }));
});

router.get('/:guildId/categories', (req, res) => {
  res.json(req.guildConfig.ticketCategories ?? []);
});

router.post('/:guildId/categories', (req, res) => {
  const { id, name, emoji, description, categoryId, requiredRole, supportRoles, maxTickets } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id et name requis' });
  const ticketCategories = [...(req.guildConfig.ticketCategories ?? [])];
  if (ticketCategories.find(c => c.id === id)) return res.status(409).json({ error: 'ID deja utilise' });
  ticketCategories.push({
    id,
    name,
    emoji: emoji || '',
    description: description || '',
    categoryId: categoryId || '',
    requiredRole: requiredRole || '',
    supportRoles: supportRoles || [],
    maxTickets: Number(maxTickets) || 1,
  });
  saveGuildConfig(req.guildId, { ticketCategories });
  res.json({ success: true });
});

router.put('/:guildId/categories/:id', (req, res) => {
  const ticketCategories = [...(req.guildConfig.ticketCategories ?? [])];
  const idx = ticketCategories.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Categorie introuvable' });
  ticketCategories[idx] = { ...ticketCategories[idx], ...req.body, id: req.params.id };
  saveGuildConfig(req.guildId, { ticketCategories });
  res.json({ success: true });
});

router.delete('/:guildId/categories/:id', (req, res) => {
  const ticketCategories = (req.guildConfig.ticketCategories ?? []).filter(c => c.id !== req.params.id);
  saveGuildConfig(req.guildId, { ticketCategories });
  res.json({ success: true });
});

router.patch('/:guildId/categories/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order doit etre un tableau' });
  const current = req.guildConfig.ticketCategories ?? [];
  const ticketCategories = order.map(id => current.find(c => c.id === id)).filter(Boolean);
  saveGuildConfig(req.guildId, { ticketCategories });
  res.json({ success: true });
});

router.get('/:guildId/stats', (req, res) => {
  const stats = db.getGuildStats(req.guildId);
  const tickets = db.getAllTickets(req.guildId);
  res.json({
    totalEver: stats?.total_created ?? 0,
    open: tickets.filter(t => t.status === 'open').length,
    closed: tickets.filter(t => t.status === 'closed').length,
    claimed: tickets.filter(t => t.claimed_by).length,
  });
});

router.get('/:guildId/tickets', (req, res) => {
  res.json(db.getAllTickets(req.guildId));
});

router.get('/:guildId/transcripts', (req, res) => {
  res.json(db.getTranscripts(req.guildId));
});

router.get('/:guildId/transcripts/:id', (req, res) => {
  const transcript = db.getTranscriptById(req.params.id, req.guildId);
  if (!transcript) return res.status(404).json({ error: 'Transcript introuvable' });
  transcript.messages = JSON.parse(transcript.messages);
  res.json(transcript);
});

router.post('/:guildId/transcripts/:id/reopen', async (req, res) => {
  const transcript = db.getTranscriptById(req.params.id, req.guildId);
  if (!transcript) return res.status(404).json({ error: 'Transcript introuvable' });

  const { categoryId, additionalUsers = [] } = req.body;
  const targetCatId = categoryId || transcript.category_id;
  const category = req.guildConfig.ticketCategories.find(c => c.id === targetCatId);
  if (!category) return res.status(400).json({ error: 'Categorie introuvable' });

  const ticketNumber = db.getNextTicketNumber(req.guildId);
  const channelName = (req.guildConfig.tickets?.nameFormat ?? '{username}-{number}')
    .replace('{number}', String(ticketNumber).padStart(4, '0'))
    .replace('{username}', 'reopen')
    .replace('{category}', category.id);

  const userIds = [transcript.user_id, ...additionalUsers.filter(id => id && id !== transcript.user_id)];
  const permissionOverwrites = [{ id: req.guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
  for (const userId of userIds) {
    permissionOverwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }
  const roleIds = [...new Set([...(req.guildConfig.staffRoles ?? []), ...(req.guildConfig.adminRoles ?? []), ...(category.supportRoles ?? [])])];
  for (const roleId of roleIds) {
    permissionOverwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const parent = await pickTicketParent(req.guild, req.guildConfig, category);
  const channel = await req.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parent ?? undefined,
    permissionOverwrites,
    topic: `Ticket rouvert depuis transcript #${transcript.id}`,
  });

  const storedTicketNumber = db.createTicket({
    channelId: channel.id,
    guildId: req.guildId,
    userId: transcript.user_id,
    categoryId: category.id,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: userIds.map(id => `<@${id}>`).join(' '),
    embeds: [new EmbedBuilder()
      .setColor(req.guildConfig.panel?.color ?? '#5865F2')
      .setDescription(`Ticket rouvert depuis le transcript #${String(transcript.ticket_number).padStart(4, '0')}`)
      .setFooter({ text: `Ticket #${String(storedTicketNumber).padStart(4, '0')}` })
      .setTimestamp()],
    components: [row],
  });

  res.json({ success: true, channelId: channel.id, channelName });
});

router.get('/:guildId/guild/channels', async (req, res) => {
  const channels = req.guild.channels.cache.map(ch => ({
    id: ch.id,
    name: ch.name,
    type: ch.type,
    parentId: ch.parentId ?? null,
  }));
  res.json(channels);
});

router.get('/:guildId/guild/roles', async (req, res) => {
  const roles = req.guild.roles.cache
    .filter(role => role.id !== req.guild.id)
    .map(role => ({ id: role.id, name: role.name, color: role.hexColor }));
  res.json(roles);
});

router.post('/:guildId/guild/create-discord-category', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });
  const category = await req.guild.channels.create({ name, type: ChannelType.GuildCategory });
  res.json({ id: category.id, name: category.name });
});

router.post('/:guildId/panel/deploy', async (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId requis' });
  const channel = req.guild.channels.cache.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
  const msg = await channel.send(buildPanelMessage(req.guildConfig));
  db.savePanel(req.guildId, channelId, msg.id);
  res.json({ success: true, messageId: msg.id });
});

module.exports = router;
