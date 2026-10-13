require('dotenv').config();

// ── Optional image generation (install: npm i @napi-rs/canvas) ──────────────
let generateMultiCard, generateSingleCard;
try {
  const cg = require('./generateCard');
  generateMultiCard  = cg.generateMultiCard;
  generateSingleCard = cg.generateSingleCard;
} catch { /* canvas not installed — falls back to embed-only mode */ }

// ── EZ Manga URL scraper (no extra packages needed) ──────────────────────────
const { scrapeSeriesPage } = require('./scrapeEzManga');

const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ChannelType, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  REST,
  Routes
} = require('discord.js');
const fs = require('fs');

// ==================== Auto-Register Slash Commands on Startup ====================

async function registerCommands() {
  try {
    const { commands } = require('./register_commands.js');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log(`✅ Slash commands registered! (${commands.length} commands)`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error.message);
  }
}

registerCommands();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const MAIN_OWNER_ID = process.env.OWNER_ID;
const OWNERS_FILE = './owners.json';
const CONFIG_FILE = './bot_config.json';

// ==================== Helper Functions ====================

function loadOwners() {
  try {
    const data = fs.readFileSync(OWNERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function saveOwners(owners) {
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(owners, null, 2));
}

function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    
    // Merge with environment variables for review channels
    if (!config.reviewChannels || Object.keys(config.reviewChannels).length === 0) {
      config.reviewChannels = {
        ktl: process.env.KTL_REVIEW_CHANNEL || null,
        jtl: process.env.JTL_REVIEW_CHANNEL || null,
        pr: process.env.PR_REVIEW_CHANNEL || null,
        ed: process.env.ED_REVIEW_CHANNEL || null
      };
    }
    
    // ✅ NEW: Add review roles support
    if (!config.reviewRoles) {
      config.reviewRoles = {
        ktl: process.env.KTL_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        jtl: process.env.JTL_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        pr: process.env.PR_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        ed: process.env.ED_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null
      };
    }
    
    // Ensure other fields exist
    if (!config.ticketCategoryId) {
      config.ticketCategoryId = process.env.TICKET_CATEGORY_ID || null;
    }
    
    return config;
  } catch (error) {
    return { 
      logChannelId: process.env.LOG_CHANNEL_ID || null, 
      trackedMessages: {},
      announcementRoles: {}, // Store role IDs for each announcement message
      ticketCategoryId: process.env.TICKET_CATEGORY_ID || null, // Ticket system
      reviewChannels: {
        ktl: process.env.KTL_REVIEW_CHANNEL || null,
        jtl: process.env.JTL_REVIEW_CHANNEL || null,
        pr: process.env.PR_REVIEW_CHANNEL || null,
        ed: process.env.ED_REVIEW_CHANNEL || null
      },
      reviewRoles: {
        ktl: process.env.KTL_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        jtl: process.env.JTL_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        pr: process.env.PR_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null,
        ed: process.env.ED_REVIEWER_ROLE || process.env.REVIEWER_ROLE || null
      }
    };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function isOwner(userId) {
  if (userId === MAIN_OWNER_ID) return true;
  const owners = loadOwners();
  return owners.includes(userId);
}

// ✅ NEW: Check if user can review submissions
function canReview(member, position = null) {
  // Check if user is owner
  if (isOwner(member.user.id)) return true;
  
  const config = loadConfig();
  
  // Check general reviewer role (if exists)
  const generalReviewerRole = process.env.REVIEWER_ROLE;
  if (generalReviewerRole && member.roles.cache.has(generalReviewerRole)) {
    return true;
  }
  
  // Check position-specific reviewer role
  if (position && config.reviewRoles && config.reviewRoles[position]) {
    if (member.roles.cache.has(config.reviewRoles[position])) {
      return true;
    }
  }
  
  // Check if user has administrator permission
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  
  return false;
}

async function sendLog(logEmbed) {
  try {
    const config = loadConfig();
    if (!config.logChannelId) return;
    
    const logChannel = await client.channels.fetch(config.logChannelId);
    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send({ embeds: [logEmbed] });
    }
  } catch (error) {
    console.error('Error sending log:', error);
  }
}

function trackMessage(messageId, commandType, executor, targetChannel, roleId = null) {
  const config = loadConfig();
  
  // Ensure announcementRoles exists
  if (!config.announcementRoles) {
    config.announcementRoles = {};
  }
  
  config.trackedMessages[messageId] = {
    commandType,
    executor,
    targetChannel,
    timestamp: Date.now()
  };
  
  // Store role ID for this announcement
  if (roleId && commandType === 'manga') {
    config.announcementRoles[messageId] = roleId;
  }
  
  saveConfig(config);
}

// ==================== TICKET AUTO-RESPONDER SYSTEM ====================

const TICKET_TESTS = {
  ktl: {
    title: "🇰🇷 Korean Translator Test (KTL)",
    description: "Thank you for applying for the **Korean Translator** position!",
    instructions: [
      "⏰ **Test Duration:** You have **2 days (48 hours)** to complete this test",
      "📋 Complete the translation test provided in the materials below",
      "✅ Submit your work in a **Google Doc** format",
      "💬 When finished, **mention the bot** in this ticket with your submission link",
      "⚠️ **Important:** This ticket will **automatically close in 2 days** if no submission is received"
    ],
    link: "https://drive.google.com/drive/folders/1_X8P2QzabXdWAhIrUTaLu8hYIU0jcoFK",
    color: 0xFF6B9D,
    emoji: "🇰🇷"
  },
  
  jtl: {
    title: "🇯🇵 Japanese Translator Test (JTL)",
    description: "Thank you for applying for the **Japanese Translator** position!",
    instructions: [
      "⏰ **Test Duration:** You have **2 days (48 hours)** to complete this test",
      "📋 Complete the translation test provided in the materials below",
      "✅ Submit your work in a **Google Doc** format",
      "💬 When finished, **mention the bot** in this ticket with your submission link",
      "⚠️ **Important:** This ticket will **automatically close in 2 days** if no submission is received"
    ],
    link: "https://drive.google.com/drive/folders/1drLvTXVZBiCGEjSTh8duHdF4MjkF8iEi?usp=sharing",
    color: 0xFF0000,
    emoji: "🇯🇵"
  },
  
  pr: {
    title: "📖 Proofreader Test (PR)",
    description: "Thank you for applying for the **Proofreader** position!",
    instructions: [
      "⏰ **Test Duration:** You have **2 days (48 hours)** to complete this test",
      "📋 Review the provided content carefully and mark all corrections",
      "✅ Submit your corrections in the format specified in the test materials",
      "💬 When finished, **mention the bot** in this ticket with your submission link",
      "⚠️ **Important:** This ticket will **automatically close in 2 days** if no submission is received"
    ],
    link: "https://drive.google.com/drive/u/0/folders/11BJZUZDl7YhnlR0UWWhyEnK_zKXg003m",
    color: 0x5865F2,
    emoji: "📖"
  },
  
  ed: {
    title: "🎨 Editor Test (ED)",
    description: "Thank you for applying for the **Editor** position!",
    instructions: [
      "⏰ **Test Duration:** You have **2 days (48 hours)** to complete this test",
      "📋 You **must typeset all SFX** in the provided pages",
      "✅ Upload both **JPG and PSD** files to Google Drive",
      "💬 When finished, **mention the bot** in this ticket with your submission link",
      "⚠️ **Important:** This ticket will **automatically close in 2 days** if no submission is received"
    ],
    link: "https://drive.google.com/drive/folders/1M4D7VcDVtBvl7A3ET6Wc1mTvdtHLsQ12?usp=drive_link",
    color: 0x9B59B6,
    emoji: "🎨"
  }
};

const activeTicketTimers = new Map();

function detectPosition(content) {
  const lowerContent = content.toLowerCase();
  
  // Check for full names and abbreviations
  if (lowerContent.includes('ktl') || 
      lowerContent.includes('korean translator') ||
      lowerContent.includes('korean translation')) {
    return 'ktl';
  }
  
  if (lowerContent.includes('jtl') || 
      lowerContent.includes('japanese translator') ||
      lowerContent.includes('japanese translation')) {
    return 'jtl';
  }
  
  // Check for PR as whole word or full name
  if (/\bpr\b/i.test(lowerContent) || 
      lowerContent.includes('proofreader') ||
      lowerContent.includes('proof reader')) {
    return 'pr';
  }
  
  // Check for ED - more flexible matching
  if (/\bed\b/i.test(lowerContent) || 
      lowerContent.includes('editor') || 
      lowerContent.match(/^ed$/m) ||
      lowerContent.match(/position.*ed/i) ||
      lowerContent.match(/ed.*position/i)) {
    return 'ed';
  }
  
  return null;
}

// ✅ NEW: Check if message contains valid submission link
function hasValidSubmissionLink(content) {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const urls = content.match(urlRegex);
  
  if (!urls || urls.length === 0) return false;
  
  const validPlatforms = [
    'docs.google.com',
    'drive.google.com',
    'dropbox.com',
    'onedrive.live.com',
    'sharepoint.com',
    'imgur.com',
    'mediafire.com',
    'mega.nz',
    'wetransfer.com',
    'sendspace.com'
  ];
  
  return urls.some(url => 
    validPlatforms.some(platform => url.toLowerCase().includes(platform))
  );
}

async function sendTestWithTimer(channel, userId, position) {
  const test = TICKET_TESTS[position];
  if (!test) return;

  try {
    const user = await channel.client.users.fetch(userId);
    
    const testEmbed = new EmbedBuilder()
      .setColor(test.color)
      .setTitle(`${test.emoji} ${test.title}`)
      .setDescription(`${test.description}\n\n<@${userId}>`)
      .addFields(
        {
          name: '📋 Instructions',
          value: test.instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n'),
          inline: false
        },
        {
          name: '📂 Test Materials',
          value: `[Click here to access the test](${test.link})`,
          inline: false
        },
        {
          name: '⏰ Deadline',
          value: `You have **2 days (48 hours)** to complete this test.\nDeadline: <t:${Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60)}:R>`,
          inline: false
        },
        {
          name: '✅ When You\'re Done',
          value: `Mention the bot (<@${channel.client.user.id}>) with your submission link!`,
          inline: false
        }
      )
      .setFooter({ text: 'Good luck! We look forward to reviewing your work.' })
      .setTimestamp();

    await channel.send({ 
      content: `<@${userId}>`,
      embeds: [testEmbed] 
    });

    const timerId = setTimeout(async () => {
      try {
        // ✅ Warning 1 hour before final deadline
        const warningEmbed = new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle('⚠️ Test Deadline Approaching!')
          .setDescription(`<@${userId}>, you have **1 hour remaining** to submit your **${test.title}**!\n\n⏰ Please mention the bot with your submission link as soon as possible.\n\n**Don't forget to include your submission link!**`)
          .setFooter({ text: 'Time is running out!' })
          .setTimestamp();

        await channel.send({ embeds: [warningEmbed] });

        // Wait 1 hour, then send final warning
        setTimeout(async () => {
          try {
            const finalWarning = new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('🚨 Test Deadline Reached!')
              .setDescription(`<@${userId}>, the **2-day deadline** for the **${test.title}** has passed.\n\n⏰ This ticket will be **closed in 1 minute**.\n\n⚠️ If you need more time, please contact staff **immediately**!`)
              .setFooter({ text: 'Last chance!' })
              .setTimestamp();

            await channel.send({ embeds: [finalWarning] });

            setTimeout(async () => {
              try {
                if (channel && !channel.deleted && channel.deletable) {
                  await channel.send('🔒 Closing ticket due to deadline...');
                  setTimeout(() => {
                    channel.delete('Test deadline reached - auto-closed after 2 days');
                  }, 5000);
                }
              } catch (error) {
                console.error('Error closing ticket:', error);
              }
            }, 60000); // 1 minute

            activeTicketTimers.delete(channel.id);
          } catch (error) {
            console.error('Error in final warning:', error);
          }
        }, 60 * 60 * 1000); // 1 hour
      } catch (error) {
        console.error('Error in timer completion:', error);
      }
    }, (2 * 24 * 60 * 60 * 1000) - (60 * 60 * 1000)); // ✅ 2 days minus 1 hour

    activeTicketTimers.set(channel.id, {
      timerId,
      position,
      userId,
      startTime: Date.now(),
      deadlineTimestamp: Date.now() + (2 * 24 * 60 * 60 * 1000) // ✅ Store deadline
    });

    const logEmbed = new EmbedBuilder()
      .setColor(test.color)
      .setTitle('🎫 Auto-Test Sent')
      .setDescription(`**Position:** ${position.toUpperCase()}\n**User:** <@${userId}>\n**Channel:** <#${channel.id}>`)
      .addFields({ name: '⏰ Auto-close', value: 'In 2 days' })
      .setTimestamp();
    
    await sendLog(logEmbed);

    console.log(`✅ Test sent: ${position.toUpperCase()} to ${user.tag} in ${channel.name}`);
  } catch (error) {
    console.error('Error sending test:', error);
  }
}

function isTicketChannel(channel) {
  const config = loadConfig();
  
  const channelName = channel.name.toLowerCase();
  const isTicketName = channelName.includes('ticket') || 
                       channelName.includes('تذكرة') ||
                       channelName.includes('application') ||
                       channelName.startsWith('app-');
  
  const isInTicketCategory = config.ticketCategoryId && 
                             channel.parentId === config.ticketCategoryId;
  
  return isTicketName || isInTicketCategory;
}

async function sendSubmissionToReview(channel, userId, position, submissionMessage) {
  try {
    const config = loadConfig();
    const test = TICKET_TESTS[position];
    
    if (!test) return;
    
    // Ensure reviewChannels exists
    if (!config.reviewChannels) {
      console.log(`⚠️ Review channels not configured in config`);
      console.log(`💡 Add review channel IDs to .env file:`);
      console.log(`   KTL_REVIEW_CHANNEL=your_channel_id`);
      console.log(`   JTL_REVIEW_CHANNEL=your_channel_id`);
      console.log(`   PR_REVIEW_CHANNEL=your_channel_id`);
      console.log(`   ED_REVIEW_CHANNEL=your_channel_id`);
      return;
    }
    
    // Get the review channel for this position
    const reviewChannelId = config.reviewChannels[position];
    
    if (!reviewChannelId) {
      console.log(`⚠️ No review channel configured for ${position.toUpperCase()}`);
      console.log(`💡 Add to .env: ${position.toUpperCase()}_REVIEW_CHANNEL=your_channel_id`);
      return;
    }
    
    const reviewChannel = await channel.client.channels.fetch(reviewChannelId).catch(() => null);
    
    if (!reviewChannel) {
      console.log(`❌ Review channel not found: ${reviewChannelId}`);
      return;
    }
    
    const user = await channel.client.users.fetch(userId);
    
    // Create review embed
    const reviewEmbed = new EmbedBuilder()
      .setColor(test.color)
      .setTitle(`${test.emoji} New Submission - ${test.title}`)
      .setDescription(`A new test submission has been received and is ready for review!`)
      .addFields(
        {
          name: '👤 Applicant',
          value: `<@${userId}> (${user.tag})`,
          inline: true
        },
        {
          name: '📍 Position',
          value: position.toUpperCase(),
          inline: true
        },
        {
          name: '🎫 Ticket',
          value: `<#${channel.id}>`,
          inline: true
        },
        {
          name: '📥 Submission',
          value: submissionMessage.content.substring(0, 1000) || '*No message content*',
          inline: false
        },
        {
          name: '🔗 Links',
          value: `[Jump to Submission](${submissionMessage.url})\n[Go to Ticket](https://discord.com/channels/${channel.guildId}/${channel.id})`,
          inline: false
        }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: `Submitted at` })
      .setTimestamp();
    
    // Check for attachments
    if (submissionMessage.attachments.size > 0) {
      const attachments = submissionMessage.attachments.map(att => `[${att.name}](${att.url})`).join('\n');
      reviewEmbed.addFields({
        name: '📎 Attachments',
        value: attachments,
        inline: false
      });
    }
    
    // Create action buttons
    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_${userId}_${channel.id}_${position}`)
          .setLabel('✅ Accept')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${userId}_${channel.id}_${position}`)
          .setLabel('❌ Reject')
          .setStyle(ButtonStyle.Danger)
      );
    
    // Get reviewer role ID from environment
    const reviewerRoleId = process.env[`${position.toUpperCase()}_REVIEWER_ROLE`] || 
                           process.env.REVIEWER_ROLE || null;
    
    let mentionContent = `🔔 **New ${position.toUpperCase()} Submission**`;
    if (reviewerRoleId) {
     mentionContent = `🔔 **New ${position.toUpperCase()} Submission** - <@&${reviewerRoleId}>`;
    }
    
    // Send to review channel
    const reviewMessage = await reviewChannel.send({
      content: mentionContent,
      embeds: [reviewEmbed],
      components: [actionRow]
    });
    
    // Update buttons with message ID for easier access
    const updatedActionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_${userId}_${channel.id}_${position}_${reviewMessage.id}`)
          .setLabel('✅ Accept')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${userId}_${channel.id}_${position}_${reviewMessage.id}`)
          .setLabel('❌ Reject')
          .setStyle(ButtonStyle.Danger)
      );
    
    await reviewMessage.edit({ components: [updatedActionRow] });
    
    console.log(`✅ Submission sent to review channel: ${reviewChannel.name} for ${position.toUpperCase()}`);
    
    // Log to main log channel
    const logEmbed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('📤 Submission Forwarded to Review')
      .setDescription(`**Position:** ${position.toUpperCase()}\n**User:** <@${userId}>\n**Review Channel:** <#${reviewChannelId}>`)
      .setTimestamp();
    
    await sendLog(logEmbed);
    
  } catch (error) {
    console.error('Error sending submission to review:', error);
  }
}

