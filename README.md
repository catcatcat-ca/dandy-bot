# Dandy — Discord Embed Bot

A JavaScript / discord.js v14 bot with configurable welcome, goodbye, boost, and custom embeds.

## Requirements
- Node.js 20+
- A Discord application and bot token
- A hosting service that supports persistent files/storage

## Files
- `index.js` — bot code
- `package.json` — dependencies and start command
- `data/settings.json` — created automatically; stores per-server settings

## Environment variables
Set these in your host's environment/variables panel:
- `DISCORD_TOKEN` — bot token (secret)
- `CLIENT_ID` — Discord application ID
- `GUILD_ID` — optional test server ID; when set, slash commands register immediately in that server. Remove it for global registration.

## Discord Developer Portal setup
1. Create an application and add a bot.
2. Under Bot > Privileged Gateway Intents, enable **Server Members Intent**.
3. Invite the bot with OAuth2 scopes `bot` and `applications.commands`.
4. Give it View Channels, Send Messages, Embed Links, and Read Message History permissions.
5. For `/clear` this bot does not include message deletion; no Manage Messages permission is required by this starter.

## Run
```bash
npm install
npm start
```

## Commands
- `/welcome set` — set channel, title, description, color, footer, image and thumbnail
- `/welcome disable`
- `/welcome test`
- `/goodbye set|disable|test`
- `/boost set|disable|test`
- `/embed send` — create and send a custom embed
- `/settings`
- `/help`
- `/ping`

## Placeholders for event messages
Use these in the event embed title, description or footer:
- `{user}` — mention the member
- `{username}` — username
- `{server}` — server name
- `{memberCount}` — current member count

## Important persistence note
The bot saves settings in `data/settings.json`. Make sure your hosting provider keeps the server's files between restarts/redeployments and does not wipe the working directory. If the host offers persistent storage/volumes, use one for the `data` directory. Back up `data/settings.json` periodically.

Never share your bot token or upload it into a public repository.
