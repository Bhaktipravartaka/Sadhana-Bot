// Load environment variables from .env file
// At the very top of your index.js
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
    // Optionally, you might want to exit the process here if it's a critical error
    // process.exit(1);
});

// Optional: Keep alive web server for hosting platforms
const express = require("express");
const app = express();
const port = process.env.PORT || 3000

app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(port, () => console.log(`Web server running on port ${port}`));



require('dotenv').config();

const http = require('http'); // Keep for Render health check

// --- Database Setup (PostgreSQL with Sequelize) ---
const { Sequelize, DataTypes, Op } = require('sequelize'); // Import Op for operators like Op.gt

// Get the PostgreSQL connection URI from environment variables
// IMPORTANT: Ensure POSTGRES_URI environment variable is set on Render (e.g., from Supabase)
const postgresUri = process.env.POSTGRES_URI;

if (!postgresUri) {
    console.error('FATAL ERROR: POSTGRES_URI environment variable is not set.');
    process.exit(1); // Exit if the database connection string is missing
}

// Create a new Sequelize instance
const sequelize = new Sequelize(postgresUri, {
    dialect: 'postgres', // Specify PostgreSQL dialect
    logging: false, // Set to true to see SQL queries in console (useful for debugging)
    dialectOptions: {
        ssl: {
            require: true, // Require SSL connection
            rejectUnauthorized: false // This might be needed for some hosting providers like Supabase free tier
        }
    }
});

// Define the Sadhana Model - MODIFIED FIELDS for chanting only
const Sadhana = sequelize.define('Sadhana', {
    userId: {
        type: DataTypes.STRING, // Use STRING for Discord IDs (they are large numbers)
        allowNull: false,
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: true, // Can be null if the command is used in a DM
    },
    date: {
        type: DataTypes.DATEONLY, // Store date only (YYYY-MM-DD) for daily logs
        allowNull: false,
    },
    japaRounds: {
        type: DataTypes.INTEGER, // Use INTEGER for number of japa rounds chanted
        defaultValue: 0,
    },
    chantingTimeBonus: {
        type: DataTypes.INTEGER, // 1 or 2 points based on chanting time
        defaultValue: 0,
    },
    // Combined score for the day - now only based on japaRounds and chantingTimeBonus
    score: {
        type: DataTypes.FLOAT, // Total score for the day
        defaultValue: 0,
    },
    timestamp: { // Original timestamp of log creation/update
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW, // Use DataTypes.NOW for current timestamp
    },
}, {
    // Model options
    tableName: 'sadhanas', // Specify table name
    timestamps: false, // Sequelize adds createdAt and updatedAt by default, set to false if not needed
    indexes: [ // Add a unique index to prevent duplicate entries for same user and date
        {
            unique: true,
            fields: ['userId', 'date']
        }
    ]
});

// Define the UserStreak Model - UPDATED WITH longestStreak and renamed streakCount
const UserStreak = sequelize.define('UserStreak', {
    userId: {
        type: DataTypes.STRING, // Discord user IDs are large numbers, store as string
        unique: true, // Each user should have only one streak entry
        allowNull: false,
    },
    currentStreak: { // Renamed from streakCount for clarity
        type: DataTypes.INTEGER,
        defaultValue: 0, // Default streak count is 0
        allowNull: false,
    },
    longestStreak: { // New field to track the longest streak achieved
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
    },
    lastLoggedDateKey: {
        type: DataTypes.STRING, // Store date as 'YYYY-MM-DD' string
        allowNull: true, // Can be null if the user hasn't logged yet
    },
}, {
    tableName: 'user_streaks', // Specify table name
    timestamps: false, // Set to false if not needed
});

// Function to connect to the database and sync models
async function connectDB() {
    try {
        console.log('Attempting to connect to the database...');
        await sequelize.authenticate();
        console.log('Database connection has been established successfully.');

        // Sync models - This will create tables if they don't exist or update them
        // IMPORTANT: For production, use a proper migration tool or alter tables manually.
        // { alter: true } attempts to make incremental changes but can sometimes be problematic.
        // For fresh dev environment, { force: true } can be used to drop and recreate tables.
        // await sequelize.sync({ force: true }); // Use this for development if you want to wipe data
        await sequelize.sync({ alter: true }); // Safer for existing data, tries to apply changes
        console.log('Database models synced successfully.');

        // Now that the database is ready, log in the Discord client
        console.log('Database ready. Logging in Discord client...');
        client.login(token);

    } catch (error) {
        console.error('FATAL ERROR: Unable to connect to the database or sync models:', error);
        // Exit the process if database connection or sync fails
        process.exit(1);
    }
}

// --- End Database Setup ---


// --- Database Data Interaction Functions ---

// Helper function to get a user's streak data
async function getUserStreak(userId) {
    try {
        console.log(`[${new Date().toISOString()}] Fetching streak data for user ${userId} from database.`);
        const userStreak = await UserStreak.findOne({ where: { userId: userId } });
        // Convert Sequelize instance to a plain object before returning
        return userStreak ? userStreak.toJSON() : null;
    } catch (err) {
        console.error(`Error fetching user streak for ${userId}:`, err);
        throw new Error('Failed to fetch user streak data from database.');
    }
}