// ==================== Bot Ready Event ====================

client.once('clientReady', () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Bot Online and Ready!`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🤖 Username: ${client.user.tag}`);
  console.log(`🆔 Client ID: ${client.user.id}`);
  console.log(`📊 Servers: ${client.guilds.cache.size}`);
  console.log(`👥 Users: ${client.users.cache.size}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🎫 Ticket System: ACTIVE ✅`);
  console.log(`⏰ Auto-close Timer: 2 days (48 hours)`);
  console.log(`🔒 Review System: ACTIVE ✅`);
  console.log(`📚 Commands: SAY, ANNOUNCE, MANGA, EMBED ✅`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const config = loadConfig();
  console.log(`\n📌 Configuration:`);
  console.log(`Log Channel: ${config.logChannelId || '⚠️ Not configured'}`);
  console.log(`Ticket Category: ${config.ticketCategoryId || 'Auto-detect'}`);
  
  // Display review channels status
  console.log(`\n📋 Review Channels:`);
  if (config.reviewChannels) {
    console.log(`   KTL: ${config.reviewChannels.ktl || '⚠️ Not configured'}`);
    console.log(`   JTL: ${config.reviewChannels.jtl || '⚠️ Not configured'}`);
    console.log(`   PR:  ${config.reviewChannels.pr || '⚠️ Not configured'}`);
    console.log(`   ED:  ${config.reviewChannels.ed || '⚠️ Not configured'}`);
  } else {
    console.log(`   ⚠️ Not configured - add to .env file`);
  }
  
  // Display reviewer roles
  console.log(`\n👥 Reviewer Roles:`);
  if (config.reviewRoles) {
    console.log(`   KTL: ${config.reviewRoles.ktl || '⚠️ Not configured'}`);
    console.log(`   JTL: ${config.reviewRoles.jtl || '⚠️ Not configured'}`);
    console.log(`   PR:  ${config.reviewRoles.pr || '⚠️ Not configured'}`);
    console.log(`   ED:  ${config.reviewRoles.ed || '⚠️ Not configured'}`);
  } else {
    console.log(`   ⚠️ Not configured - add to .env file`);
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // ✅ Set bot presence
  client.user.setPresence({
    activities: [{
      name: '📝 Test Submissions | /help',
      type: 3 // Watching
    }],
    status: 'online'
  });
});

