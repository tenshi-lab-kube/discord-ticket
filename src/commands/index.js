const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { buildPanelMessage } = require('../utils/panel');
const db = require('../database');
const { getConfig, saveConfig } = require('../utils/config');

function isStaff(member, config) {
  if (!config.staffRoles?.length) return member.permissions.has(PermissionFlagsBits.ManageChannels);
  return config.staffRoles.some(roleId => member.roles.cache.has(roleId));
}

function parseDuration(input) {
  if (!input) return null;

  const match = input.trim().toLowerCase().match(/^(\d+)\s*(m|min|h|d|j|w|sem|mo|y|a)$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    m: 60 * 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    j: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    sem: 7 * 24 * 60 * 60 * 1000,
    mo: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
    a: 365 * 24 * 60 * 60 * 1000,
  };

  return Date.now() + amount * multipliers[unit];
}

function formatBanExpiration(expiresAt) {
  if (!expiresAt) return 'definitivement';
  return `jusqu'au <t:${Math.floor(expiresAt / 1000)}:F>`;
}

const EMBED_COLORS = {
  success: '#57F287',
  error: '#ED4245',
  info: '#5865F2',
  warning: '#FEE75C',
};

function embedField(name, value, inline = true) {
  return { name, value: String(value || '-').slice(0, 1024), inline };
}

function commandEmbed(type, title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS[type] ?? EMBED_COLORS.info)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (fields.length) embed.addFields(fields);
  return embed;
}

function replyEmbed(interaction, type, title, description, fields = [], ephemeral = true) {
  return interaction.reply({
    embeds: [commandEmbed(type, title, description, fields)],
    ephemeral,
  });
}

const setupCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Déploie le panel de tickets dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const config = getConfig();
    if (!config.ticketCategories?.length) {
      return replyEmbed(
        interaction,
        'warning',
        'Aucune categorie configuree',
        'Ajoute au moins une categorie depuis le dashboard web avant de deployer le panel.'
      );
    }

    await interaction.deferReply({ ephemeral: true });
    const msg = await interaction.channel.send(buildPanelMessage(config));
    db.savePanel(interaction.guildId, interaction.channelId, msg.id);

    await interaction.editReply({
      embeds: [commandEmbed('success', 'Panel deploye', `Le panel de tickets a ete envoye dans <#${interaction.channelId}>.`)],
    });
  }
};

const ticketCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Gestion des tickets')
    .addSubcommand(sub =>
      sub.setName('rename')
        .setDescription('Renomme le ticket actuel')
        .addStringOption(opt => opt.setName('nom').setDescription('Nouveau nom').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('move')
        .setDescription('Déplace le ticket vers une autre catégorie')
        .addStringOption(opt => opt.setName('categorie').setDescription('ID de la catégorie').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Ajoute un utilisateur au ticket')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur à ajouter').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Retire un utilisateur du ticket')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur à retirer').setRequired(true))
    ),

  async autocomplete(interaction) {
    const config = getConfig();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = (config.ticketCategories ?? [])
      .filter(c => c.name.toLowerCase().includes(focused) || c.id.includes(focused))
      .slice(0, 25)
      .map(c => ({ name: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, value: c.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const config = getConfig();
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket) return replyEmbed(interaction, 'error', 'Salon invalide', 'Cette commande doit etre utilisee dans un ticket.');

    const sub = interaction.options.getSubcommand();

    if (sub === 'rename') {
      if (!isStaff(interaction.member, config)) {
        return replyEmbed(interaction, 'error', 'Acces refuse', 'Cette action est reservee au staff.');
      }
      const name = interaction.options.getString('nom').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100);
      await interaction.channel.setName(name);
      return replyEmbed(interaction, 'success', 'Ticket renomme', `Nouveau nom: **${name}**.`);
    }

    if (sub === 'move') {
      if (!isStaff(interaction.member, config)) {
        return replyEmbed(interaction, 'error', 'Acces refuse', 'Cette action est reservee au staff.');
      }
      const catId = interaction.options.getString('categorie');
      const category = config.ticketCategories.find(c => c.id === catId);
      if (!category) return replyEmbed(interaction, 'error', 'Categorie introuvable', 'La categorie demandee n existe pas dans la configuration.');

      if (category.categoryId) {
        const discordCat = interaction.guild.channels.cache.get(category.categoryId);
        if (discordCat) await interaction.channel.setParent(discordCat, { lockPermissions: false });
      }

      db.updateTicketCategory(interaction.channelId, catId);
      return replyEmbed(interaction, 'success', 'Ticket deplace', `Nouvelle categorie: **${category.emoji} ${category.name}**.`, [], false);
    }

    if (sub === 'add') {
      if (!isStaff(interaction.member, config)) {
        return replyEmbed(interaction, 'error', 'Acces refuse', 'Cette action est reservee au staff.');
      }
      const user = interaction.options.getUser('utilisateur');
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      return replyEmbed(interaction, 'success', 'Utilisateur ajoute', `<@${user.id}> a maintenant acces au ticket.`, [], false);
    }

    if (sub === 'remove') {
      if (!isStaff(interaction.member, config)) {
        return replyEmbed(interaction, 'error', 'Acces refuse', 'Cette action est reservee au staff.');
      }
      const user = interaction.options.getUser('utilisateur');
      if (user.id === ticket.user_id) {
        return replyEmbed(interaction, 'warning', 'Action impossible', 'Le createur du ticket doit garder acces au salon.');
      }
      await interaction.channel.permissionOverwrites.delete(user.id);
      return replyEmbed(interaction, 'success', 'Utilisateur retire', `<@${user.id}> n a plus acces au ticket.`, [], false);
    }
  }
};

