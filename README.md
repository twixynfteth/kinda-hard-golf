# ⛳ Kinda Hard Golf — Discord Bot

A Discord bot that wraps [kindahardgolf.com](https://kindahardgolf.com) with server leaderboards, player stats, and 1v1 duels.

## Features

- **🔗 `/golf`** — Quick link to play the game
- **🚩 `/submit`** — Log your score for any level
- **🏆 `/leaderboard`** — Server rankings (overall, per-level, or personal)
- **⚔️ `/golfduel`** — Challenge a friend to compete on a specific level
- **📊 `/golfstats`** — View detailed stats for any player

Scores are tracked per-server with SQLite. Best score per level per player counts toward rankings.

---

## Setup

### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Kinda Hard Golf")
3. Go to **Bot** tab → click **Reset Token** → copy the token
4. Go to **OAuth2** → copy the **Client ID**

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and paste in your bot token and client ID:

```
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
```

### 3. Install & Run

```bash
npm install

# Register slash commands with Discord (run once, or after changing commands)
npm run deploy

# Start the bot
npm start
```

### 4. Invite the Bot to Your Server

Go to **OAuth2 → URL Generator** in the developer portal:
- **Scopes:** `bot`, `applications.commands`
- **Permissions:** `Send Messages`, `Embed Links`, `Use External Emojis`

Copy the generated URL and open it in your browser to add the bot to your server.

---

## Commands

| Command | Description |
|---------|-------------|
| `/golf` | Link to play (optional: specify a level) |
| `/submit level:3 strokes:12` | Submit your score for level 3 |
| `/leaderboard` | Overall server rankings |
| `/leaderboard view:Specific level level:5` | Level 5 rankings |
| `/leaderboard view:My scores` | Your personal scorecard |
| `/golfduel @player level:3` | Challenge someone on level 3 |
| `/golfstats` | Your stats |
| `/golfstats @player` | Someone else's stats |
| `/golfhelp` | Show all commands |

---

## How Duels Work

1. Challenge someone with `/golfduel @opponent level:X`
2. Both players go play the level at kindahardgolf.com
3. Both submit their scores with `/submit level:X strokes:Y`
4. When both scores are in, the winner is announced automatically

---

## Hosting

The bot needs to stay running to respond to commands. Options:

- **Local:** Just run `npm start` on your machine
- **VPS:** Any cheap Linux VPS (DigitalOcean, Hetzner, etc.) — use `pm2` or `systemd`
- **Railway / Render / Fly.io:** Free-tier cloud hosting works fine for this
- **Raspberry Pi:** Works great for a small server

For process management with pm2:
```bash
npm install -g pm2
pm2 start bot.js --name golf-bot
pm2 save
pm2 startup
```
