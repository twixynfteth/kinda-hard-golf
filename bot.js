const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const Database = require("better-sqlite3");
const path = require("path");
require("dotenv").config();

// ─── Database Setup ────────────────────────────────────────────────────────────

const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, "leaderboard.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    strokes INTEGER NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS duels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    challenger_strokes INTEGER DEFAULT NULL,
    opponent_strokes INTEGER DEFAULT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_scores_user_level
    ON scores(guild_id, user_id, level);
  CREATE INDEX IF NOT EXISTS idx_scores_level
    ON scores(guild_id, level, strokes);
  CREATE INDEX IF NOT EXISTS idx_duels_players
    ON duels(guild_id, status);
`);

// Prepared statements
const stmts = {
  upsertScore: db.prepare(`
    INSERT INTO scores (user_id, username, guild_id, level, strokes)
    VALUES (@userId, @username, @guildId, @level, @strokes)
  `),
  bestScoreForLevel: db.prepare(`
    SELECT MIN(strokes) as best
    FROM scores
    WHERE user_id = @userId AND guild_id = @guildId AND level = @level
  `),
  levelLeaderboard: db.prepare(`
    SELECT username, MIN(strokes) as best_strokes, COUNT(*) as attempts
    FROM scores
    WHERE guild_id = @guildId AND level = @level
    GROUP BY user_id
    ORDER BY best_strokes ASC
    LIMIT 15
  `),
  overallLeaderboard: db.prepare(`
    SELECT username, user_id,
      SUM(best) as total_strokes,
      COUNT(*) as levels_played
    FROM (
      SELECT username, user_id, level, MIN(strokes) as best
      FROM scores
      WHERE guild_id = @guildId
      GROUP BY user_id, level
    )
    GROUP BY user_id
    ORDER BY levels_played DESC, total_strokes ASC
    LIMIT 15
  `),
  playerScores: db.prepare(`
    SELECT level, MIN(strokes) as best, COUNT(*) as attempts
    FROM scores
    WHERE user_id = @userId AND guild_id = @guildId
    GROUP BY level
    ORDER BY level ASC
  `),
  playerStats: db.prepare(`
    SELECT
      COUNT(DISTINCT level) as levels_played,
      COUNT(*) as total_attempts,
      MIN(strokes) as best_single,
      ROUND(AVG(strokes), 1) as avg_strokes
    FROM scores
    WHERE user_id = @userId AND guild_id = @guildId
  `),
  createDuel: db.prepare(`
    INSERT INTO duels (guild_id, challenger_id, opponent_id, level)
    VALUES (@guildId, @challengerId, @opponentId, @level)
  `),
  getPendingDuel: db.prepare(`
    SELECT * FROM duels
    WHERE guild_id = @guildId AND status = 'pending'
      AND ((challenger_id = @userId) OR (opponent_id = @userId))
      AND level = @level
    ORDER BY created_at DESC
    LIMIT 1
  `),
  submitDuelScore: db.prepare(`
    UPDATE duels
    SET challenger_strokes = CASE WHEN challenger_id = @userId THEN @strokes ELSE challenger_strokes END,
        opponent_strokes = CASE WHEN opponent_id = @userId THEN @strokes ELSE opponent_strokes END,
        status = CASE
          WHEN (challenger_id = @userId AND opponent_strokes IS NOT NULL) THEN 'complete'
          WHEN (opponent_id = @userId AND challenger_strokes IS NOT NULL) THEN 'complete'
          ELSE 'pending'
        END
    WHERE id = @duelId
  `),
  getDuel: db.prepare(`SELECT * FROM duels WHERE id = @duelId`),
  activeDuels: db.prepare(`
    SELECT * FROM duels
    WHERE guild_id = @guildId AND status = 'pending'
      AND (challenger_id = @userId OR opponent_id = @userId)
    ORDER BY created_at DESC
    LIMIT 5
  `),
};

// ─── Bot Setup ─────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const GAME_URL = "https://kindahardgolf.com";
const EMOJI = {
  trophy: "🏆",
  golf: "⛳",
  fire: "🔥",
  medal1: "🥇",
  medal2: "🥈",
  medal3: "🥉",
  flag: "🚩",
  chart: "📊",
  swords: "⚔️",
  star: "⭐",
  link: "🔗",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function medalFor(index) {
  if (index === 0) return EMOJI.medal1;
  if (index === 1) return EMOJI.medal2;
  if (index === 2) return EMOJI.medal3;
  return `\`${index + 1}.\``;
}

function playButton(level) {
  const url = level ? `${GAME_URL}` : GAME_URL;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Play Kinda Hard Golf")
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setEmoji("⛳")
  );
}

