"use strict";

/**
 * Telegram Affiliate / CPI Bot — Production Build
 * Brand Motive Marketing (BMM)
 */

try { require("dotenv").config(); } catch (_) { }

const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const path = require("path");


/* ─────────────── CONFIG ─────────────── */

const CONFIG = {
    PORT: parseInt(process.env.PORT || "3000", 10),
    DB_PATH: process.env.DB_PATH || path.join(__dirname, "database.db"),
    CALLBACK_TIMEOUT: 10_000,
    STATE_TIMEOUT: 5 * 60 * 1000,

    DEFAULT_ADMINS: ["BaapVector", "Shesh_Nag7", "govindyt001k"],

    DEFAULT_SETTINGS: {
        bot_token: process.env.BOT_TOKEN || "8649130059:AAGgMVNtnQHWzas_SsCR14N996z5v5KSDYo",
        welcome_message: "Welcome {name}!",
        poster_caption: "Join our official channel below.",
        button_text: "🚀 Join Channel",
        button_url: "https://t.me/yourchannel",
        redirect_url: "https://yourdomain.com/callback",
        poster_file_id: ""
    }
};


/* ─────────────── LOGGER ─────────────── */

const log = {
    info: (...a) => console.log(new Date().toISOString(), "[INFO ]", ...a),
    warn: (...a) => console.warn(new Date().toISOString(), "[WARN ]", ...a),
    error: (...a) => console.error(new Date().toISOString(), "[ERROR]", ...a)
};


/* ─────────────── UTILS ─────────────── */

const mdv2 = (t = "") => String(t).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

const isValidUrl = (s) => {
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch { return false; }
};

const isValidBotToken = (t) => /^\d+:[A-Za-z0-9_-]{30,}$/.test(t || "");
const isValidUsername = (u) => /^[A-Za-z0-9_]{3,32}$/.test(u || "");


/* ─────────────── DATABASE ─────────────── */

const db = new sqlite3.Database(CONFIG.DB_PATH);

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function initDb() {
    await dbRun(`PRAGMA journal_mode = WAL`);
    await dbRun(`PRAGMA synchronous  = NORMAL`);
    await dbRun(`PRAGMA foreign_keys = ON`);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id TEXT NOT NULL,
            username    TEXT,
            first_name  TEXT,
            click_id    TEXT,
            joined_at   TEXT,
            UNIQUE(telegram_id, click_id)
        )
    `);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_users_joined_at  ON users(joined_at)`);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS admins (
            username TEXT PRIMARY KEY COLLATE NOCASE
        )
    `);

    for (const admin of CONFIG.DEFAULT_ADMINS) {
        await dbRun(`INSERT OR IGNORE INTO admins(username) VALUES (?)`, [admin]);
    }
    for (const [k, v] of Object.entries(CONFIG.DEFAULT_SETTINGS)) {
        await dbRun(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`, [k, v]);
    }
}

const settingsCache = new Map();

async function getSetting(key) {
    if (settingsCache.has(key)) return settingsCache.get(key);
    const row = await dbGet(`SELECT value FROM settings WHERE key=?`, [key]);
    const value = row ? row.value : null;
    settingsCache.set(key, value);
    return value;
}

