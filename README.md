# Telegram Affiliate Bot

A production-grade Telegram bot for **CPI / CPA affiliate tracking** and channel-join automation. Captures click IDs from `/start` deep links, fires postbacks on channel joins, and approves join requests automatically.

---

## Features

- **Click ID tracking** — captures affiliate click IDs from `/start click_id_XXX` deep links
- **Postback firing** — sends a GET request to your tracker on every channel join
- **Auto-approve join requests** — no manual approval, scales to thousands of users
- **Per-campaign deduplication** — same user across different campaigns = separate rows; same campaign = updated row
- **Button-based admin panel** — full bot control via inline buttons, no editing code
- **Multi-admin support** — add/remove admins on the fly
- **MarkdownV2-safe** — usernames with special chars never break the bot
- **Self-healing token** — invalid stored token? Auto-recovers from env or hardcoded default
- **WAL-mode SQLite** — fast, concurrent-safe storage with indexes
- **Settings cache** — DB hit once per setting, then served from memory
- **Graceful shutdown** — clean exit on SIGINT/SIGTERM
- **Health check endpoint** — `/health` for uptime monitors
- **Built-in stats** — total users + new users today

---

## Stack

- **Node.js** 18+
- **Telegraf** 4.x
- **Express**
- **SQLite3**
- **Axios**
- **dotenv**

---

## Setup

### 1. Install

```bash
npm install telegraf express sqlite3 axios dotenv
```

### 2. Configure

Copy `.env.example` to `.env` and fill in:

```env
BOT_TOKEN=123456789:AAAA-your-real-token-here
PORT=3000
DB_PATH=./database.db
```

Get your bot token from [@BotFather](https://t.me/BotFather).

### 3. Run

**Development (auto-reload):**
```bash
npx nodemon index.js
```

**Production (with PM2):**
```bash
npm install -g pm2
pm2 start index.js --name tg-bot
pm2 save
pm2 startup
```

Expected log on success:
```
[INFO ] Using bot token from: BOT_TOKEN env
[INFO ] Logged in as @yourbot
[INFO ] HTTP listening on :3000
[INFO ] Bot started ✅
```

---

## Commands

### Public

| Command | Description |
|---------|-------------|
| `/start` | Entry point. Captures `click_id_XXX` payload, sends welcome + join button |
| `/id` | Shows the user their Telegram ID and username |

### Admin-only

| Command | Description |
|---------|-------------|
| `/admin` | Opens the full settings panel |
| `/stats` | Shows total users + new users today |
| `/cancel` | Cancels any pending admin action |

### Register with BotFather

Send `/setcommands` to [@BotFather](https://t.me/BotFather), pick your bot, paste:

```
start - Get started
id - Show my Telegram ID
admin - Open admin panel
stats - View user stats
cancel - Cancel current action
```

---

## Admin Panel

Run `/admin` (must be in the admins list) and you get button access to:

| Button | Purpose |
|--------|---------|
| ✏️ Welcome | Set the welcome message. Use `{name}` for first name |
| 🖼 Caption | Set the poster caption |
| 🔘 Button | Set the join button label |
| 🔗 Btn URL | Set the join button destination URL |
| 🌐 Callback | Set your postback/tracker URL |
| 📸 Poster | Upload a poster image (send as photo) |
| 👑 Admins | Add or remove admins |
| 🤖 Token | Change the bot token (bot will restart) |
| 📊 Stats | Total + today's user count |

Default admins are set in `CONFIG.DEFAULT_ADMINS` inside `index.js`.

---

## How the Affiliate Flow Works

1. **User clicks an affiliate link:**
   ```
   https://t.me/yourbot?start=click_id_ABC123
   ```

2. **Bot captures** the click ID and stores `{telegram_id, click_id, username, first_name}` in SQLite.

3. **Bot shows** the welcome message + poster + join button.

4. **User requests to join** the channel via the button.

5. **Bot fires a GET request** to your callback URL:
   ```
   https://your-tracker.com/callback
     ?telegram_id=123456789
     &username=user_handle
     &first_name=First
     &click_id=ABC123
     &channel_id=-1001234567890
     &channel_title=Your+Channel
   ```

6. **Bot auto-approves** the join request — user is in the channel.

7. **Your tracker** records the conversion against the click ID.

---

## Deployment

### PM2 (VPS — recommended)

```bash
pm2 start index.js --name tg-bot
pm2 logs tg-bot
pm2 restart tg-bot
```

### Render / Railway / Fly.io

- Set `BOT_TOKEN` in the platform's env var settings
- Use the `/health` endpoint for health checks
- The bot uses long polling, no webhook config needed

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

---

## Database

SQLite file at `./database.db` (or wherever `DB_PATH` points). Three tables:

- **`settings`** — key/value config (welcome message, URLs, token, etc.)
- **`users`** — every `/start` with `(telegram_id, click_id, username, first_name, joined_at)`
- **`admins`** — list of Telegram usernames with admin access

**Reset everything:**
```bash
rm database.db
```

The bot recreates tables and seeds defaults on next start.

---

## Bot Permissions

Inside your Telegram channel, the bot needs:

- **Admin** rights
- **Invite users via link** permission
- **Manage join requests** permission

Without these, `approveChatJoinRequest` will silently fail.

---

## Troubleshooting

**`Invalid or missing bot token`**
- `BOT_TOKEN` env var not set, or `.env` not loaded
- Run `npm install dotenv` and check `.env` is in the same folder as `index.js`
- Try `rm database.db` if you previously ran with an empty token

**Bot logs in but doesn't reply to `/start`**
- Check for `Bot started ✅` in logs
- Run `/setprivacy` on BotFather → `Disable` if needed

**Join requests not getting approved**
- Bot must be admin in the channel with "Manage join requests" permission
- Channel must have **join requests** enabled (Channel Settings → Channel Type → Approve new members)

**Postback not firing**
- Check the URL in `/admin` → `🌐 Callback`
- Look for `CALLBACK FAIL` lines in logs — usually a timeout or 4xx/5xx from your tracker
- The 10s timeout can be raised in `CONFIG.CALLBACK_TIMEOUT`

**Markdown errors in welcome**
- The bot uses MarkdownV2 — escape special chars with `\` in your welcome message
- Or keep messages plain text, no special chars

---

## Security Notes

- Never commit your `.env` file. Add to `.gitignore`:
  ```
  .env
  database.db
  node_modules/
  ```
- Don't hardcode the token in `CONFIG.DEFAULT_SETTINGS` for production — use env vars only
- Admin usernames are case-insensitive, but usernames can be reassigned on Telegram — review your admin list periodically

---

## Roadmap

- [ ] `/broadcast` — send a message to all users
- [ ] `/users` — export user list as CSV
- [ ] `/ban` and `/unban`
- [ ] Webhook mode
- [ ] Per-campaign analytics (clicks vs joins vs conversions)
- [ ] Multi-channel support