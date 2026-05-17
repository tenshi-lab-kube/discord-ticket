const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const db = require('../database');
const { getGuildConfig } = require('../utils/config');
const { enqueue } = require('../utils/queue');

const TICKET_CATEGORY_PAGE_SIZE = 25;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTicketButtons(status = 'open') {
  const row = new ActionRowBuilder();
  if (status === 'open') {
    row.addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('👑').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    );
  }
  return row;
}

function buildDeleteTicketButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_delete')
      .setLabel('Supprimer')
      .setStyle(ButtonStyle.Danger),
  );
}

// customId format: tc:{action}:{originalMessageId}
function buildConfirmRow(action, originalMessageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tc:${action}:${originalMessageId}`)
      .setLabel('Confirmer')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tc:cancel')
      .setLabel('Annuler')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary),
  );
}

function isStaff(member, config) {
  if (!config.staffRoles?.length) return member.permissions.has(PermissionFlagsBits.ManageChannels);
  return config.staffRoles.some(roleId => member.roles.cache.has(roleId));
}

function getAccessibleTicketCategories(config, member) {
  return (config.ticketCategories ?? []).filter(cat => {
    if (!cat.requiredRole) return true;
    return member.roles.cache.has(cat.requiredRole);
  });
}

function getTicketLimit(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function isEnabled(value) {
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function buildCategorySelectResponse(config, accessible, page = 0) {
  const pageCount = Math.max(1, Math.ceil(accessible.length / TICKET_CATEGORY_PAGE_SIZE));
  const currentPage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
  const offset = currentPage * TICKET_CATEGORY_PAGE_SIZE;
  const pageItems = accessible.slice(offset, offset + TICKET_CATEGORY_PAGE_SIZE);

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder(config.panel?.placeholder ?? 'Comment pouvons-nous t\'aider ?')
    .addOptions(pageItems.map(cat => ({
      label: String(cat.name || cat.id).slice(0, 100),
      description: cat.description ? String(cat.description).slice(0, 100) : undefined,
      value: String(cat.id).slice(0, 100),
      emoji: cat.emoji || undefined,
    })));

  const components = [new ActionRowBuilder().addComponents(select)];
  if (pageCount > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket_category_page:${currentPage - 1}`)
        .setLabel('Precedent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 0),
      new ButtonBuilder()
        .setCustomId(`ticket_category_page:${currentPage + 1}`)
        .setLabel('Suivant')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= pageCount - 1),
    ));
  }

  return {
    content: pageCount > 1
      ? `Choisis une categorie de ticket. Page ${currentPage + 1}/${pageCount}.`
      : 'Choisis une categorie de ticket.',
    components,
  };
}

async function sendLog(guild, config, embed) {
  if (!config.logChannelId) return;
  const ch = guild.channels.cache.get(config.logChannelId);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
}

async function fetchAllMessages(channel, maxMessages = 1000) {
  const messages = [];
  let before = null;
  let partial = false;
  let error = null;
  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;
    const batch = await channel.messages.fetch(options).catch(err => {
      error = err.message;
      partial = true;
      return null;
    });
    if (!batch || !batch.size) break;
    batch.forEach(msg => messages.push({
      id: msg.id,
      author: msg.author.username,
      authorId: msg.author.id,
      bot: msg.author.bot,
      content: msg.content || '',
      embeds: msg.embeds.map(e => ({
        title: e.title || null,
        description: e.description || null,
        color: e.hexColor || null,
        fields: e.fields?.map(f => ({ name: f.name, value: f.value })) ?? [],
        footer: e.footer?.text || null,
      })),
      attachments: [...msg.attachments.values()].map(a => ({ name: a.name, url: a.url })),
      timestamp: msg.createdTimestamp,
    }));
    before = batch.last().id;
    if (messages.length >= maxMessages) {
      partial = true;
      break;
    }
    if (batch.size < 100) break;
  }
  return {
    messages: messages.slice(0, maxMessages).sort((a, b) => a.timestamp - b.timestamp),
    partial,
    error,
  };
}