async function setSetting(key, value) {
    await dbRun(
        `INSERT INTO settings(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
    );
    settingsCache.set(key, value);
}

async function isAdmin(username) {
    if (!username) return false;
    const row = await dbGet(`SELECT 1 FROM admins WHERE username=? COLLATE NOCASE`, [username]);
    return !!row;
}


/* ─────────────── TOKEN RESOLUTION (self-healing) ─────────────── */

async function resolveBotToken() {
    // Priority: env var > stored DB value > hardcoded default
    const candidates = [
        { source: "BOT_TOKEN env", value: process.env.BOT_TOKEN },
        { source: "database", value: await getSetting("bot_token") },
        { source: "hardcoded default", value: CONFIG.DEFAULT_SETTINGS.bot_token }
    ];

    for (const c of candidates) {
        if (isValidBotToken(c.value)) {
            log.info(`Using bot token from: ${c.source}`);
            // Persist so DB always has the working token
            await setSetting("bot_token", c.value);
            return c.value;
        }
    }
    return null;
}


/* ─────────────── STATE (admin prompts) ─────────────── */

const adminStates = new Map();

function setState(userId, state) {
    const existing = adminStates.get(userId);
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(() => adminStates.delete(userId), CONFIG.STATE_TIMEOUT);
    adminStates.set(userId, { state, timer });
}

const getState = (userId) => adminStates.get(userId)?.state || null;

function clearState(userId) {
    const e = adminStates.get(userId);
    if (e?.timer) clearTimeout(e.timer);
    adminStates.delete(userId);
}


/* ─────────────── ADMIN PANEL ─────────────── */

const ADMIN_PANEL = Markup.inlineKeyboard([
    [Markup.button.callback("✏️ Welcome", "set_welcome"), Markup.button.callback("🖼 Caption", "set_caption")],
    [Markup.button.callback("🔘 Button", "set_button"), Markup.button.callback("🔗 Btn URL", "set_button_url")],
    [Markup.button.callback("🌐 Callback", "set_url"), Markup.button.callback("📸 Poster", "set_poster")],
    [Markup.button.callback("👑 Admins", "manage_admins"), Markup.button.callback("🤖 Token", "set_token")],
    [Markup.button.callback("📊 Stats", "show_stats")]
]);

async function showAdminPanel(ctx, edit = false) {
    const text = "⚙️ *Admin Panel*\n\nChoose an option to configure the bot\\.";
    const opts = { parse_mode: "MarkdownV2", ...ADMIN_PANEL };

    if (edit) {
        try { return await ctx.editMessageText(text, opts); } catch (_) { }
    }
    await ctx.reply(text, opts);
}


/* ─────────────── MAIN ─────────────── */

async function startBot() {
    await initDb();

    const token = await resolveBotToken();
    if (!token) {
        log.error("No valid bot token found anywhere.");
        log.error("Fix: set BOT_TOKEN env var, or edit CONFIG.DEFAULT_SETTINGS.bot_token.");
        process.exit(1);
    }

    const bot = new Telegraf(token, { handlerTimeout: 90_000 });
    const me = await bot.telegram.getMe();
    log.info(`Logged in as @${me.username}`);


    /* ── /start ── */
    bot.start(async (ctx) => {
        try {
            const payload = ctx.startPayload || "";
            const clickId = payload.startsWith("click_id_") ? payload.slice("click_id_".length) : "";
            const tgId = String(ctx.from.id);
            const username = ctx.from.username || "";
            const fname = ctx.from.first_name || "";

            log.info(`START | id=${tgId} @${username || "no_username"} click_id=${clickId || "none"}`);

            await dbRun(
                `INSERT INTO users(telegram_id, username, first_name, click_id, joined_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(telegram_id, click_id) DO UPDATE SET
                     username   = excluded.username,
                     first_name = excluded.first_name`,
                [tgId, username, fname, clickId, new Date().toISOString()]
            );

            const [welcomeTpl, captionTpl, btnText, btnUrl, posterFileId] = await Promise.all([
                getSetting("welcome_message"),
                getSetting("poster_caption"),
                getSetting("button_text"),
                getSetting("button_url"),
                getSetting("poster_file_id")
            ]);

            const finalWelcome = mdv2((welcomeTpl || "").replace(/\{name\}/g, fname));
            await ctx.reply(finalWelcome || mdv2(`Welcome ${fname}!`), { parse_mode: "MarkdownV2" });

            const keyboard = Markup.inlineKeyboard([[
                Markup.button.url(btnText || "Open", btnUrl || "https://t.me")
            ]]);

            const caption = mdv2(captionTpl || "");
            if (posterFileId) {
                await ctx.replyWithPhoto(posterFileId, { caption, parse_mode: "MarkdownV2", ...keyboard });
            } else {
                await ctx.reply(caption || "—", { parse_mode: "MarkdownV2", ...keyboard });
            }
        } catch (e) {
            log.error("START handler:", e.message);
        }
    });


    /* ── chat_join_request → postback → approve ── */
    bot.on("chat_join_request", async (ctx) => {
        try {
            const req = ctx.update.chat_join_request;
            const user = req.from;

            const row = await dbGet(
                `SELECT * FROM users WHERE telegram_id=? ORDER BY id DESC LIMIT 1`,
                [String(user.id)]
            );

            const redirectUrl = await getSetting("redirect_url");
            if (row && redirectUrl) {
                const params = new URLSearchParams({
                    telegram_id: row.telegram_id || "",
                    username: row.username || "",
                    first_name: row.first_name || "",
                    click_id: row.click_id || "",
                    channel_id: String(req.chat.id),
                    channel_title: req.chat.title || ""
                });
                const sep = redirectUrl.includes("?") ? "&" : "?";
                const callbackUrl = `${redirectUrl}${sep}${params.toString()}`;

                try {
                    await axios.get(callbackUrl, { timeout: CONFIG.CALLBACK_TIMEOUT });
                    log.info(`CALLBACK OK | @${row.username} | ${row.click_id}`);
                } catch (e) {
                    log.error(`CALLBACK FAIL | @${row.username}:`, e.message);
                }
            } else if (!row) {
                log.warn(`JOIN | no user row for ${user.id}; approving anyway`);
            }

            try {
                await ctx.telegram.approveChatJoinRequest(req.chat.id, user.id);
                log.info(`APPROVED | @${user.username || user.id} → ${req.chat.title}`);
            } catch (e) {
                log.error("APPROVE:", e.message);
            }
        } catch (e) {
            log.error("JOIN handler:", e.message);
        }
    });


    /* ── Admin commands ── */
    bot.command("admin", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return;
        await showAdminPanel(ctx, false);
    });

    bot.command("stats", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return;
        const [total, today] = await Promise.all([
            dbGet(`SELECT COUNT(DISTINCT telegram_id) AS n FROM users`),
            dbGet(`SELECT COUNT(DISTINCT telegram_id) AS n FROM users WHERE date(joined_at)=date('now')`)
        ]);
        await ctx.reply(
            `📊 *Stats*\n\nTotal users: *${total?.n || 0}*\nNew today: *${today?.n || 0}*`,
            { parse_mode: "Markdown" }
        );
    });

    bot.command("cancel", async (ctx) => {
        clearState(ctx.from.id);
        await ctx.reply("✅ Cancelled.");
    });

    bot.command("id", async (ctx) => {
        await ctx.reply(
            `Your ID: \`${ctx.from.id}\`\nUsername: @${ctx.from.username || "—"}`,
            { parse_mode: "Markdown" }
        );
    });


    /* ── Admin prompt buttons ── */
    const PROMPTS = {
        set_welcome: { state: "waiting_welcome", text: "Send the new *welcome message*\\.\nUse `{name}` for first name\\." },
        set_caption: { state: "waiting_caption", text: "Send the new *poster caption*\\." },
        set_button: { state: "waiting_button", text: "Send the new *button text* \\(max 64 chars\\)\\." },
        set_button_url: { state: "waiting_button_url", text: "Send the new *button URL* \\(must start with https://\\)\\." },
        set_url: { state: "waiting_url", text: "Send the new *callback/postback URL*\\." },
        set_token: { state: "waiting_token", text: "Send the new *bot token*\\. Bot will restart\\." },
        set_poster: { state: "waiting_poster", text: "Send the new *poster image* as a photo\\." }
    };

    for (const [action, data] of Object.entries(PROMPTS)) {
        bot.action(action, async (ctx) => {
            if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
            setState(ctx.from.id, data.state);
            await ctx.answerCbQuery();
            await ctx.reply(`${data.text}\n\nSend /cancel to abort\\.`, { parse_mode: "MarkdownV2" });
        });
    }


    /* ── Stats button ── */
    bot.action("show_stats", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        const [total, today] = await Promise.all([
            dbGet(`SELECT COUNT(DISTINCT telegram_id) AS n FROM users`),
            dbGet(`SELECT COUNT(DISTINCT telegram_id) AS n FROM users WHERE date(joined_at)=date('now')`)
        ]);
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `📊 *Stats*\n\nTotal users: *${total?.n || 0}*\nNew today: *${today?.n || 0}*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "back_admin")]])
            }
        );
    });


    /* ── Manage admins ── */
    bot.action("manage_admins", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        const rows = await dbAll(`SELECT username FROM admins ORDER BY username ASC`);

        const buttons = [];
        for (let i = 0; i < rows.length; i += 2) {
            const row = [Markup.button.callback(`👤 ${rows[i].username}`, `admin_${rows[i].username}`)];
            if (rows[i + 1]) row.push(Markup.button.callback(`👤 ${rows[i + 1].username}`, `admin_${rows[i + 1].username}`));
            buttons.push(row);
        }
        buttons.push([Markup.button.callback("➕ Add Admin", "add_admin")]);
        buttons.push([Markup.button.callback("⬅️ Back", "back_admin")]);

        await ctx.answerCbQuery();
        try {
            await ctx.editMessageText("👑 *Manage Admins*", {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
        } catch {
            await ctx.reply("👑 *Manage Admins*", {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
        }
    });

    bot.action("back_admin", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        await ctx.answerCbQuery();
        await showAdminPanel(ctx, true);
    });

    bot.action("add_admin", async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        setState(ctx.from.id, "waiting_add_admin");
        await ctx.answerCbQuery();
        await ctx.reply(
            "Send the new admin's *username* without @\\.\n\n/cancel to abort\\.",
            { parse_mode: "MarkdownV2" }
        );
    });

    bot.action(/^admin_(.+)$/, async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        const username = ctx.match[1];
        await ctx.answerCbQuery();
        await ctx.editMessageText(`👤 @${username}`, {
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback("❌ Remove Admin", `remove_${username}`)],
                    [Markup.button.callback("⬅️ Back", "manage_admins")]
                ]
            }
        });
    });

    bot.action(/^remove_(.+)$/, async (ctx) => {
        if (!(await isAdmin(ctx.from.username))) return ctx.answerCbQuery("Unauthorized");
        const username = ctx.match[1];

        const { n } = (await dbGet(`SELECT COUNT(*) AS n FROM admins`)) || { n: 0 };
        if (n <= 1) {
            return ctx.answerCbQuery("Can't remove the last admin.", { show_alert: true });
        }

        await dbRun(`DELETE FROM admins WHERE username=? COLLATE NOCASE`, [username]);
        await ctx.answerCbQuery("Admin removed");
        await ctx.editMessageText(`❌ Removed @${username}`, {
            reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", "manage_admins")]] }
        });
    });


    /* ── Message handler for admin prompts ── */
    bot.on("message", async (ctx) => {
        try {
            if (!(await isAdmin(ctx.from.username))) return;
            const state = getState(ctx.from.id);
            if (!state) return;

            if (state === "waiting_poster") {
                if (!ctx.message.photo) return ctx.reply("Please send an image as a *photo*.", { parse_mode: "Markdown" });
                const biggest = ctx.message.photo[ctx.message.photo.length - 1];
                await setSetting("poster_file_id", biggest.file_id);
                clearState(ctx.from.id);
                return ctx.reply("✅ Poster updated.");
            }

            if (!ctx.message.text) return;
            const text = ctx.message.text.trim();
            if (!text) return ctx.reply("Empty message ignored.");

            switch (state) {
                case "waiting_welcome":
                    await setSetting("welcome_message", text);
                    break;

                case "waiting_caption":
                    await setSetting("poster_caption", text);
                    break;

                case "waiting_button":
                    if (text.length > 64) return ctx.reply("❌ Button text too long (max 64 chars).");
                    await setSetting("button_text", text);
                    break;

                case "waiting_button_url":
                    if (!isValidUrl(text)) return ctx.reply("❌ Invalid URL. Must start with http(s)://");
                    await setSetting("button_url", text);
                    break;

                case "waiting_url":
                    if (!isValidUrl(text)) return ctx.reply("❌ Invalid URL. Must start with http(s)://");
                    await setSetting("redirect_url", text);
                    break;

                case "waiting_token":
                    if (!isValidBotToken(text)) return ctx.reply("❌ Invalid bot token format.");
                    await setSetting("bot_token", text);
                    clearState(ctx.from.id);
                    await ctx.reply(
                        "✅ Token saved. Restarting…\n\n_Make sure PM2/systemd auto-restarts on exit._",
                        { parse_mode: "Markdown" }
                    );
                    setTimeout(() => process.exit(0), 500);
                    return;

                case "waiting_add_admin": {
                    const clean = text.replace(/^@/, "").trim();
                    if (!isValidUsername(clean)) {
                        clearState(ctx.from.id);
                        return ctx.reply("❌ Invalid username. Use 3–32 chars: letters, digits, underscores.");
                    }
                    const existing = await dbGet(
                        `SELECT 1 FROM admins WHERE username=? COLLATE NOCASE`, [clean]
                    );
                    if (existing) {
                        clearState(ctx.from.id);
                        return ctx.reply("⚠️ Admin already exists.");
                    }
                    await dbRun(`INSERT INTO admins(username) VALUES (?)`, [clean]);
                    clearState(ctx.from.id);
                    return ctx.reply(`✅ Added @${clean}`);
                }

                default:
                    return;
            }

            clearState(ctx.from.id);
            await ctx.reply("✅ Updated.");
        } catch (e) {
            log.error("MESSAGE handler:", e.message);
        }
    });

    bot.catch((err, ctx) => {
        log.error(`Bot error (update ${ctx.update?.update_id}):`, err.message || err);
    });


    /* ── HTTP server ── */
    const app = express();
    app.use(express.json());

    app.get("/", (_req, res) => res.send("Bot running"));
    app.get("/health", async (_req, res) => {
        try {
            await dbGet(`SELECT 1`);
            res.json({ ok: true, bot: me.username, uptime: process.uptime() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    const server = app.listen(CONFIG.PORT, () => log.info(`HTTP listening on :${CONFIG.PORT}`));

    await bot.launch();
    log.info("Bot started ✅");


    /* ── Graceful shutdown ── */
    const shutdown = (signal) => {
        log.info(`Received ${signal}, shutting down…`);
        try { bot.stop(signal); } catch (_) { }
        server.close();
        try { db.close(); } catch (_) { }
        setTimeout(() => process.exit(0), 1500);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.on("unhandledRejection", (r) => log.error("Unhandled rejection:", r));
    process.on("uncaughtException", (e) => log.error("Uncaught exception:", e.message));
}


startBot().catch((e) => {
    log.error("FATAL:", e.message);
    process.exit(1);
});
