// Load environment variables from .env file
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

// Define the Sadhana Model
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
        type: DataTypes.DATE, // Use DATE for date/time
        allowNull: false,
    },
    japaRounds: {
        type: DataTypes.INTEGER, // Use INTEGER for numbers
        defaultValue: 0,
    },
    studyHours: {
        type: DataTypes.FLOAT, // Use FLOAT or DECIMAL for numbers with decimal places
        defaultValue: 0,
    },
    listeningHours: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
    },
    readingDetails: {
        type: DataTypes.TEXT, // Use TEXT for potentially longer strings
        defaultValue: '',
    },
    sleepingTime: {
        type: DataTypes.DATE, // Store as DATE if possible, or STRING if 'Not Slept' is needed
        allowNull: true, // Allow null
    },
    wakingTime: {
         type: DataTypes.DATE, // Store as DATE if possible, or STRING
         allowNull: true, // Allow null
    },
    wokeUpEarlyStatus: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    sleptEarlyStatus: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    noMeatEating: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    noGambling: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    noIllicitSex: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    noIntoxication: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    additionalService: {
        type: DataTypes.TEXT,
        defaultValue: '',
    },
    score: {
        type: DataTypes.FLOAT, // Use FLOAT or DECIMAL for the score
        defaultValue: 0,
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW, // Use DataTypes.NOW for current timestamp
    },
}, {
    // Model options
    tableName: 'sadhanas', // Specify table name
    timestamps: false, // Sequelize adds createdAt and updatedAt by default, set to false if not needed
});


// Define the UserStreak Model
const UserStreak = sequelize.define('UserStreak', {
    userId: {
        type: DataTypes.STRING, // Discord user IDs are large numbers, store as string
        unique: true, // Each user should have only one streak entry
        allowNull: false,
    },
    streakCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0, // Default streak count is 0
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
        // Use { alter: true } to make incremental changes to the schema based on model definitions
        // Be cautious with { force: true } in production as it drops existing tables!
        await sequelize.sync({ alter: true });
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


// --- Database Data Interaction Functions (Streaks Only) ---
// These functions use Sequelize to interact with the PostgreSQL database

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
// updateLogicFn is a function that takes the current streak data (as a plain object or null)
// and returns { newStreakCount, newLastLoggedDateKey }.
async function findOrCreateAndUpdateUserStreak(userId, updateLogicFn) {
     try {
         // Find or create the user streak entry
         const [userStreakInstance, created] = await UserStreak.findOrCreate({
             where: { userId: userId },
             defaults: {
                 streakCount: 0,
                 lastLoggedDateKey: null,
             },
         });

        // Get the current data as a plain object to pass to the update logic
        const currentUserStreakData = created ? null : userStreakInstance.toJSON();

        // Calculate the new streak details using the provided logic function
        const { newStreakCount, newLastLoggedDateKey } = updateLogicFn(currentUserStreakData);

        // Update the instance properties
        userStreakInstance.streakCount = newStreakCount;
        userStreakInstance.lastLoggedDateKey = newLastLoggedDateKey;

        // Save the changes to the database
        await userStreakInstance.save();

         console.log(`User streak ${created ? 'created' : 'updated'} for user ${userId}.`);

         // Return the updated data as a plain object
         return userStreakInstance.toJSON();

     } catch (err) {
         console.error(`Error finding/creating/updating user streak for ${userId}:`, err);
         throw new Error('Failed to update user streak data.');
     }
}


// Function to get all user streaks for the streakboard (no caching)
async function getAllUserStreaks() {
    console.log(`[${new Date().toISOString()}] Fetching fresh streak data from database for getAllUserStreaks.`);
    try {
        // Fetch all user streaks, ordered by streakCount descending
        const streaks = await UserStreak.findAll({
            order: [['streakCount', 'DESC']],
        });

        // Convert Sequelize instances to plain objects
        const plainStreaks = streaks.map(streak => streak.toJSON());

        return plainStreaks;

    } catch (err) {
        console.error('Error fetching all user streaks:', err);
        throw new Error('Failed to fetch all user streak data from database.');
    }
}

// Function to get the total count of user streak entries (no caching)
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

// Helper function to calculate the score (logic remains the same, operates on log object)
function calculateScore(log) {
    let score = 0;

    // Access data using object properties (matching the keys from Sadhana model)
    if ((log.japaRounds || 0) > 0) {
        score += 1;
    }

    score += (log.studyHours || 0) * 0.1;
    score += (log.listeningHours || 0) * 0.1;

    if (log.readingDetails && log.readingDetails.trim() !== '') {
        score += 1;
    }

    if (log.wokeUpEarlyStatus === true) {
        score += 1;
    }

    if (log.sleptEarlyStatus === true) {
        score += 1;
    }

    if (log.noMeatEating === true) score += 1;
    if (log.noGambling === true) score += 1;
    if (log.noIllicitSex === true) score += 1;
    if (log.noIntoxication === true) score += 1;


    return parseFloat(score.toFixed(2));
}


// --- End Database Data Interaction Functions ---


// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth, setHours, setMinutes, setSeconds, isBefore, differenceInMilliseconds } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// Import node-cron for scheduling tasks
// Make sure 'node-cron' is installed: npm install node-cron
const cron = require('node-cron');


// Get bot token, client ID, guild ID, and other IDs from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID; // Add this to your .env file


// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time

// Define the daily cutoff time for logging practice (e.g., 11:59 PM IST)
const DAILY_CUTOFF_HOUR_IST = 23; // 23 for 11 PM
const DAILY_CUTOFF_MINUTE_IST = 59; // 59 for 59 minutes

// Define how many entries per page for the streakboard
const ENTRIES_PER_PAGE = 10;


// Create a new Discord client instance.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages, // Might need this for modals in DMs, though typically modals are guild-based
    ],
});