async function pickTicketParent(guild, config, category) {
  if (category.categoryId) {
    const configured = guild.channels.cache.get(category.categoryId);
    if (configured && configured.children?.cache?.size < 48) return configured;
  }

  const prefix = config.tickets?.archiveCategoryPrefix || 'Tickets';
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

// ── Bouton du panel → menu éphémère dynamique ─────────────────────────────────

async function handleOpenTicketPanel(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  const member = interaction.member;

  // Filtrer les catégories selon le rôle requis
  const accessible = (config.ticketCategories ?? []).filter(cat => {
    if (!cat.requiredRole) return true;
    return member.roles.cache.has(cat.requiredRole);
  });

  if (!accessible.length) {
    return interaction.reply({
      content: '❌ Tu n\'as accès à aucune catégorie de ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_category_select')
    .setPlaceholder(config.panel?.placeholder ?? 'Comment pouvons-nous t\'aider ?')
    .addOptions(accessible.map(cat => ({
      label: cat.name,
      description: cat.description?.slice(0, 100) ?? '',
      value: cat.id,
      emoji: cat.emoji || undefined,
    })));

  await interaction.reply({
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Création de ticket ────────────────────────────────────────────────────────

async function handleCategorySelect(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  const categoryId = interaction.values[0];
  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) return interaction.reply({ content: '❌ Catégorie introuvable.', flags: MessageFlags.Ephemeral });

  // Double-vérif rôle requis (au cas où l'utilisateur passerait par un ancien panel statique)
  if (category.requiredRole && !interaction.member.roles.cache.has(category.requiredRole)) {
    return interaction.reply({
      content: '❌ Tu n\'as pas le rôle requis pour ouvrir un ticket dans cette catégorie.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Vérification du nombre max de tickets (global ou par catégorie)
  const globalMax = isEnabled(config.tickets?.globalMax);
  const globalLimit = getTicketLimit(config.tickets?.maxPerUser, 1);

  if (globalMax) {
    const allOpen = db.getOpenTicketsByUserGlobal(interaction.user.id, interaction.guildId);
    if (allOpen.length >= globalLimit) {
      return interaction.reply({
        content: `❌ Tu as déjà **${allOpen.length}** ticket(s) ouvert(s) (limite globale : ${globalLimit}).\nTicket ouvert : <#${allOpen[0].channel_id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } else {
    const existing = db.getOpenTicketsByUser(interaction.user.id, interaction.guildId, categoryId);
    const catLimit = getTicketLimit(category.maxTickets, globalLimit);
    if (existing.length >= catLimit) {
      return interaction.reply({
        content: `❌ Tu as déjà un ticket ouvert dans cette catégorie : <#${existing[0].channel_id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // Acknowledge — mise à jour du menu éphémère si vient du bouton, sinon defer
  const isEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
  if (isEphemeral) {
    await interaction.update({ content: '⏳ Création de ton ticket…', components: [] });
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  return enqueue(`ticket-create:${interaction.guildId}:${interaction.user.id}`, async () => {
  const guild = interaction.guild;

  if (globalMax) {
    const allOpen = db.getOpenTicketsByUserGlobal(interaction.user.id, interaction.guildId);
    if (allOpen.length >= globalLimit) {
      return interaction.editReply({
        content: `❌ Tu as déjà **${allOpen.length}** ticket(s) ouvert(s) (limite globale : ${globalLimit}).\nTicket ouvert : <#${allOpen[0].channel_id}>`,
      });
    }
  } else {
    const existing = db.getOpenTicketsByUser(interaction.user.id, interaction.guildId, categoryId);
    const catLimit = getTicketLimit(category.maxTickets, globalLimit);
    if (existing.length >= catLimit) {
      return interaction.editReply({
        content: `❌ Tu as déjà un ticket ouvert dans cette catégorie : <#${existing[0].channel_id}>`,
      });
    }
  }

  const ticketNumber = db.getNextTicketNumber(guild.id);

  const safeUsername = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20) || 'user';

  const channelName = (config.tickets?.nameFormat ?? '{username}-{number}')
    .replace('{number}', String(ticketNumber).padStart(4, '0'))
    .replace('{username}', safeUsername)
    .replace('{category}', category.id);

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];

  const roleIds = [
    ...(config.staffRoles ?? []),
    ...(config.adminRoles ?? []),
    ...(category.supportRoles ?? []),
  ];
  for (const roleId of [...new Set(roleIds)]) {
    permissionOverwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const discordCategory = await pickTicketParent(guild, config, category);

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: discordCategory ?? undefined,
    permissionOverwrites,
    topic: `Ticket de ${interaction.user.tag} | Catégorie: ${category.name}`,
  });

  let storedTicketNumber;
  try {
    storedTicketNumber = db.createTicket({
      channelId: channel.id,
      guildId: guild.id,
      userId: interaction.user.id,
      categoryId,
    });
  } catch (error) {
    await channel.delete().catch(() => {});
    console.error('[tickets] Failed to create ticket record:', error);
    return interaction.editReply({
      content: '❌ Le salon a ete cree, mais le ticket n a pas pu etre enregistre. Le salon temporaire a ete supprime.',
    });
  }

  const openEmbed = new EmbedBuilder()
    .setColor(config.panel?.color ?? '#5865F2')
    .setDescription(
      `${config.tickets?.openMessage ?? 'Ton ticket a été créé.'}\n\n` +
      `**Catégorie:** ${category.emoji} ${category.name}\n` +
      `**Créateur:** <@${interaction.user.id}>`
    )
    .setFooter({ text: `Ticket #${String(storedTicketNumber).padStart(4, '0')}` })
    .setTimestamp();

  const msg = await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [openEmbed],
    components: [buildTicketButtons('open')],
  });

  await msg.pin().catch(() => {});

  await sendLog(guild, config, new EmbedBuilder()
    .setColor('#57F287').setTitle('Ticket Créé')
    .addFields(
      { name: 'Utilisateur', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Catégorie', value: `${category.emoji} ${category.name}`, inline: true },
      { name: 'Salon', value: `<#${channel.id}>`, inline: true },
    ).setTimestamp()
  );

  await interaction.editReply({ content: `✅ Ton ticket a été créé : <#${channel.id}>` });
  });
}

// ── Confirmations initiales ───────────────────────────────────────────────────


async function handleClaim(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  if (!isStaff(interaction.member, config)) {
    return interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
  }
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: MessageFlags.Ephemeral });
  if (ticket.claimed_by) {
    return interaction.reply({ content: `❌ Déjà claim par <@${ticket.claimed_by}>.`, flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: '👑 Confirmes-tu vouloir **claim** ce ticket ?',
    components: [buildConfirmRow('claim', interaction.message.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleClose(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: MessageFlags.Ephemeral });
  const isOwner = ticket.user_id === interaction.user.id;
  if (!isOwner && !isStaff(interaction.member, config)) {
    return interaction.reply({ content: '❌ Permission refusée.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: '🔒 Confirmes-tu vouloir **fermer** ce ticket ?',
    components: [buildConfirmRow('close', interaction.message.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReopen(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  if (!isStaff(interaction.member, config)) {
    return interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: '🔓 Confirmes-tu vouloir **ré-ouvrir** ce ticket ?',
    components: [buildConfirmRow('reopen', interaction.message.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDelete(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });
  if (!isStaff(interaction.member, config)) {
    return interaction.reply({ content: '❌ Réservé au staff.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: '🗑️ Confirmes-tu vouloir **supprimer définitivement** ce ticket ?\n> Le transcript sera sauvegardé automatiquement.',
    components: [buildConfirmRow('delete', interaction.message.id)],
    flags: MessageFlags.Ephemeral,
  });
}

// ── Exécutions après confirmation ─────────────────────────────────────────────

async function executeClaim(interaction, originalMessageId) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.update({ content: 'Serveur non configure.', components: [] });
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });

  db.updateTicketStatus(interaction.channelId, 'open', interaction.user.id);
  await interaction.channel.setName(`claimed-${interaction.channel.name.replace(/^claimed-/, '')}`).catch(() => {});

  await interaction.update({ content: '✅ Ticket claim.', components: [] });
  await interaction.channel.send({
    embeds: [new EmbedBuilder().setColor('#FEE75C').setDescription(`👑 Ticket claim par <@${interaction.user.id}>.`).setTimestamp()],
  });

  const orig = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
  if (orig) await orig.edit({ components: [buildTicketButtons('open')] }).catch(() => {});

  await sendLog(interaction.guild, config, new EmbedBuilder()
    .setColor('#FEE75C').setTitle('Ticket Claim')
    .addFields(
      { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Salon', value: `<#${interaction.channelId}>`, inline: true },
    ).setTimestamp()
  );
}

async function executeClose(interaction, originalMessageId) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.update({ content: 'Serveur non configure.', components: [] });
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });

  db.updateTicketStatus(interaction.channelId, 'closed');
  await interaction.channel.permissionOverwrites.edit(ticket.user_id, { ViewChannel: false }).catch(() => {});

  if (config.tickets?.closedCategoryId) {
    const closedCat = interaction.guild.channels.cache.get(config.tickets.closedCategoryId);
    if (closedCat) await interaction.channel.setParent(closedCat, { lockPermissions: false }).catch(() => {});
  }

  await interaction.update({ content: '✅ Ticket fermé.', components: [] });
  await interaction.channel.send({
    embeds: [new EmbedBuilder().setColor('#ED4245').setDescription(`🔒 Ticket fermé par <@${interaction.user.id}>.`).setTimestamp()],
  });

  const orig = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
  if (orig) await orig.edit({ components: [buildTicketButtons('closed')] }).catch(() => {});

  await sendLog(interaction.guild, config, new EmbedBuilder()
    .setColor('#ED4245').setTitle('Ticket Fermé')
    .addFields(
      { name: 'Fermé par', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Salon', value: `<#${interaction.channelId}>`, inline: true },
    ).setTimestamp()
  );
}

async function executeReopen(interaction, originalMessageId) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.update({ content: 'Serveur non configure.', components: [] });
  const ticket = db.getTicketByChannel(interaction.channelId);
  if (!ticket) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });

  db.updateTicketStatus(interaction.channelId, 'open', null);
  await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
  }).catch(() => {});

  const category = config.ticketCategories.find(c => c.id === ticket.category_id);
  if (category?.categoryId) {
    const cat = interaction.guild.channels.cache.get(category.categoryId);
    if (cat) await interaction.channel.setParent(cat, { lockPermissions: false }).catch(() => {});
  }

  await interaction.update({ content: '✅ Ticket ré-ouvert.', components: [] });
  await interaction.channel.send({
    embeds: [new EmbedBuilder().setColor('#57F287').setDescription(`🔓 Ticket ré-ouvert par <@${interaction.user.id}>.`).setTimestamp()],
  });

  const orig = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
  if (orig) await orig.edit({ components: [buildTicketButtons('open')] }).catch(() => {});
}

async function executeDelete(interaction, originalMessageId) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.update({ content: 'Serveur non configure.', components: [] });
  const ticket = db.getTicketByChannel(interaction.channelId);

  await interaction.update({ content: '📋 Sauvegarde du transcript… suppression dans 5 secondes.', components: [] });

  const transcript = await fetchAllMessages(
    interaction.channel,
    Number(config.tickets?.maxTranscriptMessages ?? 1000),
  );
  const messages = transcript.messages;

  if (ticket) {
    db.saveTranscript({
      ticketNumber: ticket.ticket_number,
      channelName: interaction.channel.name,
      guildId: interaction.guildId,
      userId: ticket.user_id,
      categoryId: ticket.category_id,
      deletedBy: interaction.user.id,
      deletedAt: Date.now(),
      messageCount: transcript.messages.length,
      messages: transcript.messages,
      partial: transcript.partial,
      error: transcript.error,
    });
    db.softDeleteTicket(interaction.channelId);
  }

  await sendLog(interaction.guild, config, new EmbedBuilder()
    .setColor('#ED4245').setTitle('Ticket Supprimé')
    .addFields(
      { name: 'Supprimé par', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Salon', value: `#${interaction.channel.name}`, inline: true },
      ticket
        ? { name: 'Créateur', value: `<@${ticket.user_id}>`, inline: true }
        : { name: '​', value: '​', inline: true },
      { name: 'Messages archivés', value: String(messages.length), inline: true },
    ).setTimestamp()
  );

  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

async function notifyTicketOwnerLeft(member) {
  const config = getGuildConfig(member.guild.id);
  if (!config) return;

  const tickets = db.getOpenTicketsByUserGlobal(member.id, member.guild.id);
  if (!tickets.length) return;

  for (const ticket of tickets) {
    const channel = member.guild.channels.cache.get(ticket.channel_id)
      ?? await member.guild.channels.fetch(ticket.channel_id).catch(() => null);

    if (!channel?.isTextBased?.()) continue;

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('Utilisateur parti du serveur')
      .setDescription(`<@${member.id}> a quitte le Discord alors que ce ticket est encore ouvert.`)
      .addFields(
        { name: 'Utilisateur', value: `${member.user.tag} (${member.id})`, inline: false },
        { name: 'Action', value: 'Vous pouvez supprimer le ticket avec le bouton ci-dessous si besoin.', inline: false },
      )
      .setTimestamp();

    const message = await channel.send({
      embeds: [embed],
      components: [buildDeleteTicketButton()],
    }).catch(() => {});

    if (message) db.setTicketOwnerLeftMessage(ticket.channel_id, message.id);
  }
}

async function notifyTicketOwnerReturned(member) {
  const config = getGuildConfig(member.guild.id);
  if (!config) return;

  const tickets = db.getOpenTicketsByUserGlobal(member.id, member.guild.id);
  if (!tickets.length) return;

  for (const ticket of tickets) {
    const channel = member.guild.channels.cache.get(ticket.channel_id)
      ?? await member.guild.channels.fetch(ticket.channel_id).catch(() => null);

    if (!channel?.isTextBased?.()) continue;

    if (ticket.owner_left_message_id) {
      const leftMessage = await channel.messages.fetch(ticket.owner_left_message_id).catch(() => null);
      if (leftMessage) await leftMessage.delete().catch(() => {});
      db.clearTicketOwnerLeftMessage(ticket.channel_id);
    }

    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }).catch(() => {});

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor('#57F287')
          .setDescription(`<@${member.id}> est de nouveau present sur le Discord.`)
          .setTimestamp(),
      ],
    }).catch(() => {});
  }
}

async function handleCategoryPage(interaction, page) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.update({ content: 'Serveur non configure.', components: [] });

  const accessible = getAccessibleTicketCategories(config, interaction.member);
  if (!accessible.length) {
    return interaction.update({
      content: 'âŒ Tu n\'as accÃ¨s Ã  aucune catÃ©gorie de ticket.',
      components: [],
    });
  }

  return interaction.update(buildCategorySelectResponse(config, accessible, page));
}

async function handleOpenTicketPanel(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config) return interaction.reply({ content: 'Serveur non configure.', flags: MessageFlags.Ephemeral });

  const accessible = getAccessibleTicketCategories(config, interaction.member);
  if (!accessible.length) {
    return interaction.reply({
      content: 'âŒ Tu n\'as accÃ¨s Ã  aucune catÃ©gorie de ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    ...buildCategorySelectResponse(config, accessible, 0),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleOpenTicketPanel,
  handleCategoryPage,
  handleCategorySelect,
  handleClaim, handleClose, handleReopen, handleDelete,
  executeClaim, executeClose, executeReopen, executeDelete,
  notifyTicketOwnerLeft,
  notifyTicketOwnerReturned,
};
