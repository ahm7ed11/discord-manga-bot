require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');

const commands = [
  // ==================== SAY Command ====================
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot send a message in a specific channel')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message content to send')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target channel (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)),

  // ==================== REPLY Command ====================
  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Make the bot reply to a specific message')
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('The ID of the message to reply to')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The reply content')
        .setRequired(true)),

  // ==================== ANNOUNCE Command ====================
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement with optional image attachment')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The announcement message')
        .setRequired(true))
    .addAttachmentOption(option =>
      option.setName('image_file')
        .setDescription('Optional image to attach to the announcement')
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target channel (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)),

  // ==================== MANGA Command (WITH ROLE ID SYSTEM!) ====================
  new SlashCommandBuilder()
    .setName('manga')
    .setDescription('Create professional manga/novel announcement with notification role system')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('The title of the manga/novel')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('synopsis')
        .setDescription('Brief description or synopsis')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('author')
        .setDescription('Author/Creator name')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('website_url')
        .setDescription('Website URL for "Read Now" button')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('notification_role_id')
        .setDescription('⭐ Role ID for notifications (Right-click role → Copy ID)')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('cover_image')
        .setDescription('Cover image (large display)')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('thumbnail')
        .setDescription('Thumbnail image (small display)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Embed color theme')
        .setRequired(false)
        .addChoices(
          { name: '❤️ Red', value: 'red' },
          { name: '🧡 Orange', value: 'orange' },
          { name: '💛 Yellow', value: 'yellow' },
          { name: '💚 Green', value: 'green' },
          { name: '💙 Blue', value: 'blue' },
          { name: '💜 Purple', value: 'purple' },
          { name: '💗 Pink', value: 'pink' },
          { name: '✨ Gold', value: 'gold' },
          { name: '🎨 Default', value: 'default' }
        ))
    .addStringOption(option =>
      option.setName('mention')
        .setDescription('Mention role/everyone (e.g., @everyone or <@&role_id>)')
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target channel (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)),

  // ==================== QUICK MANGA Command (Auto-scrape from URL) ====================
  new SlashCommandBuilder()
    .setName('quickmanga')
    .setDescription('🔗 Paste an EZ Manga series URL — bot auto-extracts title, cover, synopsis & announces!')
    .addStringOption(o => o
      .setName('url')
      .setDescription('Series URL — e.g. https://ezmanga.org/series/solo-leveling')
      .setRequired(true))
    .addStringOption(o => o
      .setName('mention')
      .setDescription('Role or @everyone to ping')
      .setRequired(false))
    .addStringOption(o => o
      .setName('notification_role_id')
      .setDescription('Role ID for 🔔 Get Notifications button')
      .setRequired(false))
    .addStringOption(o => o
      .setName('color')
      .setDescription('Embed accent color')
      .setRequired(false)
      .addChoices(
        { name: '🔴 Red',    value: 'red'    },
        { name: '🔵 Blue',   value: 'blue'   },
        { name: '🟡 Gold',   value: 'gold'   },
        { name: '🟢 Green',  value: 'green'  },
        { name: '🟣 Purple', value: 'purple' },
      ))
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('Target channel (defaults to current)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)),

  // ==================== MULTI-MANGA Command ====================
  new SlashCommandBuilder()
    .setName('multimanga')
    .setDescription('Announce multiple manga/novel projects in one beautiful announcement')
    // ── Work 1 (required — must be first!) ───────────────────────────────
    .addStringOption(o => o.setName('manga1_title').setDescription('📌 Work 1 — Title').setRequired(true))
    // ── Announcement header ───────────────────────────────────────────────
    .addStringOption(o => o.setName('header_title').setDescription('Main announcement title').setRequired(false))
    .addStringOption(o => o.setName('header_desc').setDescription('Short intro / teaser text under the title').setRequired(false))
    .addAttachmentOption(o => o.setName('header_image').setDescription('Banner image for the announcement header').setRequired(false))
    // ── Work 1 (rest) ─────────────────────────────────────────────────────
    .addStringOption(o => o.setName('manga1_synopsis').setDescription('📌 Work 1 — Synopsis / description').setRequired(false))
    .addStringOption(o => o.setName('manga1_author').setDescription('📌 Work 1 — Author name').setRequired(false))
    .addStringOption(o => o.setName('manga1_url').setDescription('📌 Work 1 — Read Now URL').setRequired(false))
    .addAttachmentOption(o => o.setName('manga1_cover').setDescription('📌 Work 1 — Cover image').setRequired(false))
    // ── Work 2 ────────────────────────────────────────────────────────────
    .addStringOption(o => o.setName('manga2_title').setDescription('📌 Work 2 — Title').setRequired(false))
    .addStringOption(o => o.setName('manga2_synopsis').setDescription('📌 Work 2 — Synopsis / description').setRequired(false))
    .addStringOption(o => o.setName('manga2_author').setDescription('📌 Work 2 — Author name').setRequired(false))
    .addStringOption(o => o.setName('manga2_url').setDescription('📌 Work 2 — Read Now URL').setRequired(false))
    .addAttachmentOption(o => o.setName('manga2_cover').setDescription('📌 Work 2 — Cover image').setRequired(false))
    // ── Work 3 ────────────────────────────────────────────────────────────
    .addStringOption(o => o.setName('manga3_title').setDescription('📌 Work 3 — Title').setRequired(false))
    .addStringOption(o => o.setName('manga3_synopsis').setDescription('📌 Work 3 — Synopsis / description').setRequired(false))
    .addStringOption(o => o.setName('manga3_author').setDescription('📌 Work 3 — Author name').setRequired(false))
    .addStringOption(o => o.setName('manga3_url').setDescription('📌 Work 3 — Read Now URL').setRequired(false))
    .addAttachmentOption(o => o.setName('manga3_cover').setDescription('📌 Work 3 — Cover image').setRequired(false))
    // ── Shared options ────────────────────────────────────────────────────
    .addStringOption(o => o.setName('color').setDescription('Color theme for the header embed').setRequired(false)
      .addChoices(
        { name: '❤️ Red', value: 'red' }, { name: '🧡 Orange', value: 'orange' },
        { name: '💛 Yellow', value: 'yellow' }, { name: '💚 Green', value: 'green' },
        { name: '💙 Blue', value: 'blue' }, { name: '💜 Purple', value: 'purple' },
        { name: '💗 Pink', value: 'pink' }, { name: '✨ Gold', value: 'gold' },
        { name: '🎨 Default', value: 'default' }
      ))
    .addStringOption(o => o.setName('mention').setDescription('Mention role/everyone above the announcement').setRequired(false))
    .addStringOption(o => o.setName('notification_role_id').setDescription('Role ID for 🔔 Get Notifications button').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Target channel (defaults to current)').addChannelTypes(ChannelType.GuildText).setRequired(false)),

  // ==================== UPDATE MANGA Command ====================
  new SlashCommandBuilder()
    .setName('updatemanga')
    .setDescription('✏️ Edit an existing manga/novel announcement by message ID')
    .addStringOption(o => o.setName('message_id').setDescription('Message ID of the announcement to edit').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('New title (leave empty to keep current)').setRequired(false))
    .addStringOption(o => o.setName('synopsis').setDescription('New synopsis / description (leave empty to keep current)').setRequired(false))
    .addStringOption(o => o.setName('author').setDescription('New author name (leave empty to keep current)').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Channel containing the announcement (defaults to current)').addChannelTypes(ChannelType.GuildText).setRequired(false)),

  // ==================== EMBED Command ====================
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create a fully customizable rich embed message')
    .addStringOption(option =>
      option.setName('title')
        .setDescription('The embed title')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The embed description/main content')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('url')
        .setDescription('URL link for the title (makes title clickable)')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('image')
        .setDescription('Large image to display in the embed')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('thumbnail')
        .setDescription('Small thumbnail image (top-right corner)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Embed color in hex format (e.g., #FF5733) - default is Discord Blurple')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('footer')
        .setDescription('Footer text at the bottom of the embed')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('author_name')
        .setDescription('Author name displayed at the top')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('author_icon')
        .setDescription('Small icon next to author name')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('mentions')
        .setDescription('Mentions to add above the embed (e.g., @everyone, <@&role_id>)')
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Target channel (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)),

  // ==================== Owner Management Commands ====================
  new SlashCommandBuilder()
    .setName('addowner')
    .setDescription('Add a new bot owner (Main Owner Only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to grant owner permissions')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeowner')
    .setDescription('Remove a bot owner (Main Owner Only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to revoke owner permissions from')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('listowners')
    .setDescription('Display a list of all bot owners'),

  new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Configure the bot logging channel (Main Owner Only)')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send bot logs to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('setticketcategory')
    .setDescription('Set the category for ticket channels (Main Owner Only)')
    .addChannelOption(option =>
      option.setName('category')
        .setDescription('The category where ticket channels are located')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('setreviewchannel')
    .setDescription('Set review channel for test submissions (Main Owner Only)')
    .addStringOption(option =>
      option.setName('position')
        .setDescription('Select the position')
        .setRequired(true)
        .addChoices(
          { name: '🇰🇷 Korean Translator (KTL)', value: 'ktl' },
          { name: '🇯🇵 Japanese Translator (JTL)', value: 'jtl' },
          { name: '📖 Proofreader (PR)', value: 'pr' },
          { name: '🎨 Editor (ED)', value: 'ed' }
        ))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel where submissions will be sent for review')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
].map(command => command.toJSON());

module.exports = { commands };