// Helper function to find or create and update a user's streak
async function findOrCreateAndUpdateUserStreak(userId, updateLogicFn) {
     try {
         const [userStreakInstance, created] = await UserStreak.findOrCreate({
             where: { userId: userId },
             defaults: {
                 currentStreak: 0,
                 longestStreak: 0,
                 lastLoggedDateKey: null,
             },
         });

        console.log(`[${new Date().toISOString()}] [PID:${process.pid}] UserStreak findOrCreate for ${userId}. Created: ${created}. Initial instance currentStreak: ${userStreakInstance.currentStreak}, lastLoggedDateKey: ${userStreakInstance.lastLoggedDateKey}`);

        const currentUserStreakData = created ? null : userStreakInstance.toJSON();
        const { newStreakCount, newLastLoggedDateKey } = updateLogicFn(currentUserStreakData);

        userStreakInstance.currentStreak = newStreakCount;
        userStreakInstance.lastLoggedDateKey = newLastLoggedDateKey;

        // Update longest streak if current streak is higher
        if (userStreakInstance.currentStreak > userStreakInstance.longestStreak) {
             userStreakInstance.longestStreak = userStreakInstance.currentStreak;
        }

        await userStreakInstance.save();
        console.log(`[${new Date().toISOString()}] [PID:${process.pid}] User streak saved for ${userId}. Current streak: ${userStreakInstance.currentStreak}, Longest streak: ${userStreakInstance.longestStreak}`);
        return userStreakInstance.toJSON();

     } catch (err) {
         console.error(`Error finding/creating/updating user streak for ${userId}:`, err);
         throw new Error('Failed to update user streak data.');
     }
}

// Function to get all user streaks for the streakboard
async function getAllUserStreaks() {
    console.log(`[${new Date().toISOString()}] Fetching fresh streak data from database for getAllUserStreaks.`);
    try {
        const streaks = await UserStreak.findAll({
            order: [['currentStreak', 'DESC']],
        });
        return streaks.map(streak => streak.toJSON());
    } catch (err) {
        console.error('Error fetching all user streaks:', err);
        throw new Error('Failed to fetch all user streak data from database.');
    }
}

// Function to get the total count of user streak entries
async function getTotalUserStreakCount() {
     console.log(`[${new Date().toISOString()}] Fetching total user streak count directly from database.`);
     try {
         const count = await UserStreak.count();
         console.log(`Total user streak entries counted: ${count} (fetched directly).`);
         return count;
     } catch (err) {
         console.error('Error counting user streak entries:', err);
         throw new Error('Failed to count user streak entries.');
     }
}

// Helper function to calculate the score based on new criteria (chanting only)
function calculateDailyScore(log) {
    let score = 0;
    score += log.japaRounds / 16; // Assuming 1 point per 16 rounds as a base for score
    score += log.chantingTimeBonus || 0; // Add chanting time bonus

    return parseFloat(score.toFixed(2));
}

// --- End Database Data Interaction Functions ---


// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Using date-fns for robust date/time parsing and comparison
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth, setHours, setMinutes, setSeconds, isBefore, differenceInMilliseconds, addHours } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// Import node-cron for scheduling tasks
const cron = require('node-cron');


// Get bot token, client ID, guild ID, and other IDs from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID; // Add this to your .env file
const SADHANA_CHANNEL_ID = '1317679585076318218'; // Specific channel for Sadhana commands

// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time

// Define the daily cutoff time for logging practice (e.g., 11:59 PM IST)
const DAILY_CUTOFF_HOUR_IST = 23; // 23 for 11 PM
const DAILY_CUTOFF_MINUTE_IST = 59; // 59 for 59 minutes
const GRACE_PERIOD_HOURS = 1; // 1 hour grace period for 7+ day streaks
const MIN_STREAK_FOR_GRACE_PERIOD = 7; // Minimum streak count for grace period

// Define how many entries per page for the streakboard
const ENTRIES_PER_PAGE = 10;

// Funny responses for extra rounds button (now for challenges)
const extraRoundsFunnyResponses = [
    "A divine challenge awaits! Can you chant these extra rounds for Krishna?",
    "The spiritual energy is high! Accept this challenge to deepen your connection!",
    "Ready for a spiritual boost? Here's a special challenge just for you!",
    "It's a japa mini-quest! Conquer these rounds and feel the bliss!",
    "Expand your devotion! Take on this extra rounds challenge!",
];


// Create a new Discord client instance.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages, // Needed for sending DMs
        GatewayIntentBits.MessageContent, // Needed for reading command content if not using slash commands exclusively
    ],
});


// --- Define Slash Commands ---
const commands = [
     {
        name: 'chant',
        description: 'Log your japa rounds chanted for today, and update your daily practice.',
        options: [
            {
                name: 'rounds',
                type: 4, // INTEGER
                description: 'The number of rounds chanted.',
                required: true,
            },
        ],
    },
    {
        name: 'streakset',
        description: 'Sets the chanting streak for a user (Admin only).',
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user whose streak to set.',
                required: true,
            },
            {
                name: 'streak',
                type: 4, // INTEGER
                description: 'The new streak value.',
                required: true,
            },
        ],
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    },
     {
        name: 'help',
        description: 'Provides information about the bot commands.',
    },
    {
        name: 'checkdata',
        description: 'Check specific data from the database (Admin only).',
        options: [
            {
                name: 'type',
                type: 3, // STRING
                description: 'Type of data to check',
                required: true,
                choices: [
                    { name: 'User Log by Date', value: 'user_sadhana_log_by_date' },
                    { name: 'User Streak', value: 'user_streak' },
                    { name: 'Total Sadhana Entries Count', value: 'total_sadhana_count' },
                    { name: 'Total User Streak Entries Count', value: 'total_streak_count' },
                ],
            },
            {
                name: 'user',
                type: 6, // USER
                description: 'The user to check data for (required for User Log and User Streak).',
                required: false,
            },
             {
                name: 'date_string', // New option for date string
                type: 3, // STRING
                description: 'Date of the log (e.g., 07/05/2025) (required for User Log by Date).',
                required: false, // Make required true in handler logic
            },
        ],
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    },
     {
        name: 'streakboard',
        description: 'Shows the current chanting streak leaderboard.',
    },
    {
        name: 'sadhanacard',
        description: 'Shows your personal chanting progress card with streaks and badges.',
    },
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`Started refreshing application (/) commands for client ID: ${clientId}.`);
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );
        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();


