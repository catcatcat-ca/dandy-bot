const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");
const fs = require("node:fs/promises");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // Optional: instant command updates in one test server
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "settings.json");

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let settings = { guilds: {} };
let saveQueue = Promise.resolve();

async function loadSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.guilds) settings = parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveSettings();
  }
}

function saveSettings() {
  // Serialize writes so two quick configuration changes cannot overwrite each other.
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(settings, null, 2), "utf8");
    await fs.rename(tempFile, DATA_FILE);
  });
  return saveQueue;
}

function guildSettings(guildId) {
  if (!settings.guilds[guildId]) settings.guilds[guildId] = {};
  return settings.guilds[guildId];
}

function replacePlaceholders(text, member) {
  const guild = member.guild;
  return String(text || "")
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", guild.name)
    .replaceAll("{memberCount}", String(guild.memberCount));
}

function validColor(value) {
  if (!value) return "#5865F2";
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : null;
}

function validUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildEmbed({ title, description, color, footer, image, thumbnail, author }) {
  const parsedColor = validColor(color);
  if (!parsedColor) throw new Error("Color must be a hex value such as #5865F2.");
  const embed = new EmbedBuilder().setColor(parsedColor);
  if (title) embed.setTitle(title.slice(0, 256));
  if (description) embed.setDescription(description.slice(0, 4096));
  if (footer) embed.setFooter({ text: footer.slice(0, 2048) });
  if (author) embed.setAuthor({ name: author.slice(0, 256) });
  if (image) {
    const url = validUrl(image);
    if (!url) throw new Error("Image must be a valid HTTP or HTTPS URL.");
    embed.setImage(url);
  }
  if (thumbnail) {
    const url = validUrl(thumbnail);
    if (!url) throw new Error("Thumbnail must be a valid HTTP or HTTPS URL.");
    embed.setThumbnail(url);
  }
  if (!title && !description && !image && !thumbnail) {
    throw new Error("Add at least a title, description, image, or thumbnail.");
  }
  return embed;
}

function eventEmbed(config, member, fallbackTitle) {
  const color = validColor(config.color || "#5865F2");
  if (!color) return null;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTimestamp();
  const title = replacePlaceholders(config.title || fallbackTitle, member);
  const description = replacePlaceholders(config.message || "", member);
  if (title) embed.setTitle(title.slice(0, 256));
  if (description) embed.setDescription(description.slice(0, 4096));
  if (config.footer) {
    embed.setFooter({ text: replacePlaceholders(config.footer, member).slice(0, 2048) });
  }
  if (config.thumbnail === "user") embed.setThumbnail(member.user.displayAvatarURL());
  else if (config.thumbnail && validUrl(config.thumbnail)) embed.setThumbnail(config.thumbnail);
  if (config.image && validUrl(config.image)) embed.setImage(config.image);
  return embed;
}

async function sendConfiguredEvent(member, type) {
  const config = guildSettings(member.guild.id)[type];
  if (!config?.enabled || !config.channelId) return;
  const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.send) return;
  const title = type === "welcome" ? "Welcome!" : type === "goodbye" ? "Goodbye!" : "Thank you for boosting!";
  const embed = eventEmbed(config, member, title);
  if (!embed) return;
  const content = config.message ? replacePlaceholders(config.content || "", member) : "";
  await channel.send({
    content: content || undefined,
    embeds: [embed],
    allowedMentions: { users: [member.id] }
  }).catch(error => console.error(`Could not send ${type} event:`, error.message));
}

const eventCommand = (name, description) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub => sub
    .setName("set")
    .setDescription(`Configure the ${name} embed`)
    .addChannelOption(o => o.setName("channel").setDescription("Channel for this event").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName("title").setDescription("Embed title; supports placeholders").setMaxLength(256).setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Embed description; supports placeholders").setMaxLength(4000).setRequired(true))
    .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #FF99CC").setMaxLength(7))
    .addStringOption(o => o.setName("footer").setDescription("Optional footer").setMaxLength(200))
    .addStringOption(o => o.setName("image").setDescription("Optional image URL"))
    .addStringOption(o => o.setName("thumbnail").setDescription("URL, or type 'user' for member avatar")))
  .addSubcommand(sub => sub.setName("disable").setDescription(`Disable ${name} messages`))
  .addSubcommand(sub => sub.setName("test").setDescription(`Preview the ${name} embed`));

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Check Dandy's response time"),
  new SlashCommandBuilder().setName("help").setDescription("Show Dandy's commands"),
  new SlashCommandBuilder().setName("settings").setDescription("Show this server's Dandy settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  eventCommand("welcome", "Configure welcome messages"),
  eventCommand("goodbye", "Configure goodbye messages"),
  eventCommand("boost", "Configure server boost messages"),
  new SlashCommandBuilder().setName("embed").setDescription("Create a custom embed")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub => sub.setName("send").setDescription("Build and send a custom embed")
      .addChannelOption(o => o.setName("channel").setDescription("Where to send it").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName("title").setDescription("Embed title").setMaxLength(256))
      .addStringOption(o => o.setName("description").setDescription("Embed description").setMaxLength(4000))
      .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #FF99CC").setMaxLength(7))
      .addStringOption(o => o.setName("footer").setDescription("Footer text").setMaxLength(200))
      .addStringOption(o => o.setName("author").setDescription("Author text").setMaxLength(200))
      .addStringOption(o => o.setName("image").setDescription("Image URL"))
      .addStringOption(o => o.setName("thumbnail").setDescription("Thumbnail URL")))
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new (require("@discordjs/rest").REST)({ version: "10" }).setToken(TOKEN);
  const { Routes } = require("discord-api-types/v10");
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Registered commands in test server ${GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Registered global commands (Discord may take a little while to display them).");
  }
}