// ─── Daily Hole Scraper ────────────────────────────────────────────────────────

let cachedDaily = { hole: null, date: null, fetchedAt: 0 };

async function fetchDailyHole() {
  // Cache for 30 minutes
  if (Date.now() - cachedDaily.fetchedAt < 30 * 60 * 1000 && cachedDaily.hole) {
    return cachedDaily;
  }
  try {
    const res = await fetch(GAME_URL);
    const html = await res.text();

    // Extract hole number (looks for "No.\n315" pattern in the HTML)
    const holeMatch = html.match(/No\.\s*(?:<[^>]*>\s*)*(\d+)/i);
    // Extract date
    const dateMatch = html.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*\n?\s*(\d{4})/i
    );

    cachedDaily.hole = holeMatch ? parseInt(holeMatch[1]) : null;
    cachedDaily.date = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}` : null;
    cachedDaily.fetchedAt = Date.now();
  } catch (err) {
    console.error("Failed to fetch daily hole:", err.message);
  }
  return cachedDaily;
}

// ─── Command Handlers ──────────────────────────────────────────────────────────

async function handleGolf(interaction) {
  const level = interaction.options.getString("level");
  const daily = await fetchDailyHole();
  const todayInfo = daily.hole ? `Today's hole: **No. ${daily.hole}**\n\n` : "";

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${EMOJI.golf} Kinda Hard Golf`)
    .setDescription(
      `${todayInfo}` +
        `Think you've got what it takes?\n\n` +
        `${level ? `**Go play Level ${level}** and come back to submit your score!` : "**Click below to play**, then submit your score with `/submit`!"}` +
        `\n\nThe game is... kinda hard. Good luck.`
    )
    .setURL(GAME_URL)
    .setFooter({ text: "Use /submit to log your score • /leaderboard to see rankings" });

  await interaction.reply({ embeds: [embed], components: [playButton(level)] });
}

async function handleToday(interaction) {
  const daily = await fetchDailyHole();
  const guildId = interaction.guildId;

  if (!daily.hole) {
    return interaction.reply({
      content: "Couldn't fetch today's hole info — try again in a minute!",
      ephemeral: true,
    });
  }

  // Get leaderboard for today's hole
  const rows = stmts.levelLeaderboard.all({ guildId, level: daily.hole });
  const lbText =
    rows.length > 0
      ? `\n\n**${EMOJI.trophy} Server Scores for No. ${daily.hole}:**\n` +
        rows
          .slice(0, 10)
          .map(
            (r, i) =>
              `${medalFor(i)} **${r.username}** — ${r.best_strokes} stroke${r.best_strokes !== 1 ? "s" : ""}`
          )
          .join("\n")
      : `\n\nNo one has submitted a score yet — be the first!\nUse \`/submit strokes:<your score>\``;

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`${EMOJI.golf} Today's Hole — No. ${daily.hole}`)
    .setDescription(
      `**${daily.date || "Today"}**\n\n` +
        `Today's daily hole is **No. ${daily.hole}**. Play it and submit your score!` +
        lbText
    )
    .setURL(GAME_URL)
    .setFooter({
      text: `Use /submit strokes:<score> to log your score`,
    });

  await interaction.reply({ embeds: [embed], components: [playButton()] });
}