// ==================== Command Handler ====================

client.on('interactionCreate', async (interaction) => {

  if (!isOwner(interaction.user.id)) {
    return await interaction.reply({
      content: '❌ **Access Denied** - This command is restricted to bot owners only.',
      ephemeral: true
    });
  }

  const { commandName } = interaction;

  try {
    // ==================== SAY Command ====================
    if (commandName === 'say') {
      const message = interaction.options.getString('message');
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      const sentMessage = await channel.send({
        content: message,
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
      });

      trackMessage(sentMessage.id, 'say', interaction.user.id, channel.id);

      const logEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📤 Say Command Executed')
        .setDescription(`**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n\n**Message:**\n${message.substring(0, 1000)}`)
        .addFields({ name: '🔗 Message Link', value: `[Jump to Message](${sentMessage.url})` })
        .setTimestamp();
      
      await sendLog(logEmbed);

      await interaction.reply({
        content: '✅ Message sent successfully!',
        ephemeral: true
      });
    }

    // ==================== REPLY Command ====================
    else if (commandName === 'reply') {
      const messageId = interaction.options.getString('message_id');
      const messageText = interaction.options.getString('message');

      try {
        const targetMessage = await interaction.channel.messages.fetch(messageId);
        
        const sentMessage = await targetMessage.reply({
          content: messageText,
          allowedMentions: { parse: ['everyone', 'roles', 'users'] }
        });

        trackMessage(sentMessage.id, 'reply', interaction.user.id, interaction.channel.id);

        const logEmbed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('💬 Reply Command Executed')
          .setDescription(`**Executor:** <@${interaction.user.id}>\n**Channel:** <#${interaction.channel.id}>\n\n**Reply Text:**\n${messageText.substring(0, 1000)}`)
          .addFields(
            { name: '🔗 Original Message', value: `[View Original](https://discord.com/channels/${interaction.guildId}/${interaction.channel.id}/${messageId})` },
            { name: '🔗 Reply Link', value: `[Jump to Reply](${sentMessage.url})` }
          )
          .setTimestamp();
        
        await sendLog(logEmbed);

        await interaction.reply({
          content: '✅ Reply sent successfully!',
          ephemeral: true
        });
      } catch (error) {
        await interaction.reply({
          content: '❌ Could not find the specified message. Please check the Message ID.',
          ephemeral: true
        });
      }
    }

    // ==================== ANNOUNCE Command ====================
    else if (commandName === 'announce') {
      const message = interaction.options.getString('message');
      const imageFile = interaction.options.getAttachment('image_file');
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      const payload = {
        content: message,
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
      };

      if (imageFile) {
        payload.files = [imageFile.url];
      }

      const sentMessage = await channel.send(payload);

      trackMessage(sentMessage.id, 'announce', interaction.user.id, channel.id);

      const logEmbed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('📣 Announcement Sent')
        .setDescription(`**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n\n**Message:**\n${message.substring(0, 1000)}${imageFile ? '\n\n**Image:** ✅ Attached' : ''}`)
        .addFields({ name: '🔗 Announcement Link', value: `[Jump to Announcement](${sentMessage.url})` })
        .setTimestamp();
      
      if (imageFile) {
        logEmbed.setThumbnail(imageFile.url);
      }

      await sendLog(logEmbed);

      await interaction.reply({
        content: '✅ Announcement published successfully!',
        ephemeral: true
      });
    }

    // ==================== MANGA ANNOUNCEMENT Command (With Role ID System) ====================
    else if (commandName === 'manga') {
      await interaction.deferReply({ ephemeral: true });

      const title = interaction.options.getString('title');
      const synopsis = interaction.options.getString('synopsis');
      const author = interaction.options.getString('author');
      const websiteUrl = interaction.options.getString('website_url');
      const coverImage = interaction.options.getAttachment('cover_image');
      const thumbnailImage = interaction.options.getAttachment('thumbnail');
      const mentionRole = interaction.options.getString('mention');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const notificationRoleId = interaction.options.getString('notification_role_id');
      
      const colorOption = interaction.options.getString('color') || 'default';
      const colorMap = {
        'default': 0xFF6B6B, 'red': 0xFF0000, 'orange': 0xFFA500,
        'yellow': 0xFFD700, 'green': 0x00FF00, 'blue': 0x0099FF,
        'purple': 0x9B59B6, 'pink': 0xFF69B4, 'gold': 0xFFD700
      };
      const embedColor = colorMap[colorOption] || 0xFF6B6B;

      // Validate role ID if provided
      let roleInfo = null;
      if (notificationRoleId) {
        try {
          const role = await interaction.guild.roles.fetch(notificationRoleId);
          if (role) {
            roleInfo = { id: role.id, name: role.name };
          } else {
            return await interaction.editReply({ content: '❌ Invalid Role ID! Please check and try again.' });
          }
        } catch (error) {
          return await interaction.editReply({ content: '❌ Could not find the role with that ID!' });
        }
      }

      // ── DEFINITIVE single manga embed ────────────────────────────────────
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // ── Try to generate cinematic card image ─────────────────────────────
      let cardBuffer = null;
      if (generateSingleCard) {
        try {
          // Convert hex color → [R, G, B]
          const hex = embedColor.toString(16).padStart(6, '0');
          const accentRgb = [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ];
          cardBuffer = await generateSingleCard({
            title,
            author,
            synopsis,
            coverUrl:   coverImage ? coverImage.url : null,
            accent:     accentRgb,
            date:       dateStr,
            status:     'ONGOING',
            translator: 'EZ TEAM',
            type:       'MANGA',
          });
        } catch (e) { console.warn('Card gen failed:', e.message); }
      }

      const mangaEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: `𝔈𝔷 𝔐𝔞𝔫𝔤𝔞  ✦  𝔑𝔢𝔴 𝔖𝔢𝔯𝔦𝔢𝔰` })
        .setTitle(title)
        .setDescription(
          `> *${synopsis}*\n\n` +
          `\`📖 Manga\`  \`🟢 Ongoing\`  \`✦ New Series\``
        )
        .addFields(
          { name: '✦ Author',   value: `\`${author}\``,  inline: true },
          { name: '◉ Status',   value: '🟢 **Ongoing**',  inline: true },
          { name: '🗓 Released', value: `\`${dateStr}\``, inline: true }
        )
        .setFooter({ text: `EZ Manga Translation Team  ·  ${dateStr}` })
        .setTimestamp();

      // ✅ Permanent images via attachment://
      const payloadFiles = [];
      if (cardBuffer) {
        // Card image takes priority as the main image
        payloadFiles.push({ attachment: cardBuffer, name: 'card.png' });
        mangaEmbed.setImage('attachment://card.png');
      } else if (coverImage) {
        payloadFiles.push({ attachment: coverImage.url, name: 'cover.jpg' });
        mangaEmbed.setImage('attachment://cover.jpg');
      }
      if (thumbnailImage && !cardBuffer) {
        payloadFiles.push({ attachment: thumbnailImage.url, name: 'thumb.jpg' });
        mangaEmbed.setThumbnail('attachment://thumb.jpg');
      }

      // Create action buttons
      const buttons = new ActionRowBuilder();
      if (websiteUrl) {
        buttons.addComponents(
          new ButtonBuilder().setLabel('📖 Read Now').setStyle(ButtonStyle.Link).setURL(websiteUrl)
        );
      }
      buttons.addComponents(
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary)
      );
      if (notificationRoleId) {
        buttons.addComponents(
          new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId('subscribe_temp').setStyle(ButtonStyle.Primary)
        );
      }
      // Edit button — always present (owner-only, enforced in handler)
      buttons.addComponents(
        new ButtonBuilder().setLabel('✏️ Edit').setCustomId(`edit_manga_temp`).setStyle(ButtonStyle.Secondary)
      );

      const payload = { embeds: [mangaEmbed], components: [buttons], files: payloadFiles };
      if (mentionRole) {
        payload.content = mentionRole;
        payload.allowedMentions = { parse: ['everyone', 'roles', 'users'] };
      }

      const sentMessage = await channel.send(payload);
      trackMessage(sentMessage.id, 'manga', interaction.user.id, channel.id, notificationRoleId);

      // ✅ FIX: Update button with real message ID — preserve embed to avoid timestamp reset
      const updatedButtons = new ActionRowBuilder();
      if (websiteUrl) {
        updatedButtons.addComponents(
          new ButtonBuilder().setLabel('📖 Read Now').setStyle(ButtonStyle.Link).setURL(websiteUrl)
        );
      }
      updatedButtons.addComponents(
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary)
      );
      if (notificationRoleId) {
        updatedButtons.addComponents(
          new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId(`subscribe_${sentMessage.id}`).setStyle(ButtonStyle.Primary)
        );
      }
      updatedButtons.addComponents(
        new ButtonBuilder().setLabel('✏️ Edit').setCustomId(`edit_manga_${sentMessage.id}`).setStyle(ButtonStyle.Secondary)
      );
      // Only update components, embeds stay untouched → timestamp preserved ✅
      await sentMessage.edit({ components: [updatedButtons] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📚 Manga Announcement Created')
        .setDescription(`**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n\n**Title:** ${title}\n**Author:** ${author}${roleInfo ? `\n**Notification Role:** <@&${roleInfo.id}> (${roleInfo.name})` : ''}`)
        .addFields({ name: '🔗 Announcement Link', value: `[Jump to Announcement](${sentMessage.url})` })
        .setTimestamp();

      await sendLog(logEmbed);
      await interaction.editReply({
        content: `✅ Manga announcement published successfully!${roleInfo ? `\n🔔 Notification role: <@&${roleInfo.id}>` : ''}`
      });
    }

    // ==================== MULTI-MANGA Command (Multiple Works, One Announcement) ====================
    else if (commandName === 'multimanga') {
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const mentionRole = interaction.options.getString('mention');
      const headerTitle = interaction.options.getString('header_title') || '✨ New Projects Announcement!';
      const notificationRoleId = interaction.options.getString('notification_role_id');

      const colorOption = interaction.options.getString('color') || 'default';
      const colorMap = {
        'default': 0xFF6B6B, 'red': 0xFF0000, 'orange': 0xFFA500,
        'yellow': 0xFFD700, 'green': 0x00FF00, 'blue': 0x0099FF,
        'purple': 0x9B59B6, 'pink': 0xFF69B4, 'gold': 0xFFD700
      };
      const embedColor = colorMap[colorOption] || 0xFF6B6B;

      // Validate notification role
      let roleInfo = null;
      if (notificationRoleId) {
        try {
          const role = await interaction.guild.roles.fetch(notificationRoleId);
          if (role) roleInfo = { id: role.id, name: role.name };
        } catch (_) {}
      }

      // ── Collect all manga entries ─────────────────────────────────────────
      const works = [];
      for (let i = 1; i <= 4; i++) {
        const t = interaction.options.getString(`manga${i}_title`);
        if (!t) continue; // skip empty slots
        works.push({
          title:    t,
          synopsis: interaction.options.getString(`manga${i}_synopsis`) || '',
          author:   interaction.options.getString(`manga${i}_author`)   || '',
          url:      interaction.options.getString(`manga${i}_url`)      || null,
          cover:    interaction.options.getAttachment(`manga${i}_cover`) || null,
        });
      }

      if (works.length === 0) {
        return await interaction.editReply({ content: '❌ You need to fill in at least one manga title!' });
      }

      // ── DEFINITIVE embed design ───────────────────────────────────────────
      const payloadFiles = [];
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // ── Try cinematic card generation ─────────────────────────────────────
      let multiCardBuffer = null;
      if (generateMultiCard) {
        try {
          multiCardBuffer = await generateMultiCard({
            works,
            headerTitle,
            date: dateStr,
          });
        } catch (e) { console.warn('Multi card gen failed:', e.message); }
      }
      if (multiCardBuffer) payloadFiles.push({ attachment: multiCardBuffer, name: 'announcement.png' });

      const palette = [
        { color: 0xE8001D, num: '➊', label: 'SERIES 01' },
        { color: 0x3B82F6, num: '➋', label: 'SERIES 02' },
        { color: 0xF59E0B, num: '➌', label: 'SERIES 03' },
        { color: 0x22C55E, num: '➍', label: 'SERIES 04' },
      ];

      // ── Header embed ─────────────────────────────────────────────────────
      const headerLines = works
        .map((w, i) => {
          const p = palette[i];
          return `  ${p.num}  **${w.title}**\n     ▸ *${w.author || 'Unknown'}*`;
        })
        .join('\n\n');

      const headerEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: `𝔈𝔷 𝔐𝔞𝔫𝔤𝔞  ✦  𝔑𝔢𝔴 𝔖𝔢𝔯𝔦𝔢𝔰` })
        .setTitle(headerTitle)
        .setDescription(
          `╔══════════════════════════╗\n` +
          `${headerLines}\n` +
          `╚══════════════════════════╝\n` +
          `\`📚 ${works.length} Series  ·  Available Now  ·  ${dateStr}\``
        )
        .setFooter({ text: `EZ Manga Translation Team  ·  Read free on EZ Manga` })
        .setTimestamp();

      if (multiCardBuffer) headerEmbed.setImage('attachment://announcement.png');

      const allEmbeds = [headerEmbed];

      // ── Per-work embeds ───────────────────────────────────────────────────
      for (let i = 0; i < works.length; i++) {
        const w   = works[i];
        const p   = palette[i % palette.length];
        const coverName = `cover${i + 1}.jpg`;

        // Genre tags line — shown as `inline code pills`
        const genreTag = `\`📖 Manga\``;

        const workEmbed = new EmbedBuilder()
          .setColor(p.color)
          .setAuthor({ name: `${p.num} ${p.label}  ◈  EZ MANGA` })
          .setTitle(w.title)
          .setDescription(
            `> *${w.synopsis || 'No synopsis provided.'}*\n\n` +
            `${genreTag}  \`🟢 Ongoing\`  \`✦ New Series\``
          )
          .addFields(
            { name: '✦ Author',  value: w.author ? `\`${w.author}\`` : '`—`', inline: true },
            { name: '◉ Status',  value: '🟢 **Ongoing**',                      inline: true },
            { name: '🗓 Released', value: `\`${dateStr}\``,                    inline: true }
          )
          .setFooter({ text: `EZ Manga  ·  Tap Read Now to start` });

        if (w.cover) {
          payloadFiles.push({ attachment: w.cover.url, name: coverName });
          workEmbed.setImage(`attachment://${coverName}`);
        }

        allEmbeds.push(workEmbed);
      }

      // ── Build buttons ─────────────────────────────────────────────────────
      const buttonRows = [];

      // Read Now buttons (one row, one button per work that has a URL)
      const readButtons = new ActionRowBuilder();
      let hasReadButtons = false;
      for (let i = 0; i < works.length; i++) {
        if (works[i].url) {
          readButtons.addComponents(
            new ButtonBuilder()
              .setLabel(`📖 ${works[i].title}`)
              .setStyle(ButtonStyle.Link)
              .setURL(works[i].url)
          );
          hasReadButtons = true;
        }
      }
      if (hasReadButtons) buttonRows.push(readButtons);

      // Action buttons row
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary)
      );
      if (notificationRoleId) {
        actionRow.addComponents(
          new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId('subscribe_temp').setStyle(ButtonStyle.Primary)
        );
      }
      actionRow.addComponents(
        new ButtonBuilder().setLabel('✏️ Edit').setCustomId(`edit_manga_temp`).setStyle(ButtonStyle.Secondary)
      );
      buttonRows.push(actionRow);

      // ── Send message ──────────────────────────────────────────────────────
      const payload = {
        embeds: allEmbeds,
        components: buttonRows,
        files: payloadFiles
      };
      if (mentionRole) {
        payload.content = mentionRole;
        payload.allowedMentions = { parse: ['everyone', 'roles', 'users'] };
      }

      const sentMessage = await channel.send(payload);
      trackMessage(sentMessage.id, 'manga', interaction.user.id, channel.id, notificationRoleId);

      // ✅ Fix buttons with real message ID — only edit components
      const updatedActionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary)
      );
      if (notificationRoleId) {
        updatedActionRow.addComponents(
          new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId(`subscribe_${sentMessage.id}`).setStyle(ButtonStyle.Primary)
        );
      }
      updatedActionRow.addComponents(
        new ButtonBuilder().setLabel('✏️ Edit').setCustomId(`edit_manga_${sentMessage.id}`).setStyle(ButtonStyle.Secondary)
      );
      const updatedRows = hasReadButtons ? [readButtons, updatedActionRow] : [updatedActionRow];
      await sentMessage.edit({ components: updatedRows }); // embeds untouched → timestamp safe ✅

      const logEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('📚 Multi-Manga Announcement Created')
        .setDescription(
          `**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n` +
          `**Works:** ${works.map(w => w.title).join(', ')}` +
          (roleInfo ? `\n**Notification Role:** <@&${roleInfo.id}>` : '')
        )
        .addFields({ name: '🔗 Announcement Link', value: `[Jump to Announcement](${sentMessage.url})` })
        .setTimestamp();
      await sendLog(logEmbed);

      await interaction.editReply({
        content: `✅ Multi-manga announcement published! (${works.length} work${works.length > 1 ? 's' : ''})${roleInfo ? `\n🔔 Notification role: <@&${roleInfo.id}>` : ''}`
      });
    }

    // ==================== QUICK MANGA Command (Auto-scrape from EZ Manga URL) ====================
    else if (commandName === 'quickmanga') {
      await interaction.deferReply({ ephemeral: true });

      const seriesUrl          = interaction.options.getString('url').trim();
      const mentionRole        = interaction.options.getString('mention');
      const notificationRoleId = interaction.options.getString('notification_role_id');
      const colorOption        = interaction.options.getString('color') || 'red';
      const channel            = interaction.options.getChannel('channel') || interaction.channel;

      const colorMap = {
        red: 0xE8001D, blue: 0x3B82F6, gold: 0xF59E0B, green: 0x22C55E, purple: 0x9B59B6,
      };
      const embedColor = colorMap[colorOption] || 0xE8001D;

      let roleInfo = null;
      if (notificationRoleId) {
        try {
          const role = await interaction.guild.roles.fetch(notificationRoleId);
          if (role) roleInfo = { id: role.id, name: role.name };
        } catch (_) {}
      }

      await interaction.editReply({ content: '🔍 Fetching series data from EZ Manga...' });

      let scraped;
      try {
        scraped = await scrapeSeriesPage(seriesUrl);
      } catch (err) {
        return await interaction.editReply({
          content: `❌ **Could not fetch series data**\n\`${err.message}\`\n\nMake sure the URL is a valid EZ Manga series page:\`https://ezmanga.org/series/...\``,
        });
      }

      const { title, synopsis, author, genres, status, coverUrl, chapterCount } = scraped;
      const dateStr   = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const genreStr  = genres.length ? genres.slice(0, 4).map(g => `\`${g}\``).join('  ') : '`Manga`';
      const statusIcon = status === 'Completed' ? '✅' : status === 'Hiatus' ? '⏸️' : '🟢';

      // ── Try cinematic card ────────────────────────────────────────────────
      const payloadFiles = [];
      let cardBuffer = null;
      if (generateSingleCard) {
        try {
          const hex = embedColor.toString(16).padStart(6, '0');
          cardBuffer = await generateSingleCard({
            title,
            author:     author || '—',
            synopsis:   synopsis || '',
            genres:     genres.slice(0, 3),
            coverUrl:   coverUrl || null,
            accent:     [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)],
            date:       dateStr,
            status:     status.toUpperCase(),
            translator: 'EZ TEAM',
            type:       'MANGA',
          });
        } catch (e) { console.warn('Card gen failed:', e.message); }
      }

      // ── Build embed ───────────────────────────────────────────────────────
      const mangaEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: `𝔈𝔷 𝔐𝔞𝔫𝔤𝔞  ✦  𝔑𝔢𝔴 𝔖𝔢𝔯𝔦𝔢𝔰` })
        .setTitle(title)
        .setURL(scraped.seriesUrl)
        .setDescription(
          synopsis
            ? `> *${synopsis.substring(0, 350)}${synopsis.length > 350 ? '...' : ''}*\n\n${genreStr}`
            : genreStr
        )
        .addFields(
          { name: '✦ Author',   value: author ? `\`${author}\`` : '`—`',    inline: true },
          { name: '◉ Status',   value: `${statusIcon} **${status}**`,        inline: true },
          { name: '🗓 Released', value: `\`${dateStr}\``,                     inline: true },
        )
        .setFooter({ text: `EZ Manga Translation Team  ·  ${dateStr}` })
        .setTimestamp();

      if (chapterCount) {
        mangaEmbed.addFields({ name: '📚 Chapters', value: `\`${chapterCount}\``, inline: true });
      }

      if (cardBuffer) {
        payloadFiles.push({ attachment: cardBuffer, name: 'card.png' });
        mangaEmbed.setImage('attachment://card.png');
      } else if (coverUrl) {
        payloadFiles.push({ attachment: coverUrl, name: 'cover.jpg' });
        mangaEmbed.setImage('attachment://cover.jpg');
      }

      // ── Buttons ───────────────────────────────────────────────────────────
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('📖 Read Now').setStyle(ButtonStyle.Link).setURL(scraped.seriesUrl),
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary),
      );
      if (roleInfo) {
        buttons.addComponents(new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId('subscribe_temp').setStyle(ButtonStyle.Primary));
      }
      buttons.addComponents(new ButtonBuilder().setLabel('✏️ Edit').setCustomId('edit_manga_temp').setStyle(ButtonStyle.Secondary));

      const payload = { embeds: [mangaEmbed], components: [buttons], files: payloadFiles };
      if (mentionRole) {
        payload.content = mentionRole;
        payload.allowedMentions = { parse: ['everyone', 'roles', 'users'] };
      }

      const sentMessage = await channel.send(payload);
      trackMessage(sentMessage.id, 'manga', interaction.user.id, channel.id, notificationRoleId);

      // ── Update button IDs with real message ID ────────────────────────────
      const updatedButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('📖 Read Now').setStyle(ButtonStyle.Link).setURL(scraped.seriesUrl),
        new ButtonBuilder().setLabel('⭐ Add to Favorites').setCustomId('add_favorite').setStyle(ButtonStyle.Secondary),
      );
      if (roleInfo) {
        updatedButtons.addComponents(new ButtonBuilder().setLabel('🔔 Get Notifications').setCustomId(`subscribe_${sentMessage.id}`).setStyle(ButtonStyle.Primary));
      }
      updatedButtons.addComponents(new ButtonBuilder().setLabel('✏️ Edit').setCustomId(`edit_manga_${sentMessage.id}`).setStyle(ButtonStyle.Secondary));
      await sentMessage.edit({ components: [updatedButtons] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🔗 Quick Manga — Auto-Scraped')
        .setDescription(
          `**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n` +
          `**Title:** ${title}\n**Author:** ${author || '—'}\n**Status:** ${status}\n**Source:** ${scraped.seriesUrl}` +
          (roleInfo ? `\n**Role:** <@&${roleInfo.id}>` : '')
        )
        .addFields({ name: '🔗 Announcement', value: `[Jump](${sentMessage.url})` })
        .setTimestamp();
      await sendLog(logEmbed);

      await interaction.editReply({
        content: [
          `✅ **Announcement published!**`,
          `📌 **${title}**`,
          `✍️ ${author || '—'}  ·  ${statusIcon} ${status}${chapterCount ? `  ·  📚 ${chapterCount} chapters` : ''}`,
          ``,
          `[Jump to Announcement](${sentMessage.url})`,
        ].join('\n'),
      });
    }

    // ==================== UPDATE MANGA Command ====================
    else if (commandName === 'updatemanga') {
      await interaction.deferReply({ ephemeral: true });

      const messageId  = interaction.options.getString('message_id');
      const newTitle   = interaction.options.getString('title');
      const newSynopsis= interaction.options.getString('synopsis');
      const newAuthor  = interaction.options.getString('author');
      const channelOpt = interaction.options.getChannel('channel') || interaction.channel;

      try {
        const targetMsg = await channelOpt.messages.fetch(messageId);
        if (!targetMsg || targetMsg.author.id !== client.user.id) {
          return await interaction.editReply({ content: '❌ Message not found or not sent by the bot.' });
        }

        const oldEmbed = targetMsg.embeds[0];
        if (!oldEmbed) return await interaction.editReply({ content: '❌ No embed found in that message.' });

        const updatedEmbed = EmbedBuilder.from(oldEmbed);
        if (newTitle)    updatedEmbed.setTitle(`✨ ${newTitle}`);
        if (newSynopsis) updatedEmbed.setDescription(newSynopsis);
        if (newAuthor) {
          // Update author field inside embed fields
          const fields = (oldEmbed.fields || []).map(f =>
            f.name === '📚 Author' ? { ...f, value: newAuthor } : f
          );
          updatedEmbed.setFields(fields);
          // Update footer too
          const currentFooter = oldEmbed.footer?.text || '';
          const newFooter = currentFooter.replace(/^Published by .+? •/, `Published by ${newAuthor} •`);
          updatedEmbed.setFooter({ text: newFooter });
        }

        await targetMsg.edit({ embeds: [updatedEmbed] });

        const logEmbed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('✏️ Manga Announcement Updated')
          .setDescription(
            `**Editor:** <@${interaction.user.id}>\n**Message:** [Jump](${targetMsg.url})\n\n` +
            (newTitle    ? `**New Title:** ${newTitle}\n` : '') +
            (newSynopsis ? `**New Synopsis:** ${newSynopsis.substring(0, 200)}\n` : '') +
            (newAuthor   ? `**New Author:** ${newAuthor}` : '')
          )
          .setTimestamp();
        await sendLog(logEmbed);

        await interaction.editReply({ content: '✅ Announcement updated successfully!' });
      } catch (err) {
        console.error('updatemanga error:', err);
        await interaction.editReply({ content: '❌ Could not find the message. Make sure the Message ID and channel are correct.' });
      }
    }

    // ==================== EMBED Command ====================
    else if (commandName === 'embed') {
      await interaction.deferReply({ ephemeral: true });

      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const url = interaction.options.getString('url');
      const imageAttachment = interaction.options.getAttachment('image');
      const thumbnailAttachment = interaction.options.getAttachment('thumbnail');
      const colorInput = interaction.options.getString('color');
      const footer = interaction.options.getString('footer');
      const authorName = interaction.options.getString('author_name');
      const authorIcon = interaction.options.getAttachment('author_icon');
      const mentions = interaction.options.getString('mentions');
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description);

      if (url) {
        embed.setURL(url);
      }

      // Handle color
      if (colorInput) {
        const cleanColor = colorInput.trim().replace('#', '');
        if (/^[0-9A-Fa-f]{6}$/.test(cleanColor)) {
          embed.setColor(parseInt(cleanColor, 16));
        } else {
          embed.setColor(0x5865F2);
        }
      } else {
        embed.setColor(0x5865F2);
      }

      // Add images
      if (imageAttachment) {
        embed.setImage(imageAttachment.url);
      }

      if (thumbnailAttachment) {
        embed.setThumbnail(thumbnailAttachment.url);
      }

      // Add author
      if (authorName) {
        const authorObj = { name: authorName };
        if (authorIcon) {
          authorObj.iconURL = authorIcon.url;
        }
        embed.setAuthor(authorObj);
      }

      // Add footer
      if (footer) {
        embed.setFooter({ text: footer });
      }

      embed.setTimestamp();

      const payload = {
        embeds: [embed]
      };

      if (mentions) {
        payload.content = mentions;
        payload.allowedMentions = { parse: ['everyone', 'roles', 'users'] };
      }

      const sentMessage = await channel.send(payload);

      trackMessage(sentMessage.id, 'embed', interaction.user.id, channel.id);

      const logEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎨 Embed Message Sent')
        .setDescription(`**Executor:** <@${interaction.user.id}>\n**Channel:** <#${channel.id}>\n\n**Title:** ${title}\n**Description:** ${description.substring(0, 500)}...`)
        .addFields({ name: '🔗 Embed Link', value: `[Jump to Embed](${sentMessage.url})` })
        .setTimestamp();
      
      if (imageAttachment) {
        logEmbed.setThumbnail(imageAttachment.url);
      }

      await sendLog(logEmbed);

      await interaction.editReply({
        content: '✅ Embed message sent successfully!'
      });
    }

    // ==================== Owner Management Commands ====================
    else if (commandName === 'addowner') {
      if (interaction.user.id !== MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ Only the main owner can add additional owners.',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('user');
      const owners = loadOwners();

      if (targetUser.id === MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ This user is already the main owner.',
          ephemeral: true
        });
      }

      if (owners.includes(targetUser.id)) {
        return await interaction.reply({
          content: `❌ **${targetUser.tag}** is already an owner.`,
          ephemeral: true
        });
      }

      owners.push(targetUser.id);
      saveOwners(owners);

      await interaction.reply({
        content: `✅ Successfully added **${targetUser.tag}** as a bot owner.`,
        ephemeral: true
      });
    }

    else if (commandName === 'removeowner') {
      if (interaction.user.id !== MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ Only the main owner can remove owners.',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('user');
      let owners = loadOwners();

      if (!owners.includes(targetUser.id)) {
        return await interaction.reply({
          content: `❌ **${targetUser.tag}** is not a bot owner.`,
          ephemeral: true
        });
      }

      owners = owners.filter(id => id !== targetUser.id);
      saveOwners(owners);

      await interaction.reply({
        content: `✅ Successfully removed **${targetUser.tag}** from bot owners.`,
        ephemeral: true
      });
    }

    else if (commandName === 'listowners') {
      const owners = loadOwners();
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('👑 Bot Owners List')
        .setDescription('Here are all the users with owner permissions:')
        .addFields(
          { name: '⭐ Main Owner', value: `<@${MAIN_OWNER_ID}> \`(${MAIN_OWNER_ID})\`` }
        )
        .setTimestamp();

      if (owners.length > 0) {
        const ownersList = owners.map((id, index) => `${index + 1}. <@${id}> \`(${id})\``).join('\n');
        embed.addFields({ 
          name: `📋 Additional Owners (${owners.length})`, 
          value: ownersList 
        });
      } else {
        embed.addFields({ 
          name: '📋 Additional Owners', 
          value: '_No additional owners configured_' 
        });
      }

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    else if (commandName === 'setlogchannel') {
      if (interaction.user.id !== MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ Only the main owner can configure the log channel.',
          ephemeral: true
        });
      }

      const channel = interaction.options.getChannel('channel');
      
      if (channel.type !== ChannelType.GuildText) {
        return await interaction.reply({
          content: '❌ Please select a text channel.',
          ephemeral: true
        });
      }

      const config = loadConfig();
      config.logChannelId = channel.id;
      saveConfig(config);

      await interaction.reply({
        content: `✅ Log channel successfully set to <#${channel.id}>`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Log Channel Updated')
        .setDescription(`Log channel has been configured to <#${channel.id}> by <@${interaction.user.id}>`)
        .setTimestamp();
      
      await sendLog(logEmbed);
    }

    else if (commandName === 'setticketcategory') {
      if (interaction.user.id !== MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ Only the main owner can configure the ticket category.',
          ephemeral: true
        });
      }

      const category = interaction.options.getChannel('category');
      
      if (category.type !== ChannelType.GuildCategory) {
        return await interaction.reply({
          content: '❌ Please select a category channel.',
          ephemeral: true
        });
      }

      const config = loadConfig();
      config.ticketCategoryId = category.id;
      saveConfig(config);

      await interaction.reply({
        content: `✅ Ticket category set to **${category.name}**\n\n🎫 All channels in this category will have auto-responses enabled for:\n• KTL - Korean Translator\n• JTL - Japanese Translator\n• PR - Proofreader\n• ED - Editor`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🎫 Ticket Category Updated')
        .setDescription(`Ticket category configured to **${category.name}** by <@${interaction.user.id}>`)
        .setTimestamp();
      
      await sendLog(logEmbed);
    }

    else if (commandName === 'setreviewchannel') {
      if (interaction.user.id !== MAIN_OWNER_ID) {
        return await interaction.reply({
          content: '❌ Only the main owner can configure review channels.',
          ephemeral: true
        });
      }

      const position = interaction.options.getString('position');
      const channel = interaction.options.getChannel('channel');
      
      if (channel.type !== ChannelType.GuildText) {
        return await interaction.reply({
          content: '❌ Please select a text channel.',
          ephemeral: true
        });
      }

      const config = loadConfig();
      if (!config.reviewChannels) {
        config.reviewChannels = { ktl: null, jtl: null, pr: null, ed: null };
      }
      config.reviewChannels[position] = channel.id;
      saveConfig(config);

      const positionNames = {
        ktl: '🇰🇷 Korean Translator (KTL)',
        jtl: '🇯🇵 Japanese Translator (JTL)',
        pr: '📖 Proofreader (PR)',
        ed: '🎨 Editor (ED)'
      };

      await interaction.reply({
        content: `✅ Review channel for **${positionNames[position]}** set to <#${channel.id}>\n\nAll ${position.toUpperCase()} submissions will be automatically forwarded to this channel!`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📋 Review Channel Updated')
        .setDescription(`**Position:** ${position.toUpperCase()}\n**Channel:** <#${channel.id}>\n**Set by:** <@${interaction.user.id}>`)
        .setTimestamp();
      
      await sendLog(logEmbed);
    }

  } catch (error) {
    console.error('Command execution error:', error);
    
    const errorMessage = {
      content: '❌ An error occurred while executing this command. Please try again.',
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
  
  // ==================== MODAL/FORM SUBMISSION HANDLER (TICKET FORMS) ====================
  
  // Handle Modal/Form Submissions from Ticket Systems
  if (interaction.isModalSubmit()) {
    // Handle rejection reason modal
    if (interaction.customId.startsWith('reject_reason_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[2];
      const ticketChannelId = parts[3];
      const position = parts[4];
      const messageId = parts[5];
      
      const reason = interaction.fields.getTextInputValue('rejection_reason');
      
      try {
        // Acknowledge the modal immediately
        await interaction.deferReply({ ephemeral: true });
        
        // Get applicant and ticket channel
        const applicant = await interaction.client.users.fetch(userId);
        const ticketChannel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
        
        // Get the review message
        const config = loadConfig();
        const reviewChannelId = config.reviewChannels?.[position];
        
        if (reviewChannelId && messageId) {
          const reviewChannel = await interaction.client.channels.fetch(reviewChannelId).catch(() => null);
          
          if (reviewChannel) {
            const submissionMessage = await reviewChannel.messages.fetch(messageId).catch(() => null);
            
            if (submissionMessage && submissionMessage.embeds[0]) {
              // Update review message
              const rejectedEmbed = EmbedBuilder.from(submissionMessage.embeds[0])
                .setColor(0xFF0000)
                .setTitle(`${submissionMessage.embeds[0].title} - ❌ REJECTED`)
                .addFields(
                  {
                    name: '❌ Reviewed By',
                    value: `<@${interaction.user.id}>`,
                    inline: true
                  },
                  {
                    name: '📝 Rejection Reason',
                    value: reason.substring(0, 1024),
                    inline: false
                  }
                );
              
              await submissionMessage.edit({
                embeds: [rejectedEmbed],
                components: [] // Remove buttons
              });
            }
          }
        }
        
        // Send rejection message to applicant in ticket
        if (ticketChannel && ticketChannel.isTextBased()) {
          const rejectEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Test Not Accepted')
            .setDescription(`<@${userId}>, thank you for taking the time to complete the **${position.toUpperCase()}** test.\n\nUnfortunately, your submission has not been accepted at this time.\n\n⏰ This ticket will automatically close in **20 hours**.`)
            .addFields({
              name: '📝 Feedback',
              value: reason,
              inline: false
            })
            .setFooter({ text: 'Feel free to apply again in the future! • Reviewed by ' + interaction.user.tag })
            .setTimestamp();
          
          await ticketChannel.send({ embeds: [rejectEmbed] });
          
          // Schedule ticket closure after 20 hours
          setTimeout(async () => {
            try {
              const finalChannel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
              if (finalChannel && finalChannel.deletable) {
                const closeEmbed = new EmbedBuilder()
                  .setColor(0xFFA500)
                  .setTitle('🔒 Ticket Closing')
                  .setDescription('This ticket has been automatically closed after test review.')
                  .setTimestamp();
                
                await finalChannel.send({ embeds: [closeEmbed] }).catch(() => {});
                
                // Wait 10 seconds then delete
                setTimeout(async () => {
                  await finalChannel.delete().catch((err) => {
                    console.log(`Could not delete ticket: ${err.message}`);
                  });
                }, 10000);
                
                console.log(`🔒 Auto-closed rejected ticket: ${finalChannel.name}`);
              }
            } catch (error) {
              console.error('Error auto-closing rejected ticket:', error);
            }
          }, 20 * 60 * 60 * 1000); // 5 hours
        }
        
        // Log the rejection
        const logEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ Test Rejected')
          .setDescription(`**Position:** ${position.toUpperCase()}\n**Applicant:** <@${userId}>\n**Reviewer:** <@${interaction.user.id}>\n**Reason:** ${reason.substring(0, 200)}`)
          .setTimestamp();
        
        await sendLog(logEmbed);
        
        console.log(`❌ ${position.toUpperCase()} test rejected for ${applicant.tag} by ${interaction.user.tag}`);
        
        // Confirm to reviewer
        await interaction.editReply({
          content: '✅ Rejection submitted successfully! The applicant has been notified.'
        });
        
      } catch (error) {
        console.error('Error handling rejection:', error);
        await interaction.editReply({
          content: '❌ An error occurred while processing the rejection.'
        }).catch(() => {});
      }
      return;
    }
    
    // Handle ticket form submissions
    try {
      console.log(`📝 Modal submitted: ${interaction.customId}`);
      
      // Check if we're in a ticket channel
      if (!isTicketChannel(interaction.channel)) {
        console.log('⚠️ Not in ticket channel, ignoring modal');
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      
      // Check if test already sent
      if (activeTicketTimers.has(interaction.channel.id)) {
        console.log('⚠️ Test already sent in this ticket');
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      
      // Get all form field values
      let allFormText = '';
      
      // Collect all field values
      interaction.fields.fields.forEach((field) => {
        allFormText += field.value + ' ';
      });
      
      console.log(`📋 Form content: ${allFormText.substring(0, 200)}`);
      
      // Detect position from form content
      const position = detectPosition(allFormText);
      
      if (position) {
        console.log(`✅ DETECTED POSITION: ${position.toUpperCase()}`);
        
        // Acknowledge the modal
        await interaction.deferUpdate().catch(() => {});
        
        // Send test with small delay (let the ticket system finish first)
        setTimeout(async () => {
          console.log(`📤 Sending ${position.toUpperCase()} test...`);
          await sendTestWithTimer(interaction.channel, interaction.user.id, position);
        }, 2000);
        
        return;
      } else {
        console.log('⚠️ No position detected in form');
      }
      
      // If no position detected, just acknowledge
      await interaction.deferUpdate().catch(() => {});
    } catch (error) {
      console.error('Modal submit handling error:', error);
      try {
        await interaction.deferUpdate().catch(() => {});
      } catch (e) {}
    }
  }
  
  // Handle String Select Menus (Dropdown selections)
  if (interaction.isStringSelectMenu()) {
    try {
      console.log(`📋 Dropdown selected: ${interaction.customId}`);
      
      // Check if in ticket channel
      if (!isTicketChannel(interaction.channel)) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      
      // Check if test already sent
      if (activeTicketTimers.has(interaction.channel.id)) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      
      // Get selected values
      const selectedValues = interaction.values.join(' ');
      console.log(`📋 Selection: ${selectedValues}`);
      
      // Detect position
      const position = detectPosition(selectedValues);
      
      if (position) {
        console.log(`✅ DETECTED from dropdown: ${position.toUpperCase()}`);
        
        await interaction.deferUpdate().catch(() => {});
        
        setTimeout(async () => {
          await sendTestWithTimer(interaction.channel, interaction.user.id, position);
        }, 2000);
        
        return;
      }
      
      await interaction.deferUpdate().catch(() => {});
    } catch (error) {
      console.error('Select menu handling error:', error);
      try {
        await interaction.deferUpdate().catch(() => {});
      } catch (e) {}
    }
  }
});

// ==================== Button Interaction Handler (Role Assignment by ID) ====================

client.on('interactionCreate', async (interaction) => {
  // ── Edit Manga Modal Submit ──────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_manga_modal_')) {
    const messageId  = interaction.customId.replace('edit_manga_modal_', '');
    const newTitle   = interaction.fields.getTextInputValue('edit_title').trim();
    const newSynopsis= interaction.fields.getTextInputValue('edit_synopsis').trim();
    const newAuthor  = interaction.fields.getTextInputValue('edit_author').trim();

    try {
      await interaction.deferReply({ ephemeral: true });
      const targetMsg = await interaction.channel.messages.fetch(messageId);
      const oldEmbed  = targetMsg.embeds[0];
      if (!oldEmbed) return await interaction.editReply({ content: '❌ Could not find the embed.' });

      const updatedEmbed = EmbedBuilder.from(oldEmbed);
      if (newTitle)    updatedEmbed.setTitle(newTitle);
      if (newSynopsis) {
        // Preserve genre pills line if present
        const oldDesc    = oldEmbed.description || '';
        const pillsLine  = oldDesc.match(/(\n\n`[^\n]+`.*$)/s);
        updatedEmbed.setDescription(
          `> *${newSynopsis}*` + (pillsLine ? pillsLine[0] : '')
        );
      }
      if (newAuthor) {
        const fields = (oldEmbed.fields || []).map(f =>
          f.name === '✦ Author' ? { ...f, value: `\`${newAuthor}\`` } : f
        );
        updatedEmbed.setFields(fields);
        const currentFooter = oldEmbed.footer?.text || '';
        const newFooter = currentFooter.replace(/^EZ Manga.*/, `EZ Manga Translation Team  ·  ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
        updatedEmbed.setFooter({ text: newFooter });
      }

      await targetMsg.edit({ embeds: [updatedEmbed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('✏️ Manga Updated via Edit Button')
        .setDescription(`**Editor:** <@${interaction.user.id}>\n**Message:** [Jump](${targetMsg.url})\n${newTitle ? `**New Title:** ${newTitle}\n` : ''}${newAuthor ? `**New Author:** ${newAuthor}` : ''}`)
        .setTimestamp();
      await sendLog(logEmbed);

      await interaction.editReply({ content: '✅ Announcement updated successfully!' });
    } catch (err) {
      console.error('edit modal submit error:', err);
      await interaction.editReply({ content: '❌ Something went wrong while updating.' }).catch(() => {});
    }
    return;
  }

  if (!interaction.isButton()) return;

  const { customId } = interaction;

  try {
    // ── Edit Manga Button ─────────────────────────────────────────────────
    if (customId.startsWith('edit_manga_')) {
      // Only owners can edit
      if (!isOwner(interaction.user.id)) {
        return await interaction.reply({
          content: '❌ Only bot owners can edit announcements.',
          ephemeral: true
        });
      }

      const messageId = customId.replace('edit_manga_', '');
      const targetMsg = await interaction.channel.messages.fetch(messageId).catch(() => null);
      const oldEmbed  = targetMsg?.embeds?.[0];

      // Pre-fill modal with current values
      const currentTitle   = (oldEmbed?.title   || '').replace(/^✨ /, '');
      const currentSynopsis= oldEmbed?.description || '';
      const currentAuthor  = oldEmbed?.fields?.find(f => f.name === '📚 Author')?.value || '';

      const modal = new ModalBuilder()
        .setCustomId(`edit_manga_modal_${messageId}`)
        .setTitle('✏️ Edit Manga Announcement');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('edit_title')
            .setLabel('Title')
            .setStyle(TextInputStyle.Short)
            .setValue(currentTitle.substring(0, 100))
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('edit_synopsis')
            .setLabel('Synopsis / Description')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(currentSynopsis.substring(0, 4000))
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('edit_author')
            .setLabel('Author')
            .setStyle(TextInputStyle.Short)
            .setValue(currentAuthor.substring(0, 100))
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }
    if (customId === 'add_favorite') {
      await interaction.reply({
        content: '⭐ This series has been added to your favorites!',
        ephemeral: true
      });
    }
    
    // ==================== ACCEPT/REJECT SUBMISSION HANDLERS ====================
    else if (customId.startsWith('accept_')) {
      // Format: accept_userId_channelId_position_messageId (or without messageId for old format)
      const parts = customId.split('_');
      const userId = parts[1];
      const ticketChannelId = parts[2];
      const position = parts[3];
      const messageId = parts[4] || interaction.message.id; // Use message ID from button or current message
      
      // ✅ NEW: Check if user has permission to review
      if (!canReview(interaction.member, position)) {
        return await interaction.reply({
          content: '❌ **Access Denied**\n\nYou don\'t have permission to approve submissions.\n\n**Required:** Owner, Administrator, or Reviewer role',
          ephemeral: true
        });
      }
      
      try {
        // Get the applicant and ticket channel
        const applicant = await interaction.client.users.fetch(userId);
        const ticketChannel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
        
        // Update the review message
        const acceptedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(0x00FF00)
          .setTitle(`${interaction.message.embeds[0].title} - ✅ ACCEPTED`)
          .addFields({
            name: '✅ Reviewed By',
            value: `<@${interaction.user.id}>`,
            inline: true
          });
        
        await interaction.update({
          embeds: [acceptedEmbed],
          components: [] // Remove buttons
        });
        
        // Send acceptance message to applicant in ticket
        if (ticketChannel && ticketChannel.isTextBased()) {
          const acceptEmbed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎉 Congratulations!')
            .setDescription(`<@${userId}>, your **${position.toUpperCase()}** test has been reviewed and **accepted**!\n\nWelcome to the team! A staff member will contact you shortly with next steps.\n\n⏰ This ticket will automatically close in **20 hours**.`)
            .setFooter({ text: 'Reviewed by ' + interaction.user.tag })
            .setTimestamp();
          
          await ticketChannel.send({ embeds: [acceptEmbed] });
          
          // Schedule ticket closure after 20 hours
          setTimeout(async () => {
            try {
              const finalChannel = await interaction.client.channels.fetch(ticketChannelId).catch(() => null);
              if (finalChannel && finalChannel.deletable) {
                const closeEmbed = new EmbedBuilder()
                  .setColor(0xFFA500)
                  .setTitle('🔒 Ticket Closing')
                  .setDescription('This ticket has been automatically closed after test acceptance.')
                  .setTimestamp();
                
                await finalChannel.send({ embeds: [closeEmbed] }).catch(() => {});
                
                // Wait 10 seconds then delete
                setTimeout(async () => {
                  await finalChannel.delete().catch((err) => {
                    console.log(`Could not delete ticket: ${err.message}`);
                  });
                }, 10000);
                
                console.log(`🔒 Auto-closed accepted ticket: ${finalChannel.name}`);
              }
            } catch (error) {
              console.error('Error auto-closing accepted ticket:', error);
            }
          }, 20 * 60 * 60 * 1000); // 20 hours
        }
        
        // Log the acceptance
        const logEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Test Accepted')
          .setDescription(`**Position:** ${position.toUpperCase()}\n**Applicant:** <@${userId}>\n**Reviewer:** <@${interaction.user.id}>`)
          .setTimestamp();
        
        await sendLog(logEmbed);
        
        console.log(`✅ ${position.toUpperCase()} test accepted for ${applicant.tag} by ${interaction.user.tag}`);
        
      } catch (error) {
        console.error('Error handling accept:', error);
        await interaction.reply({
          content: '❌ An error occurred while processing the acceptance.',
          ephemeral: true
        }).catch(() => {});
      }
    }
    
    else if (customId.startsWith('reject_')) {
      // Format: reject_userId_channelId_position_messageId (or without messageId for old format)
      const parts = customId.split('_');
      const userId = parts[1];
      const ticketChannelId = parts[2];
      const position = parts[3];
      const messageId = parts[4] || interaction.message.id;
      
      // ✅ NEW: Check if user has permission to review
      if (!canReview(interaction.member, position)) {
        return await interaction.reply({
          content: '❌ **Access Denied**\n\nYou don\'t have permission to reject submissions.\n\n**Required:** Owner, Administrator, or Reviewer role',
          ephemeral: true
        });
      }
      
      try {
        // Create modal for rejection reason
        const modal = new ModalBuilder()
          .setCustomId(`reject_reason_${userId}_${ticketChannelId}_${position}_${messageId}`)
          .setTitle('Rejection Reason');
        
        const reasonInput = new TextInputBuilder()
          .setCustomId('rejection_reason')
          .setLabel('Why is this submission being rejected?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Please provide detailed feedback for the applicant...')
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(1000);
        
        const actionRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(actionRow);
        
        await interaction.showModal(modal);
        
      } catch (error) {
        console.error('Error showing reject modal:', error);
        await interaction.reply({
          content: '❌ An error occurred while opening the rejection form.',
          ephemeral: true
        }).catch(() => {});
      }
    }
    
    else if (customId === 'add_favorite') {
      await interaction.reply({
        content: '⭐ This series has been added to your favorites!',
        ephemeral: true
      });
    } 
    else if (customId.startsWith('subscribe_')) {
      // Extract message ID from custom ID
      const messageId = customId.replace('subscribe_', '');
      
      // Get the role ID for this announcement
      const config = loadConfig();
      
      // Ensure announcementRoles exists
      if (!config.announcementRoles) {
        return await interaction.reply({
          content: '❌ No notification role configured for this announcement.',
          ephemeral: true
        });
      }
      
      const roleId = config.announcementRoles[messageId];
      
      if (!roleId) {
        return await interaction.reply({
          content: '❌ No notification role configured for this announcement.',
          ephemeral: true
        });
      }

      try {
        // Fetch the role
        const role = await interaction.guild.roles.fetch(roleId);
        
        if (!role) {
          return await interaction.reply({
            content: '❌ The notification role no longer exists in this server.',
            ephemeral: true
          });
        }
        
        // Check if user already has the role
        if (interaction.member.roles.cache.has(role.id)) {
          return await interaction.reply({
            content: `🔔 You already have the ${role} role! You're receiving notifications for this series.`,
            ephemeral: true
          });
        }
        
        // Add the role to the user
        await interaction.member.roles.add(role);
        
        // Log the subscription
        const logEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🔔 New Subscription')
          .setDescription(`**User:** <@${interaction.user.id}>\n**Role:** ${role}\n**Announcement:** [View](https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${messageId})`)
          .setTimestamp();
        
        await sendLog(logEmbed);
        
        await interaction.reply({
          content: `🔔 **Success!** You've been given the ${role} role.\n\nYou will now receive notifications whenever new content is posted for this series!`,
          ephemeral: true
        });
      } catch (error) {
        console.error('Error assigning role:', error);
        await interaction.reply({
          content: '❌ Failed to assign notification role. Please contact a server administrator.\n\n**Possible reasons:**\n• Bot doesn\'t have "Manage Roles" permission\n• The role is higher than the bot\'s highest role',
          ephemeral: true
        });
      }
    }
  } catch (error) {
    console.error('Button interaction error:', error);
  }
});

// ==================== Reaction Tracking ====================

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }

    const config = loadConfig();
    const messageData = config.trackedMessages[reaction.message.id];

    if (messageData) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('⭐ Reaction Added to Tracked Message')
        .setDescription(`**User:** <@${user.id}>\n**Emoji:** ${reaction.emoji}\n\n**Original Command:** \`${messageData.commandType}\`\n**Executed By:** <@${messageData.executor}>\n**Channel:** <#${messageData.targetChannel}>`)
        .addFields({ name: '🔗 Message Link', value: `[Jump to Message](${reaction.message.url})` })
        .setTimestamp();
      
      await sendLog(logEmbed);
    }
  } catch (error) {
    console.error('Reaction tracking error:', error);
  }
});

