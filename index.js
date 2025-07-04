// Load environment variables from .env file
// At the very top of your index.js
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
    // Optionally, you might want to exit the process here if it's a critical error
    // process.exit(1);
});

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

// Define the Sadhana Model - UPDATED FIELDS
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
    // New fields for tracking point components
    readingPoints: {
        type: DataTypes.INTEGER, // 0 or 1 point for reading
        defaultValue: 0,
    },
    hearingPoints: {
        type: DataTypes.INTEGER, // 0 or 1 point for hearing/sravanam
        defaultValue: 0,
    },
    chantingTimeBonus: {
        type: DataTypes.INTEGER, // 1 or 2 points based on chanting time
        defaultValue: 0,
    },
    // Combined score for the day
    score: {
        type: DataTypes.FLOAT, // Total score for the day
        defaultValue: 0,
    },
    // State for managing reading reminder DMs
    readingReminderStatus: { // 'none', 'pending_dm_9pm', 'pending_dm_final', 'completed'
        type: DataTypes.STRING,
        defaultValue: 'none',
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

        const currentUserStreakData = created ? null : userStreakInstance.toJSON();
        const { newStreakCount, newLastLoggedDateKey } = updateLogicFn(currentUserStreakData);

        userStreakInstance.currentStreak = newStreakCount;
        userStreakInstance.lastLoggedDateKey = newLastLoggedDateKey;

        // Update longest streak if current streak is higher
        if (userStreakInstance.currentStreak > userStreakInstance.longestStreak) {
             userStreakInstance.longestStreak = userStreakInstance.currentStreak;
        }

        await userStreakInstance.save();
        console.log(`User streak ${created ? 'created' : 'updated'} for user ${userId}.`);
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

// Helper function to calculate the score based on new criteria
function calculateDailyScore(log) {
    let score = 0;
    score += log.readingPoints || 0;
    score += log.hearingPoints || 0;
    score += log.chantingTimeBonus || 0;

    return parseFloat(score.toFixed(2));
}

// --- End Database Data Interaction Functions ---


// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
        name: 'weeklysummary',
        description: 'Shows your spiritual practice summary for the last 7 days.',
    },
    {
        name: 'monthlysummary',
        description: 'Shows your spiritual practice summary for the current month.',
    },
     {
        name: 'leaderboard',
        description: 'Shows the top devotees based on practice scores.',
        options: [
            {
                name: 'period',
                type: 3, // STRING
                description: 'Select the period for the leaderboard',
                required: true,
                choices: [
                    { name: 'Weekly', value: 'weekly' },
                    { name: 'Monthly', value: 'monthly' },
                ],
            },
        ],
    },
    {
        name: 'myscore',
        description: 'Shows your personal practice score for a specific period.',
        options: [
            {
                name: 'period',
                type: 3, // STRING
                description: 'Select the period for your score',
                required: true,
                choices: [
                    { name: 'Weekly', value: 'weekly' },
                    { name: 'Monthly', value: 'monthly'},
                ],
            },
        ],
    },
    {
        name: 'showscore',
        description: 'Shows a user\'s personal practice scores (weekly, monthly, all-time) and streak.',
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user whose data to show.',
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
            // Kept these options but made them not required, handler logic will prioritize date_string
             {
                name: 'day',
                type: 4, // INTEGER
                description: 'Day of the month (optional, use date_string instead).',
                required: false,
            },
            {
                name: 'month',
                type: 4, // INTEGER
                description: 'Month (1-12) (optional, use date_string instead).',
                required: false,
            },
            {
                name: 'year',
                type: 4, // INTEGER
                description: 'Year (e.g., 2023) (optional, use date_string instead).',
                required: false,
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
        description: 'Shows your personal Sadhana progress card with streaks and badges.',
    },
    {
        name: 'resetcard', // New command to reset Sadhana data
        description: 'Resets all your past Sadhana logs, but keeps your streak (Admin only).', // Clarified admin only
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(), // Made admin only
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
                    .setTitle('Daily Practice Reminder!')
                    .setDescription(`Hare Krishna! 🙏 Remember to log your spiritual practices for today.\n\n`
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

    // New Cron Job: 9 PM IST for Hearing/Sravanam and "Will Read Later" Reminders
    cron.schedule('0 21 * * *', async () => { // 9:00 PM IST
        console.log(`[${new Date().toISOString()}] Running 9 PM IST daily reminders job (Hearing/Reading).`);
        const now = new Date();
        const todayISTDate = format(toZonedTime(now, IST_TIMEZONE), 'yyyy-MM-dd');

        // Fetch ALL users from UserStreak to send Sravanam reminder to everyone.
        // For reading reminders, we still filter for those who explicitly said "will read later".
        const allUsers = await UserStreak.findAll();

        for (const userEntry of allUsers) {
            const userId = userEntry.userId;
            const user = await client.users.fetch(userId).catch(e => {
                console.warn(`Could not fetch user ${userId} for 9 PM reminder: ${e.message}`);
                return null;
            });
            if (!user) continue;

            // Fetch sadhana log for today for this specific user
            const sadhanaLog = await Sadhana.findOne({
                where: { userId: userId, date: todayISTDate }
            });

            // --- Hearing/Sravanam Reminder (to all users if not already logged) ---
            if (!sadhanaLog || sadhanaLog.hearingPoints === 0) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setTitle('Daily Sravanam Reminder 👂')
                        .setDescription('Hare Krishna! Have you done your hearing/Sravanam today?')
                        .setFooter({ text: 'Log your progress!' });

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`sravanam_yes_${todayISTDate}_${userId}`)
                                .setLabel('Yes, I have!')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`sravanam_no_${todayISTDate}_${userId}`)
                                .setLabel('No, I haven\'t.')
                                .setStyle(ButtonStyle.Danger),
                        );

                    await user.send({ embeds: [embed], components: [row] });
                    console.log(`[${new Date().toISOString()}] Sent Sravanam reminder to ${userId}`);
                } catch (dmError) {
                    console.error(`[${new Date().toISOString()}] Failed to send Sravanam reminder to ${userId}:`, dmError);
                }
            }

            // --- "Will Read Later" Reminder (only if user explicitly chose it) ---
            if (sadhanaLog && sadhanaLog.readingReminderStatus === 'pending_dm_9pm') {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('#FFB6C1')
                        .setTitle('Reading Reminder 📖')
                        .setDescription('You marked "Will Read Later" earlier. Have you had a chance to read today?')
                        .setFooter({ text: 'Time to log that reading!' });

                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`reading_9pm_yes_${todayISTDate}_${userId}`)
                                .setLabel('Yes, I read it!')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`reading_9pm_no_${todayISTDate}_${userId}`)
                                .setLabel('No, I didn\'t read.')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId(`reading_9pm_now_${todayISTDate}_${userId}`)
                                .setLabel('I will read now!')
                                .setStyle(ButtonStyle.Primary),
                        );

                    await user.send({ embeds: [embed], components: [row] });
                    // Update status for the *existing* log entry, not creating a new one
                    sadhanaLog.readingReminderStatus = 'pending_dm_final'; // Move to next state
                    await sadhanaLog.save(); // Save the updated status
                    console.log(`[${new Date().toISOString()}] Sent 9 PM reading reminder to ${userId}`);
                } catch (dmError) {
                    console.error(`[${new Date().toISOString()}] Failed to send 9 PM reading reminder to ${userId}:`, dmError);
                }
            }
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
    if (interaction.isCommand() && interaction.commandName !== 'sadhanacard' && interaction.commandName !== 'resetcard') { // Allow sadhanacard and resetcard outside specific channel
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
            // Defer the reply immediately
            try {
                await interaction.deferReply({ ephemeral: false }); // Ensure it's not ephemeral if you plan public followUps
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 // If defer fails, we cannot proceed with editReply or followUp on this interaction.
                 // Attempt a direct ephemeral reply as a last resort if deferral failed, to inform the user.
                 try {
                     // Check if interaction is still valid to reply to
                     if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'Sorry, I could not process your command right now. Please try again.', ephemeral: true });
                     } else if (interaction.deferred && !interaction.replied) {
                         // This case shouldn't happen if deferError was caught, but as a safeguard.
                         await interaction.followUp({ content: 'Sorry, I could not process your command right now. Please try again. (After deferral error)', ephemeral: true });
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
                        readingPoints: 0,
                        hearingPoints: 0,
                        chantingTimeBonus: chantingTimeBonus,
                        readingReminderStatus: 'none',
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

                    if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) {
                        const dayDifference = differenceInCalendarDays(todayISTStartOfDay, lastLoggedDate);

                        if (dayDifference === 1) { // Logged yesterday, continue streak
                            newStreakVal = currentStreakVal + 1;
                        } else if (dayDifference > 1) { // Streak broken
                            newStreakVal = 1;
                        } else { // Already logged today, or same day but different time
                            newStreakVal = currentStreakVal;
                        }
                    } else { // First log ever
                        newStreakVal = 1;
                    }
                    return { newStreakCount: newStreakVal, newLastLoggedDateKey: todayISTDateString };
                 });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreateAndUpdateUserStreak for streak (/chant).`);
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
                .setDescription(`You logged **${sadhanaEntry.japaRounds}** rounds for today (${format(todayIST, 'dd/MM/yyyy')}).\n`
                              + `Today's Practice Score: **${sadhanaEntry.score.toFixed(2)}**\n`
                              + `Current Chanting Streak: **${userStreak.currentStreak} day(s) 🙏**`);

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
                 // No return here, as we still want to try to send the reading prompt as a followUp.
                 // This ensures the first part of the response is handled, even if the second fails.
            }

            // --- Send separate follow-up message for Reading Prompt ---
            const readingPromptEmbed = new EmbedBuilder()
                .setColor('#87CEEB') // Sky Blue
                .setTitle('Have you read any spiritual book today? 📚')
                .setFooter({ text: 'This will help track your reading progress.' });

            const readingPromptRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`read_yes_${todayISTDateString}_${userId}`) // Add userId
                        .setLabel('Yes')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`read_no_today_${todayISTDateString}_${userId}`) // Add userId
                        .setLabel('Will Not Read Today')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌'),
                    new ButtonBuilder()
                        .setCustomId(`read_later_${todayISTDateString}_${userId}`) // Add userId
                        .setLabel('Will Read Later')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⏰'),
                );

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to send followUp for /chant command with reading prompt for user ${userId}`);
            try {
                 await interaction.followUp({ embeds: [readingPromptEmbed], components: [readingPromptRow] });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully sent followUp for /chant command with reading prompt for user ${userId}`);
            } catch (followUpError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error sending followUp for /chant command with reading prompt for user ${userId}:`, followUpError);
                 // If both editReply and followUp fail, and deferral succeeded,
                 // the user might still see "Bot is thinking..." indefinitely.
                 // This is a difficult scenario to recover from in a single interaction.
            }
        }
        // ... (other slash commands) ...
        else if (commandName === 'weeklysummary') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /weeklysummary command for user ${username}`);
             try {
                 await interaction.deferReply();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
             } catch (deferError) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                  return;
             }
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

             const userId = interaction.user.id;
             const now = new Date();
             const startDateIST = startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE));
             const endDateIST = endOfDay(toZonedTime(now, IST_TIMEZONE));

             try {
                 const logs = await Sadhana.findAll({
                     where: {
                         userId: userId,
                         date: {
                             [Op.gte]: format(startDateIST, 'yyyy-MM-dd'),
                             [Op.lte]: format(endDateIST, 'yyyy-MM-dd')
                         }
                     },
                     order: [['date', 'ASC']]
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 let totalJapaRounds = 0;
                 let totalReadingPoints = 0;
                 let totalHearingPoints = 0;
                 let totalChantingBonus = 0;


                 for (const log of logs) {
                     const logData = log.toJSON();
                     totalScore += calculateDailyScore(logData);
                     loggedDays++;
                     totalJapaRounds += logData.japaRounds || 0;
                     totalReadingPoints += logData.readingPoints || 0;
                     totalHearingPoints += logData.hearingPoints || 0;
                     totalChantingBonus += logData.chantingTimeBonus || 0;
                 }

                 const embed = new EmbedBuilder()
                     .setColor('#3498DB')
                     .setTitle(`Weekly Practice Summary for ${username}`)
                     .setDescription(`Summary for the period: ${format(startDateIST, 'dd/MM/yyyy')} - ${format(endDateIST, 'dd/MM/yyyy')}`)
                     .addFields(
                         { name: 'Total Score', value: `${totalScore.toFixed(2)} points`, inline: true },
                         { name: 'Logged Days', value: `${loggedDays} day(s)`, inline: true },
                         { name: 'Total Japa Rounds', value: `${totalJapaRounds}`, inline: true },
                         { name: 'Total Reading Points', value: `${totalReadingPoints}`, inline: true },
                         { name: 'Total Hearing Points', value: `${totalHearingPoints}`, inline: true },
                         { name: 'Total Chanting Bonus Points', value: `${totalChantingBonus}`, inline: true }
                     )
                     .setFooter({ text: 'Based on your logged practices.' });

                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /weeklysummary command for user ${userId}`);
                 try {
                      await interaction.editReply({ embeds: [embed] });
                      console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /weeklysummary command for user ${userId}`);
                 } catch (editError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /weeklysummary command for user ${userId}:`, editError);
                       try {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                           await interaction.followUp({ content: 'Successfully generated summary, but failed to update the original message.', ephemeral: true });
                       } catch (followUpError) {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                       }
                 }

             } catch (error) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /weeklysummary command for user ${userId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Weekly Summary Failed')
                      .setDescription(`An error occurred while fetching your weekly practice summary: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
             }
        }
        else if (commandName === 'monthlysummary') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /monthlysummary command for user ${username}`);
             try {
                 await interaction.deferReply();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
             } catch (deferError) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                  return;
             }
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

             const userId = interaction.user.id;
             const now = new Date();
             const startDateIST = startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE));
             const endDateIST = endOfDay(toZonedTime(now, IST_TIMEZONE));

             try {
                 const logs = await Sadhana.findAll({
                     where: {
                         userId: userId,
                         date: {
                             [Op.gte]: format(startDateIST, 'yyyy-MM-dd'),
                             [Op.lte]: format(endDateIST, 'yyyy-MM-dd')
                         }
                     },
                     order: [['date', 'ASC']]
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 let totalJapaRounds = 0;
                 let totalReadingPoints = 0;
                 let totalHearingPoints = 0;
                 let totalChantingBonus = 0;


                 for (const log of logs) {
                     const logData = log.toJSON();
                     totalScore += calculateDailyScore(logData);
                     loggedDays++;
                     totalJapaRounds += logData.japaRounds || 0;
                     totalReadingPoints += logData.readingPoints || 0;
                     totalHearingPoints += logData.hearingPoints || 0;
                     totalChantingBonus += logData.chantingTimeBonus || 0;
                 }

                 const embed = new EmbedBuilder()
                     .setColor('#2ECC71')
                     .setTitle(`Monthly Practice Summary for ${username}`)
                     .setDescription(`Summary for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`)
                     .addFields(
                         { name: 'Total Score', value: `${totalScore.toFixed(2)} points`, inline: true },
                         { name: 'Logged Days', value: `${loggedDays} day(s)`, inline: true },
                         { name: 'Total Japa Rounds', value: `${totalJapaRounds}`, inline: true },
                         { name: 'Total Reading Points', value: `${totalReadingPoints}`, inline: true },
                         { name: 'Total Hearing Points', value: `${totalHearingPoints}`, inline: true },
                         { name: 'Total Chanting Bonus Points', value: `${totalChantingBonus}`, inline: true }
                     )
                     .setFooter({ text: 'Based on your logged practices.' });

                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /monthlysummary command for user ${userId}`);
                 try {
                      await interaction.editReply({ embeds: [embed] });
                      console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /monthlysummary command for user ${userId}`);
                 } catch (editError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /monthlysummary command for user ${userId}:`, editError);
                       try {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                           await interaction.followUp({ content: 'Successfully generated summary, but failed to update the original message.', ephemeral: true });
                       } catch (followUpError) {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                       }
                 }

             } catch (error) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /monthlysummary command for user ${userId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Monthly Summary Failed')
                      .setDescription(`An error occurred while fetching your monthly practice summary: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
             }
        }
        else if (commandName === 'leaderboard') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /leaderboard command for user ${username}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            const period = interaction.options.getString('period');
            const now = new Date();
            let startDateISTDateString;
            let endDateISTDateString = format(toZonedTime(now, IST_TIMEZONE), 'yyyy-MM-dd');
            let leaderboardTitle;
            let leaderboardDescription;

            if (period === 'weekly') {
                startDateISTDateString = format(startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE)), 'yyyy-MM-dd');
                leaderboardTitle = 'Weekly Practice Leaderboard 🏆';
                leaderboardDescription = `Top devotees based on scores from ${format(parse(startDateISTDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} to ${format(parse(endDateISTDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`;
            } else if (period === 'monthly') {
                startDateISTDateString = format(startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE)), 'yyyy-MM-dd');
                leaderboardTitle = 'Monthly Practice Leaderboard 🏆';
                leaderboardDescription = `Top devotees based on scores for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
            } else {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Leaderboard Failed')
                     .setDescription('Invalid period specified. Please choose "Weekly" or "Monthly".');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            try {
                const logs = await Sadhana.findAll({
                    where: {
                        date: {
                            [Op.gte]: startDateISTDateString,
                            [Op.lte]: endDateISTDateString
                        }
                    },
                    // Select all relevant attributes for score calculation
                    attributes: ['userId', 'readingPoints', 'hearingPoints', 'chantingTimeBonus'],
                });

                const userScores = {};
                for (const log of logs) {
                    const logData = log.toJSON();
                    const userId = logData.userId;
                    const score = calculateDailyScore(logData);

                    if (!userScores[userId]) {
                        userScores[userId] = { totalScore: 0, loggedDays: 0 };
                    }
                    userScores[userId].totalScore += score;
                    userScores[userId].loggedDays++;
                }

                const sortedLeaderboard = Object.keys(userScores)
                    .map(userId => ({ userId: userId, ...userScores[userId] }))
                    .sort((a, b) => b.totalScore - a.totalScore);

                const embed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle(leaderboardTitle)
                    .setDescription(leaderboardDescription);

                if (sortedLeaderboard.length === 0) {
                    embed.addFields({ name: 'No Data', value: 'No practice logs found for this period.' });
                } else {
                    const topEntries = sortedLeaderboard.slice(0, 10);
                    let leaderboardText = '';
                    for (let i = 0; i < topEntries.length; i++) {
                        const entry = topEntries[i];
                        let fetchedUsername = 'Unknown User';
                         try {
                              if (interaction.guild) {
                                 const member = await interaction.guild.members.fetch(entry.userId);
                                  fetchedUsername = member.user.globalName || member.user.username;
                              } else {
                                  const user = await client.users.fetch(entry.userId);
                                  fetchedUsername = user.globalName || user.username;
                              }
                         } catch (err) {
                             console.warn(`Could not fetch user/member ${entry.userId} for leaderboard:`, err.message);
                             fetchedUsername = `User ID: ${entry.userId}`;
                         }
                        leaderboardText += `${i + 1}. **${fetchedUsername}**: ${entry.totalScore.toFixed(2)} points (${entry.loggedDays} logged day(s))\n`;
                    }
                    embed.addFields({ name: 'Rankings', value: leaderboardText });
                }

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /leaderboard command`);
                try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /leaderboard command`);
                 } catch (editError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /leaderboard command:`, editError);
                       try {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                           await interaction.followUp({ content: 'Successfully generated leaderboard, but failed to update the original message.', ephemeral: true });
                       } catch (followUpError) {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                       }
                 }

            } catch (error) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /leaderboard command:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Leaderboard Failed')
                     .setDescription(`An error occurred while fetching leaderboard data: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
            }
        }
        else if (commandName === 'myscore') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /myscore command for user ${username}`);
             try {
                 await interaction.deferReply();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
             } catch (deferError) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                  return;
             }
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

             const period = interaction.options.getString('period');
             const userId = interaction.user.id;
             const now = new Date();
             let startDateISTDateString;
             let endDateISTDateString = format(toZonedTime(now, IST_TIMEZONE), 'yyyy-MM-dd');
             let scoreTitle;
             let scoreDescription;

             if (period === 'weekly') {
                 startDateISTDateString = format(startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE)), 'yyyy-MM-dd');
                 scoreTitle = 'Your Weekly Practice Score';
                 scoreDescription = `Score for the period: ${format(parse(startDateISTDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} - ${format(parse(endDateISTDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`;
             } else if (period === 'monthly') {
                 startDateISTDateString = format(startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE)), 'yyyy-MM-dd');
                 scoreTitle = 'Your Monthly Practice Score';
                 scoreDescription = `Score for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
             } else {
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('My Score Failed')
                      .setDescription('Invalid period specified. Please choose "Weekly" or "Monthly".');
                  await interaction.editReply({ embeds: [embed] });
                  return;
             }

             try {
                 const logs = await Sadhana.findAll({
                     where: {
                         userId: userId,
                         date: {
                             [Op.gte]: startDateISTDateString,
                             [Op.lte]: endDateISTDateString
                         }
                     },
                     attributes: ['readingPoints', 'hearingPoints', 'chantingTimeBonus'],
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 for (const log of logs) {
                     totalScore += calculateDailyScore(log.toJSON());
                     loggedDays++;
                 }

                 const embed = new EmbedBuilder()
                     .setColor('#800080')
                     .setTitle(scoreTitle)
                     .setDescription(scoreDescription)
                     .addFields(
                         { name: 'Total Score', value: `${totalScore.toFixed(2)} points`, inline: true },
                         { name: 'Logged Days', value: `${loggedDays} day(s)`, inline: true }
                     )
                     .setFooter({ text: 'Based on your logged practices.' });

                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /myscore command for user ${userId}`);
                 try {
                      await interaction.editReply({ embeds: [embed] });
                      console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /myscore command for user ${userId}`);
                  } catch (editError) {
                       console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /myscore command for user ${userId}:`, editError);
                        try {
                            console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                            await interaction.followUp({ content: 'Successfully generated your score summary, but failed to update the original message.', ephemeral: true });
                        } catch (followUpError) {
                            console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                        }
                  }

             } catch (error) {
                  console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /myscore command for user ${userId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('My Score Failed')
                      .setDescription(`An error occurred while fetching your practice score: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
             }
        }
        else if (commandName === 'showscore') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /showscore command for user ${username}`);
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const targetUser = interaction.options.getUser('user');
            const userId = targetUser.id;
            const targetUsername = targetUser.globalName || targetUser.username;

            try {
                const userStreak = await getUserStreak(userId);
                const currentStreak = userStreak ? userStreak.currentStreak : 0; // Use currentStreak

                const startOfLast7DaysDateString = format(startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE)), 'yyyy-MM-dd');
                const startOfMonthDateString = format(startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE)), 'yyyy-MM-dd');
                const todayISTDate = format(todayIST, 'yyyy-MM-dd'); // Corrected to DATEONLY

                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Fetching Sadhana logs for user ${userId} for score calculation.`);
                const allTimeLogs = await Sadhana.findAll({
                    where: { userId: userId },
                    order: [['date', 'ASC']]
                });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished fetching Sadhana logs for user ${userId}. Found ${allTimeLogs.length} logs.`);


                let weeklyScore = 0;
                let monthlyScore = 0;
                let allTimeScore = 0;
                let weeklyLoggedDays = 0;
                let monthlyLoggedDays = 0;
                let allTimeLoggedDays = 0;

                for (const log of allTimeLogs) {
                    const logDate = log.date; // already DATEONLY string
                    const logData = log.toJSON();

                    allTimeScore += calculateDailyScore(logData);
                    allTimeLoggedDays++;

                    if (logDate >= startOfLast7DaysDateString) { // Compare DATEONLY strings
                        weeklyScore += calculateDailyScore(logData);
                        weeklyLoggedDays++;
                    }

                    if (logDate >= startOfMonthDateString) { // Compare DATEONLY strings
                         monthlyScore += calculateDailyScore(logData);
                         monthlyLoggedDays++;
                    }
                }


                const embed = new EmbedBuilder()
                    .setColor('#00CED1')
                    .setTitle(`Practice Summary for ${targetUsername}`)
                    .addFields(
                        { name: 'Current Chanting Streak', value: `${currentStreak} day(s) 🙏}` },
                        { name: 'Weekly (Last 7 Days)', value: `${weeklyScore.toFixed(2)} points (${weeklyLoggedDays} logged)`, inline: true },
                        { name: `Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })})`, value: `${monthlyScore.toFixed(2)} points (${monthlyLoggedDays} logged)`, inline: true },
                        { name: 'All-Time', value: `${allTimeScore.toFixed(2)} points (${allTimeLoggedDays} logged)`, inline: true }
                    );

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for showscore for user ${userId}`);
                try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for showscore for user ${userId}`);
                } catch (editError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply for showscore for user ${userId}:`, editError);
                      try {
                          console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                          await interaction.followUp({ content: 'Successfully fetched user summary, but failed to update the original message.', ephemeral: true });
                      } catch (followUpError) {
                          console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                      }
                }
            } catch (error) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /showscore command for user ${userId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Score Failed')
                      .setDescription(`An error occurred while fetching data: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
            }

        }
         // Handle the /streakset command (Admin only)
        else if (commandName === 'streakset') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Permission Denied')
                     .setDescription('You do not have permission to use this command.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /streakset command for user ${username}`);


            const targetUser = interaction.options.getUser('user');
            const newStreakValue = interaction.options.getInteger('streak');

            if (newStreakValue < 0) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Streak Set Failed')
                     .setDescription('Streak value cannot be negative.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }

            const targetUserId = targetUser.id;

            try {
                 const userStreak = await findOrCreateAndUpdateUserStreak(targetUserId, (currentUserStreak) => {
                     const yesterday = addDays(now, -1);
                     const yesterdayKey = format(yesterday, 'yyyy-MM-dd'); // For last logged date to enable streak progression

                     return {
                         newStreakCount: newStreakValue,
                         newLastLoggedDateKey: yesterdayKey
                     };
                 });

                const embed = new EmbedBuilder()
                    .setColor('#32CD32')
                    .setTitle('Streak Set Successfully')
                    .setDescription(`Successfully set ${targetUser.username}'s chanting streak to ${userStreak.currentStreak}. Their last logged date is set for streak calculation.`);

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to reply for streakset for user ${targetUserId}`);
                try {
                     await interaction.reply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully replied for streakset for user ${targetUserId}`);
                } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error replying for streakset for user ${targetUserId}:`, replyError);
                }

            } catch (error) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /streakset command for user ${targetUserId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Set Failed')
                      .setDescription(`An error occurred while setting the streak: ${error.message}`);
                  await interaction.reply({ embeds: [embed] });
            }
        }
        // Handle the /help command
        else if (commandName === 'help') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /help command for user ${username}`);
            const embed = new EmbedBuilder()
                .setColor('#FFFF00')
                .setTitle('Helpful Resources and Commands')
                .setDescription(`Here are the available commands:\n\n`
                              + `- \`/chant <rounds>\`: Log your japa rounds for today. This will initiate questions about reading.\n`
                              + `- \`/weeklysummary\`: Shows your practice summary for the last 7 days.\n`
                              + `- \`/monthlysummary\`: Shows your practice summary for the current month.\n`
                              + `- \`/leaderboard <period>\`: Shows the top devotees based on practice scores (weekly or monthly).\n`
                              + `- \`/myscore <period>\`: Shows your personal practice score for a specific period (weekly or monthly).\n`
                              + `- \`/showscore <user>\`: Shows a user\'s chanting streak and practice scores.\n`
                              + `- \`/streakboard\`: Shows the current chanting streak leaderboard with pagination.\n`
                              + `- \`/sadhanacard\`: Displays your personal Sadhana progress card with streaks and badges (can be used anywhere).\n`
                              + `- \`/resetcard\`: Resets all your past Sadhana logs, but keeps your streak (Admin only).\n` // Added new command to help
                              + `- \`/streakset <user> <streak>\`: Sets a user\'s chanting streak (Admin only).\n`
                              + `- \`/checkdata <type> [user] [date_string]\`: Check specific data from the database (Admin only).`);

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to reply for help command for user ${username}`);
            try {
                 await interaction.reply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully replied for help command for user ${username}`);
            } catch (replyError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error replying for help command for user ${username}:`, replyError);
            }
        }
        // --- Handle /checkdata command ---
        else if (commandName === 'checkdata') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Permission Denied')
                     .setDescription('You do not have permission to use this command.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /checkdata command for user ${username}`);

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const dataType = interaction.options.getString('type');
            const targetUser = interaction.options.getUser('user');
            const dateString = interaction.options.getString('date_string');


            const embed = new EmbedBuilder()
                 .setColor('#800080')
                .setTitle('Data Check Results');

            let embedDescription = '';

            try {
                switch (dataType) {
                    case 'user_streak':
                        if (!targetUser) {
                             embedDescription = 'For "User Streak", you must provide a user.';
                             embed.setColor('#FF0000');
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                            return;
                        }
                        const userStreak = await getUserStreak(targetUser.id);

                        if (userStreak) {
                            embed.setTitle(`Streak for ${targetUser.username}`);
                            embed.addFields(
                                { name: 'Current Streak', value: `${userStreak.currentStreak} day(s)` }, // Use currentStreak
                                { name: 'Longest Streak', value: `${userStreak.longestStreak} day(s)` }, // Show longest streak
                                { name: 'Last Logged Date Key', value: userStreak.lastLoggedDateKey || 'None' }
                            );
                        } else {
                            embedDescription = `No streak data found for ${targetUser.username}.`;
                             embed.setDescription(embedDescription);
                        }
                        break;

                    case 'total_streak_count':
                        const totalStreakCount = await getTotalUserStreakCount();
                        embedDescription = `**Total User Streak Entries in Database:** ${totalStreakCount}`;
                        embed.setDescription(embedDescription);
                        break;

                    case 'user_sadhana_log_by_date':
                         if (!targetUser || !dateString) {
                             embedDescription = 'For "User Sadhana Log by Date", you must provide both a user and a date string (YYYY-MM-DD).';
                             embed.setColor('#FF0000');
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                             return;
                         }

                        const parsedDate = parse(dateString, 'yyyy-MM-dd', new Date());
                         if (isNaN(parsedDate.getTime())) {
                             embedDescription = 'Invalid date string format. Please use `YYYY-MM-DD`.';
                             embed.setColor('#FF0000');
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                             return;
                         }

                        const targetDateISTString = format(toZonedTime(parsedDate, IST_TIMEZONE), 'yyyy-MM-dd'); // Ensure DATEONLY string

                         console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Fetching Sadhana log for user ${targetUser.id} on date ${targetDateISTString} from database.`);
                        const sadhanaLog = await Sadhana.findOne({
                             where: {
                                 userId: targetUser.id,
                                 date: targetDateISTString // Query by DATEONLY string
                             }
                        });

                         if (sadhanaLog) {
                             const logData = sadhanaLog.toJSON();
                             embed.setTitle(`Sadhana Log for ${targetUser.username} on ${format(parse(targetDateISTString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`);
                             embed.addFields(
                                 { name: 'Japa Rounds', value: logData.japaRounds?.toString() || '0', inline: true },
                                 { name: 'Reading Points', value: logData.readingPoints?.toString() || '0', inline: true },
                                 { name: 'Hearing Points', value: logData.hearingPoints?.toString() || '0', inline: true },
                                 { name: 'Chanting Time Bonus', value: logData.chantingTimeBonus?.toString() || '0', inline: true },
                                 { name: 'Reading Reminder Status', value: logData.readingReminderStatus || 'none', inline: true },
                                 { name: 'Calculated Score', value: logData.score?.toFixed(2) || '0.00', inline: true }
                             );
                         } else {
                             embedDescription = `No Sadhana log found for ${targetUser.username} on ${format(parse(targetDateISTString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}.`;
                             embed.setDescription(embedDescription);
                         }
                         break;

                    default:
                        embedDescription = 'Invalid data type specified.';
                        embed.setColor('#FF0000');
                        embed.setDescription(embedDescription);
                        break;
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] An unexpected error occurred in /checkdata command:`, error);
                embedDescription = `An unexpected error occurred while fetching data: ${error.message}`;
                embed.setColor('#FF0000');
                embed.setDescription(embedDescription);
            }

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for checkdata command`);
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for checkdata command`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /checkdata command:`, editError);
                  try {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                      await interaction.followUp({ content: 'Successfully fetched data, but failed to update the original message.', ephemeral: true });
                  } catch (followUpError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                  }
            }

        }
         // --- Handle /streakboard command ---
        else if (commandName === 'streakboard') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /streakboard command for user ${username}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            try {
                const userStreaks = await getAllUserStreaks();

                const totalPages = Math.ceil(userStreaks.length / ENTRIES_PER_PAGE);
                const page = 0;

                const { embeds, components } = await generateStreakboardPage(userStreaks, page, totalPages, interaction);

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /streakboard command`);
                try {
                     await interaction.editReply({ embeds: embeds, components: components });
                     console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /streakboard command`);
                 } catch (editError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /streakboard command:`, editError);
                       try {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                           await interaction.followUp({ content: 'Successfully generated streakboard, but failed to refresh the original message.', ephemeral: true });
                       } catch (followUpError) {
                           console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                       }
                 }
            } catch (error) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /streakboard command:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Streak Leaderboard Failed')
                     .setDescription(`An error occurred while fetching streak data: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
            }
        }
        // --- Handle /sadhanacard command ---
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
                let totalReadingPointsAllTime = 0;
                let totalHearingPointsAllTime = 0;
                let totalChantingBonusAllTime = 0;
                let allTimeScore = 0;
                let loggedDaysCount = 0; // Count of days with at least one log

                // Calculate totals and all-time score
                for (const log of allSadhanaLogs) {
                    const logData = log.toJSON();
                    totalJapaRounds += logData.japaRounds || 0;
                    totalReadingPointsAllTime += logData.readingPoints || 0;
                    totalHearingPointsAllTime += logData.hearingPoints || 0;
                    totalChantingBonusAllTime += logData.chantingTimeBonus || 0;
                    allTimeScore += calculateDailyScore(logData);
                    loggedDaysCount++;
                }

                // Determine badges
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
                if (totalReadingPointsAllTime >= 10) { // Example threshold
                    badges.push('📚 Study Enthusiast (10+ Reading Logs)');
                }
                if (totalHearingPointsAllTime >= 10) { // Example threshold
                    badges.push('🎧 Listening Disciple (10+ Hearing Logs)');
                }
                if (allTimeScore >= 50) { // Example score threshold
                    badges.push('✨ Dedicated Devotee (50+ Total Score)');
                }

                const embed = new EmbedBuilder()
                    .setColor('#FFC0CB') // Pink color for the card
                    .setTitle(`Sadhana Card: ${username}`)
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true })) // User's avatar
                    .setDescription(`Your spiritual journey at a glance!`)
                    .addFields(
                        { name: 'Current Streak 🔥', value: `${currentStreak} day(s)`, inline: true },
                        { name: 'Longest Streak 🏆', value: `${longestStreak} day(s)`, inline: true },
                        { name: 'All-Time Score ✨', value: `${allTimeScore.toFixed(2)} points`, inline: true },
                        { name: 'Total Japa Rounds 📿', value: `${totalJapaRounds}`, inline: true },
                        { name: 'Total Reading Points 📚', value: `${totalReadingPointsAllTime}`, inline: true },
                        { name: 'Total Hearing Points 🎧', value: `${totalHearingPointsAllTime}`, inline: true },
                        { name: 'Badges Earned 🎗️', value: badges.length > 0 ? badges.join('\n') : 'None yet! Keep practicing to earn badges!' },
                    )
                    .setFooter({ text: 'Keep going on your spiritual journey!' })
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
        // --- Handle /resetcard command ---
        else if (commandName === 'resetcard') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Permission Denied')
                     .setDescription('You do not have permission to use this command.');
                 await interaction.reply({ embeds: [embed], ephemeral: true }); // Keep this ephemeral
                return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /resetcard command for user ${username}`);
            try {
                await interaction.deferReply(); // Defer without ephemeral, as response will be public
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                return;
            }

            try {
                // Delete all Sadhana logs for ALL users
                const deletedRows = await Sadhana.destroy({
                    where: {}, // Empty where clause deletes all rows
                });

                const embed = new EmbedBuilder()
                    .setColor('#FFD700') // Gold color
                    .setTitle('Sadhana Card Reset! 🧹 (Admin Action)')
                    .setDescription(`All past Sadhana logs (${deletedRows} entries) for ALL users have been cleared by ${username}. `
                                  + `All chanting streaks remain intact for a fresh start! 🎉`);

                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /resetcard command (global)`);
                try {
                    await interaction.editReply({ embeds: [embed] }); // Public reply
                    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /resetcard command (global)`);
                } catch (editError) {
                    console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply for /resetcard command (global):`, editError);
                    // Fallback to followUp, also public
                    try {
                        console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                        await interaction.followUp({ content: 'Successfully reset all cards, but failed to update the original message. Check console for details.', ephemeral: false });
                    } catch (followUpError) {
                        console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                    }
                }

            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error during /resetcard command (global):`, error);
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Sadhana Card Reset Failed (Admin Action)')
                    .setDescription(`An error occurred while resetting all Sadhana Cards: ${error.message}`);
                await interaction.editReply({ embeds: [embed] }); // Public reply for error
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

        // --- Handle "Extra Rounds" Button ---
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
        }
        // --- Handle Reading Prompt Buttons (from /chant initial reply) ---
        else if (buttonAction === 'read') {
            let responseMessage = '';
            let newReminderStatus = sadhanaLog.readingReminderStatus; // Keep current status by default
            let readingAwarded = false;

            if (sadhanaLog.readingPoints > 0) {
                 responseMessage = 'You have already logged reading points for this day!';
            } else {
                if (customIdParts[1] === 'yes') {
                    sadhanaLog.readingPoints = 1;
                    readingAwarded = true;
                    responseMessage = 'Fantastic! You earned 1 point for reading today. Keep it up! 🌟';
                    newReminderStatus = 'completed'; // Mark as completed
                } else if (customIdParts[1] === 'no' && customIdParts[2] === 'today') {
                    responseMessage = 'Okay, no worries! Maybe another time. 🙌';
                    newReminderStatus = 'completed'; // Mark as completed
                } else if (customIdParts[1] === 'later') {
                    responseMessage = 'Got it! I\'ll send you a reminder around 9 PM IST. Don\'t forget to read! ⏰';
                    newReminderStatus = 'pending_dm_9pm'; // Set reminder state
                }
            }

            sadhanaLog.readingReminderStatus = newReminderStatus;
            sadhanaLog.score = calculateDailyScore(sadhanaLog.toJSON()); // Recalculate score

            try {
                await sadhanaLog.save();
                // Send ephemeral follow-up to user
                await interaction.followUp({ content: `**Reading Update for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}:** ${responseMessage}`, ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reading choice handled for user ${userId} on ${buttonDateString}: ${interaction.customId}. Points: ${readingAwarded ? 1 : 0}`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error saving reading choice for user ${userId} on date ${buttonDateString}:`, error);
                await interaction.followUp({ content: 'There was an error saving your reading choice. Please try again later.', ephemeral: true });
            }
            // Disable the reading prompt buttons after a choice has been made
             const updatedComponents = interaction.message.components.map(row =>
                 new ActionRowBuilder().addComponents(
                     row.components.map(button =>
                         ButtonBuilder.from(button).setDisabled(true)
                     )
                 )
             );
             await interaction.editReply({ components: updatedComponents });
        }
        // --- Handle Hearing/Sravanam Buttons (from 9 PM DM cron) ---
        else if (buttonAction === 'sravanam') {
            // Ensure there's a sadhana log for today, create if not
            let sadhanaLogToday = await Sadhana.findOne({
                where: { userId: originalCommanderId, date: buttonDateString }
            });

            if (!sadhanaLogToday) {
                // If no log exists for today, create a new one with default values
                sadhanaLogToday = await Sadhana.create({
                    userId: originalCommanderId,
                    guildId: null, // DMs don't have a guild ID
                    date: buttonDateString,
                    japaRounds: 0,
                    readingPoints: 0,
                    hearingPoints: 0, // This will be set below
                    chantingTimeBonus: 0,
                    readingReminderStatus: 'none',
                    score: 0,
                });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Created new Sadhana log for user ${originalCommanderId} on ${buttonDateString} for Sravanam response.`);
            }

            if (sadhanaLogToday.hearingPoints > 0) {
                 await interaction.followUp({ content: 'You have already logged hearing points for this day!', ephemeral: true });
                 // Still disable buttons even if already logged
                 const updatedComponents = interaction.message.components.map(row =>
                     new ActionRowBuilder().addComponents(
                         row.components.map(button =>
                             ButtonBuilder.from(button).setDisabled(true)
                         )
                     )
                 );
                 await interaction.editReply({ components: updatedComponents });
                 return;
            }

            if (customIdParts[1] === 'yes') {
                sadhanaLogToday.hearingPoints = 1;
                sadhanaLogToday.score = calculateDailyScore(sadhanaLogToday.toJSON()); // Recalculate score
                await sadhanaLogToday.save();
                await interaction.followUp({ content: `Excellent! You earned 1 point for Sravanam for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}. Keep connecting! 🙏`, ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Sravanam Yes handled for user ${userId} on ${buttonDateString}.`);
            } else if (customIdParts[1] === 'no') {
                // If they say no, still update the log to prevent repeated prompts if no other action is taken
                sadhanaLogToday.hearingPoints = 0; // Explicitly 0
                sadhanaLogToday.score = calculateDailyScore(sadhanaLogToday.toJSON()); // Recalculate score
                await sadhanaLogToday.save();
                await interaction.followUp({ content: `Okay, no worries. Try to make time for Sravanam for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} tomorrow! ✨`, ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Sravanam No handled for user ${userId} on ${buttonDateString}.`);
            }
             // Disable Sravanam buttons after action
             const updatedComponents = interaction.message.components.map(row =>
                 new ActionRowBuilder().addComponents(
                     row.components.map(button =>
                         ButtonBuilder.from(button).setDisabled(true)
                     )
                 )
             );
             await interaction.editReply({ components: updatedComponents });
        }
        // --- Handle 9 PM Reading Reminder Buttons ---
        else if (buttonAction === 'reading' && customIdParts[1] === '9pm') {
            if (sadhanaLog.readingPoints > 0) {
                 await interaction.followUp({ content: 'You have already logged reading points for this day!', ephemeral: true });
                 // Still disable buttons even if already logged
                 const updatedComponents = interaction.message.components.map(row =>
                     new ActionRowBuilder().addComponents(
                         row.components.map(button =>
                             ButtonBuilder.from(button).setDisabled(true)
                         )
                     )
                 );
                 await interaction.editReply({ components: updatedComponents });
                 return;
            }

            if (customIdParts[2] === 'yes') {
                sadhanaLog.readingPoints = 1;
                sadhanaLog.score = calculateDailyScore(sadhanaLog.toJSON()); // Recalculate score
                sadhanaLog.readingReminderStatus = 'completed';
                await sadhanaLog.save();
                await interaction.followUp({ content: `Wonderful! You earned 1 point for reading for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}. 🙏`, ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reading 9 PM Yes handled for user ${userId} on ${buttonDateString}.`);
            } else if (customIdParts[2] === 'no') {
                sadhanaLog.readingReminderStatus = 'completed'; // No more reminders
                await sadhanaLog.save();
                await interaction.followUp({ content: 'Understood. Maybe next time! ✨', ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reading 9 PM No handled for user ${userId} on ${buttonDateString}.`);
            } else if (customIdParts[2] === 'now') {
                // This is the "I will read now!" button. Send final prompt.
                sadhanaLog.readingReminderStatus = 'pending_dm_final'; // Mark for final check
                await sadhanaLog.save();

                const embed = new EmbedBuilder()
                    .setColor('#FF69B4') // Hot Pink
                    .setTitle('Final Reading Check! 🧐')
                    .setDescription(`Have you completed your reading session for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} now?`)
                    .setFooter({ text: 'This is the last reminder for this day.' });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`final_read_confirm_${buttonDateString}_${originalCommanderId}`) // Final confirm
                            .setLabel('Yes, I read it!')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`final_read_decline_${buttonDateString}_${originalCommanderId}`) // Final decline
                            .setLabel('No, I still haven\'t.')
                            .setStyle(ButtonStyle.Danger),
                    );
                try {
                    await interaction.user.send({ embeds: [embed], components: [row] });
                    await interaction.followUp({ content: 'Okay, check your DMs for the final reading check!', ephemeral: true });
                    console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Sent final reading check DM to ${userId} for date ${buttonDateString}.`);
                } catch (dmError) {
                    console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send final reading check DM to ${userId} for date ${buttonDateString}:`, dmError);
                    await interaction.followUp({ content: 'Could not send the final reading reminder. Please ensure your DMs are open.', ephemeral: true });
                }
            }
             // Disable 9 PM reading buttons after action
             const updatedComponents = interaction.message.components.map(row =>
                 new ActionRowBuilder().addComponents(
                     row.components.map(button =>
                         ButtonBuilder.from(button).setDisabled(true)
                     )
                 )
             );
             await interaction.editReply({ components: updatedComponents });

        }
        // --- Handle Final Reading Confirmation Buttons (from DM) ---
        else if (buttonAction === 'final' && customIdParts[1] === 'read') {
            if (sadhanaLog.readingPoints > 0) {
                 await interaction.followUp({ content: 'You have already logged reading points for this day!', ephemeral: true });
                 // Still disable buttons even if already logged
                 const updatedComponents = interaction.message.components.map(row =>
                     new ActionRowBuilder().addComponents(
                         row.components.map(button =>
                             ButtonBuilder.from(button).setDisabled(true)
                         )
                     )
                 );
                 await interaction.editReply({ components: updatedComponents });
                 return;
            }

            if (customIdParts[2] === 'confirm') {
                sadhanaLog.readingPoints = 1;
                sadhanaLog.score = calculateDailyScore(sadhanaLog.toJSON()); // Recalculate score
                sadhanaLog.readingReminderStatus = 'completed'; // Final status
                await sadhanaLog.save();
                await interaction.followUp({ content: `Fantastic! Your reading has been logged for ${format(parse(buttonDateString, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}. Hare Krishna! 🎉`, ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Final Reading Confirmed for user ${userId} on ${buttonDateString}.`);
            } else if (customIdParts[2] === 'decline') {
                sadhanaLog.readingReminderStatus = 'completed'; // Final status
                await sadhanaLog.save();
                await interaction.followUp({ content: 'Understood. We\'ll catch it next time! Your determination is still appreciated. 💪', ephemeral: true });
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Final Reading Declined for user ${userId} on ${buttonDateString}.`);
            }
             // Disable final reading buttons after action
             const updatedComponents = interaction.message.components.map(row =>
                 new ActionRowBuilder().addComponents(
                     row.components.map(button =>
                         ButtonBuilder.from(button).setDisabled(true)
                     )
                 )
             );
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

// Optional: Keep alive web server for hosting platforms
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(port, () => console.log(`Web server running on port ${port}`));