async function handleSubmit(interaction) {
  let level = interaction.options.getInteger("level");
  const strokes = interaction.options.getInteger("strokes");
  const userId = interaction.user.id;
  const username = interaction.user.displayName || interaction.user.username;
  const guildId = interaction.guildId;

  // Default to today's hole if no level provided
  if (!level) {
    const daily = await fetchDailyHole();
    if (!daily.hole) {
      return interaction.reply({
        content: "Couldn't fetch today's hole number. Please specify a level manually: `/submit strokes:8 level:315`",
        ephemeral: true,
      });
    }
    level = daily.hole;
  }

  // Get previous best
  const prev = stmts.bestScoreForLevel.get({ userId, guildId, level });
  const previousBest = prev?.best ?? null;
  const isNewRecord = previousBest === null || strokes < previousBest;

  // Save score
  stmts.upsertScore.run({ userId, username, guildId, level, strokes });

  // Check if any active duels for this level
  let duelMsg = "";
  const duel = stmts.getPendingDuel.get({ guildId, userId, level });
  if (duel) {
    stmts.submitDuelScore.run({ userId, strokes, duelId: duel.id });
    const updated = stmts.getDuel.get({ duelId: duel.id });
    if (updated.status === "complete") {
      const challengerWon = updated.challenger_strokes < updated.opponent_strokes;
      const tie = updated.challenger_strokes === updated.opponent_strokes;
      duelMsg = `\n\n${EMOJI.swords} **Duel Complete!**\n` +
        `<@${updated.challenger_id}>: **${updated.challenger_strokes}** strokes\n` +
        `<@${updated.opponent_id}>: **${updated.opponent_strokes}** strokes\n` +
        (tie ? "It's a **tie**!" : `${EMOJI.trophy} <@${challengerWon ? updated.challenger_id : updated.opponent_id}> wins!`);
    } else {
      duelMsg = `\n\n${EMOJI.swords} Duel score submitted! Waiting for opponent...`;
    }
  }

  // Get current rank on this level
  const lb = stmts.levelLeaderboard.all({ guildId, level });
  const rank = lb.findIndex(
    (r) => r.username === username
  );

  const embed = new EmbedBuilder()
    .setColor(isNewRecord ? 0xf1c40f : 0x3498db)
    .setTitle(
      isNewRecord
        ? `${EMOJI.star} New Personal Best!`
        : `${EMOJI.flag} Score Submitted`
    )
    .setDescription(
      `**Level ${level}** — **${strokes} stroke${strokes !== 1 ? "s" : ""}**` +
        (previousBest !== null && !isNewRecord
          ? `\nYour best: **${previousBest}** strokes`
          : previousBest !== null
            ? `\nPrevious best: **${previousBest}** → **${strokes}** ${EMOJI.fire}`
            : "") +
        (rank >= 0 ? `\nServer rank: **#${rank + 1}**` : "") +
        duelMsg
    )
    .setFooter({ text: `${username} • Level ${level}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleLeaderboard(interaction) {
  const view = interaction.options.getString("view") || "overall";
  const level = interaction.options.getInteger("level");
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (view === "level") {
    if (!level) {
      return interaction.reply({
        content: "Please specify a level number! Example: `/leaderboard view:Specific level level:5`",
        ephemeral: true,
      });
    }

    const rows = stmts.levelLeaderboard.all({ guildId, level });
    if (rows.length === 0) {
      return interaction.reply({
        content: `No scores submitted for Level ${level} yet! Be the first with \`/submit\`.`,
        ephemeral: true,
      });
    }

    const lines = rows.map(
      (r, i) =>
        `${medalFor(i)} **${r.username}** — ${r.best_strokes} stroke${r.best_strokes !== 1 ? "s" : ""} *(${r.attempts} attempt${r.attempts !== 1 ? "s" : ""})*`
    );

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${EMOJI.trophy} Level ${level} Leaderboard`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Best scores per player" });

    await interaction.reply({ embeds: [embed], components: [playButton(level)] });

  } else if (view === "mine") {
    const rows = stmts.playerScores.all({ userId, guildId });
    if (rows.length === 0) {
      return interaction.reply({
        content: "You haven't submitted any scores yet! Play at kindahardgolf.com and use `/submit`.",
        ephemeral: true,
      });
    }

    const totalStrokes = rows.reduce((sum, r) => sum + r.best, 0);
    const lines = rows.map(
      (r) =>
        `**Level ${r.level}** — ${EMOJI.golf} ${r.best} stroke${r.best !== 1 ? "s" : ""} *(${r.attempts} attempt${r.attempts !== 1 ? "s" : ""})*`
    );

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`${EMOJI.chart} Your Scores`)
      .setDescription(
        lines.join("\n") +
          `\n\n**Total:** ${totalStrokes} strokes across ${rows.length} level${rows.length !== 1 ? "s" : ""}`
      )
      .setFooter({ text: interaction.user.displayName || interaction.user.username });

    await interaction.reply({ embeds: [embed], components: [playButton()] });

  } else {
    // Overall
    const rows = stmts.overallLeaderboard.all({ guildId });
    if (rows.length === 0) {
      return interaction.reply({
        content: "No scores yet! Get started at kindahardgolf.com and use `/submit`.",
        ephemeral: true,
      });
    }

    const lines = rows.map(
      (r, i) =>
        `${medalFor(i)} **${r.username}** — ${r.levels_played} level${r.levels_played !== 1 ? "s" : ""}, ${r.total_strokes} total strokes`
    );

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${EMOJI.trophy} Kinda Hard Golf Leaderboard`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Ranked by levels completed, then fewest total strokes" });

    await interaction.reply({ embeds: [embed], components: [playButton()] });
  }
}

