const { saveGuildConfig } = require('../utils/config');
const { registerGuildCommands } = require('../utils/commands');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    saveGuildConfig(guild.id, {
      guildId: guild.id,
      name: guild.name,
      enabled: true,
    });

    try {
      await registerGuildCommands(guild.id);
      console.log(`[Bot] Serveur configure et commands enregistrees pour ${guild.name} (${guild.id}).`);
    } catch (err) {
      console.error(`[Bot] Erreur initialisation serveur ${guild.id}:`, err);
    }
  },
};
