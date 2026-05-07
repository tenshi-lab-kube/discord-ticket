const { EmbedBuilder } = require('discord.js');

function normalizeEmbedMessage(input = {}) {
  const now = Date.now();
  const id = input.id || `embed-${now}`;

  return {
    id,
    name: String(input.name || 'Nouvel embed').trim().slice(0, 80),
    content: String(input.content || '').slice(0, 2000),
    title: String(input.title || '').slice(0, 256),
    description: String(input.description || '').slice(0, 4096),
    color: /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : '#5865F2',
    url: String(input.url || '').slice(0, 2048),
    authorName: String(input.authorName || '').slice(0, 256),
    authorIcon: String(input.authorIcon || '').slice(0, 2048),
    thumbnail: String(input.thumbnail || '').slice(0, 2048),
    image: String(input.image || '').slice(0, 2048),
    footer: String(input.footer || '').slice(0, 2048),
    footerIcon: String(input.footerIcon || '').slice(0, 2048),
    timestamp: Boolean(input.timestamp),
    fields: Array.isArray(input.fields)
      ? input.fields
          .map(field => ({
            name: String(field.name || '').slice(0, 256),
            value: String(field.value || '').slice(0, 1024),
            inline: Boolean(field.inline),
          }))
          .filter(field => field.name && field.value)
          .slice(0, 25)
      : [],
    updatedAt: now,
  };
}

function getDefaultEmbedMessages() {
  return [
    normalizeEmbedMessage({
      id: 'embed-commandes-tickets',
      name: 'Commandes tickets',
      title: 'Commandes tickets',
      description: 'Voici les commandes principales pour gerer les tickets.',
      color: '#5865F2',
      footer: 'Dashboard Ticket Bot',
      timestamp: true,
      fields: [
        { name: '/setup', value: 'Deploie le panel de tickets dans le salon actuel.', inline: false },
        { name: '/ticket add', value: 'Ajoute un utilisateur dans le ticket actuel.', inline: true },
        { name: '/ticket remove', value: 'Retire un utilisateur du ticket actuel.', inline: true },
        { name: '/ticket move', value: 'Deplace le ticket vers une autre categorie.', inline: true },
        { name: '/ticket rename', value: 'Renomme le salon du ticket actuel.', inline: true },
        { name: '/ticketban ban', value: 'Bloque temporairement ou definitivement un utilisateur de l ouverture de tickets.', inline: false },
        { name: '/ticketban unban', value: 'Retire le ban ticket actif d un utilisateur.', inline: true },
        { name: '/ticketban info', value: 'Verifie si un utilisateur est banni des tickets.', inline: true },
      ],
      updatedAt: 0,
    }),
  ];
}

function validateUrl(value, label) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error(`${label} n'est pas une URL valide`);
  }
}

function buildDiscordEmbedMessage(data) {
  const embedData = normalizeEmbedMessage(data);

  if (!embedData.title && !embedData.description && !embedData.fields.length && !embedData.image && !embedData.thumbnail) {
    throw new Error('Ajoute au moins un titre, une description, un champ ou une image.');
  }

  validateUrl(embedData.url, 'URL du titre');
  validateUrl(embedData.authorIcon, 'Icone auteur');
  validateUrl(embedData.thumbnail, 'Thumbnail');
  validateUrl(embedData.image, 'Image');
  validateUrl(embedData.footerIcon, 'Icone footer');

  const embed = new EmbedBuilder().setColor(embedData.color);
  if (embedData.title) embed.setTitle(embedData.title);
  if (embedData.description) embed.setDescription(embedData.description);
  if (embedData.url) embed.setURL(embedData.url);
  if (embedData.authorName) {
    embed.setAuthor({ name: embedData.authorName, iconURL: embedData.authorIcon || undefined });
  }
  if (embedData.thumbnail) embed.setThumbnail(embedData.thumbnail);
  if (embedData.image) embed.setImage(embedData.image);
  if (embedData.footer) {
    embed.setFooter({ text: embedData.footer, iconURL: embedData.footerIcon || undefined });
  }
  if (embedData.timestamp) embed.setTimestamp();
  if (embedData.fields.length) embed.addFields(embedData.fields);

  return {
    content: embedData.content || undefined,
    embeds: [embed],
  };
}

module.exports = { normalizeEmbedMessage, getDefaultEmbedMessages, buildDiscordEmbedMessage };
