# Telegram Affiliate Tracking Bot

A powerful Telegram bot with:

- Deep-link tracking
- SQLite database
- Admin panel
- Dynamic poster upload
- Dynamic button text
- Dynamic welcome message
- Dynamic callback URL
- Dynamic bot token
- PM2 auto restart
- User tracking system

---

# Features

## User Flow

User opens:

https://t.me/YOUR_BOT?start=click_id_offer123

Bot will:

1. Save click_id
2. Save user info
3. Send welcome message
4. Send poster
5. Show button
6. Trigger callback to your server

---

# Technologies

- Node.js
- Telegraf.js
- SQLite
- Express
- PM2

---

# Installation

## Clone

git clone YOUR_REPO

cd telegram-affiliate-bot

## Install packages

npm install

---

# Start Bot

node index.js

---

# PM2 Setup

Install PM2:

npm install -g pm2

Run:

pm2 start index.js --name tg-bot

Save:

pm2 save

Auto-start:

pm2 startup

---

# Admin Panel

Use:

/admin

Admins are defined inside:

index.js

Example:

const ADMINS = [
    "yourusername"
];

---

# Deep Link Example

https://t.me/YOUR_BOT?start=click_id_offer123

---

# Database

SQLite database file:

database.db

No external database required.

---

# Editable Settings

Admins can change:

- Welcome message
- Poster image
- Poster caption
- Button text
- Callback URL
- Bot token

---

# Bot Token Change

When token changes:

1. Bot saves new token
2. App exits
3. PM2 restarts bot automatically

---

# Callback Payload

Example callback sent to your server:

{
  "telegram_id": 123456,
  "username": "john",
  "first_name": "John",
  "click_id": "offer123"
}

---

# Port

Default:

3000

---

# License

MIT