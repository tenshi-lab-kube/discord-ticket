const { REST, Routes } = require('discord.js');
const { getCommands } = require('../commands/index');
const { getConfig } = require('../utils/config');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot] Connecté en tant que ${client.user.tag}`);

    const config = getConfig();
    const commands = getCommands();
    const rest = new REST().setToken(process.env.BOT_TOKEN);

    try {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, config.guildId),
        { body: commands.map(c => c.data.toJSON()) }
      );
      console.log('[Bot] Slash commands enregistrées.');
    } catch (err) {
      console.error('[Bot] Erreur enregistrement commands:', err);
    }
  }
};