// --- Helper function to generate a streakboard page embed and components ---
async function generateStreakboardPage(streaks, page, totalPages, interaction) {
    const start = page * ENTRIES_PER_PAGE;
    const end = start + ENTRIES_PER_PAGE;
    const entriesToShow = streaks.slice(start, end);

    const embed = new EmbedBuilder()
        .setColor('#FF6347') // Tomato color
        .setTitle('Chanting Streak Leaderboard 🔥')
        .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

    if (streaks.length === 0) {
        embed.setDescription("No chanting streaks found yet.");
    } else {
        let leaderboardDescription = '';
        for (let i = 0; i < entriesToShow.length; i++) {
            const userStreak = entriesToShow[i];
            const globalRank = start + i + 1; // Calculate global rank
            let username = 'Unknown User';
             try {
                 if (interaction.guild) {
                    const member = await interaction.guild.members.fetch(userStreak.userId);
                     username = member.user.globalName || member.user.username; // Prefer global name
                 } else {
                     const user = await client.users.fetch(userStreak.userId);
                     username = user.globalName || user.username; // Prefer global name
                 }
             } catch (err) {
                 console.warn(`Could not fetch user/member ${userStreak.userId}:`, err.message);
                 username = `User ID: ${userStreak.userId}`;
             }

            leaderboardDescription += `${globalRank}. **${username}**: ${userStreak.currentStreak} day(s) 🙏\n`;
        }
        embed.setDescription(leaderboardDescription);
    }

    // Create pagination buttons
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`streakboard_page_${page - 1}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0), // Disable if on the first page
            new ButtonBuilder()
                .setCustomId(`streakboard_page_${page + 1}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page >= totalPages - 1), // Disable if on the last page
        );

    // Only return components if there is more than one page
    return { embeds: [embed], components: totalPages > 1 ? [row] : [] };
}