const ticketBanCommand = {
  data: new SlashCommandBuilder()
    .setName('ticketban')
    .setDescription('Bannit ou debannit un utilisateur des tickets')
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Bannit un utilisateur de la creation de tickets')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a bannir').setRequired(true))
        .addStringOption(opt => opt.setName('duree').setDescription('Duree: 30m, 2h, 7d, 1mo. Vide = permanent').setRequired(false))
        .addStringOption(opt => opt.setName('raison').setDescription('Raison du ban').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Retire le ban ticket d un utilisateur')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a debannir').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Verifie si un utilisateur est banni des tickets')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a verifier').setRequired(true))
    ),

  async execute(interaction) {
    const config = getConfig();
    if (!isStaff(interaction.member, config)) {
      return replyEmbed(interaction, 'error', 'Acces refuse', 'Cette commande est reservee au staff.');
    }

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('utilisateur');

    if (sub === 'ban') {
      if (user.bot) {
        return replyEmbed(interaction, 'warning', 'Action impossible', 'Un bot ne peut pas etre banni de l ouverture de tickets.');
      }

      const duration = interaction.options.getString('duree');
      const expiresAt = parseDuration(duration);
      if (expiresAt === undefined) {
        return replyEmbed(
          interaction,
          'warning',
          'Duree invalide',
          'Exemples valides: `30m`, `2h`, `7d`, `1mo`, `1y`. Laisse vide pour un ban definitif.'
        );
      }

      const reason = interaction.options.getString('raison') ?? 'Aucune raison indiquee';
      db.createTicketBan({
        guildId: interaction.guildId,
        userId: user.id,
        bannedBy: interaction.user.id,
        reason,
        expiresAt,
      });

      return replyEmbed(interaction, 'success', 'Ban ticket applique', `<@${user.id}> ne peut plus ouvrir de tickets.`, [
        embedField('Duree', formatBanExpiration(expiresAt)),
        embedField('Raison', reason, false),
      ]);
    }

    if (sub === 'unban') {
      const result = db.revokeTicketBan(user.id, interaction.guildId, interaction.user.id);
      if (!result.changes) {
        return replyEmbed(interaction, 'info', 'Aucun ban actif', `<@${user.id}> n a pas de ban ticket actif.`);
      }

      return replyEmbed(interaction, 'success', 'Ban ticket retire', `<@${user.id}> peut de nouveau ouvrir des tickets.`);
    }

    if (sub === 'info') {
      const ban = db.getActiveTicketBan(user.id, interaction.guildId);
      if (!ban) {
        return replyEmbed(interaction, 'success', 'Aucun ban actif', `<@${user.id}> peut ouvrir des tickets.`);
      }

      return replyEmbed(interaction, 'warning', 'Ban ticket actif', `<@${user.id}> est actuellement bloque.`, [
        embedField('Expiration', formatBanExpiration(ban.expires_at)),
        embedField('Banni par', `<@${ban.banned_by}>`),
        embedField('Raison', ban.reason ?? 'Aucune raison indiquee', false),
      ]);
    }
  }
};

const commands = [setupCommand, ticketCommand, ticketBanCommand];

function getCommands() {
  return commands;
}

module.exports = { getCommands };