// --- Define Slash Commands ---
const commands = [
     {
        name: 'chant',
        description: 'Log your japa rounds chanted for today.',
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
        name: 'logpractice',
        description: 'Log your daily spiritual practices using a form.',
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


// --- Define the Log Practice Modal ---
const logPracticeModal = new ModalBuilder()
    .setCustomId('logPracticeModal') // Unique ID for this modal
    .setTitle('Log Your Daily Practice');

// Create text input components for the modal
const dateInput = new TextInputBuilder()
    .setCustomId('dateInput')
    .setLabel('Date (dd/mm/yyyy)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 07/05/2025');

const japaRoundsInput = new TextInputBuilder()
    .setCustomId('japaRoundsInput')
    .setLabel('Japa Rounds Chanted')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 16');

const studyHoursInput = new TextInputBuilder()
    .setCustomId('studyHoursInput')
    .setLabel('Study Hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 1.5');

const readingDetailsInput = new TextInputBuilder()
    .setCustomId('readingDetailsInput')
    .setLabel('Reading Details (What you read and how much)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('e.g., Bhagavad Gita Ch 2, 10 pages');

const listeningHoursInput = new TextInputBuilder()
    .setCustomId('listeningHoursInput')
    .setLabel('Listening Hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 0.75');


// Add inputs to the modal, grouping them into 5 Action Rows, one input per row for short inputs.
logPracticeModal.addComponents(
    { type: 1, components: [dateInput] },
    { type: 1, components: [japaRoundsInput] },
    { type: 1, components: [studyHoursInput] },
    { type: 1, components: [listeningHoursInput] },
    { type: 1, components: [readingDetailsInput] }
);


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

            leaderboardDescription += `${globalRank}. **${username}**: ${userStreak.streakCount} day(s) 🙏\n`;
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
    cron.schedule('0 22 * * *', async () => {
        console.log(`[${new Date().toISOString()}] Running daily streak warning job.`);
        try {
            const now = new Date();
            const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE));

            // Calculate the cutoff time for today in IST
            let cutoffTimeTodayIST = setHours(setMinutes(setSeconds(todayIST, 0), DAILY_CUTOFF_MINUTE_IST), DAILY_CUTOFF_HOUR_IST);
             // If the current time is past the cutoff time, the cutoff is for the *next* day.
             // However, for the warning, we want to warn *before* today's cutoff.
             // So, we just need today's cutoff time.

            // Fetch all users with a streak > 0
            const usersWithStreaks = await UserStreak.findAll({
                where: {
                    streakCount: { [Op.gt]: 0 }
                }
            });

            console.log(`[${new Date().toISOString()}] Found ${usersWithStreaks.length} users with streaks.`);

            for (const userStreak of usersWithStreaks) {
                const userId = userStreak.userId;

                // Check if the user has logged practice for today by looking for a Sadhana entry
                const todayLog = await Sadhana.findOne({
                    where: {
                        userId: userId,
                        date: {
                            [Op.gte]: startOfDay(toZonedTime(now, IST_TIMEZONE)),
                            [Op.lte]: endOfDay(toZonedTime(now, IST_TIMEZONE))
                        }
                    }
                });

                // If no log for today, send a warning DM
                if (!todayLog) {
                    try {
                        const user = await client.users.fetch(userId);
                        if (user) {
                            // Calculate remaining time until cutoff
                            const nowIST = toZonedTime(new Date(), IST_TIMEZONE);
                            const timeRemainingMs = differenceInMilliseconds(cutoffTimeTodayIST, nowIST);

                            if (timeRemainingMs > 0) {
                                const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
                                const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));

                                const warningMessage = `Hare Krishna! 🙏 Your chanting streak of ${userStreak.streakCount} day(s) is about to be lost! You haven't logged your practice for today yet.`;
                                const timeRemainingMessage = `You have about ${hours} hours and ${minutes} minutes remaining to log your rounds using \`/chant <rounds>\` or log your full practice using \`/logpractice\`. Don't miss your streak!`;

                                const embed = new EmbedBuilder()
                                    .setColor('#FFCC00')
                                    .setTitle('Streak Warning!')
                                    .setDescription(`${warningMessage}\n${timeRemainingMessage}`);

                                await user.send({ embeds: [embed] });
                                console.log(`[${new Date().toISOString()}] Sent streak warning DM to user ${userId}`);
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
    cron.schedule('0 8 * * *', async () => {
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
                                  + `Quickly log your japa rounds using \`/chant <rounds>\`.\n`
                                  + `Log your full practice details using \`/logpractice\`.`);

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

    // --- Handle Slash Command Interactions ---
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        // --- Handle /chant command ---
        if (commandName === 'chant') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /chant command for user ${interaction.user.tag}`);
            // Defer the reply immediately
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            const rounds = interaction.options.getInteger('rounds');
            const userId = interaction.user.id;
            const guildId = interaction.guild?.id;
            const now = new Date();
            const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE));

            if (rounds < 0) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('Number of rounds cannot be negative.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // --- Database Interaction for /chant (Sadhana Log part) ---
            let sadhanaEntry;
            let created;
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database findOrCreate for Sadhana log (/chant) for user ${userId} on ${format(todayIST, 'yyyy-MM-dd')}`);
            try {
                 [sadhanaEntry, created] = await Sadhana.findOrCreate({
                    where: {
                        userId: userId,
                        date: {
                             [Op.gte]: startOfDay(toZonedTime(now, IST_TIMEZONE)),
                             [Op.lte]: endOfDay(toZonedTime(now, IST_TIMEZONE))
                        }
                    },
                    defaults: {
                        userId: userId,
                        guildId: guildId,
                        date: todayIST,
                        japaRounds: rounds,
                        studyHours: 0,
                        listeningHours: 0,
                        readingDetails: '',
                        wakingTime: null,
                        wokeUpEarlyStatus: false,
                        sleepingTime: null,
                        sleptEarlyStatus: false,
                        noMeatEating: false,
                        noGambling: false,
                        noIllicitSex: false,
                        noIntoxication: false,
                        additionalService: '',
                        score: 0,
                    }
                });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreate for Sadhana log (/chant). Created: ${created}`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during findOrCreate for Sadhana log (/chant):`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while accessing the Sadhana database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // If updating an existing Sadhana entry, add the new rounds to existing rounds
            if (!created) {
                 sadhanaEntry.japaRounds = (sadhanaEntry.japaRounds || 0) + rounds;
            }

            // Recalculate and save the score for the Sadhana entry
            sadhanaEntry.score = calculateScore(sadhanaEntry.toJSON());

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database save for Sadhana log (/chant) for user ${userId} on ${format(todayIST, 'yyyy-MM-dd')}`);
            try {
                await sadhanaEntry.save();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database save for Sadhana log (/chant).`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during save for Sadhana log (/chant):`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while saving Sadhana data to the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }


            // --- Chanting Streak Logic for /chant ---
            let userStreak;
            let streakCreated;
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database findOrCreateAndUpdateUserStreak for streak (/chant) for user ${userId}`);
            try {
                 [userStreak, streakCreated] = await UserStreak.findOrCreate({
                    where: { userId: userId },
                    defaults: {
                        userId: userId,
                        streakCount: 0,
                        lastLoggedDateKey: null,
                    }
                });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreate for streak (/chant). Created: ${streakCreated}`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during findOrCreate for streak (/chant):`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Chanting Log Failed')
                      .setDescription('An error occurred while accessing streak data. Please try again later.');
                  await interaction.editReply({ embeds: [embed] });
                  return;
            }


            let currentStreak = userStreak.streakCount;
            const lastLoggedDateKey = userStreak.lastLoggedDateKey;
            let newStreak = currentStreak;

            const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;

            if (todayIST && !isNaN(todayIST.getTime())) {
                if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) {
                    const dayDifference = differenceInCalendarDays(todayIST, lastLoggedDate);

                    if (dayDifference === 1) {
                        newStreak = currentStreak + 1;
                    } else if (dayDifference > 1) {
                        newStreak = 1; // Reset streak
                    } else if (dayDifference <= 0 && format(todayIST, 'yyyy-MM-dd') !== lastLoggedDateKey) {
                        newStreak = currentStreak;
                    }
                } else {
                    newStreak = 1;
                }

                if (!lastLoggedDateKey || (lastLoggedDate && todayIST >= lastLoggedDate)) {
                     userStreak.streakCount = newStreak;
                     userStreak.lastLoggedDateKey = format(todayIST, 'yyyy-MM-dd'); // Corrected format
                }


            } else {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Invalid todayIST date for streak logic (/chant): ${todayIST}`);
            }

            // Save the updated user streak
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database save for streak (/chant) for user ${userId}`);
            try {
                await userStreak.save();
                console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database save for streak (/chant).`);
            } catch (dbError) {
                console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during save for streak (/chant):`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while saving streak data to the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }


            // --- Create an embed response message for /chant ---
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Japa Rounds Logged!')
                .setDescription(`You logged **${rounds}** rounds for today (${format(todayIST, 'dd/MM/yyyy')}).`)
                .addFields(
                     { name: 'Current Chanting Streak', value: `${userStreak.streakCount} day(s) 🙏}`, inline: true }
                );

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for /chant command for user ${userId}`);
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for /chant command for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply with embed for /chant command for user ${userId}:`, editError);
                 try {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError); // Log full error
                     await interaction.followUp({ content: 'Successfully logged your chanting, but failed to update the original message.', ephemeral: true });
                 } catch (followUpError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                 }
            }


        }
        // --- Handle /logpractice command ---
        else if (commandName === 'logpractice') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /logpractice command for user ${interaction.user.tag}`);
            try {
                 await interaction.showModal(logPracticeModal);
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully showed logPracticeModal to user ${interaction.user.tag}`);
            } catch (modalError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error showing logPracticeModal to user ${interaction.user.tag}:`, modalError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('An error occurred while opening the practice logging form. Please try again later.');
                 await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
        // --- Handle /weeklysummary command ---
        else if (commandName === 'weeklysummary') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /weeklysummary command for user ${interaction.user.tag}`);
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
                             [Op.gte]: startDateIST,
                             [Op.lte]: endDateIST
                         }
                     },
                     order: [['date', 'ASC']]
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 let japaRounds = 0;
                 let studyHours = 0;
                 let listeningHours = 0;
                 let readingCount = 0;
                 let wokeUpEarlyCount = 0;
                 let sleptEarlyCount = 0;
                 let regulativePrinciplesCount = 0;
                 let additionalServiceCount = 0;

                 for (const log of logs) {
                     const logData = log.toJSON();
                     totalScore += calculateScore(logData);
                     loggedDays++;
                     japaRounds += logData.japaRounds || 0;
                     studyHours += logData.studyHours || 0;
                     listeningHours += logData.listeningHours || 0;
                     if (logData.readingDetails && logData.readingDetails.trim() !== '') readingCount++;
                     if (logData.wokeUpEarlyStatus) wokeUpEarlyCount++;
                     if (logData.sleptEarlyStatus) sleptEarlyCount++;

                     if (logData.noMeatEating && logData.noGambling && logData.noIllicitSex && logData.noIntoxication) {
                         regulativePrinciplesCount++;
                     }

                     if (logData.additionalService && logData.additionalService.trim() !== '') additionalServiceCount++;
                 }

                 const embed = new EmbedBuilder()
                     .setColor('#3498DB')
                     .setTitle(`Weekly Practice Summary for ${interaction.user.username}`)
                     .setDescription(`Summary for the period: ${format(startDateIST, 'dd/MM/yyyy')} - ${format(endDateIST, 'dd/MM/yyyy')}`)
                     .addFields(
                         { name: 'Total Score', value: `${totalScore.toFixed(2)} points`, inline: true },
                         { name: 'Logged Days', value: `${loggedDays} day(s)`, inline: true },
                         { name: 'Total Japa Rounds', value: `${japaRounds}`, inline: true },
                         { name: 'Total Study Hours', value: `${studyHours.toFixed(2)}`, inline: true },
                         { name: 'Total Listening Hours', value: `${listeningHours.toFixed(2)}`, inline: true },
                         { name: 'Days with Reading', value: `${readingCount}`, inline: true },
                         { name: 'Days Woke Up Early', value: `${wokeUpEarlyCount}`, inline: true },
                         { name: 'Days Slept Early', value: `${sleptEarlyCount}`, inline: true },
                         { name: 'Days Regulative Principles Followed', value: `${regulativePrinciplesCount}`, inline: true },
                         { name: 'Days with Additional Service', value: `${additionalServiceCount}`, inline: true }
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
        // --- Handle /monthlysummary command ---
        else if (commandName === 'monthlysummary') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /monthlysummary command for user ${interaction.user.tag}`);
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
                             [Op.gte]: startDateIST,
                             [Op.lte]: endDateIST
                         }
                     },
                     order: [['date', 'ASC']]
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 let japaRounds = 0;
                 let studyHours = 0;
                 let listeningHours = 0;
                 let readingCount = 0;
                 let wokeUpEarlyCount = 0;
                 let sleptEarlyCount = 0;
                 let regulativePrinciplesCount = 0;
                 let additionalServiceCount = 0;

                 for (const log of logs) {
                     const logData = log.toJSON();
                     totalScore += calculateScore(logData);
                     loggedDays++;
                     japaRounds += logData.japaRounds || 0;
                     studyHours += logData.studyHours || 0;
                     listeningHours += logData.listeningHours || 0;
                     if (logData.readingDetails && logData.readingDetails.trim() !== '') readingCount++;
                     if (logData.wokeUpEarlyStatus) wokeUpEarlyCount++;
                     if (logData.sleptEarlyStatus) sleptEarlyCount++;

                     if (logData.noMeatEating && logData.noGambling && logData.noIllicitSex && logData.noIntoxication) {
                         regulativePrinciplesCount++;
                     }

                     if (logData.additionalService && logData.additionalService.trim() !== '') additionalServiceCount++;
                 }

                 const embed = new EmbedBuilder()
                     .setColor('#2ECC71')
                     .setTitle(`Monthly Practice Summary for ${interaction.user.username}`)
                     .setDescription(`Summary for ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`)
                     .addFields(
                         { name: 'Total Score', value: `${totalScore.toFixed(2)} points`, inline: true },
                         { name: 'Logged Days', value: `${loggedDays} day(s)`, inline: true },
                         { name: 'Total Japa Rounds', value: `${japaRounds}`, inline: true },
                         { name: 'Total Study Hours', value: `${studyHours.toFixed(2)}`, inline: true },
                         { name: 'Total Listening Hours', value: `${listeningHours.toFixed(2)}`, inline: true },
                         { name: 'Days with Reading', value: `${readingCount}`, inline: true },
                         { name: 'Days Woke Up Early', value: `${wokeUpEarlyCount}`, inline: true },
                         { name: 'Days Slept Early', value: `${sleptEarlyCount}`, inline: true },
                         { name: 'Days Regulative Principles Followed', value: `${regulativePrinciplesCount}`, inline: true },
                         { name: 'Days with Additional Service', value: `${additionalServiceCount}`, inline: true }
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
        // --- Handle /leaderboard command ---
        else if (commandName === 'leaderboard') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /leaderboard command for user ${interaction.user.tag}`);
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
            let startDateIST;
            let endDateIST = endOfDay(toZonedTime(now, IST_TIMEZONE));
            let leaderboardTitle;
            let leaderboardDescription;

            if (period === 'weekly') {
                startDateIST = startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE));
                leaderboardTitle = 'Weekly Practice Leaderboard 🏆';
                leaderboardDescription = `Top devotees based on scores from ${format(startDateIST, 'dd/MM/yyyy')} to ${format(endDateIST, 'dd/MM/yyyy')}`;
            } else if (period === 'monthly') {
                startDateIST = startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE));
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
                            [Op.gte]: startDateIST,
                            [Op.lte]: endDateIST
                        }
                    },
                    attributes: ['userId', 'japaRounds', 'studyHours', 'listeningHours', 'readingDetails', 'wokeUpEarlyStatus', 'sleptEarlyStatus', 'noMeatEating', 'noGambling', 'noIllicitSex', 'noIntoxication', 'additionalService'],
                });

                const userScores = {};
                for (const log of logs) {
                    const logData = log.toJSON();
                    const userId = logData.userId;
                    const score = calculateScore(logData);

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
                        let username = 'Unknown User';
                         try {
                              if (interaction.guild) {
                                 const member = await interaction.guild.members.fetch(entry.userId);
                                  username = member.user.globalName || member.user.username;
                              } else {
                                  const user = await client.users.fetch(entry.userId);
                                  username = user.globalName || user.username;
                              }
                         } catch (err) {
                             console.warn(`Could not fetch user/member ${entry.userId} for leaderboard:`, err.message);
                             username = `User ID: ${entry.userId}`;
                         }
                        leaderboardText += `${i + 1}. **${username}**: ${entry.totalScore.toFixed(2)} points (${entry.loggedDays} logged day(s))\n`;
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
        // --- Handle /myscore command ---
        else if (commandName === 'myscore') {
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /myscore command for user ${interaction.user.tag}`);
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
             let startDateIST;
             let endDateIST = endOfDay(toZonedTime(now, IST_TIMEZONE));
             let scoreTitle;
             let scoreDescription;

             if (period === 'weekly') {
                 startDateIST = startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE));
                 scoreTitle = 'Your Weekly Practice Score';
                 scoreDescription = `Score for the period: ${format(startDateIST, 'dd/MM/yyyy')} - ${format(endDateIST, 'dd/MM/yyyy')}`;
             } else if (period === 'monthly') {
                 startDateIST = startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE));
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
                             [Op.gte]: startDateIST,
                             [Op.lte]: endDateIST
                         }
                     },
                     attributes: ['japaRounds', 'studyHours', 'listeningHours', 'readingDetails', 'wokeUpEarlyStatus', 'sleptEarlyStatus', 'noMeatEating', 'noGambling', 'noIllicitSex', 'noIntoxication', 'additionalService'],
                 });

                 let totalScore = 0;
                 let loggedDays = 0;
                 for (const log of logs) {
                     totalScore += calculateScore(log.toJSON());
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
        // --- Handle /showscore command ---
        else if (commandName === 'showscore') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /showscore command for user ${interaction.user.tag}`);
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
            const username = targetUser.globalName || targetUser.username;

            try {
                const userStreak = await getUserStreak(userId);
                const currentStreak = userStreak ? userStreak.streakCount : 0;

                const now = new Date();
                const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE));

                const startOfLast7DaysIST = startOfDay(toZonedTime(addDays(now, -6), IST_TIMEZONE));
                const startOfMonthIST = startOfDay(toZonedTime(startOfMonth(now), IST_TIMEZONE));

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
                    const logDate = log.date instanceof Date ? log.date : new Date(log.date);
                    const logDateIST = startOfDay(toZonedTime(logDate, IST_TIMEZONE));

                    allTimeScore += calculateScore(log.toJSON());
                    allTimeLoggedDays++;

                    // Corrected typo from startOfLast77DaysIST to startOfLast7DaysIST
                    if (!isBefore(logDateIST, startOfLast7DaysIST)) {
                        weeklyScore += calculateScore(log.toJSON());
                        weeklyLoggedDays++;
                    }

                    if (!isBefore(logDateIST, startOfMonthIST)) {
                         monthlyScore += calculateScore(log.toJSON());
                         monthlyLoggedDays++;
                    }
                }


                const embed = new EmbedBuilder()
                    .setColor('#00CED1')
                    .setTitle(`Practice Summary for ${username}`)
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
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /streakset command for user ${interaction.user.tag}`);


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
                     const now = new Date();
                     const yesterday = addDays(now, -1);
                     const yesterdayKey = format(yesterday, 'yyyy-MM-dd');

                     return {
                         newStreakCount: newStreakValue,
                         newLastLoggedDateKey: yesterdayKey
                     };
                 });

                const embed = new EmbedBuilder()
                    .setColor('#32CD32')
                    .setTitle('Streak Set Successfully')
                    .setDescription(`Successfully set ${targetUser.username}'s chanting streak to ${userStreak.streakCount}. Their last logged date is set for streak calculation.`);

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
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /help command for user ${interaction.user.tag}`);
            const youtubeLink = 'Yet to be uploaded';
            const embed = new EmbedBuilder()
                .setColor('#FFFF00')
                .setTitle('Helpful Resources and Commands')
                .setDescription(`Here are the available commands:\n\n`
                              + `- \`/chant <rounds>\`: Quickly log your japa rounds for today and update your chanting streak.\n`
                              + `- \`/logpractice\`: Open a form to log your full daily practice details.\n`
                              + `- \`/weeklysummary\`: Shows your practice summary for the last 7 days.\n`
                              + `- \`/monthlysummary\`: Shows your practice summary for the current month.\n`
                              + `- \`/leaderboard <period>\`: Shows the top devotees based on practice scores (weekly or monthly).\n`
                              + `- \`/myscore <period>\`: Shows your personal practice score for a specific period (weekly or monthly).\n`
                              + `- \`/showscore <user>\`: Shows a user\'s chanting streak and practice scores.\n`
                              + `- \`/streakboard\`: Shows the current chanting streak leaderboard with pagination.\n`
                              + `- \`/streakset <user> <streak>\`: Sets a user\'s chanting streak (Admin only).\n`
                              + `- \`/checkdata <type> [user] [date_string]\`: Check specific data from the database (Admin only).`);

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to reply for help command for user ${interaction.user.tag}`);
            try {
                 await interaction.reply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully replied for help command for user ${interaction.user.tag}`);
            } catch (replyError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error replying for help command for user ${interaction.user.tag}:`, replyError);
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
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /checkdata command for user ${interaction.user.tag}`);

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
                                { name: 'Current Streak', value: `${userStreak.streakCount} day(s)` },
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

                        const targetDateIST = startOfDay(toZonedTime(parsedDate, IST_TIMEZONE));

                         console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Fetching Sadhana log for user ${targetUser.id} on date ${dateString} from database.`);
                        const sadhanaLog = await Sadhana.findOne({
                             where: {
                                 userId: targetUser.id,
                                 date: {
                                     [Op.gte]: startOfDay(toZonedTime(parsedDate, IST_TIMEZONE)),
                                     [Op.lte]: endOfDay(toZonedTime(parsedDate, IST_TIMEZONE))
                                 }
                             }
                        });

                         if (sadhanaLog) {
                             const logData = sadhanaLog.toJSON();
                             embed.setTitle(`Sadhana Log for ${targetUser.username} on ${format(targetDateIST, 'dd/MM/yyyy')}`);
                             embed.addFields(
                                 { name: 'Japa Rounds', value: logData.japaRounds?.toString() || '0', inline: true },
                                 { name: 'Study Hours', value: logData.studyHours?.toFixed(1) || '0.0', inline: true },
                                 { name: 'Listening Hours', value: logData.listeningHours?.toFixed(1) || '0.0', inline: true },
                                 { name: 'Reading Details', value: logData.readingDetails || 'None', inline: true },
                                 { name: 'Waking Time', value: logData.wakingTime ? formatInTimeZone(logData.wakingTime, IST_TIMEZONE, 'hh:mm a zzz') : 'Not Logged', inline: true },
                                 { name: 'Sleeping Time', value: logData.sleepingTime ? formatInTimeZone(logData.sleepingTime, IST_TIMEZONE, 'hh:mm a zzz') : 'Not Logged', inline: true },
                                 { name: 'Woke Up Early', value: logData.wokeUpEarlyStatus ? 'Yes' : 'No', inline: true },
                                 { name: 'Slept Early', value: logData.sleptEarlyStatus ? 'Yes' : 'No', inline: true },
                                 { name: 'No Meat Eating', value: logData.noMeatEating ? 'Yes' : 'No', inline: true },
                                 { name: 'No Gambling', value: logData.noGambling ? 'Yes' : 'No', inline: true },
                                 { name: 'No Illicit Sex', value: logData.noIllicitSex ? 'Yes' : 'No', inline: true },
                                 { name: 'No Intoxication', value: logData.noIntoxication ? 'Yes' : 'No', inline: true },
                                 { name: 'Additional Service', value: logData.additionalService || 'None' },
                                 { name: 'Calculated Score', value: logData.score?.toFixed(2) || '0.00', inline: true }
                             );
                         } else {
                             embedDescription = `No Sadhana log found for ${targetUser.username} on ${format(targetDateIST, 'dd/MM/yyyy')}.`;
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
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling /streakboard command for user ${interaction.user.tag}`);
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
                           await interaction.followUp({ content: 'Successfully generated streakboard, but failed to update the original message.', ephemeral: true });
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
    }

    // --- Handle Modal Submit Interactions ---
    else if (interaction.isModalSubmit()) {
        console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Modal submission received: ${interaction.customId} for user ${interaction.user.tag}`);
        if (interaction.customId === 'logPracticeModal') {
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Handling logPracticeModal submission for user ${interaction.user.tag}`);
            try {
                 await interaction.deferReply({ ephemeral: true });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Reply deferred successfully (ephemeral) for modal submission ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error deferring reply for modal submission ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Deferral complete for modal submission ${interaction.id}. Proceeding with modal logic.`);


            const userId = interaction.user.id;
            const guildId = interaction.guild?.id;
            const now = new Date();
            const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE));

            const dateString = interaction.fields.getTextInputValue('dateInput');
            const japaRounds = parseInt(interaction.fields.getTextInputValue('japaRoundsInput'), 10) || 0;
            const studyHours = parseFloat(interaction.fields.getTextInputValue('studyHoursInput')) || 0;
            const listeningHours = parseFloat(interaction.fields.getTextInputValue('listeningHoursInput')) || 0;
            const readingDetails = interaction.fields.getTextInputValue('readingDetailsInput');


            const parsedDate = parse(dateString, 'dd/MM/yyyy', new Date());

            if (isNaN(parsedDate.getTime())) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('Invalid date format. Please use dd/mm/yyyy.');
                 await interaction.editReply({ embeds: [embed], ephemeral: true });
                 return;
            }

            const logDateIST = startOfDay(toZonedTime(parsedDate, IST_TIMEZONE));


            // --- Database Interaction for Modal Submission ---
            let sadhanaEntry;
            let created;
             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database findOrCreate for modal submission for user ${userId} on ${format(logDateIST, 'yyyy-MM-dd')}`);
            try {
                 [sadhanaEntry, created] = await Sadhana.findOrCreate({
                    where: { userId: userId, date: logDateIST },
                    defaults: {
                        userId: userId,
                        guildId: guildId,
                        date: logDateIST,
                        japaRounds: japaRounds,
                        studyHours: studyHours,
                        listeningHours: listeningHours,
                        readingDetails: readingDetails,
                        wakingTime: null,
                        wokeUpEarlyStatus: false,
                        sleepingTime: null,
                        sleptEarlyStatus: false,
                        noMeatEating: false,
                        noGambling: false,
                        noIllicitSex: false,
                        noIntoxication: false,
                        additionalService: '',
                        score: 0,
                    }
                });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database findOrCreate for modal submission. Created: ${created}`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during findOrCreate for modal submission:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Logging Failed')
                      .setDescription('An error occurred while accessing the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed], ephemeral: true });
                 return;
            }

            if (!created) {
                sadhanaEntry.japaRounds = japaRounds;
                sadhanaEntry.studyHours = studyHours;
                sadhanaEntry.listeningHours = listeningHours;
                sadhanaEntry.readingDetails = readingDetails;
            }

            sadhanaEntry.score = calculateScore(sadhanaEntry.toJSON());

             console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Starting database save for modal submission for user ${userId} on ${format(logDateIST, 'yyyy-MM-dd')}`);
            try {
                await sadhanaEntry.save();
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished database save for modal submission.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during save for modal submission:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Logging Failed')
                      .setDescription('An error occurred while saving to the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed], ephemeral: true });
                 return;
            }

            // --- Streak Logic for Modal Submission ---
             if (format(logDateIST, 'yyyy-MM-dd') === format(todayIST, 'yyyy-MM-dd')) {
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Log date is today. Updating streak for user ${userId}.`);
                 try {
                      const userStreak = await findOrCreateAndUpdateUserStreak(userId, (currentUserStreak) => {
                          let currentStreak = currentUserStreak ? currentUserStreak.streakCount : 0;
                          const lastLoggedDateKey = currentUserStreak ? currentUserStreak.lastLoggedDateKey : null;
                          let newStreak = currentStreak;

                          const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;

                          if (todayIST && !isNaN(todayIST.getTime())) {
                              if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) {
                                  const dayDifference = differenceInCalendarDays(todayIST, lastLoggedDate);

                                  if (dayDifference === 1) {
                                      newStreak = currentStreak + 1;
                                  } else if (dayDifference > 1) {
                                      newStreak = 1;
                                  } else if (dayDifference <= 0 && format(todayIST, 'yyyy-MM-dd') !== lastLoggedDateKey) {
                                      newStreak = currentStreak;
                                  }
                              } else {
                                  newStreak = 1;
                              }

                               if (!lastLoggedDateKey || (lastLoggedDate && todayIST >= lastLoggedDate)) {
                                    return { newStreakCount: newStreak, newLastLoggedDateKey: format(todayIST, 'yyyy-MM-dd') };
                               } else {
                                    return { newStreakCount: currentStreak, newLastLoggedDateKey: lastLoggedDateKey };
                               }


                          } else {
                               console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Invalid todayIST date for streak logic (modal): ${todayIST}`);
                               return { newStreakCount: currentStreak, newLastLoggedDateKey: lastLoggedDateKey };
                          }
                      });
                       console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Finished updating streak for user ${userId} from modal.`);
                 } catch (dbError) {
                      console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Database error during streak update (modal):`, dbError);
                 }
             } else {
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Log date (${format(logDateIST, 'yyyy-MM-dd')}) is not today. Skipping streak update for user ${userId}.`);
             }


            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Practice Logged Successfully!')
                .setDescription(`Your practice for ${format(logDateIST, 'dd/MM/yyyy')} has been logged.`);

            embed.addFields(
                { name: 'Japa Rounds', value: japaRounds.toString(), inline: true },
                { name: 'Study Hours', value: studyHours.toFixed(2), inline: true },
                { name: 'Listening Hours', value: listeningHours.toFixed(2), inline: true },
                { name: 'Reading Details', value: readingDetails || 'None' },
                { name: 'Calculated Score', value: sadhanaEntry.score.toFixed(2), inline: true }
            );

            console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Attempting to editReply for modal submission for user ${userId}`);
            try {
                 await interaction.editReply({ embeds: [embed], ephemeral: true });
                 console.log(`[${new Date().toISOString()}] [PID:${process.pid}] Successfully edited reply for modal submission for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Error editing reply for modal submission for user ${userId}:`, editError);
                 try {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Full editReply error object:`, editError);
                     await interaction.followUp({ content: 'Successfully logged your practice, but failed to update the original message.', ephemeral: true });
                 } catch (followUpError) {
                     console.error(`[${new Date().toISOString()}] [PID:${process.pid}] Failed to send follow-up message after editReply error:`, followUpError);
                 }
            }


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