// --- Bot Event Handlers ---

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online and ready to receive slash commands and modal submissions!');

    // --- Schedule Cron Jobs ---

    // Schedule daily streak warning DM (e.g., at 10:00 PM IST)
    cron.schedule('0 22 * * *', async () => { // 10:00 PM IST
        console.log(`[${new Date().toISOString()}] Running daily streak warning job.`);
        try {
            const now = new Date();
            const todayISTDate = format(toZonedTime(now, IST_TIMEZONE), 'yyyy-MM-dd'); // Get today's IST date string

            // Fetch all users with a streak > 0
            const usersWithStreaks = await UserStreak.findAll({
                where: {
                    currentStreak: { [Op.gt]: 0 }
                }
            });

            console.log(`[${new Date().toISOString()}] Found ${usersWithStreaks.length} users with streaks.`);

            for (const userStreak of usersWithStreaks) {
                const userId = userStreak.userId;

                // Determine cutoff time, applying grace period if streak is long enough
                let cutoffTimeTodayIST = setHours(setMinutes(setSeconds(toZonedTime(now, IST_TIMEZONE), 0), DAILY_CUTOFF_MINUTE_IST), DAILY_CUTOFF_HOUR_IST);
                let isGracePeriodUser = false;

                if (userStreak.currentStreak >= MIN_STREAK_FOR_GRACE_PERIOD) {
                    cutoffTimeTodayIST = addHours(cutoffTimeTodayIST, GRACE_PERIOD_HOURS);
                    isGracePeriodUser = true;
                    console.log(`[${new Date().toISOString()}] User ${userId} has streak ${userStreak.currentStreak}, applying ${GRACE_PERIOD_HOURS} hour grace period. New cutoff: ${formatInTimeZone(cutoffTimeTodayIST, IST_TIMEZONE, 'hh:mm a zzz')}`);
                }

                // Check if the user has logged practice for today (any Sadhana entry)
                const todaySadhanaLog = await Sadhana.findOne({
                    where: {
                        userId: userId,
                        date: todayISTDate // Check against DATEONLY string
                    }
                });

                // If no log for today, send a warning DM
                if (!todaySadhanaLog) {
                    try {
                        const user = await client.users.fetch(userId);
                        if (user) {
                            const nowIST = toZonedTime(new Date(), IST_TIMEZONE);
                            const timeRemainingMs = differenceInMilliseconds(cutoffTimeTodayIST, nowIST);

                            if (timeRemainingMs > 0) {
                                const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
                                const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));

                                let warningMessage = `Hare Krishna! 🙏 Your chanting streak of ${userStreak.currentStreak} day(s) is about to be lost! You haven't logged your practice for today yet.`;
                                let timeRemainingMessage = `You have about ${hours} hours and ${minutes} minutes remaining to log your rounds using \`/chant <rounds>\`. Don't miss your streak!`;

                                let embedTitle = 'Streak Warning!';
                                let embedColor = '#FFCC00'; // Yellow/Orange

                                if (isGracePeriodUser) {
                                    warningMessage += `\n\n**Special Grace Period!** You have an extra ${GRACE_PERIOD_HOURS} hour grace period because of your ${userStreak.currentStreak} day streak!`;
                                    embedTitle = 'Streak Grace Period Active!';
                                    embedColor = '#ADD8E6'; // Light Blue
                                }

                                const embed = new EmbedBuilder()
                                    .setColor(embedColor)
                                    .setTitle(embedTitle)
                                    .setDescription(`${warningMessage}\n${timeRemainingMessage}`);

                                await user.send({ embeds: [embed] });
                                console.log(`[${new Date().toISOString()}] Sent streak warning DM to user ${userId}${isGracePeriodUser ? ' (with grace period)' : ''}.`);
                            } else {
                                console.log(`[${new Date().toISOString()}] Skipping streak warning DM for user ${userId} as cutoff time has passed.`);
                            }
                        } else {
                            console.warn(`[${new Date().toISOString()}] Could not fetch user ${userId} for streak warning DM.`);
                        }
                    } catch (dmError) {
                        console.error(`[${new Date().toISOString()}] Failed to send streak warning DM to user ${userId}:`, dmError);
                    }
                } else {
                    console.log(`[${new Date().toISOString()}] User ${userId} has already logged today. No streak warning needed.`);
                }
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error during daily streak warning job:`, error);
        }
    }, {
        scheduled: true,
        timezone: IST_TIMEZONE
    });

    // Schedule daily announcement message (e.g., at 8:00 AM IST)
    cron.schedule('0 8 * * *', async () => { // 8:00 AM IST
        console.log(`[${new Date().toISOString()}] Running daily announcement job.`);
        if (!announcementChannelId) {
            console.warn(`[${new Date().toISOString()}] ANNOUNCEMENT_CHANNEL_ID is not set in .env. Skipping daily announcement.`);
            return;
        }

        try {
            const channel = await client.channels.fetch(announcementChannelId);
            if (channel && channel.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setColor('#0099FF')
                    .setTitle('Daily Chanting Reminder!')
                    .setDescription(`Hare Krishna! 🙏 Remember to log your japa rounds for today.\n\n`
                                  + `Quickly log your japa rounds using \`/chant <rounds>\`.`);

                await channel.send({
                    embeds: [embed],
                });
                console.log(`[${new Date().toISOString()}] Sent daily announcement to channel ${announcementChannelId}`);

            } else {
                console.warn(`[${new Date().toISOString()}] Could not fetch or send to announcement channel with ID: ${announcementChannelId}. Please check the ID and bot permissions.`);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error during daily announcement job:`, error);
        }
    }, {
        scheduled: true,
        timezone: IST_TIMEZONE
    });
});

client.on('interactionCreate', async interaction => {
    // Added process.pid for better debugging in multi-instance environments
    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Interaction received: ${interaction.id}, Type: ${interaction.type}, Command: ${interaction.isCommand() ? interaction.commandName : 'N/A'}, Modal: ${interaction.isModalSubmit() ? interaction.customId : 'N/A'}, Button: ${interaction.isButton() ? interaction.customId : 'N/A'}`);

    const userId = interaction.user.id;
    const username = interaction.user.tag;
    const now = new Date();
    const todayIST = toZonedTime(now, IST_TIMEZONE);
    const todayISTDateString = format(todayIST, 'yyyy-MM-dd'); // Use DATEONLY format for consistency with DB

    // --- Command Channel Restriction ---
    // All commands are restricted except sadhanacard (which can be used anywhere)
    if (interaction.isCommand() && interaction.commandName !== 'sadhanacard') {
        if (interaction.channelId !== SADHANA_CHANNEL_ID) {
            await interaction.reply({
                content: `Please use this command only in the <#${SADHANA_CHANNEL_ID}> channel.`,
                ephemeral: true
            });
            return;
        }
    }


    // --- Handle Slash Command Interactions ---
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        // --- Handle /chant command ---
        if (commandName === 'chant') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /chant command for user ${username}`);
            // Defer the reply immediately to acknowledge the interaction within 3 seconds
            try {
                await interaction.deferReply({ ephemeral: false }); // Ensure it's not ephemeral if you plan public followUps
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 // If defer fails, it means the interaction might have already expired.
                 // Attempt a direct ephemeral reply as a last resort to inform the user.
                 try {
                     if (!interaction.replied && !interaction.deferred) { // Check if it hasn't been replied to or deferred by another means
                        await interaction.reply({ content: 'Sorry, I could not process your command right now. Please try again.', ephemeral: true });
                     }
                 } catch (fallbackError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Critical: Failed to send fallback reply after deferral error:`, fallbackError);
                 }
                 return; // Exit if deferral failed
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            const rounds = interaction.options.getInteger('rounds');
            const guildId = interaction.guild?.id;


            if (rounds < 0) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('Number of rounds cannot be negative.');
                 // Since we already deferred, use editReply
                 try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Negative rounds error reply sent successfully.`);
                 } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error sending negative rounds error reply:`, replyError);
                 }
                 return;
            }

            // Calculate chanting time bonus based on current IST time
            let chantingTimeBonus = 0;
            const currentHourIST = todayIST.getHours();
            if (currentHourIST >= 3 && currentHourIST < 9) { // 3 AM to 8:59 AM IST
                chantingTimeBonus = 2;
            } else if (currentHourIST >= 9 && currentHourIST <= 23) { // 9 AM to 11:59 PM IST
                chantingTimeBonus = 1;
            }
            // If it's after midnight (00:00 to 02:59), the bonus is 0, which is the default.

            // --- Database Interaction for /chant (Sadhana Log part) ---
            let sadhanaEntry;
            let created;
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database findOrCreate for Sadhana log (/chant) for user ${userId} on ${todayISTDateString}`);
            try {
                 [sadhanaEntry, created] = await Sadhana.findOrCreate({
                    where: {
                        userId: userId,
                        date: todayISTDateString // Use DATEONLY string
                    },
                    defaults: {
                        userId: userId,
                        guildId: guildId,
                        date: todayISTDateString,
                        japaRounds: rounds,
                        chantingTimeBonus: chantingTimeBonus,
                        score: 0, // Will be calculated after all components are updated
                    }
                });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreate for Sadhana log (/chant). Created: ${created}`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during findOrCreate for Sadhana log (/chant):`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while accessing the Sadhana database. Please try again later.');
                 try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] DB findOrCreate error reply sent successfully.`);
                 } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error sending DB findOrCreate error reply:`, replyError);
                 }
                 return;
            }

            // If updating an existing Sadhana entry, add the new rounds to existing rounds
            if (!created) {
                 sadhanaEntry.japaRounds = (sadhanaEntry.japaRounds || 0) + rounds;
                 sadhanaEntry.chantingTimeBonus = chantingTimeBonus; // Update bonus in case they log again later in day
            }
            // Calculate score after updating japa and bonus for current action
            sadhanaEntry.score = calculateDailyScore(sadhanaEntry.toJSON());


            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database save for Sadhana log (/chant) for user ${userId} on ${todayISTDateString}`);
            try {
                await sadhanaEntry.save();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database save for Sadhana log (/chant).`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during save for Sadhana log (/chant):`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while saving Sadhana data to the database. Please try again later.');
                 try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] DB save error reply sent successfully.`);
                 } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error sending DB save error reply:`, replyError);
                 }
                 return;
            }


            // --- Chanting Streak Logic for /chant ---
            let userStreak;
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database findOrCreateAndUpdateUserStreak for streak (/chant) for user ${userId}`);
            try {
                 userStreak = await findOrCreateAndUpdateUserStreak(userId, (currentUserStreak) => {
                    let currentStreakVal = currentUserStreak ? currentUserStreak.currentStreak : 0;
                    const lastLoggedDateKey = currentUserStreak ? currentUserStreak.lastLoggedDateKey : null;
                    let newStreakVal = currentStreakVal;

                    const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;
                    const todayISTStartOfDay = startOfDay(todayIST); // Ensure we're comparing start of day

                    if (!lastLoggedDate || isNaN(lastLoggedDate.getTime())) {
                        // This is the very first log for this user, or lastLoggedDate is invalid.
                        newStreakVal = 1;
                    } else {
                        const dayDifference = differenceInCalendarDays(todayISTStartOfDay, lastLoggedDate);
                        if (dayDifference === 1) { // Logged yesterday, continue streak
                            newStreakVal = currentStreakVal + 1;
                        } else if (dayDifference > 1) { // Streak broken, start new streak
                            newStreakVal = 1;
                        } else { // dayDifference === 0, already logged today
                            // If they already logged today and their streak was 0, it means they just started/restarted.
                            // If currentStreakVal is 0 and they are logging on the same day, it should become 1.
                            // Otherwise, if currentStreakVal > 0, it means they are just logging more for today.
                            newStreakVal = currentStreakVal === 0 ? 1 : currentStreakVal; // This line is the key change
                        }
                    }
                    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Inside updateLogicFn for user ${userId}. currentUserStreak: ${JSON.stringify(currentUserStreak)}, newStreakVal: ${newStreakVal}`);
                    return { newStreakCount: newStreakVal, newLastLoggedDateKey: todayISTDateString };
                 });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreateAndUpdateUserStreak for streak (/chant).`);
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] User streak received by /chant handler: ${userStreak.currentStreak}`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during streak update for /chant:`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while updating streak data. Please try again later.');
                 try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] DB streak update error reply sent successfully.`);
                 } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error sending DB streak update error reply:`, replyError);
                 }
                 return;
            }

            // --- Build Initial Reply Embed ---
            const initialEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Japa Rounds Logged! 🎶')
                .setDescription(`You logged **${sadhanaEntry.japaRounds}** rounds for today (${format(todayIST, 'dd/MM/yyyy')}).\n` +
                              `Today's Practice Score: **${sadhanaEntry.score.toFixed(2)}**\n` +
                              `Current Chanting Streak: **${userStreak.currentStreak} day(s) 🙏**`);
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Value of userStreak.currentStreak for embed: ${userStreak.currentStreak}`);

            // Embed userId into customId for multi-user interaction control
            const extraRoundsButton = new ButtonBuilder()
                .setCustomId(`extra_rounds_button_${todayISTDateString}_${userId}`)
                .setLabel('Feel like chanting few more rounds?')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('➕'); // Plus sign emoji

            const initialComponents = [
                new ActionRowBuilder().addComponents(extraRoundsButton)
            ];

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /chant command with Japa Rounds Logged embed for user ${userId}`);
            try {
                await interaction.editReply({ embeds: [initialEmbed], components: initialComponents });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /chant command for user ${userId}`);
            } catch (editError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply for /chant command for user ${userId}:`, editError);
            }
        }
        else if (commandName === 'streakset') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }

            const targetUser = interaction.options.getUser('user');
            const newStreak = interaction.options.getInteger('streak');

            if (newStreak < 0) {
                await interaction.reply({ content: 'Streak value cannot be negative.', ephemeral: true });
                return;
            }

            try {
                const [userStreakInstance, created] = await UserStreak.findOrCreate({
                    where: { userId: targetUser.id },
                    defaults: {
                        currentStreak: newStreak,
                        longestStreak: newStreak, // If setting, longest also becomes this
                        lastLoggedDateKey: newStreak > 0 ? todayISTDateString : null, // Set last logged if streak is > 0
                    },
                });

                if (!created) {
                    userStreakInstance.currentStreak = newStreak;
                    if (newStreak > userStreakInstance.longestStreak) {
                        userStreakInstance.longestStreak = newStreak;
                    }
                    userStreakInstance.lastLoggedDateKey = newStreak > 0 ? todayISTDateString : null;
                    await userStreakInstance.save();
                }

                await interaction.reply({
                    content: `Successfully set ${targetUser.tag}'s streak to ${newStreak} day(s).`,
                    ephemeral: false
                });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Admin ${userId} set ${targetUser.id}'s streak to ${newStreak}.`);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error setting streak for user ${targetUser.id}:`, error);
                await interaction.reply({ content: 'An error occurred while setting the streak. Please try again.', ephemeral: true });
            }
        }
        else if (commandName === 'help') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /help command for user ${username}`);
            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle('Bot Commands (Chanting Only)')
                .setDescription('Here are the commands you can use with this bot, focused only on chanting:')
                .addFields(
                    { name: '/chant <rounds>', value: 'Log the number of japa rounds you chanted today.' },
                    { name: '/streakboard', value: 'See the current chanting streak leaderboard.' },
                    { name: '/sadhanacard', value: 'Displays your personal chanting progress card with streaks and badges (can be used anywhere).' },
                    { name: '/help', value: 'Displays this help message.' },
                    { name: '/checkdata [type] [user] [date_string]', value: '*(Admin Only)* Check specific data from the database. Use `User Log by Date` to check a user\'s daily log, `User Streak` for a user\'s streak, `Total Sadhana Entries Count` for total daily logs, `Total User Streak Entries Count` for total streak entries. Date format for `date_string` is `YYYY-MM-DD` or `MM/DD/YYYY`.' },
                    { name: '/streakset <user> <streak>', value: '*(Admin Only)* Manually set a user\'s chanting streak.' }
                )
                .setFooter({ text: 'May your chanting be blissful! Hare Krishna! 🙏' });

            await interaction.reply({ embeds: [embed], ephemeral: false });
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] /help command reply sent for user ${userId}`);
        }
        else if (commandName === 'checkdata') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /checkdata command for user ${username}`);
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true }); // Defer for admin command

            const type = interaction.options.getString('type');
            const targetUser = interaction.options.getUser('user');
            const dateStringInput = interaction.options.getString('date_string'); // New preferred date input

            let parsedDate = null;
            if (dateStringInput) {
                 // Try parsing with YYYY-MM-DD or MM/DD/YYYY
                 parsedDate = parse(dateStringInput, 'yyyy-MM-dd', new Date());
                 if (isNaN(parsedDate.getTime())) { // If first parse fails, try MM/DD/YYYY
                     parsedDate = parse(dateStringInput, 'MM/dd/yyyy', new Date());
                 }
                 if (isNaN(parsedDate.getTime())) {
                     await interaction.editReply({ content: 'Invalid date format. Please use YYYY-MM-DD or MM/DD/YYYY (e.g., 2025-07-05 or 07/05/2025).' });
                     return;
                 }
            }


            try {
                let replyContent = '';
                let embed = new EmbedBuilder().setColor('#0099FF');

                switch (type) {
                    case 'user_sadhana_log_by_date':
                        if (!targetUser || !parsedDate) {
                            await interaction.editReply({ content: 'For "User Log by Date", you must provide both a user and a valid date (YYYY-MM-DD or MM/DD/YYYY).' });
                            return;
                        }
                        const formattedDate = format(parsedDate, 'yyyy-MM-dd');
                        const sadhanaLog = await Sadhana.findOne({
                            where: {
                                userId: targetUser.id,
                                date: formattedDate
                            }
                        });
                        if (sadhanaLog) {
                            embed.setTitle(`Sadhana Log for ${targetUser.tag} on ${format(parsedDate, 'dd/MM/yyyy')}`)
                                 .addFields(
                                     { name: 'Japa Rounds', value: sadhanaLog.japaRounds.toString(), inline: true },
                                     { name: 'Chanting Time Bonus', value: sadhanaLog.chantingTimeBonus.toString(), inline: true },
                                     { name: 'Score', value: sadhanaLog.score.toFixed(2), inline: true }
                                 );
                            replyContent = 'User Sadhana Log:';
                        } else {
                            replyContent = `No Sadhana log found for ${targetUser.tag} on ${format(parsedDate, 'dd/MM/yyyy')}.`;
                        }
                        break;
                    case 'user_streak':
                        if (!targetUser) {
                            await interaction.editReply({ content: 'For "User Streak", you must provide a user.' });
                            return;
                        }
                        const userStreak = await getUserStreak(targetUser.id);
                        if (userStreak) {
                            embed.setTitle(`Chanting Streak for ${targetUser.tag}`)
                                 .addFields(
                                     { name: 'Current Streak', value: `${userStreak.currentStreak} day(s)`, inline: true },
                                     { name: 'Longest Streak', value: `${userStreak.longestStreak} day(s)`, inline: true },
                                     { name: 'Last Logged Date', value: userStreak.lastLoggedDateKey || 'N/A', inline: true }
                                 );
                            replyContent = 'User Streak:';
                        } else {
                            replyContent = `No streak data found for ${targetUser.tag}.`;
                        }
                        break;
                    case 'total_sadhana_count':
                        const sadhanaCount = await Sadhana.count();
                        replyContent = `Total Sadhana Log Entries: ${sadhanaCount}`;
                        break;
                    case 'total_streak_count':
                        const streakCount = await UserStreak.count();
                        replyContent = `Total User Streak Entries: ${streakCount}`;
                        break;
                    default:
                        replyContent = 'Invalid data type specified.';
                }

                if (embed.data.fields && embed.data.fields.length > 0) {
                    await interaction.editReply({ embeds: [embed] });
                } else {
                    await interaction.editReply({ content: replyContent });
                }
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] /checkdata command reply sent for admin ${userId}`);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /checkdata command:`, error);
                await interaction.editReply({ content: `An error occurred while checking data: ${error.message}` });
            }
        }
        else if (commandName === 'streakboard') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /streakboard command for user ${username}`);
            try {
                await interaction.deferReply();
            } catch (deferError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                return;
            }

            try {
                const allStreaks = await getAllUserStreaks();
                const totalPages = Math.ceil(allStreaks.length / ENTRIES_PER_PAGE);

                const { embeds, components } = await generateStreakboardPage(allStreaks, 0, totalPages, interaction);
                await interaction.editReply({ embeds, components });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] /streakboard command initial reply sent for user ${userId}`);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error fetching streakboard:`, error);
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Streakboard Failed')
                    .setDescription('An error occurred while fetching the streakboard. Please try again later.');
                await interaction.editReply({ embeds: [embed] });
            }
        }
        else if (commandName === 'sadhanacard') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /sadhanacard command for user ${username}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            const userId = interaction.user.id;

            try {
                // Fetch user streak data
                const userStreak = await getUserStreak(userId);
                const currentStreak = userStreak ? userStreak.currentStreak : 0;
                const longestStreak = userStreak ? userStreak.longestStreak : 0; // Get longest streak

                // Fetch all Sadhana logs for the user to calculate totals and all-time score
                const allSadhanaLogs = await Sadhana.findAll({
                    where: { userId: userId }
                });

                let totalJapaRounds = 0;
                let totalChantingBonusAllTime = 0;
                let allTimeScore = 0;
                let loggedDaysCount = 0; // Count of days with at least one log

                // Calculate totals and all-time score based ONLY on chanting
                for (const log of allSadhanaLogs) {
                    const logData = log.toJSON();
                    totalJapaRounds += logData.japaRounds || 0;
                    totalChantingBonusAllTime += logData.chantingTimeBonus || 0;
                    allTimeScore += calculateDailyScore(logData); // This function now only uses chanting data
                    loggedDaysCount++;
                }

                // Determine badges (chanting-only)
                const badges = [];
                if (loggedDaysCount > 0) {
                    badges.push('🔰 First Step (Logged at least once)');
                }
                if (currentStreak >= 7) {
                    badges.push('🔥 7-Day Streaker');
                }
                if (currentStreak >= 30) {
                    badges.push('🌟 30-Day Streaker');
                }
                if (currentStreak >= 100) { // New 100-day streak badge
                    badges.push('💯 Century Streaker');
                }
                if (totalJapaRounds >= 100) { // Example threshold
                    badges.push('📿 Japa Seeker (100+ Rounds)');
                }
                if (totalJapaRounds >= 1000) { // Example threshold
                    badges.push('📿 Japa Master (1000+ Rounds)');
                }
                if (allTimeScore >= 50) { // Example score threshold
                    badges.push('✨ Dedicated Devotee (50+ Total Chanting Score)');
                }

                const embed = new EmbedBuilder()
                    .setColor('#FFC0CB') // Pink color for the card
                    .setTitle(`Sadhana Card: ${username}`)
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true })) // User's avatar
                    .setDescription(`Your chanting journey at a glance!`)
                    .addFields(
                        { name: 'Current Streak 🔥', value: `${currentStreak} day(s)`, inline: true },
                        { name: 'Longest Streak 🏆', value: `${longestStreak} day(s)`, inline: true },
                        { name: 'All-Time Chanting Score ✨', value: `${allTimeScore.toFixed(2)} points`, inline: true },
                        { name: 'Total Japa Rounds 📿', value: `${totalJapaRounds}`, inline: true },
                        { name: 'Total Chanting Time Bonus ⏰', value: `${totalChantingBonusAllTime}`, inline: true },
                        { name: 'Badges Earned 🎗️', value: badges.length > 0 ? badges.join('\n') : 'None yet! Keep chanting to earn badges!' },
                    )
                    .setFooter({ text: 'Keep going on your spiritual chanting journey! Hare Krishna! 🙏' })
                    .setTimestamp();

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /sadhanacard command for user ${userId}`);
                try {
                    await interaction.editReply({ embeds: [embed] });
                    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /sadhanacard command for user ${userId}`);
                } catch (editError) {
                    console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /sadhanacard command for user ${userId}:`, editError);
                    try {
                        console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                        await interaction.followUp({ content: 'There was an error generating your Sadhana Card, but I\'m still working on it!', ephemeral: true });
                    } catch (followUpError) {
                        console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                    }
                }

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /sadhanacard command for user ${userId}:`, error);
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Sadhana Card Failed')
                    .setDescription(`An error occurred while generating your Sadhana Card: ${error.message}`);
                await interaction.editReply({ embeds: [embed] });
            }
        }
    }

    // --- Handle Button Interactions ---
    else if (interaction.isButton()) {
        const customIdParts = interaction.customId.split('_');
        const buttonAction = customIdParts[0];
        const buttonDateString = customIdParts[customIdParts.length - 2]; // Date is second to last
        const originalCommanderId = customIdParts[customIdParts.length - 1]; // Commander ID is last part

        // Special handling for streakboard pagination buttons as they don't relate to a specific daily log
        if (interaction.customId.startsWith('streakboard_page_')) {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling streakboard pagination button: ${interaction.customId}`);
            await interaction.deferUpdate(); // Defer the button interaction update

            try {
                const pageNumber = parseInt(customIdParts[2]); // Page number is the third part
                const userStreaks = await getAllUserStreaks(); // Fetch all data again for pagination

                const totalPages = Math.ceil(userStreaks.length / ENTRIES_PER_PAGE);

                // Reconstruct embed and components
                const { embeds, components } = await generateStreakboardPage(userStreaks, pageNumber, totalPages, interaction);

                try {
                    await interaction.editReply({ embeds: embeds, components: components });
                    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for streakboard pagination.`);
                } catch (editError) {
                    console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply for streakboard pagination:`, editError);
                    // Add fallback
                    try {
                        await interaction.followUp({ content: 'Successfully updated pagination, but failed to refresh the original message.', ephemeral: true });
                    } catch (followUpError) {
                        console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                    }
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during streakboard pagination button:`, error);
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Streak Leaderboard Failed')
                    .setDescription(`An error occurred while fetching streak data: ${error.message}`);
                await interaction.editReply({ embeds: [embed], components: [] }); // Remove buttons on error
            }
            return; // Exit after handling streakboard buttons
        }

        // --- Restrict daily action buttons to the original commander ---
        if (interaction.user.id !== originalCommanderId) {
            await interaction.reply({ content: 'You can only interact with your own Sadhana log buttons.', ephemeral: true });
            return;
        }

        console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling daily action button: ${interaction.customId} for user ${username} for date ${buttonDateString}`);
        await interaction.deferUpdate(); // Defer the button interaction

        const sadhanaLog = await Sadhana.findOne({
            where: { userId: originalCommanderId, date: buttonDateString } // Use date and commanderId from custom ID
        });

        if (!sadhanaLog) {
            // This button might be from a past day for which the log was cleared, or an invalid date.
            await interaction.followUp({ content: 'This button refers to a log entry that no longer exists or is too old to modify directly. Please use `/chant` to create a new log for today.', ephemeral: true });
            return;
        }

        // --- Handle "Extra Rounds" Button (now a challenge) ---
        if (buttonAction === 'extra' && customIdParts[1] === 'rounds' && customIdParts[2] === 'button') {
            try {
                // Generate a random number of rounds for the challenge (1 to 5)
                const challengeRounds = Math.floor(Math.random() * 5) + 1;

                const funnyResponse = extraRoundsFunnyResponses[Math.floor(Math.random() * extraRoundsFunnyResponses.length)];

                const embed = new EmbedBuilder()
                    .setColor('#FFA500') // Orange for fun
                    .setTitle(`Japa Challenge! 🎉`)
                    .setDescription(`${funnyResponse}\n\n**${username}** clicked the button and received a challenge to chant **${challengeRounds}** extra rounds for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}! Hare Krishna! 🙏`);

                await interaction.followUp({ embeds: [embed], ephemeral: false }); // Visible to everyone
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] User ${userId} was challenged to chant ${challengeRounds} extra rounds for date ${buttonDateString}.`);

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error handling extra rounds button for user ${userId} on date ${buttonDateString}:`, error);
                await interaction.followUp({ content: 'There was an error with the extra rounds challenge. Please try again later.', ephemeral: true });
            }
            // Disable the extra rounds button after it's clicked
            const updatedComponents = interaction.message.components.map(row => {
                if (row.components.some(comp => comp.customId.startsWith('extra_rounds_button_'))) {
                    return new ActionRowBuilder().addComponents(
                        row.components.map(button =>
                            ButtonBuilder.from(button).setDisabled(true)
                        )
                    );
                }
                return row;
            });
            await interaction.editReply({ components: updatedComponents });
        }
    }
});


// Start the database connection and sync models
connectDB();


// Basic error handling for issues with the Discord client itself (like login failures).
client.on('error', error => {
    console.error('Something went wrong with the Discord client:', error);
});

