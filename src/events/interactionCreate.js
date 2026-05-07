const { getCommands } = require('../commands/index');
const ticketHandler = require('../handlers/ticket');
const db = require('../database');

function buildTicketBanMessage(ban) {
  const expiration = ban.expires_at
    ? `jusqu'au <t:${Math.floor(ban.expires_at / 1000)}:F>`
    : 'definitivement';

  return `🚫 Tu es banni de la creation de tickets ${expiration}.\nRaison: ${ban.reason ?? 'Aucune raison indiquee'}`;
}

async function blockIfTicketBanned(interaction) {
  const activeBan = db.getActiveTicketBan(interaction.user.id, interaction.guildId);
  if (!activeBan) return false;

  await interaction.reply({
    content: buildTicketBanMessage(activeBan),
    ephemeral: true,
  });
  return true;
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.isAutocomplete()) {
      const commands = getCommands();
      const cmd = commands.find(c => c.data.name === interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction).catch(console.error);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const commands = getCommands();
      const cmd = commands.find(c => c.data.name === interaction.commandName);
      if (cmd) await cmd.execute(interaction).catch(console.error);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_category_select') {
        if (await blockIfTicketBanned(interaction)) return;
        await ticketHandler.handleCategorySelect(interaction).catch(console.error);
      }
      return;
    }

    if (interaction.isButton()) {
      const parts = interaction.customId.split(':');

      // Boutons de confirmation (tc:{action}:{originalMessageId} ou tc:cancel)
      if (parts[0] === 'tc') {
        const subAction = parts[1];
        if (subAction === 'cancel') {
          await interaction.update({ content: '❌ Action annulée.', components: [] }).catch(console.error);
          return;
        }
        const originalMessageId = parts[2];
        const execMap = {
          claim:  ticketHandler.executeClaim,
          close:  ticketHandler.executeClose,
          reopen: ticketHandler.executeReopen,
          delete: ticketHandler.executeDelete,
        };
        const fn = execMap[subAction];
        if (fn) await fn(interaction, originalMessageId).catch(console.error);
        return;
      }

      // Boutons principaux du ticket → affichent la confirmation
      switch (parts[0]) {
        case 'open_ticket_panel':
          if (await blockIfTicketBanned(interaction)) return;
          await ticketHandler.handleOpenTicketPanel(interaction).catch(console.error);
          break;
        case 'ticket_claim':  await ticketHandler.handleClaim(interaction).catch(console.error);  break;
        case 'ticket_close':  await ticketHandler.handleClose(interaction).catch(console.error);  break;
        case 'ticket_reopen': await ticketHandler.handleReopen(interaction).catch(console.error); break;
        case 'ticket_delete': await ticketHandler.handleDelete(interaction).catch(console.error); break;
      }
    }
  }
};
