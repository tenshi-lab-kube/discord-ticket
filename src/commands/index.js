const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { buildPanelMessage } = require('../utils/panel');
const db = require('../database');
const { getGuildConfig } = require('../utils/config');
const {
  addCustomResponse,
  listCustomResponses,
  removeCustomResponseByKeyword,
} = require('../customResponses');

function hasAnyRole(member, roleIds = []) {
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function isStaff(member, config, category = null) {
  if (hasAnyRole(member, config.staffRoles ?? [])) return true;
  if (category && hasAnyRole(member, category.supportRoles ?? [])) return true;
  if (!config.staffRoles?.length) return member.permissions.has(PermissionFlagsBits.ManageChannels);
  return false;
}

function getTicketCategory(config, ticket) {
  return (config.ticketCategories ?? []).find(category => category.id === ticket?.category_id) ?? null;
}

function canManageGuild(member) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function parseDuration(value) {
  if (!value) return null;
  const match = String(value).trim().toLowerCase().match(/^(\d+)\s*(m|h|d|w)$/);
  if (!match) throw new Error('Duree invalide. Exemples: 30m, 2h, 7d, 1w.');

  const amount = Number(match[1]);
  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }[match[2]];

  return Date.now() + amount * unitMs;
}

function formatBanStatus(ban) {
  if (!ban) return 'Aucun ban ticket trouve.';
  if (ban.revoked_at) return `Ban revoque <t:${Math.floor(ban.revoked_at / 1000)}:R> par <@${ban.revoked_by}>.`;
  if (ban.expires_at && ban.expires_at <= Date.now()) return `Ban expire <t:${Math.floor(ban.expires_at / 1000)}:R>.`;
  const expires = ban.expires_at ? `<t:${Math.floor(ban.expires_at / 1000)}:R>` : 'jamais';
  return `Ban actif. Expiration: ${expires}. Raison: ${ban.reason || 'Aucune raison'}`;
}

const setupCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Déploie le panel de tickets dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    if (!config) return interaction.reply({ content: 'Serveur non configure.', ephemeral: true });
    if (!config.ticketCategories?.length) {
      return interaction.reply({ content: '❌ Aucune catégorie configurée. Utilise le dashboard web.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const msg = await interaction.channel.send(buildPanelMessage(config));
    db.savePanel(interaction.guildId, interaction.channelId, msg.id);

    await interaction.editReply({ content: `✅ Panel déployé dans <#${interaction.channelId}>` });
  }
};

const customResponseCommand = {
  data: new SlashCommandBuilder()
    .setName('custom-response')
    .setDescription('Gestion des reponses custom du bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Ajoute une reponse custom')
        .addStringOption(opt =>
          opt.setName('keyword')
            .setDescription('Mot-cle a detecter')
            .setRequired(true)
            .setMaxLength(120))
        .addStringOption(opt =>
          opt.setName('response')
            .setDescription('Reponse envoyee par le bot')
            .setRequired(true)
            .setMaxLength(2000))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Supprime une reponse custom')
        .addStringOption(opt =>
          opt.setName('keyword')
            .setDescription('Mot-cle a supprimer')
            .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Liste les reponses custom du serveur')
    ),

  async execute(interaction) {
    if (!interaction.guildId || !interaction.guild) {
      return interaction.reply({ content: 'Cette commande doit etre utilisee dans un serveur.', ephemeral: true });
    }
    if (!canManageGuild(interaction.member)) {
      return interaction.reply({ content: 'Permission requise: Administrateur ou Manage Server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'add') {
        const keyword = interaction.options.getString('keyword', true);
        const response = interaction.options.getString('response', true);
        const saved = addCustomResponse({
          guild_id: interaction.guildId,
          keyword,
          response,
          created_by: interaction.user.id,
        });
        return interaction.reply({
          content: `Reponse custom ajoutee pour le keyword \`${saved.keyword}\`.`,
          ephemeral: true,
        });
      }

      if (sub === 'remove') {
        const keyword = interaction.options.getString('keyword', true);
        const removed = removeCustomResponseByKeyword(interaction.guildId, keyword);
        return interaction.reply({
          content: removed ? 'Reponse custom supprimee.' : 'Aucune reponse custom trouvee pour ce keyword.',
          ephemeral: true,
        });
      }

      if (sub === 'list') {
        const rows = listCustomResponses(interaction.guildId);
        if (!rows.length) {
          return interaction.reply({ content: 'Aucune reponse custom configuree sur ce serveur.', ephemeral: true });
        }

        const lines = rows.map(row => `- \`${row.keyword}\` -> ${row.response.slice(0, 120)}${row.response.length > 120 ? '...' : ''}`);
        return interaction.reply({
          content: lines.join('\n').slice(0, 1900),
          ephemeral: true,
        });
      }
    } catch (error) {
      const statusMessage = error.status === 409 ? error.message : `Erreur: ${error.message}`;
      return interaction.reply({ content: statusMessage, ephemeral: true });
    }
  },
};

const ticketBanCommand = {
  data: new SlashCommandBuilder()
    .setName('ticketban')
    .setDescription('Gestion des bans de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Interdit a un utilisateur d ouvrir des tickets')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a bannir des tickets').setRequired(true))
        .addStringOption(opt => opt.setName('raison').setDescription('Raison du ban ticket').setMaxLength(500))
        .addStringOption(opt => opt.setName('duree').setDescription('Duree optionnelle: 30m, 2h, 7d, 1w'))
    )
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Retire le ban ticket actif d un utilisateur')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a debannir').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Verifie le statut ticketban d un utilisateur')
        .addUserOption(opt => opt.setName('utilisateur').setDescription('Utilisateur a verifier').setRequired(true))
    ),

  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    if (!config) return interaction.reply({ content: 'Serveur non configure.', ephemeral: true });
    if (!canManageGuild(interaction.member) && !isStaff(interaction.member, config)) {
      return interaction.reply({ content: 'Permission requise: staff ou Manage Server.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('utilisateur', true);

    try {
      if (sub === 'ban') {
        const reason = interaction.options.getString('raison') || 'Aucune raison';
        const expiresAt = parseDuration(interaction.options.getString('duree'));
        db.addTicketBan({
          guildId: interaction.guildId,
          userId: user.id,
          bannedBy: interaction.user.id,
          reason,
          expiresAt,
        });

        const expires = expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:R>` : 'jamais';
        return interaction.reply({
          content: `✅ <@${user.id}> est maintenant banni de l'ouverture de tickets. Expiration: ${expires}.`,
          ephemeral: true,
        });
      }

      if (sub === 'unban') {
        const result = db.revokeTicketBan(interaction.guildId, user.id, interaction.user.id);
        return interaction.reply({
          content: result.changes
            ? `✅ <@${user.id}> peut a nouveau ouvrir des tickets.`
            : `ℹ️ Aucun ban ticket actif pour <@${user.id}>.`,
          ephemeral: true,
        });
      }

      if (sub === 'info') {
        const ban = db.getTicketBanInfo(interaction.guildId, user.id);
        return interaction.reply({
          content: `Statut ticketban de <@${user.id}>: ${formatBanStatus(ban)}`,
          ephemeral: true,
        });
      }
    } catch (error) {
      return interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  },
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
    const config = getGuildConfig(interaction.guildId);
    if (!config) return interaction.respond([]);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = (config.ticketCategories ?? [])
      .filter(c => c.name.toLowerCase().includes(focused) || c.id.includes(focused))
      .slice(0, 25)
      .map(c => ({ name: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, value: c.id }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const config = getGuildConfig(interaction.guildId);
    if (!config) return interaction.reply({ content: 'Serveur non configure.', ephemeral: true });
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    const ticketCategory = getTicketCategory(config, ticket);

    const sub = interaction.options.getSubcommand();

    if (sub === 'rename') {
      if (!isStaff(interaction.member, config, ticketCategory)) {
        return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
      }
      const name = interaction.options.getString('nom').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 100);
      await interaction.channel.setName(name);
      return interaction.reply({ content: `✅ Ticket renommé en **${name}**`, ephemeral: true });
    }

    if (sub === 'move') {
      if (!isStaff(interaction.member, config, ticketCategory)) {
        return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
      }
      const catId = interaction.options.getString('categorie');
      const category = config.ticketCategories.find(c => c.id === catId);
      if (!category) return interaction.reply({ content: '❌ Catégorie introuvable.', ephemeral: true });

      if (category.categoryId) {
        const discordCat = interaction.guild.channels.cache.get(category.categoryId);
        if (discordCat) await interaction.channel.setParent(discordCat, { lockPermissions: false });
      }

      const previousSupportRoles = new Set(ticketCategory?.supportRoles ?? []);
      const nextSupportRoles = new Set(category.supportRoles ?? []);
      for (const roleId of previousSupportRoles) {
        if (!nextSupportRoles.has(roleId)) {
          await interaction.channel.permissionOverwrites.delete(roleId).catch(() => {});
        }
      }
      for (const roleId of nextSupportRoles) {
        await interaction.channel.permissionOverwrites.edit(roleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});
      }

      db.updateTicketCategory(interaction.channelId, catId);
      return interaction.reply({ content: `✅ Ticket déplacé vers **${category.emoji} ${category.name}**` });
    }

    if (sub === 'add') {
      if (!isStaff(interaction.member, config, ticketCategory)) {
        return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
      }
      const user = interaction.options.getUser('utilisateur');
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      return interaction.reply({ content: `✅ <@${user.id}> ajouté au ticket.` });
    }

    if (sub === 'remove') {
      if (!isStaff(interaction.member, config, ticketCategory)) {
        return interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true });
      }
      const user = interaction.options.getUser('utilisateur');
      if (user.id === ticket.user_id) {
        return interaction.reply({ content: '❌ Impossible de retirer le créateur du ticket.', ephemeral: true });
      }
      await interaction.channel.permissionOverwrites.delete(user.id);
      return interaction.reply({ content: `✅ <@${user.id}> retiré du ticket.` });
    }
  }
};

const commands = [setupCommand, ticketCommand, ticketBanCommand, customResponseCommand];

function getCommands() {
  return commands;
}

module.exports = { getCommands };
