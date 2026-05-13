const { REST, Routes } = require('discord.js');
const { getCommands } = require('../commands/index');

async function registerGuildCommands(guildId) {
  if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID) {
    throw new Error('BOT_TOKEN ou CLIENT_ID manquant');
  }

  const commands = getCommands();
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
    { body: commands.map(command => command.data.toJSON()) },
  );
}

module.exports = { registerGuildCommands };
