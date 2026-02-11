const { REST, Routes, SlashCommandBuilder } = require("discord.js");
require("dotenv").config();

const commands = [
  new SlashCommandBuilder()
    .setName("golf")
    .setDescription("Play Kinda Hard Golf!")
    .addStringOption((opt) =>
      opt
        .setName("level")
        .setDescription("Specific level number to link to (optional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("submit")
    .setDescription("Submit your score for a level")
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Level number (e.g. 1, 2, 3...)")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("strokes")
        .setDescription("Number of strokes it took you")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the leaderboard")
    .addStringOption((opt) =>
      opt
        .setName("view")
        .setDescription("What to view")
        .setRequired(false)
        .addChoices(
          { name: "Overall (total strokes)", value: "overall" },
          { name: "Specific level", value: "level" },
          { name: "My scores", value: "mine" }
        )
    )
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Level number (for level leaderboard)")
        .setRequired(false)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("golfduel")
    .setDescription("Challenge someone to a golf duel on a specific level!")
    .addUserOption((opt) =>
      opt
        .setName("opponent")
        .setDescription("Who are you challenging?")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Level number to compete on")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("golfstats")
    .setDescription("View detailed stats for a player")
    .addUserOption((opt) =>
      opt
        .setName("player")
        .setDescription("Player to look up (defaults to you)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("golfhelp")
    .setDescription("How to use the Kinda Hard Golf bot"),
].map((cmd) => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands...`);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("Commands registered successfully!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();
