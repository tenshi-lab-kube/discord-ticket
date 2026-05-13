const { getGuildConfig, listConfiguredGuilds, saveGuildConfig } = require('../utils/config');
const { registerGuildCommands } = require('../utils/commands');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot] Connecte en tant que ${client.user.tag}`);

    for (const [, guild] of client.guilds.cache) {
      if (!getGuildConfig(guild.id, { requireEnabled: false })) {
        saveGuildConfig(guild.id, {
          guildId: guild.id,
          name: guild.name,
          enabled: true,
        });
        console.log(`[Bot] Serveur ajoute a la configuration: ${guild.name} (${guild.id}).`);
      }
    }

    const guilds = listConfiguredGuilds({ enabledOnly: true });

    if (!guilds.length) {
      console.warn('[Bot] Aucun serveur actif dans la configuration.');
      return;
    }

    for (const guild of guilds) {
      try {
        await registerGuildCommands(guild.guildId);
        console.log(`[Bot] Slash commands enregistrees pour ${guild.name || guild.guildId}.`);
      } catch (err) {
        console.error(`[Bot] Erreur enregistrement commands pour ${guild.guildId}:`, err);
      }
    }
  },
};
