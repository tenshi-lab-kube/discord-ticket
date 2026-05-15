const { findMatchingResponse } = require('../customResponses');

const CUSTOM_RESPONSE_COOLDOWN_MS = 10000;
const customResponseCooldowns = new Map();

function stripBotMention(content, botId) {
  return String(content || '')
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    try {
      if (!message.guild || !message.guildId) return;
      if (message.author?.bot) return;
      if (!client.user?.id || !message.mentions.users.has(client.user.id)) return;

      const content = stripBotMention(message.content, client.user.id);
      if (!content) return;

      const cooldownKey = `${message.guildId}:${message.author.id}`;
      const now = Date.now();
      const lastReplyAt = customResponseCooldowns.get(cooldownKey) || 0;
      if (now - lastReplyAt < CUSTOM_RESPONSE_COOLDOWN_MS) return;

      const match = findMatchingResponse(message.guildId, content);
      if (!match) return;

      customResponseCooldowns.set(cooldownKey, now);
      await message.reply({
        content: String(match.response || '').slice(0, 2000),
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      console.error('[custom-responses] Message handler error:', error);
    }
  },
};