async function handleDuel(interaction) {
  const opponent = interaction.options.getUser("opponent");
  let level = interaction.options.getInteger("level");
  const guildId = interaction.guildId;
  const challengerId = interaction.user.id;

  // Default to today's hole if no level provided
  if (!level) {
    const daily = await fetchDailyHole();
    if (!daily.hole) {
      return interaction.reply({
        content: "Couldn't fetch today's hole number. Please specify a level manually: `/golfduel @player level:315`",
        ephemeral: true,
      });
    }
    level = daily.hole;
  }

  if (opponent.id === challengerId) {
    return interaction.reply({ content: "You can't duel yourself!", ephemeral: true });
  }
  if (opponent.bot) {
    return interaction.reply({ content: "You can't duel a bot!", ephemeral: true });
  }

  stmts.createDuel.run({
    guildId,
    challengerId,
    opponentId: opponent.id,
    level,
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${EMOJI.swords} Golf Duel — Hole ${level}!`)
    .setDescription(
      `**${interaction.user.displayName}** has challenged **${opponent.displayName}** to a duel!\n\n` +
        `**Hole ${level}** — Play it and submit your score with:\n` +
        `\`/submit strokes:<your score>\`\n\n` +
        `Both players must submit to see the result!`
    )
    .setFooter({ text: "May the fewest strokes win" });

  await interaction.reply({ embeds: [embed], components: [playButton(level)] });
}

async function handleStats(interaction) {
  const targetUser = interaction.options.getUser("player") || interaction.user;
  const guildId = interaction.guildId;
  const userId = targetUser.id;

  const stats = stmts.playerStats.get({ userId, guildId });
  const duelsActive = stmts.activeDuels.all({ guildId, userId });

  if (!stats || stats.levels_played === 0) {
    return interaction.reply({
      content: `${targetUser.displayName} hasn't submitted any scores yet!`,
      ephemeral: true,
    });
  }

  const scores = stmts.playerScores.all({ userId, guildId });
  const bestLevel = scores.reduce((a, b) => (a.best <= b.best ? a : b));

  let desc =
    `**Levels Played:** ${stats.levels_played}\n` +
    `**Total Attempts:** ${stats.total_attempts}\n` +
    `**Best Single Score:** ${stats.best_single} strokes\n` +
    `**Avg Strokes/Attempt:** ${stats.avg_strokes}\n` +
    `**Best Level:** Level ${bestLevel.level} (${bestLevel.best} strokes)`;

  if (duelsActive.length > 0) {
    desc += `\n\n${EMOJI.swords} **Active Duels:** ${duelsActive.length}`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`${EMOJI.chart} ${targetUser.displayName}'s Golf Stats`)
    .setDescription(desc)
    .setThumbnail(targetUser.displayAvatarURL())
    .setFooter({ text: "Kinda Hard Golf" });

  await interaction.reply({ embeds: [embed] });
}

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${EMOJI.golf} Kinda Hard Golf Bot`)
    .setDescription(
      `Wrap your Kinda Hard Golf addiction in Discord with leaderboards and duels!\n\n` +
        `**How it works:**\n` +
        `1. Play at [kindahardgolf.com](${GAME_URL})\n` +
        `2. Submit your scores here\n` +
        `3. Compete with your server!\n\n` +
        `**Commands:**\n` +
        `${EMOJI.link} \`/golf\` — Link to play the game\n` +
        `${EMOJI.flag} \`/submit\` — Submit a score for a level\n` +
        `${EMOJI.trophy} \`/leaderboard\` — View rankings (overall, by level, or yours)\n` +
        `${EMOJI.swords} \`/golfduel\` — Challenge someone to compete on a level\n` +
        `${EMOJI.chart} \`/golfstats\` — View detailed player stats\n\n` +
        `*Scores are tracked per-server. Your best score per level counts for rankings.*`
    )
    .setFooter({ text: "It's kinda hard. Good luck." });

  await interaction.reply({ embeds: [embed], components: [playButton()] });
}

// ─── Event Handling ────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "golf":
        await handleGolf(interaction);
        break;
      case "today":
        await handleToday(interaction);
        break;
      case "submit":
        await handleSubmit(interaction);
        break;
      case "leaderboard":
        await handleLeaderboard(interaction);
        break;
      case "golfduel":
        await handleDuel(interaction);
        break;
      case "golfstats":
        await handleStats(interaction);
        break;
      case "golfhelp":
        await handleHelp(interaction);
        break;
    }
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const reply = {
      content: "Something went wrong! Try again.",
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.once("ready", () => {
  console.log(`${EMOJI.golf} Kinda Hard Golf Bot is online as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} server(s)`);
});

// ─── Start ─────────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);
