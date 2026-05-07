const express = require('express');
const router = express.Router();
const { getConfig, saveConfig } = require('../utils/config');
const { client } = require('../bot');
const { normalizeEmbedMessage, getDefaultEmbedMessages, buildDiscordEmbedMessage } = require('../utils/embeds');

function ensureEmbedMessages(config) {
  if (!Array.isArray(config.embedMessages)) {
    config.embedMessages = getDefaultEmbedMessages();
    saveConfig(config);
  }
  return config.embedMessages;
}

router.get('/embed-messages', (req, res) => {
  const config = getConfig();
  res.json(ensureEmbedMessages(config));
});

router.post('/embed-messages', (req, res) => {
  try {
    const config = getConfig();
    const embedMessages = ensureEmbedMessages(config);
    const embedMessage = normalizeEmbedMessage(req.body);

    if (embedMessages.some(item => item.id === embedMessage.id)) {
      return res.status(409).json({ error: 'ID embed deja utilise' });
    }

    embedMessages.push(embedMessage);
    saveConfig(config);
    res.json(embedMessage);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/embed-messages/:id', (req, res) => {
  try {
    const config = getConfig();
    const embedMessages = ensureEmbedMessages(config);
    const index = embedMessages.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Embed introuvable' });

    const embedMessage = normalizeEmbedMessage({ ...embedMessages[index], ...req.body, id: req.params.id });
    embedMessages[index] = embedMessage;
    saveConfig(config);
    res.json(embedMessage);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/embed-messages/:id', (req, res) => {
  const config = getConfig();
  config.embedMessages = ensureEmbedMessages(config).filter(item => item.id !== req.params.id);
  saveConfig(config);
  res.json({ success: true });
});

router.post('/embed-messages/:id/send', async (req, res) => {
  const { channelId } = req.body;
  if (!channelId) return res.status(400).json({ error: 'channelId requis' });

  const config = getConfig();
  const embedMessage = ensureEmbedMessages(config).find(item => item.id === req.params.id);
  if (!embedMessage) return res.status(404).json({ error: 'Embed introuvable' });

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild introuvable' });

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return res.status(404).json({ error: 'Salon introuvable' });

  try {
    const message = await channel.send(buildDiscordEmbedMessage(embedMessage));
    res.json({ success: true, messageId: message.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
