# discord-manga-bot

Discord bot for announcing manga and novel releases. Posts clean embeds with cover art, lets members opt in to updates with one click, and includes a small review flow for translation-team test submissions.

## Features

- Release announcements with covers, thumbnails, color themes and link buttons
- "Get Notifications" button that hands out a per-series role, so you can ping only the people following that title
- Auto-fill from an EZ Manga series URL (`/quickmanga`)
- Image cards for single or multi-series announcements
- Command logging to a dedicated channel, with owner-only management commands

## Commands

| Command | What it does |
| --- | --- |
| `/manga` | Announce a series (title, synopsis, author, link, optional role and cover) |
| `/quickmanga` | Same, filled in automatically from a series URL |
| `/multimanga` | Announce several series in one post |
| `/updatemanga` | Edit an existing announcement by message ID |
| `/announce`, `/embed` | Plain announcements and custom embeds |
| `/say`, `/reply` | Send or reply as the bot |
| `/addowner`, `/removeowner`, `/listowners` | Manage bot owners |
| `/setlogchannel`, `/setticketcategory`, `/setreviewchannel` | Server configuration |

## Setup

Requires Node.js 18 or newer.

```bash
git clone <this-repo>
cd discord-manga-bot
npm install
cp .env.example .env   # then fill in your values
npm start
```

Slash commands are registered automatically on startup. To register them without starting the bot, run `npm run register`.

### Environment variables

See `.env.example`. `DISCORD_TOKEN`, `CLIENT_ID` and `OWNER_ID` are required; the rest are optional channel and role IDs.

### Bot permissions

Manage Roles, Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History. The bot's role must sit above any notification roles it assigns.

## How notification roles work

1. Create a role for the series in your server and copy its ID (Developer Mode on, right-click the role, Copy ID).
2. Pass it as `notification_role_id` when you run `/manga`.
3. Members click **Get Notifications** and receive the role.
4. Ping the role in later announcements.

## Project layout

```
src/
  index.js              bot entry point and command handlers
  register_commands.js  slash command definitions
  generateCard.js       image card rendering
  scrapeEzManga.js      series page scraper
scripts/
  register.js           standalone command registration
```

`owners.json` and `bot_config.json` are created at runtime in the project root and are git-ignored.