// ==================== Message Tracking ====================

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // ==================== TICKET AUTO-RESPONDER ====================
  if (isTicketChannel(message.channel)) {
    // Check for position keywords
    const position = detectPosition(message.content);
    
    if (position && !activeTicketTimers.has(message.channel.id)) {
      await sendTestWithTimer(message.channel, message.author.id, position);
      return;
    }
    
    // Check for submission (user mentions bot)
    if (message.mentions.has(client.user.id)) {
      const ticketData = activeTicketTimers.get(message.channel.id);
      
      if (ticketData && message.author.id === ticketData.userId) {
        // ✅ NEW: Check if message has valid link
        const hasLink = hasValidSubmissionLink(message.content);
        
        if (!hasLink) {
          const warningEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('⚠️ No Valid Submission Link Detected')
            .setDescription(`<@${message.author.id}>, I see you mentioned me, but I couldn't find a valid submission link in your message!`)
            .addFields(
              {
                name: '📤 Supported Platforms',
                value: '• Google Drive\n• Google Docs\n• Dropbox\n• OneDrive\n• Imgur\n• MediaFire\n• MEGA\n• WeTransfer',
                inline: true
              },
              {
                name: '📝 How to Submit',
                value: `\`\`\`\n@${client.user.username} Here is my submission:\nhttps://docs.google.com/...\n\`\`\``,
                inline: false
              }
            )
            .setFooter({ text: 'Please include your submission link and mention me again!' })
            .setTimestamp();
          
          await message.reply({ embeds: [warningEmbed] });
          return;
        }
        
        // ✅ Valid submission received
        const confirmEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Submission Received Successfully!')
          .setDescription(`<@${message.author.id}>, excellent! Your test submission has been received!`)
          .addFields(
            {
              name: '📥 What Happens Now?',
              value: '1️⃣ Your work has been forwarded to our review team\n2️⃣ The auto-close timer has been **cancelled**\n3️⃣ This ticket will remain open for communication\n4️⃣ You\'ll receive a response within 1-3 business days',
              inline: false
            },
            {
              name: '⏰ Review Time',
              value: 'Please be patient while our team reviews your submission. We carefully evaluate all submissions to ensure quality.',
              inline: false
            },
            {
              name: '💡 In the Meantime',
              value: 'Feel free to ask questions or provide additional context about your submission in this ticket.',
              inline: false
            }
          )
          .setFooter({ text: 'Good luck! We\'ll get back to you soon. 🍀' })
          .setTimestamp();

        await message.reply({ embeds: [confirmEmbed] });

        // Cancel timer
        clearTimeout(ticketData.timerId);
        activeTicketTimers.delete(message.channel.id);
        
        // Send to review channel
        await sendSubmissionToReview(message.channel, message.author.id, ticketData.position, message);
        
        // Log the submission
        const logEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('📥 Valid Test Submission Received')
          .setDescription(`**User:** <@${message.author.id}> (${message.author.tag})\n**Position:** ${ticketData.position.toUpperCase()}\n**Channel:** <#${message.channel.id}>\n**Has Valid Links:** ✅ Yes`)
          .addFields({
            name: '🔗 Preview',
            value: message.content.substring(0, 200) + (message.content.length > 200 ? '...' : '')
          })
          .setTimestamp();
        
        await sendLog(logEmbed);
        
        console.log(`✅ Valid submission received from ${message.author.tag} - Timer cancelled`);
        return;
      } else if (ticketData && message.author.id !== ticketData.userId) {
        // ✅ NEW: Someone else mentioned the bot
        const infoEmbed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('ℹ️ Ticket Information')
          .setDescription(`This ticket belongs to <@${ticketData.userId}> for their **${ticketData.position.toUpperCase()}** test submission.\n\nOnly they can submit their test by mentioning me with their submission link.`)
          .setFooter({ text: 'If you need help, please create your own ticket!' })
          .setTimestamp();
        
        await message.reply({ embeds: [infoEmbed] });
        return;
      }
    }
  }
  
  // ==================== EXISTING MESSAGE TRACKING ====================
  try {
    const config = loadConfig();
    
    // Track replies to bot messages
    if (message.reference && message.reference.messageId) {
      const messageData = config.trackedMessages[message.reference.messageId];

      if (messageData) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('💬 Reply Received on Tracked Message')
          .setDescription(`**User:** <@${message.author.id}>\n\n**Reply Content:**\n${message.content.substring(0, 1000)}\n\n**Original Command:** \`${messageData.commandType}\`\n**Executed By:** <@${messageData.executor}>\n**Channel:** <#${message.channel.id}>`)
          .addFields(
            { name: '🔗 Original Message', value: `[View Original](https://discord.com/channels/${message.guildId}/${messageData.targetChannel}/${message.reference.messageId})` },
            { name: '🔗 Reply Link', value: `[Jump to Reply](${message.url})` }
          )
          .setTimestamp();
        
        await sendLog(logEmbed);
      }
    }
    
    // Track bot mentions (except in tickets where submission is handled separately)
    if (message.mentions.has(client.user.id) && !isTicketChannel(message.channel)) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('📢 Bot Mentioned')
        .setDescription(`**User:** <@${message.author.id}>\n**Channel:** <#${message.channel.id}>\n\n**Message:**\n${message.content.substring(0, 1000)}`)
        .addFields({ name: '🔗 Message Link', value: `[Jump to Message](${message.url})` })
        .setTimestamp();
      
      await sendLog(logEmbed);
    }
  } catch (error) {
    console.error('Message tracking error:', error);
  }
});

// ==================== Error Handling ====================

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

client.on('error', (error) => {
  console.error('❌ Discord Client Error:', error);
});

// ==================== Bot Login ====================

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});
