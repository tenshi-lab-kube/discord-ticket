const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildPanelMessage(config) {
  const embed = new EmbedBuilder()
    .setTitle(config.panel?.title ?? 'OUVRIR UN TICKET')
    .setDescription(config.panel?.description ?? 'Clique sur le bouton ci-dessous pour ouvrir un ticket.')
    .setColor(config.panel?.color ?? '#5865F2');

  if (config.panel?.thumbnail) embed.setThumbnail(config.panel.thumbnail);
  if (config.panel?.footer) embed.setFooter({ text: config.panel.footer });

  const button = new ButtonBuilder()
    .setCustomId('open_ticket_panel')
    .setLabel(config.panel?.buttonLabel ?? 'Ouvrir un ticket')
    .setEmoji('📩')
    .setStyle(ButtonStyle.Primary);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

module.exports = { buildPanelMessage };