client.once("ready", () => {
  console.log(`Dandy is online as ${client.user.tag}`);
});

client.on("guildMemberAdd", member => sendConfiguredEvent(member, "welcome"));
client.on("guildMemberRemove", member => sendConfiguredEvent(member, "goodbye"));
client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince) {
    sendConfiguredEvent(newMember, "boost");
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  try {
    const name = interaction.commandName;

    if (name === "ping") {
      return interaction.reply(`Pong! 🏓 ${client.ws.ping}ms`);
    }

    if (name === "help") {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("Dandy — Commands")
          .setDescription([
            "`/welcome set|disable|test` — Welcome embeds",
            "`/goodbye set|disable|test` — Goodbye embeds",
            "`/boost set|disable|test` — Boost embeds",
            "`/embed send` — Create a custom embed",
            "`/settings` — View server configuration",
            "`/ping` — Check bot latency"
          ].join("\n"))
          .setFooter({ text: "Dandy • Your server, your style" })]
      });
    }

    if (name === "settings") {
      const data = guildSettings(interaction.guildId);
      const summary = ["welcome", "goodbye", "boost"].map(type => {
        const cfg = data[type];
        return `**${type}:** ${cfg?.enabled ? `<#${cfg.channelId}>` : "Disabled"}`;
      }).join("\n");
      return interaction.reply({ content: summary, ephemeral: true });
    }

    if (["welcome", "goodbye", "boost"].includes(name)) {
      const sub = interaction.options.getSubcommand();
      const data = guildSettings(interaction.guildId);

      if (sub === "disable") {
        data[name] = { ...(data[name] || {}), enabled: false };
        await saveSettings();
        return interaction.reply({ content: `✅ ${name} messages disabled.`, ephemeral: true });
      }

      if (sub === "set") {
        const channel = interaction.options.getChannel("channel", true);
        const colorInput = interaction.options.getString("color") || "#5865F2";
        if (!validColor(colorInput)) {
          return interaction.reply({ content: "Please use a six-digit hex color, e.g. `#FF99CC`.", ephemeral: true });
        }
        const image = interaction.options.getString("image");
        const thumbnail = interaction.options.getString("thumbnail");
        if (image && !validUrl(image)) return interaction.reply({ content: "The image URL must start with http:// or https://.", ephemeral: true });
        if (thumbnail && thumbnail.toLowerCase() !== "user" && !validUrl(thumbnail)) {
          return interaction.reply({ content: "Thumbnail must be a valid HTTP(S) URL or `user`.", ephemeral: true });
        }
        data[name] = {
          enabled: true,
          channelId: channel.id,
          title: interaction.options.getString("title", true),
          message: interaction.options.getString("message", true),
          color: colorInput,
          footer: interaction.options.getString("footer") || "",
          image: image || "",
          thumbnail: thumbnail || ""
        };
        await saveSettings();
        return interaction.reply({ content: `✅ ${name} embed saved and enabled in ${channel}.`, ephemeral: true });
      }

      if (sub === "test") {
        const config = data[name];
        if (!config?.enabled) return interaction.reply({ content: `Configure ${name} first using \`/${name} set\`.`, ephemeral: true });
        const previewMember = await interaction.guild.members.fetch(interaction.user.id);
        const embed = eventEmbed(config, previewMember, `${name} preview`);
        return interaction.reply({ embeds: embed ? [embed] : [], content: embed ? undefined : "The saved color is invalid.", ephemeral: true });
      }
    }

    if (name === "embed" && interaction.options.getSubcommand() === "send") {
      const channel = interaction.options.getChannel("channel", true);
      const options = {
        title: interaction.options.getString("title"),
        description: interaction.options.getString("description"),
        color: interaction.options.getString("color") || "#5865F2",
        footer: interaction.options.getString("footer"),
        author: interaction.options.getString("author"),
        image: interaction.options.getString("image"),
        thumbnail: interaction.options.getString("thumbnail")
      };
      const embed = buildEmbed(options);
      await channel.send({ embeds: [embed] });
      return interaction.reply({ content: `✅ Your embed was sent to ${channel}.`, ephemeral: true });
    }
  } catch (error) {
    console.error("Command error:", error);
    const message = error.message?.includes("Invalid Form Body")
      ? "Discord rejected part of that embed. Check the text lengths and image URLs."
      : "Something went wrong. Check the hosting console for details.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

(async () => {
  await loadSettings();
  await registerCommands();
  await client.login(TOKEN);
})().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});
