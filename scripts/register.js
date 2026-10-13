require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('../src/register_commands.js');

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`Registered ${commands.length} commands.`);
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
