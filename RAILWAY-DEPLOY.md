# 🚂 Deploying Kinda Hard Golf Bot to Railway

Step-by-step guide to get the bot running 24/7 on Railway.

---

## Prerequisites

- A [GitHub](https://github.com) account
- A [Railway](https://railway.com) account (sign in with GitHub)
- A Discord bot token and client ID ([setup guide below](#step-1-create-discord-bot))

---

## Step 1: Create Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it **Kinda Hard Golf**
3. Go to **Bot** tab:
   - Click **Reset Token** → **copy the token** (save it, you can't see it again)
   - Disable **Public Bot** if you only want it in your server
4. Go to **OAuth2** tab → copy the **Client ID** (also called Application ID)
5. Still in **OAuth2** → **URL Generator**:
   - Check **bot** and **applications.commands** under Scopes
   - Check **Send Messages**, **Embed Links** under Bot Permissions
   - Copy the generated URL → open it → add the bot to your server

---

## Step 2: Push Code to GitHub

1. Create a new repo on GitHub (e.g. `kindahard-golf-bot`)
2. Push this project to it:

```bash
cd kindahard-golf-bot
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kindahard-golf-bot.git
git push -u origin main
```

---

## Step 3: Deploy on Railway

1. Go to [railway.com/new](https://railway.com/new)
2. Click **Deploy from GitHub Repo**
3. Select your `kindahard-golf-bot` repo
4. Railway will detect the project and start building — **it will fail** because env vars aren't set yet. That's fine.

---

## Step 4: Set Environment Variables

1. In your Railway project, click on the service
2. Go to the **Variables** tab
3. Add these two variables:

| Variable | Value |
|----------|-------|
| `DISCORD_TOKEN` | Your bot token from Step 1 |
| `CLIENT_ID` | Your application/client ID from Step 1 |

4. Railway will automatically redeploy after adding variables

---

## Step 5: Add a Volume (keeps leaderboard data safe)

Without a volume, your SQLite database resets every time Railway redeploys. To persist it:

1. In your Railway project, click **+ New** → **Volume**
2. Attach it to your service
3. Set the **Mount Path** to `/data`
4. Go to your service's **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `DATA_DIR` | `/data` |

5. Redeploy — your leaderboard data now survives redeploys

---

## Step 6: Verify

1. Check the **Logs** tab in Railway — you should see:
   ```
   Registering 6 slash commands...
   Commands registered successfully!
   ⛳ Kinda Hard Golf Bot is online as KindaHardGolf#1234
   ```
2. Go to your Discord server and try `/golfhelp`

---

## Costs

Railway's free trial gives you $5 of credits. A Discord bot like this is extremely lightweight and typically costs **~$1–3/month** on the Hobby plan ($5/month with $5 of included usage). You'll barely use any resources since the bot is idle most of the time.

---

## Troubleshooting

**Bot is online but commands don't show up:**
- Wait 1-2 minutes — Discord caches slash commands globally and it can take a moment
- Make sure you invited the bot with `applications.commands` scope

**Bot crashes on start:**
- Check the Variables tab — make sure `DISCORD_TOKEN` and `CLIENT_ID` are set correctly
- Check logs for specific error messages

**Leaderboard resets after redeploy:**
- You need to add a Volume (Step 5). Without it, the SQLite file lives in the ephemeral filesystem.

**"Unknown interaction" errors:**
- This usually means the bot is taking too long to respond. Check Railway logs for errors.
