const { REST, Routes } = require('discord.js');
const { getCommands } = require('../commands/index');
const { listConfiguredGuilds } = require('../utils/config');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot] Connecte en tant que ${client.user.tag}`);

    const commands = getCommands();
    const rest = new REST().setToken(process.env.BOT_TOKEN);
    const guilds = listConfiguredGuilds({ enabledOnly: true });

    if (!guilds.length) {
      console.warn('[Bot] Aucun serveur actif dans la configuration.');
      return;
    }

    for (const guild of guilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.guildId),
          { body: commands.map(c => c.data.toJSON()) },
        );
        console.log(`[Bot] Slash commands enregistrees pour ${guild.name || guild.guildId}.`);
      } catch (err) {
        console.error(`[Bot] Erreur enregistrement commands pour ${guild.guildId}:`, err);
      }
    }
  },
};
