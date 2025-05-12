// Load environment variables from .env file
require('dotenv').config();

// Import necessary classes from discord.js
// Added ModalBuilder, TextInputBuilder, TextInputStyle
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth, setHours, setMinutes, setSeconds, isBefore, differenceInMilliseconds } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// Import Sequelize and DataTypes
const { Sequelize, DataTypes } = require('sequelize'); // Import Sequelize and DataTypes

// Import node-cron for scheduling tasks
// Make sure 'node-cron' is installed: npm install node-cron
const cron = require('node-cron');


// Get bot token, client ID, guild ID, and PostgreSQL URI from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
const postgresUri = process.env.POSTGRES_URI; // Get the PostgreSQL URI from .env
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID; // Add this to your .env file

// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time

// Define the daily cutoff time for logging practice (e.g., 11:59 PM IST)
const DAILY_CUTOFF_HOUR_IST = 23; // 23 for 11 PM
const DAILY_CUTOFF_MINUTE_IST = 59; // 59 for 59 minutes


// --- Database Connection using Sequelize ---
// Create a new Sequelize instance
const sequelize = new Sequelize(postgresUri, {
    dialect: 'postgres', // Specify the database dialect
    logging: console.log, // Optional: enable logging of SQL queries
    dialectOptions: {
        ssl: {
            require: true, // Require SSL connection for production
            rejectUnauthorized: false // Adjust based on your PostgreSQL provider's SSL cert
        }
    },
    // Add connection pool options if needed for performance
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    // --- Adjusted Timeout Options (Sequelize uses different options) ---
    // Sequelize connection options are different from MongoClient.
    // Timeouts are often handled at the pool or query level.
    // You might need to configure these based on your specific needs and PostgreSQL setup.
    // connectTimeout: 30000, // Example: connection timeout (might not be directly supported by dialect)
    // acquire: 30000 // Example: pool acquire timeout
    // --- End Adjusted Timeout Options ---
});

async function connectDB() {
    try {
        console.log("Attempting to connect to PostgreSQL...");
        // Authenticate the connection
        await sequelize.authenticate();
        console.log('PostgreSQL connection has been established successfully.');

        // Sync models with the database (creates tables if they don't exist)
        // Use { alter: true } carefully in production as it modifies existing tables
        await sequelize.sync(); // Or sequelize.sync({ alter: true });
        console.log("Database synchronized.");

    } catch (error) {
        console.error('Unable to connect to the PostgreSQL database:', error);
        // Exit the process if database connection fails
        process.exit(1);
    }
}

// Call the connection function when the bot starts
connectDB();


// --- Sequelize Model Definitions ---
// Define the Sadhana model (equivalent to Mongoose Schema)
const Sadhana = sequelize.define('Sadhana', { // Model name is 'Sadhana'
    userId: {
        type: DataTypes.STRING, // Use STRING for Discord IDs
        allowNull: false, // Equivalent to required: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: true, // Equivalent to required: false
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
    // Removed mangalaArati and morningProgram fields from the model
    sleepingTime: {
        type: DataTypes.DATE, // Store as DATE if possible, or STRING if 'Not Slept' is needed
        allowNull: true, // Allow null for 'Not Slept'
        // If you need to store 'Not Slept', you'd change type to DataTypes.STRING
        // and handle the string value in your application logic.
    },
    wakingTime: {
         type: DataTypes.DATE, // Store as DATE if possible, or STRING
         allowNull: true, // Allow null for 'Not Slept'
         // Similar considerations as sleepingTime
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
    tableName: 'sadhanas', // Optional: specify table name
    timestamps: false, // Sequelize adds createdAt and updatedAt by default, set to false if not needed
});

// Define the UserStreak model
const UserStreak = sequelize.define('UserStreak', {
    userId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true, // Ensure userId is unique
    },
    streakCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    lastLoggedDateKey: {
        type: DataTypes.STRING, // Store the date key string (e.g., 'YYYY-MM-DD')
        allowNull: true,
    },
}, {
    tableName: 'user_streaks', // Optional: specify table name
    timestamps: false, // Set to false if not needed
});


// Helper function to parse time string with date context and convert to IST
// This logic would remain similar, but you'd work with standard Date objects
// before saving to PostgreSQL.
function parseTimeInIST(dateKey, timeString) {
    try {
        const dateTimeString = `${dateKey} ${timeString}`;
        const parsedDate = parse(dateTimeString, 'yyyy-MM-dd h:mm a', fromZonedTime(new Date(dateKey + 'T00:00:00'), IST_TIMEZONE));

         if (isNaN(parsedDate.getTime())) {
             console.error(`Parsed date is invalid for string: "${dateTimeString}"`);
             return null;
        }

        const utcDate = fromZonedTime(parsedDate, IST_TIMEZONE);

        return utcDate;

    } catch (error) {
        console.error(`Error parsing time string "${timeString}" for date "${dateKey}":`, error);
        throw new Error(`Failed to parse time "${timeString}". Please use HH:MM AM/PM format.`);
    }
}


// Function to calculate the score (logic remains the same)
function calculateScore(log) {
    let score = 0;

    // Note: When using Sequelize, you'd access data using log.japaRounds, log.studyHours, etc.
    // The logic for calculating the score based on these values remains the same.
    if ((log.japaRounds || 0) > 0) {
        score += 1;
    }

    score += (log.studyHours || 0) * 0.1;
    score += (log.listeningHours || 0) * 0.1;

    if (log.readingDetails && log.readingDetails.trim() !== '') {
        score += 1;
    }

    // Removed scoring for mangalaArati and morningProgram
    // if (log.mangalaArati === true) {
    //     score += 1;
    // }
    //
    // if (log.morningProgram === true) {
    //     score += 1;
    // }

    // Note: Accessing the boolean status from Sequelize would be log.wokeUpEarlyStatus
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
// Added /chant and /streaklog command definitions
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
        // No options defined here, the modal handles input
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
                description: 'The user whose score to show.',
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
        description: 'Provides information about the bot commands.', // Updated description
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
                    { name: 'User Log by Date', value: 'user_log_by_date' },
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
        name: 'streaklog',
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

// Waking Time and Sleeping Time are removed from this modal to fit within the 5-row limit.
// const wakingTimeInput = new TextInputBuilder()
//     .setCustomId('wakingTimeInput')
//     .setLabel('Waking Time (h:mm AM/PM or "Not Slept")')
//     .setStyle(TextInputStyle.Short)
//     .setRequired(true)
//     .setPlaceholder('e.g., 4:30 AM or Not Slept');

const japaRoundsInput = new TextInputBuilder()
    .setCustomId('japaRoundsInput')
    .setLabel('Japa Rounds Chanted')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 16');

// Study Hours is now included in the modal
const studyHoursInput = new TextInputBuilder()
    .setCustomId('studyHoursInput')
    .setLabel('Study Hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 1.5');

const readingDetailsInput = new TextInputBuilder()
    .setCustomId('readingDetailsInput')
    .setLabel('Reading Details (What you read and how much)')
    .setStyle(TextInputStyle.Paragraph) // Use Paragraph for longer text
    .setRequired(true)
    .setPlaceholder('e.g., Bhagavad Gita Ch 2, 10 pages');

const listeningHoursInput = new TextInputBuilder()
    .setCustomId('listeningHoursInput')
    .setLabel('Listening Hours')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 0.75');

// Sleeping Time is removed from this modal to fit within the 5-row limit.
// const sleepingTimeInput = new TextInputBuilder()
//     .setCustomId('sleepingTimeInput')
//     .setLabel('Sleeping Time (h:mm AM/PM or "Not Slept")')
//     .setStyle(TextInputStyle.Short)
//     .setRequired(true)
//     .setPlaceholder('e.g., 10:30 PM or Not Slept');

// Regulative Principles input is removed from this modal.
// const regulativePrinciplesInput = new TextInputBuilder()
//     .setCustomId('regulativePrinciplesInput')
//     .setLabel('Regulative Principles (Yes/No, comma sep)') // Shortened label
//     .setStyle(TextInputStyle.Short)
//     .setRequired(true)
//     .setPlaceholder('e.g., Yes, Yes, Yes, Yes (Meat, Gambling, Sex, Intoxication)');

// Additional Service input is removed from the modal to fit within the 5-row limit.
// const additionalServiceInput = new TextInputBuilder()
//     .setCustomId('additionalServiceInput')
//     .setLabel('Additional Service (Optional)')
//     .setStyle(TextInputStyle.Paragraph)
//     .setRequired(false) // This is optional
    // .setPlaceholder('e.g., Distributed flyers, Cleaned temple');


// Add inputs to the modal, grouping them into 5 Action Rows, one input per row for short inputs.
logPracticeModal.addComponents(
    { type: 1, components: [dateInput] }, // Row 1: Date (Short)
    { type: 1, components: [japaRoundsInput] }, // Row 2: Japa Rounds (Short)
    { type: 1, components: [studyHoursInput] }, // Row 3: Study Hours (Short)
    { type: 1, components: [listeningHoursInput] }, // Row 4: Listening Hours (Short)
    { type: 1, components: [readingDetailsInput] } // Row 5: Reading Details (Paragraph)
);


// --- Bot Event Handlers ---

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online and ready to receive slash commands and modal submissions!');

    // --- Schedule Cron Jobs ---

    // Schedule daily streak warning DM (e.g., at 10:00 PM IST)
    // Cron format: minute hour day-of-month month day-of-week
    // Example: '0 22 * * *' runs at 22:00 (10:00 PM) every day
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
                    streakCount: { [Sequelize.Op.gt]: 0 }
                }
            });

            console.log(`[${new Date().toISOString()}] Found ${usersWithStreaks.length} users with streaks.`);

            for (const userStreak of usersWithStreaks) {
                const userId = userStreak.userId;

                // Check if the user has logged practice for today
                const todayLog = await Sadhana.findOne({
                    where: {
                        userId: userId,
                        date: todayIST // Check for log on the start of today in IST
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

                            if (timeRemainingMs > 0) { // Only send if there's time remaining today
                                const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
                                const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));

                                const warningMessage = `Hare Krishna! 🙏 Your chanting streak of ${userStreak.streakCount} day(s) is about to be lost! You haven't logged your practice for today yet.`;
                                const timeRemainingMessage = `You have about ${hours} hours and ${minutes} minutes remaining to log your rounds using \`/chant <rounds>\` or log your full practice using \`/logpractice\`. Don't miss your streak!`;

                                const embed = new EmbedBuilder()
                                    .setColor('#FFCC00') // Yellow/Orange color for warning
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
                        // This error might occur if the user has DMs disabled
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
        timezone: IST_TIMEZONE // Ensure the cron job runs based on IST
    });

    // Schedule daily announcement message (e.g., at 8:00 AM IST)
    // Example: '0 8 * * *' runs at 8:00 AM every day
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
                    .setColor('#0099FF') // Blue color
                    .setTitle('Daily Practice Reminder!')
                    .setDescription(`Hare Krishna! 🙏 Remember to log your spiritual practices for today.\n\n`
                                  + `Quickly log your japa rounds using \`/chant <rounds>\`.\n`
                                  + `Log your full practice details using \`/logpractice\`.`);

                // Use channel.send to send the message
                // To mention everyone, you would add allowedMentions and content: '@everyone'
                // However, mentioning @everyone frequently can be disruptive.
                // A better approach might be to mention a specific role or just send the message without a mass mention.
                // For now, sending without @everyone mention. If you need @everyone, uncomment the content and allowedMentions lines.
                await channel.send({
                    // content: '@everyone', // Uncomment this line to mention everyone (requires bot permissions)
                    embeds: [embed],
                    // allowedMentions: { parse: ['everyone'] } // Uncomment this line if mentioning everyone
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
        timezone: IST_TIMEZONE // Ensure the cron job runs based on IST
    });


});

client.on('interactionCreate', async interaction => {
    console.log(`[${new Date().toISOString()}] Interaction received: ${interaction.id}, Type: ${interaction.type}, Command: ${interaction.isCommand() ? interaction.commandName : 'N/A'}, Modal: ${interaction.isModalSubmit() ? interaction.customId : 'N/A'}`);

    // --- Handle Slash Command Interactions ---
    if (interaction.isCommand()) {
        const { commandName } = interaction;

        // --- Handle /chant command ---
        if (commandName === 'chant') {
            console.log(`[${new Date().toISOString()}] Handling /chant command for user ${interaction.user.tag}`);
            // Defer the reply immediately
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            const rounds = interaction.options.getInteger('rounds');
            const userId = interaction.user.id;
            const guildId = interaction.guild?.id;
            const todayIST = startOfDay(toZonedTime(new Date(), IST_TIMEZONE)); // Get start of today in IST

            if (rounds < 0) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('Number of rounds cannot be negative.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // --- Database Interaction for /chant ---
            let sadhanaEntry;
            let created;
            console.log(`[${new Date().toISOString()}] Starting database findOrCreate for /chant for user ${userId} on ${format(todayIST, 'yyyy-MM-dd')}`);
            try {
                 [sadhanaEntry, created] = await Sadhana.findOrCreate({
                    where: { userId: userId, date: todayIST },
                    defaults: {
                        userId: userId,
                        guildId: guildId,
                        date: todayIST,
                        japaRounds: rounds,
                         // Set other fields to default values as they are not provided by /chant
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
                        score: 0, // Calculate score after updating
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database findOrCreate for /chant. Created: ${created}`);
            } catch (dbError) {
                console.error(`Database error during findOrCreate for /chant:`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while accessing the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // If updating, update the japa rounds
            if (!created) {
                sadhanaEntry.japaRounds = rounds;
            }

            // Recalculate and save the score
            sadhanaEntry.score = calculateScore(sadhanaEntry); // Corrected typo here

            console.log(`[${new Date().toISOString()}] Starting database save for /chant for user ${userId} on ${format(todayIST, 'yyyy-MM-dd')}`);
            try {
                await sadhanaEntry.save();
                 console.log(`[${new Date().toISOString()}] Finished database save for /chant.`);
            } catch (dbError) {
                console.error(`Database error during save for /chant:`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('An error occurred while saving to the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }


            // --- Chanting Streak Logic for /chant ---
             // Find or create the user's streak entry
            let userStreak;
            let streakCreated;
            console.log(`[${new Date().toISOString()}] Starting database findOrCreate for streak (/chant) for user ${userId}`);
            try {
                 [userStreak, streakCreated] = await UserStreak.findOrCreate({
                    where: { userId: userId },
                    defaults: {
                        userId: userId,
                        streakCount: 0,
                        lastLoggedDateKey: null,
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database findOrCreate for streak (/chant). Created: ${streakCreated}`);
            } catch (dbError) {
                 console.error(`Database error during findOrCreate for streak (/chant):`, dbError);
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

                if (!lastLoggedDateKey || (todayIST > lastLoggedDate)) {
                     userStreak.streakCount = newStreak;
                     userStreak.lastLoggedDateKey = format(todayIST, 'yyyy-MM-dd'); // Use yyyy-MM-dd format
                } else {
                     newStreak = userStreak.streakCount;
                }
            } else {
                 console.error(`Invalid todayIST date for streak logic (/chant): ${todayIST}`);
                 // Optionally, reply with an embed for this error case
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('Internal error processing log date for streak calculation. Please contact bot administrator.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            console.log(`[${new Date().toISOString()}] Starting database save for streak (/chant) for user ${userId}`);
            try {
                 await userStreak.save();
                 console.log(`[${new Date().toISOString()}] Finished database save for streak (/chant).`);
            } catch (dbError) {
                 console.error(`Database error during save for streak (/chant):`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Chanting Log Failed')
                      .setDescription('An error occurred while saving streak data. Please try again later.');
                  await interaction.editReply({ embeds: [embed] });
                  return;
            }


            // --- Create an embed response message for /chant ---
            const embed = new EmbedBuilder()
                .setColor('#00FF00') // Green color
                .setTitle('Japa Rounds Logged!')
                .setDescription(`You logged **${sadhanaEntry.japaRounds}** rounds for today (${format(todayIST, 'dd/MM/yyyy')}).`)
                .addFields(
                     { name: 'Score for today (so far)', value: sadhanaEntry.score.toString(), inline: true },
                     { name: 'Current Chanting Streak', value: `${userStreak.streakCount} day(s) 🙏`, inline: true }
                );

            console.log(`[${new Date().toISOString()}] Attempting to editReply for /chant command for user ${userId}`);
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for /chant command for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for /chant command for user ${userId}:`, editError);
            }


        }
        else if (commandName === 'logpractice') {
            console.log(`[${new Date().toISOString()}] Handling /logpractice command for user ${interaction.user.tag}`);
            // Show the modal instead of deferring and processing directly
            try {
                await interaction.showModal(logPracticeModal);
                console.log(`[${new Date().toISOString()}] Modal shown successfully for interaction ${interaction.id}`);
            } catch (modalError) {
                console.error(`[${new Date().toISOString()}] Error showing modal for interaction ${interaction.id}:`, modalError);
                // Reply with an error if showing the modal fails
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('An error occurred while trying to open the logging form. Please try again.');
                 // Use editReply here as showModal attempts to acknowledge the interaction
                 // Also use flags instead of ephemeral
                 if (interaction.deferred || interaction.replied) {
                     await interaction.editReply({ embeds: [embed] });
                 } else {
                      // Fallback reply if somehow not acknowledged, though less likely after showModal attempt
                      await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
                 }
            }

        }
        // Handle other commands (weeklysummary, monthlysummary, leaderboard, myscore, showscore, streakset, help, checkdata)
        // These handlers remain largely the same, but you might need to adjust how they access data
        // if the underlying data structure or input methods change significantly.
        // For now, they should work with the existing database structure.
        else if (commandName === 'weeklysummary') {
            console.log(`[${new Date().toISOString()}] Handling /weeklysummary command for user ${interaction.user.tag}`);
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const userId = interaction.user.id;

            const now = new Date();
            const todayStart = startOfDay(now);
            const sevenDaysAgoStart = startOfDay(addDays(now, -6));

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let recentLogs;
            console.log(`[${new Date().toISOString()}] Starting database query for weeklysummary for user ${userId}`);
            try {
                 recentLogs = await Sadhana.findAll({
                    where: {
                        userId: userId,
                        date: {
                            [Sequelize.Op.gte]: sevenDaysAgoStart,
                            [Sequelize.Op.lte]: todayStart
                        }
                    },
                    order: [['date', 'ASC']]
                });
                console.log(`[${new Date().toISOString()}] Finished database query for weeklysummary. Found ${recentLogs.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for weeklysummary:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Weekly Summary Failed')
                      .setDescription('An error occurred while fetching weekly data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                  if (!interaction.replied && !interaction.deferred) {
                       await interaction.reply({ embeds: [embed] });
                  } else {
                       await interaction.editReply({ embeds: [embed] });
                  }
                  return;
            }


            let totalRounds = 0;
            let totalStudyHours = 0;
            let totalListeningHours = 0;
            let totalScore = 0;
            const booksReadThisWeek = new Set();
            let earlyWakingCount = 0;
            let earlySleepingCount = 0;
            let principlesFollowedCount = 0;
            const loggedDaysCount = recentLogs.length;

            for (const log of recentLogs) {
                totalRounds += log.japaRounds || 0;
                totalStudyHours += log.studyHours || 0;
                totalListeningHours += log.listeningHours || 0;
                totalScore += log.score || 0;
                if (log.readingDetails && log.readingDetails.trim() !== '') {
                    booksReadThisWeek.add(log.readingDetails);
                }
                if (log.wakingTime !== null && log.wokeUpEarlyStatus === true) earlyWakingCount++; // Check for null
                if (log.sleepingTime !== null && log.sleptEarlyStatus === true) earlySleepingCount++; // Check for null
                if (log.noMeatEating === true) principlesFollowedCount++;
                if (log.noGambling === true) principlesFollowedCount++;
                if (log.noIllicitSex === true) principlesFollowedCount++;
                if (log.noIntoxication === true) principlesFollowedCount++;
            }

            const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
            const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
            const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
            const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0;
            // Calculate average principles per logged day (each day has 4 principles)
            const avgPrinciplesPerDay = loggedDaysCount > 0 ? (principlesFollowedCount / loggedDaysCount / 4).toFixed(2) : 0; // Divide by 4 for average per day


            // Create an embed for the weekly summary
            const embed = new EmbedBuilder()
                .setColor('#00AA00') // Green color
                .setTitle(`Weekly Practice Summary for ${interaction.user.username}`)
                .setDescription(`(Summary based on ${loggedDaysCount} logged day(s) in the last 7 days)`)
                .addFields(
                    { name: 'Total Score', value: `${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})` },
                    { name: 'Total Rounds Chanted', value: `${totalRounds} (Avg per logged day: ${avgRounds})` },
                    { name: 'Total Study Hours', value: `${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})`, inline: true },
                    { name: 'Total Listening Hours', value: `${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})`, inline: true },
                    { name: 'Woke up early (< 5 AM IST)', value: `${earlyWakingCount} time(s)`, inline: true },
                    { name: 'Slept early (< 11 PM IST Previous Night)', value: `${earlySleepingCount} time(s)`, inline: true },
                     { name: 'Avg. Regulative Principles Followed per Logged Day', value: `${avgPrinciplesPerDay} / 4` }, // Changed to out of 4
                    { name: 'Reading Logged', value: booksReadThisWeek.size > 0 ? Array.from(booksReadThisWeek).join('; ') : 'None' }
                );

            console.log(`[${new Date().toISOString()}] Attempting to editReply for weeklysummary for user ${userId}`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for weeklysummary for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for weeklysummary for user ${userId}:`, editError);
            }


        }
         // Handle the /monthlysummary command (Need to be rewritten for Sequelize)
         else if (commandName === 'monthlysummary') {
            console.log(`[${new Date().toISOString()}] Handling /monthlysummary command for user ${interaction.user.tag}`);
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
             console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const userId = interaction.user.id;

            const now = new Date();
            const startDate = startOfMonth(now);
            const endDate = endOfDay(now);

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let monthlyLogs;
            console.log(`[${new Date().toISOString()}] Starting database query for monthlysummary for user ${userId}`);
            try {
                 monthlyLogs = await Sadhana.findAll({
                    where: {
                        userId: userId,
                        date: {
                            [Sequelize.Op.gte]: startDate,
                            [Sequelize.Op.lte]: endDate
                        }
                    },
                    order: [['date', 'ASC']]
                });
                console.log(`[${new Date().toISOString()}] Finished database query for monthlysummary. Found ${monthlyLogs.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for monthlysummary:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Monthly Summary Failed')
                      .setDescription('An error occurred while fetching monthly data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }


            let totalRounds = 0;
            let totalStudyHours = 0;
            let totalListeningHours = 0;
            let totalScore = 0;
            const booksReadThisMonth = new Set();
            let earlyWakingCount = 0;
            let earlySleepingCount = 0;
            let principlesFollowedCount = 0;
            const loggedDaysCount = monthlyLogs.length;

            for (const log of monthlyLogs) {
                totalRounds += log.japaRounds || 0;
                totalStudyHours += log.studyHours || 0;
                totalListeningHours += log.listeningHours || 0;
                totalScore += log.score || 0;
                if (log.readingDetails && log.readingDetails.trim() !== '') {
                    booksReadThisMonth.add(log.readingDetails);
                }
                 if (log.wakingTime !== null && log.wokeUpEarlyStatus === true) earlyWakingCount++; // Check for null
                 if (log.sleepingTime !== null && log.sleptEarlyStatus === true) earlySleepingCount++; // Check for null
                 if (log.noMeatEating === true) principlesFollowedCount++;
                 if (log.noGambling === true) principlesFollowedCount++;
                 if (log.noIllicitSex === true) principlesFollowedCount++;
                 if (log.noIntoxication === true) principlesFollowedCount++;
            }

            const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
            const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
            const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
            const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0;
             // Calculate average principles per logged day (each day has 4 principles)
            const avgPrinciplesPerDay = loggedDaysCount > 0 ? (principlesFollowedCount / loggedDaysCount / 4).toFixed(2) : 0; // Divide by 4 for average per day


            // Create an embed for the monthly summary
             const embed = new EmbedBuilder()
                 .setColor('#FFAA00') // Orange color
                 .setTitle(`Monthly Practice Summary for ${interaction.user.username} (${now.toLocaleString('default', { month: 'long', year: 'numeric' })})`)
                 .setDescription(`(Based on ${loggedDaysCount} logged day(s))`)
                 .addFields(
                     { name: 'Total Score', value: `${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})` },
                     { name: 'Total Rounds Chanted', value: `${totalRounds} (Avg per logged day: ${avgRounds})` },
                     { name: 'Total Study Hours', value: `${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})`, inline: true },
                     { name: 'Total Listening Hours', value: `${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})`, inline: true },
                     { name: 'Woke up early (< 5 AM IST)', value: `${earlyWakingCount} time(s)`, inline: true },
                     { name: 'Slept early (< 11 PM IST Previous Night)', value: `${earlySleepingCount} time(s)`, inline: true },
                     { name: 'Avg. Regulative Principles Followed per Logged Day', value: `${avgPrinciplesPerDay} / 4` }, // Changed to out of 4
                     { name: 'Reading Logged', value: booksReadThisMonth.size > 0 ? Array.from(booksReadThisMonth).join('; ') : 'None' }
                 );

             console.log(`[${new Date().toISOString()}] Attempting to editReply for monthlysummary for user ${userId}`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for monthlysummary for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for monthlysummary for user ${userId}:`, editError);
            }
         }
         // Handle the /leaderboard command (Need to be rewritten for Sequelize)
        else if (commandName === 'leaderboard') {
            console.log(`[${new Date().toISOString()}] Handling /leaderboard command for user ${interaction.user.tag}`);
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const period = interaction.options.getString('period');
            const now = new Date();

            let startDate;
            let endDate = endOfDay(now);

            let periodName;

            if (period === 'weekly') {
                startDate = startOfDay(addDays(now, -6));
                periodName = 'Last 7 Days';
            } else if (period === 'monthly') {
                startDate = startOfMonth(now);
                periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
            } else {
                 // Reply with embed for invalid period
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Leaderboard Error')
                     .setDescription('Invalid period specified. Choose "weekly" or "monthly".');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                return;
            }

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let userScores;
            console.log(`[${new Date().toISOString()}] Starting database query for leaderboard (${period})`);
            try {
                 userScores = await Sadhana.findAll({
                     attributes: [
                        'userId',
                        [sequelize.fn('SUM', sequelize.col('score')), 'totalScore'],
                        [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.literal('DATE("date")'))), 'loggedDaysCount'] // Count distinct dates
                    ],
                    where: {
                        date: {
                            [Sequelize.Op.gte]: startDate,
                            [Sequelize.Op.lte]: endDate
                        }
                    },
                    group: ['userId'],
                    order: [[sequelize.literal('"totalScore"'), 'DESC']], // Order by the aggregated totalScore
                    limit: 10 // Limit to top 10
                });
                 console.log(`[${new Date().toISOString()}] Finished database query for leaderboard. Found ${userScores.length} entries.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for leaderboard:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Leaderboard Failed')
                      .setDescription('An error occurred while fetching leaderboard data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }


            // Create an embed for the leaderboard
            const embed = new EmbedBuilder()
                .setColor('#FFD700') // Gold color
                .setTitle(`Spiritual Practice Leaderboard (${periodName})`);

            if (userScores.length === 0) {
                embed.setDescription("No practice logs found for this period.");
            } else {
                let leaderboardDescription = '';
                for (let i = 0; i < userScores.length; i++) {
                    const userScore = userScores[i];
                    let username = 'Unknown User';
                     try {
                         if (interaction.guild) {
                            const member = await interaction.guild.members.fetch(userScore.userId);
                             username = member.user.globalName || member.user.username; // Prefer global name
                         } else {
                             const user = await client.users.fetch(userScore.userId);
                             username = user.globalName || user.username; // Prefer global name
                         }
                     } catch (err) {
                         console.warn(`Could not fetch user/member ${userScore.userId}:`, err.message);
                         username = `User ID: ${userScore.userId}`;
                     }

                    // Access aggregated values using userScore.get('totalScore') and userScore.get('loggedDaysCount')
                    leaderboardDescription += `${i + 1}. **${username}**: ${parseFloat(userScore.get('totalScore')).toFixed(2)} points (${userScore.get('loggedDaysCount')} day(s) logged)\n`;
                }
                embed.setDescription(leaderboardDescription);
            }

            console.log(`[${new Date().toISOString()}] Attempting to editReply for leaderboard (${period})`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for leaderboard (${period})`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for leaderboard (${period}):`, editError);
            }
        }
        // Handle the /myscore command (Need to be rewritten for Sequelize)
        else if (commandName === 'myscore') {
            console.log(`[${new Date().toISOString()}] Handling /myscore command for user ${interaction.user.tag}`);
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const userId = interaction.user.id;
            const username = interaction.user.username;

            const now = new Date();
            let startDate;
            let endDate = endOfDay(now);

            const period = interaction.options.getString('period');
            let periodName;
            let totalScore = 0;
            let loggedDaysCount = 0;

            if (period === 'weekly') {
                startDate = startOfDay(addDays(now, -6));
                periodName = 'Last 7 Days';
            } else if (period === 'monthly') {
                startDate = startOfMonth(now);
                periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
            } else {
                 // Reply with embed for invalid period
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('My Score Error')
                     .setDescription('Invalid period specified. Choose "weekly" or "monthly".');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                return;
            }

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let userLogsInPeriod;
            console.log(`[${new Date().toISOString()}] Starting database query for myscore (${period}) for user ${userId}`);
            try {
                 userLogsInPeriod = await Sadhana.findAll({
                    where: {
                        userId: userId,
                        date: {
                            [Sequelize.Op.gte]: startDate,
                            [Sequelize.Op.lte]: endDate
                        }
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database query for myscore. Found ${userLogsInPeriod.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for myscore:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('My Score Failed')
                      .setDescription('An error occurred while fetching your score data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }


            loggedDaysCount = userLogsInPeriod.length;
            for (const log of userLogsInPeriod) {
                totalScore += log.score || 0;
            }

            // Create an embed for the user's score
            const embed = new EmbedBuilder()
                .setColor('#8A2BE2') // Blue Violet color
                .setTitle(`Your Personal Practice Score (${periodName})`)
                .setDescription(`Total Score: ${totalScore.toFixed(2)} points (${loggedDaysCount} logged day(s))`);

            console.log(`[${new Date().toISOString()}] Attempting to editReply for myscore (${period}) for user ${userId}`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for myscore (${period}) for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for myscore (${period}) for user ${userId}:`, editError);
            }


        }
        // Handle the /showscore command (Need to be rewritten for Sequelize)
        else if (commandName === 'showscore') {
            console.log(`[${new Date().toISOString()}] Handling /showscore command for user ${interaction.user.tag}`);
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const targetUser = interaction.options.getUser('user');
            const userId = targetUser.id;
            const username = targetUser.globalName || targetUser.username; // Prefer global name

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let userStreak;
            console.log(`[${new Date().toISOString()}] Starting database query for showscore streak for user ${userId}`);
            try {
                // Find the user's streak entry
                userStreak = await UserStreak.findOne({ where: { userId: userId } });
                console.log(`[${new Date().toISOString()}] Finished database query for showscore streak.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findOne for showscore streak:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Score Failed')
                      .setDescription('An error occurred while fetching streak data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }

            const currentStreak = userStreak ? userStreak.streakCount : 0;

            const now = new Date();

            // Weekly Score
            const weeklyStartDate = startOfDay(addDays(now, -6));
            const weeklyEndDate = endOfDay(now);
            let weeklyLogs;
            console.log(`[${new Date().toISOString()}] Starting database query for showscore weekly for user ${userId}`);
            try {
                 weeklyLogs = await Sadhana.findAll({
                    where: {
                        userId: userId,
                        date: { [Sequelize.Op.gte]: weeklyStartDate, [Sequelize.Op.lte]: weeklyEndDate }
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database query for showscore weekly. Found ${weeklyLogs.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for showscore weekly:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Score Failed')
                      .setDescription('An error occurred while fetching weekly score data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }

            let weeklyScore = 0;
            let weeklyLoggedDays = weeklyLogs.length;
            for (const log of weeklyLogs) weeklyScore += log.score || 0;

            // Monthly Score
            const monthStartDate = startOfMonth(now);
            const monthlyEndDate = endOfDay(now);
            let monthlyLogs;
            console.log(`[${new Date().toISOString()}] Starting database query for showscore monthly for user ${userId}`);
            try {
                 monthlyLogs = await Sadhana.findAll({
                    where: {
                        userId: userId,
                        date: { [Sequelize.Op.gte]: monthStartDate, [Sequelize.Op.lte]: monthlyEndDate }
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database query for showscore monthly. Found ${monthlyLogs.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for showscore monthly:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Score Failed')
                      .setDescription('An error occurred while fetching monthly score data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }

            let monthlyScore = 0;
            let monthlyLoggedDays = monthlyLogs.length;
             for (const log of monthlyLogs) monthlyScore += log.score || 0;

            // All-Time Score
            let allTimeLogs;
            console.log(`[${new Date().toISOString()}] Starting database query for showscore all-time for user ${userId}`);
            try {
                 allTimeLogs = await Sadhana.findAll({ where: { userId: userId } });
                 console.log(`[${new Date().toISOString()}] Finished database query for showscore all-time. Found ${allTimeLogs.length} logs.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for showscore all-time:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Score Failed')
                      .setDescription('An error occurred while fetching all-time score data. Please try again later.');
                  // Check if interaction is still valid before editing reply
                 if (!interaction.replied && !interaction.deferred) {
                      await interaction.reply({ embeds: [embed] });
                 } else {
                      await interaction.editReply({ embeds: [embed] });
                 }
                  return;
            }

            let allTimeScore = 0;
            let allTimeLoggedDays = allTimeLogs.length;
             for (const log of allTimeLogs) allTimeScore += log.score || 0;

            // Create an embed for showing user's score
            const embed = new EmbedBuilder()
                .setColor('#00CED1') // Dark Cyan color
                .setTitle(`Practice Scores for ${username}`)
                .addFields(
                    { name: 'Current Chanting Streak', value: `${currentStreak} day(s) 🙏` },
                    { name: 'Weekly (Last 7 Days)', value: `${weeklyScore.toFixed(2)} points (${weeklyLoggedDays} logged)`, inline: true },
                    { name: `Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })})`, value: `${monthlyScore.toFixed(2)} points (${monthlyLoggedDays} logged)`, inline: true },
                    { name: 'All-Time', value: `${allTimeScore.toFixed(2)} points (${allTimeLoggedDays} logged)`, inline: true }
                );

            console.log(`[${new Date().toISOString()}] Attempting to editReply for showscore for user ${userId}`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for showscore for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for showscore for user ${userId}:`, editError);
            }

        }
         // Handle the /streakset command (Admin only) (Need to be rewritten for Sequelize)
        else if (commandName === 'streakset') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                 // Reply with embed for insufficient permissions
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Permission Denied')
                     .setDescription('You do not have permission to use this command.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }
            console.log(`[${new Date().toISOString()}] Handling /streakset command for user ${interaction.user.tag}`);


            const targetUser = interaction.options.getUser('user');
            const newStreak = interaction.options.getInteger('streak');

            if (newStreak < 0) {
                 // Reply with embed for invalid streak value
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Streak Set Failed')
                     .setDescription('Streak value cannot be negative.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }

            const targetUserId = targetUser.id;

            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            // Find or create the user's streak entry
            let userStreak;
            let created;
            console.log(`[${new Date().toISOString()}] Starting database operation (findOrCreate) for streakset for user ${targetUserId}`);
            try {
                 [userStreak, created] = await UserStreak.findOrCreate({
                    where: { userId: targetUserId },
                    defaults: {
                        userId: targetUserId,
                        streakCount: 0,
                        lastLoggedDateKey: null,
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database operation (findOrCreate) for streakset.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findOrCreate for streakset:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Set Failed')
                      .setDescription('An error occurred while accessing streak data. Please try again later.');
                  await interaction.reply({ embeds: [embed] });
                  return;
            }


            // Update the streak count
            userStreak.streakCount = newStreak;

            try {
                // Set lastLoggedDateKey to yesterday's date for streak calculation purposes
                const now = new Date();
                const yesterday = addDays(now, -1);
                const yesterdayKey = format(yesterday, 'yyyy-MM-dd');

                userStreak.lastLoggedDateKey = yesterdayKey;

            } catch (error) {
                 console.error(`[${new Date().toISOString()}] Error during date calculation for streakset:`, error);
                 // Reply with embed for internal error
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Streak Set Failed')
                     .setDescription('An internal error occurred while setting the streak date. Please contact bot administrator.');
                 await interaction.reply({ embeds: [embed] });
                 return;
            }

            console.log(`[${new Date().toISOString()}] Starting database operation (save) for streakset for user ${targetUserId}`);
            try {
                await userStreak.save();
                 console.log(`[${new Date().toISOString()}] Finished database operation (save) for streakset.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during save for streakset:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Set Failed')
                      .setDescription('An error occurred while saving streak data. Please try again later.');
                  await interaction.reply({ embeds: [embed] });
                  return;
            }


            // Create an embed for successful streak set
            const embed = new EmbedBuilder()
                .setColor('#32CD32') // Lime Green color
                .setTitle('Streak Set Successfully')
                .setDescription(`Successfully set ${targetUser.username}'s chanting streak to ${newStreak}. Their last logged date is set for streak calculation.`);

            console.log(`[${new Date().toISOString()}] Attempting to reply for streakset for user ${targetUserId}`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.reply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully replied for streakset for user ${targetUserId}`);
            } catch (replyError) {
                 console.error(`[${new Date().toISOString()}] Error replying for streakset for user ${targetUserId}:`, replyError);
            }
        }
        // Handle the /help command
        else if (commandName === 'help') {
            console.log(`[${new Date().toISOString()}] Handling /help command for user ${interaction.user.tag}`);
            const youtubeLink = 'Yet to be uploaded'; // Replace with your actual YouTube link
            // Create an embed for the help command
            const embed = new EmbedBuilder()
                .setColor('#FFFF00') // Yellow color
                .setTitle('Helpful Resources and Commands') // Updated title
                .setDescription(`Here is a helpful video: ${youtubeLink}\n\n`
                              + `**Available Commands:**\n` // Updated description format
                              + `- \`/chant <rounds>\`: Quickly log your japa rounds for today and update your chanting streak.\n`
                              + `- \`/logpractice\`: Open a form to log your full daily practice details.\n`
                              + `- \`/weeklysummary\`: Shows your practice summary for the last 7 days.\n`
                              + `- \`/monthlysummary\`: Shows your practice summary for the current month.\n`
                              + `- \`/leaderboard <period>\`: Shows the top devotees based on practice scores (weekly or monthly).\n`
                              + `- \`/myscore <period>\`: Shows your personal practice score for a specific period (weekly or monthly).\n`
                              + `- \`/showscore <user>\`: Shows a user's practice scores and streak.\n`
                              + `- \`/streaklog\`: Shows the current chanting streak leaderboard.\n` // Added /streaklog info
                              + `- \`/streakset <user> <streak>\`: Sets a user's chanting streak (Admin only).\n`
                              + `- \`/checkdata <type> [user] [date_string]\`: Check specific data from the database (Admin only).`);


            console.log(`[${new Date().toISOString()}] Attempting to reply for help command for user ${interaction.user.tag}`);
            // Reply with embed
            try {
                 await interaction.reply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully replied for help command for user ${interaction.user.tag}`);
            } catch (replyError) {
                 console.error(`[${new Date().toISOString()}] Error replying for help command for user ${interaction.user.tag}:`, replyError);
            }
        }
        // --- New /checkdata command handler (Need to be rewritten for Sequelize) ---
        else if (commandName === 'checkdata') {
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                 // Reply with embed for insufficient permissions
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Permission Denied')
                     .setDescription('You do not have permission to use this command.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }
            console.log(`[${new Date().toISOString()}] Handling /checkdata command for user ${interaction.user.tag}`);

            // Removed ephemeral flag from deferReply
            console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);


            const dataType = interaction.options.getString('type');
            const targetUser = interaction.options.getUser('user');
            const dateString = interaction.options.getString('date_string'); // Get date string for checkdata
            const day = interaction.options.getInteger('day'); // Keep for fallback/alternative
            const month = interaction.options.getInteger('month'); // Keep for fallback/alternative
            const year = interaction.options.getInteger('year'); // Keep for fallback/alternative


            // Create an embed for the checkdata results
            const embed = new EmbedBuilder()
                 .setColor('#800080') // Purple color
                .setTitle('Data Check Results');

            let embedDescription = ''; // Use description or fields for results

            try {
                switch (dataType) {
                    case 'user_log_by_date':
                        if (!targetUser) {
                             embedDescription = 'For "User Log by Date", you must provide a user.';
                             embed.setColor('#FF0000'); // Change color for error
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                            return;
                        }

                        let checkDate;
                        if (dateString) {
                            try {
                                // Parse the date string in dd/MM/yyyy format
                                const parsedDate = parse(dateString, 'dd/MM/yyyy', new Date()); // Parse with base date

                                if (isNaN(parsedDate.getTime())) {
                                    embedDescription = `Invalid date format: "${dateString}". Please use dd/mm/yyyy format (e.g., 07/05/2025) or provide day, month, and year.`;
                                    embed.setColor('#FF0000'); // Change color for error
                                    embed.setDescription(embedDescription);
                                    await interaction.editReply({ embeds: [embed] });
                                    return;
                                }
                                // Set the time to the start of the day in IST
                                checkDate = startOfDay(toZonedTime(parsedDate, IST_TIMEZONE));

                            } catch (parseError) {
                                 console.error(`Error parsing date string "${dateString}" for checkdata:`, parseError);
                                 embedDescription = `Error parsing date: "${dateString}". Please use dd/mm/yyyy format (e.g., 07/05/2025) or provide day, month, and year.`;
                                 embed.setColor('#FF0000'); // Change color for error
                                 embed.setDescription(embedDescription);
                                 await interaction.editReply({ embeds: [embed] });
                                 return;
                            }

                        } else if (day !== null && month !== null && year !== null) {
                            checkDate = startOfDay(new Date(year, month - 1, day));
                             if (isNaN(checkDate.getTime())) {
                                 embedDescription = 'Invalid date provided for check (using day, month, year).';
                                 embed.setColor('#FF0000'); // Change color for error
                                 embed.setDescription(embedDescription);
                                 await interaction.editReply({ embeds: [embed] });
                                return;
                            }
                        } else {
                             embedDescription = 'For "User Log by Date", you must provide either a date string (dd/mm/yyyy) or a day, month, and year.';
                             embed.setColor('#FF0000'); // Change color for error
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                            return;
                        }


                        // --- Database Interaction Logic (Rewritten for Sequelize) ---
                        let userLog;
                        console.log(`[${new Date().toISOString()}] Starting database query for checkdata user_log_by_date for user ${targetUser.id} on ${format(checkDate, 'yyyy-MM-dd')}`);
                        try {
                             userLog = await Sadhana.findOne({ where: { userId: targetUser.id, date: checkDate } });
                             console.log(`[${new Date().toISOString()}] Finished database query for checkdata user_log_by_date. Log found: ${!!userLog}`);
                        } catch (dbError) {
                             console.error(`[${new Date().toISOString()}] Database error during findOne for checkdata user_log_by_date:`, dbError);
                              embedDescription = 'An error occurred while fetching user log data. Please try again later.';
                              embed.setColor('#FF0000'); // Change color for error
                              embed.setDescription(embedDescription);
                              await interaction.editReply({ embeds: [embed] });
                              return;
                        }


                        if (userLog) {
                            const formattedDate = format(userLog.date, 'yyyy-MM-dd');
                            embed.setTitle(`Log for ${targetUser.username} on ${formattedDate}`);
                            embed.addFields(
                                { name: 'Waking Time', value: `${userLog.wakingTime === null ? 'Not Slept' : (userLog.wakingTime ? formatInTimeZone(userLog.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${userLog.wokeUpEarlyStatus ? 'Yes' : 'No'})` },
                                { name: 'Japa Rounds', value: userLog.japaRounds.toString() },
                                { name: 'Study Hours', value: userLog.studyHours.toString(), inline: true },
                                { name: 'Reading', value: userLog.readingDetails || 'Not logged' },
                                { name: 'Listening Hours', value: userLog.listeningHours.toString(), inline: true },
                                { name: 'Sleeping Time', value: `${userLog.sleepingTime === null ? 'Not Slept' : (userLog.sleepingTime ? formatInTimeZone(userLog.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${userLog.sleptEarlyStatus ? 'Yes' : 'No'})` },
                                { name: 'Regulative Principles Followed', value: `Meat: ${userLog.noMeatEating ? 'Yes' : 'No'}, Gambling: ${userLog.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${userLog.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${userLog.noIntoxication ? 'Yes' : 'No'}` },
                                 { name: 'Score', value: userLog.score.toString() }
                            );
                             if (userLog.additionalService) {
                                embed.addFields({ name: 'Additional Service', value: userLog.additionalService });
                            }

                        } else {
                            const formattedDate = format(checkDate, 'yyyy-MM-dd');
                            embedDescription = `No log found for ${targetUser.username} on ${formattedDate}.`;
                            embed.setDescription(embedDescription);
                        }
                        break;

                    case 'user_streak':
                        if (!targetUser) {
                             embedDescription = 'For "User Streak", you must provide a user.';
                             embed.setColor('#FF0000'); // Change color for error
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                            return;
                        }
                        // --- Database Interaction Logic (Rewritten for Sequelize) ---
                        let userStreak;
                        console.log(`[${new Date().toISOString()}] Starting database query for checkdata user_streak for user ${targetUser.id}`);
                        try {
                             userStreak = await UserStreak.findOne({ where: { userId: targetUser.id } });
                             console.log(`[${new Date().toISOString()}] Finished database query for checkdata user_streak. Streak found: ${!!userStreak}`);
                        } catch (dbError) {
                             console.error(`[${new Date().toISOString()}] Database error during findOne for checkdata user_streak:`, dbError);
                              embedDescription = 'An error occurred while fetching user streak data. Please try again later.';
                              embed.setColor('#FF0000'); // Change color for error
                              embed.setDescription(embedDescription);
                              await interaction.editReply({ embeds: [embed] });
                              return;
                        }

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

                    case 'total_sadhana_count':
                        // --- Database Interaction Logic (Rewritten for Sequelize) ---
                        let totalSadhanaCount;
                        console.log(`[${new Date().toISOString()}] Starting database query for total_sadhana_count`);
                        try {
                             totalSadhanaCount = await Sadhana.count(); // Use count() for total count
                             console.log(`[${new Date().toISOString()}] Finished database query for total_sadhana_count. Count: ${totalSadhanaCount}`);
                        } catch (dbError) {
                             console.error(`[${new Date().toISOString()}] Database error during count for total_sadhana_count:`, dbError);
                              embedDescription = 'An error occurred while fetching total sadhana count. Please try again later.';
                              embed.setColor('#FF0000'); // Change color for error
                              embed.setDescription(embedDescription);
                              await interaction.editReply({ embeds: [embed] });
                              return;
                        }
                        embedDescription = `**Total Sadhana Entries in Database:** ${totalSadhanaCount}`;
                        embed.setDescription(embedDescription);
                        break;

                    case 'total_streak_count':
                        // --- Database Interaction Logic (Rewritten for Sequelize) ---
                        let totalStreakCount;
                        console.log(`[${new Date().toISOString()}] Starting database query for total_streak_count`);
                        try {
                             totalStreakCount = await UserStreak.count(); // Use count() for total count
                             console.log(`[${new Date().toISOString()}] Finished database query for total_streak_count. Count: ${totalStreakCount}`);
                        } catch (dbError) {
                             console.error(`[${new Date().toISOString()}] Database error during count for total_streak_count:`, dbError);
                              embedDescription = 'An error occurred while fetching total streak count. Please try again later.';
                              embed.setColor('#FF0000'); // Change color for error
                              embed.setDescription(embedDescription);
                              await interaction.editReply({ embeds: [embed] });
                              return;
                        }
                        embedDescription = `**Total User Streak Entries in Database:** ${totalStreakCount}`;
                        embed.setDescription(embedDescription);
                        break;

                    default:
                        embedDescription = 'Invalid data type specified.';
                        embed.setColor('#FF0000'); // Change color for error
                        embed.setDescription(embedDescription);
                        break;
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] An unexpected error occurred in /checkdata command:`, error);
                embedDescription = 'An unexpected error occurred while fetching data.';
                embed.setColor('#FF0000'); // Change color for error
                embed.setDescription(embedDescription);
            }

            console.log(`[${new Date().toISOString()}] Attempting to editReply for checkdata command`);
            // Edited reply to use embeds (removed ephemeral)
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for checkdata command`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for checkdata command:`, editError);
            }

        }
         // --- Handle /streaklog command ---
        else if (commandName === 'streaklog') {
            console.log(`[${new Date().toISOString()}] Handling /streaklog command for user ${interaction.user.tag}`);
            // Defer the reply immediately
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            // --- Database Interaction for /streaklog ---
            let userStreaks;
            console.log(`[${new Date().toISOString()}] Starting database query for streaklog`);
            try {
                 userStreaks = await UserStreak.findAll({
                    order: [['streakCount', 'DESC']], // Order by streak count descending
                    limit: 10 // Limit to top 10 for a cleaner display
                });
                 console.log(`[${new Date().toISOString()}] Finished database query for streaklog. Found ${userStreaks.length} entries.`);
            } catch (dbError) {
                 console.error(`[${new Date().toISOString()}] Database error during findAll for streaklog:`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Leaderboard Failed')
                      .setDescription('An error occurred while fetching streak data. Please try again later.');
                  await interaction.editReply({ embeds: [embed] });
                  return;
            }

            // Create an embed for the streak leaderboard
            const embed = new EmbedBuilder()
                .setColor('#FF6347') // Tomato color
                .setTitle('Chanting Streak Leaderboard 🔥');

            if (userStreaks.length === 0) {
                embed.setDescription("No chanting streaks found yet.");
            } else {
                let leaderboardDescription = '';
                for (let i = 0; i < userStreaks.length; i++) {
                    const userStreak = userStreaks[i];
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

                    leaderboardDescription += `${i + 1}. **${username}**: ${userStreak.streakCount} day(s) 🙏\n`;
                }
                embed.setDescription(leaderboardDescription);
            }

            console.log(`[${new Date().toISOString()}] Attempting to editReply for /streaklog command`);
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for /streaklog command`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for /streaklog command:`, editError);
            }
        }
    }

    // --- Handle Modal Submit Interactions ---
    if (interaction.isModalSubmit()) {
        console.log(`[${new Date().toISOString()}] Modal submission received: ${interaction.customId} for user ${interaction.user.tag}`);

        if (interaction.customId === 'logPracticeModal') {
            console.log(`[${new Date().toISOString()}] Handling logPracticeModal submission for user ${interaction.user.tag}`);
            // Defer the reply immediately to give the bot time to process
            try {
                 // Removed ephemeral flag from deferReply
                 await interaction.deferReply();
                 console.log(`[${new Date().toISOString()}] Modal reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring modal reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
             console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with modal submission logic.`);


            // Get the data from the modal inputs
            const dateString = interaction.fields.getTextInputValue('dateInput');
            // Waking Time is removed from the modal
            // const wakingTimeInput = interaction.fields.getTextInputValue('wakingTimeInput');
            const japaRoundsInput = interaction.fields.getTextInputValue('japaRoundsInput');
            // Study Hours is now included in the modal
            const studyHoursInput = interaction.fields.getTextInputValue('studyHoursInput');
            const readingDetails = interaction.fields.getTextInputValue('readingDetailsInput');
            const listeningHoursInput = interaction.fields.getTextInputValue('listeningHoursInput');
            // Sleeping Time is removed from the modal
            // const sleepingTimeInput = interaction.fields.getTextInputValue('sleepingTimeInput');
            // Regulative Principles input is removed from the modal
            // const regulativePrinciplesInput = interaction.fields.getTextInputValue('regulativePrinciplesInput');
            // Additional Service input is removed from the modal, so we don't get its value here.
            // const additionalService = interaction.fields.getTextInputValue('additionalServiceInput');

            const userId = interaction.user.id;
            const guildId = interaction.guild?.id;

            // --- Data Validation and Parsing ---
            let loggedDate;
            try {
                const parsedDate = parse(dateString, 'dd/MM/yyyy', new Date());
                 if (isNaN(parsedDate.getTime())) {
                     throw new Error(`Invalid date format: "${dateString}". Please use dd/mm/yyyy.`);
                }
                 loggedDate = startOfDay(toZonedTime(parsedDate, IST_TIMEZONE)); // Ensure date is start of day in IST

            } catch (error) {
                 console.error(`Error parsing date string "${dateString}" from modal:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription(`Invalid date provided: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            let japaRounds;
            try {
                 japaRounds = parseInt(japaRoundsInput, 10);
                 if (isNaN(japaRounds) || japaRounds < 0) {
                     throw new Error(`Invalid japa rounds value: "${japaRoundsInput}". Please enter a non-negative number.`);
                 }
            } catch (error) {
                 console.error(`Error parsing japa rounds "${japaRoundsInput}" from modal:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription(`Invalid japa rounds: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // Study Hours is now included in the modal, parse it here.
            let studyHours;
            try {
                 studyHours = parseFloat(studyHoursInput);
                 if (isNaN(studyHours) || studyHours < 0) {
                     throw new Error(`Invalid study hours value: "${studyHoursInput}". Please enter a non-negative number.`);
                 }
            } catch (error) {
                 console.error(`Error parsing study hours "${studyHoursInput}" from modal:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription(`Invalid study hours: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            let listeningHours;
            try {
                 listeningHours = parseFloat(listeningHoursInput);
                 if (isNaN(listeningHours) || listeningHours < 0) {
                     throw new Error(`Invalid listening hours value: "${listeningHoursInput}". Please enter a non-negative number.`);
                 }
            } catch (error) {
                 console.error(`Error parsing listening hours "${listeningHoursInput}" from modal:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription(`Invalid listening hours: ${error.message}`);
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            // Waking Time and Sleeping Time are removed from the modal, so no parsing here.
            // let parsedWakingTime = null;
            // let wokeUpEarlyStatus = false;
            // const dateKeyForTimeParsing = format(loggedDate, 'yyyy-MM-dd');
            //
            // if (wakingTimeInput && wakingTimeInput.toLowerCase() === 'not slept') {
            //     parsedWakingTime = null;
            //     wokeUpEarlyStatus = false;
            // } else {
            //     try {
            //         parsedWakingTime = parseTimeInIST(dateKeyForTimeParsing, wakingTimeInput);
            //         if (!parsedWakingTime) {
            //              throw new Error(`Invalid format. Please use HH:MM AM/PM (e.g., 4:30 AM) or type "Not Slept".`);
            //         }
            //         let fiveAmIST = parseTimeInIST(dateKeyForTimeParsing, '5:00 AM');
            //         if (fiveAmIST) {
            //             wokeUpEarlyStatus = parsedWakingTime < fiveAmIST;
            //         } else {
            //              console.error("Could not parse 5:00 AM IST for comparison.");
            //              // Continue without early status if comparison fails
            //         }
            //
            //     } catch (error) {
            //          console.error(`Error parsing waking time "${wakingTimeInput}" from modal:`, error);
            //          const embed = new EmbedBuilder()
            //              .setColor('#FF0000')
            //              .setTitle('Logging Failed')
            //              .setDescription(`Invalid waking time: ${error.message}`);
            //          await interaction.editReply({ embeds: [embed] });
            //          return;
            //     }
            // }
            //
            // let parsedSleepingTime = null;
            // let sleptEarlyStatus = false;
            // const previousDayDate = addDays(loggedDate, -1);
            // const previousDateKey = format(previousDayDate, 'yyyy-MM-dd');
            //
            // if (sleepingTimeInput && sleepingTimeInput.toLowerCase() === 'not slept') {
            //     parsedSleepingTime = null;
            //     sleptEarlyStatus = false;
            // } else {
            //     try {
            //         parsedSleepingTime = parseTimeInIST(previousDateKey, sleepingTimeInput);
            //          if (!parsedSleepingTime) {
            //              throw new Error(`Invalid format. Please use HH:MM AM/PM (e.g., 10:30 PM) or type "Not Slept".`);
            //         }
            //          let elevenPmISTPreviousDay = parseTimeInIST(previousDateKey, '11:00 PM');
            //          if (elevenPmISTPreviousDay) {
            //              sleptEarlyStatus = parsedSleepingTime < elevenPmISTPreviousDay;
            //          } else {
            //              console.error("Could not parse 11:00 PM IST (previous day) for comparison.");
            //              // Continue without early status if comparison fails
            //          }
            //     } catch (error) {
            //          console.error(`Error parsing sleeping time "${sleepingTimeInput}" from modal:`, error);
            //          const embed = new EmbedBuilder()
            //              .setColor('#FF0000')
            //              .setTitle('Logging Failed')
            //              .setDescription(`Invalid sleeping time: ${error.message}`);
            //          await interaction.editReply({ embeds: [embed] });
            //          return;
            //     }
            // }


             // Regulative Principles input is removed from the modal, so no parsing here.
             // let noMeatEating = false, noGambling = false, noIllicitSex = false, noIntoxication = false;
             // const principles = regulativePrinciplesInput.toLowerCase().split(',').map(p => p.trim());
             // if (principles.length === 4) {
             //     noMeatEating = principles[0] === 'yes';
             //     noGambling = principles[1] === 'yes';
             //     noIllicitSex = principles[2] === 'yes';
             //     noIntoxication = principles[3] === 'yes';
             // } else {
             //     const embed = new EmbedBuilder()
             //         .setColor('#FF0000')
             //         .setTitle('Logging Failed')
             //         .setDescription(`Invalid format for Regulative Principles. Please provide Yes/No for each, separated by commas (e.g., Yes, Yes, Yes, Yes).`);
             //     await interaction.editReply({ embeds: [embed] });
             //     return;
             // }


            // --- Database Interaction Logic (Rewritten for Sequelize) ---
            let sadhanaEntry;
            let created;
            console.log(`[${new Date().toISOString()}] Starting database findOrCreate for logPracticeModal for user ${userId} on ${format(loggedDate, 'yyyy-MM-dd')}`);
            try {
                 [sadhanaEntry, created] = await Sadhana.findOrCreate({
                    where: { userId: userId, date: loggedDate },
                    defaults: { // Default values if a new entry is created
                        userId: userId,
                        guildId: guildId,
                        date: loggedDate,
                        japaRounds: japaRounds,
                        // Waking Time and Sleeping Time are not in the modal, set to null or default
                        wakingTime: null, // Set to null
                        wokeUpEarlyStatus: false, // Set to false
                        // Study Hours is now in the modal
                        studyHours: studyHours,
                        readingDetails: readingDetails,
                        listeningHours: listeningHours,
                        // Sleeping Time is not in the modal, set to null or default
                        sleepingTime: null, // Set to null
                        sleptEarlyStatus: false, // Set to false
                        // Regulative Principles are not in the modal, set to false
                        noMeatEating: false, // Set to false
                        noGambling: false, // Set to false
                        noIllicitSex: false, // Set to false
                        noIntoxication: false, // Set to false
                        additionalService: '', // Set to empty string
                        score: 0, // Calculate score after updating
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database findOrCreate for logPracticeModal. Created: ${created}`);
            } catch (dbError) {
                console.error(`Database error during findOrCreate for logPracticeModal:`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('An error occurred while accessing the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }


            const isUpdatingExistingLog = !created; // If not created, it was found

            // If updating, update the found entry with values from the modal
            if (isUpdatingExistingLog) {
                sadhanaEntry.japaRounds = japaRounds;
                // Waking Time and Sleeping Time are not in the modal, do not update from modal input
                // sadhanaEntry.wakingTime = parsedWakingTime; // REMOVED
                // sadhanaEntry.wokeUpEarlyStatus = wokeUpEarlyStatus; // REMOVED
                // Study Hours is now in the modal, update it.
                sadhanaEntry.studyHours = studyHours;
                sadhanaEntry.readingDetails = readingDetails;
                sadhanaEntry.listeningHours = listeningHours;
                // Sleeping Time is not in the modal, do not update from modal input
                // sadhanaEntry.sleepingTime = parsedSleepingTime; // REMOVED
                // sadhanaEntry.sleptEarlyStatus = sleptEarlyStatus; // REMOVED
                // Regulative Principles are not in the modal, do not update from modal input
                // sadhanaEntry.noMeatEating = noMeatEating; // REMOVED
                // sadhanaEntry.noGambling = noGambling; // REMOVED
                // sadhanaEntry.noIllicitSex = noIllicitSex; // REMOVED
                // sadhanaEntry.noIntoxication = noIntoxication; // REMOVED
                // additionalService is not in the modal, so we don't update it here.
                // sadhanaEntry.additionalService = additionalService; // REMOVED
            }

            // Calculate and store the score
            sadhanaEntry.score = calculateScore(sadhanaEntry);

            console.log(`[${new Date().toISOString()}] Starting database save for logPracticeModal for user ${userId} on ${format(loggedDate, 'yyyy-MM-dd')}`);
            try {
                await sadhanaEntry.save();
                 console.log(`[${new Date().toISOString()}] Finished database save for logPracticeModal.`);
            } catch (dbError) {
                console.error(`Database error during save for logPracticeModal:`, dbError);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('An error occurred while saving to the database. Please try again later.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }


            // --- Chanting Streak Logic (Remains the same) ---
             // Find or create the user's streak entry
            let userStreak;
            let streakCreated;
            console.log(`[${new Date().toISOString()}] Starting database findOrCreate for streak (modal) for user ${userId}`);
            try {
                 [userStreak, streakCreated] = await UserStreak.findOrCreate({
                    where: { userId: userId },
                    defaults: {
                        userId: userId,
                        streakCount: 0,
                        lastLoggedDateKey: null,
                    }
                });
                 console.log(`[${new Date().toISOString()}] Finished database findOrCreate for streak (modal). Created: ${streakCreated}`);
            } catch (dbError) {
                 console.error(`Database error during findOrCreate for streak (modal):`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Logging Failed')
                      .setDescription('An error occurred while accessing streak data. Please try again later.');
                  await interaction.editReply({ embeds: [embed] });
                  return;
            }


            let currentStreak = userStreak.streakCount;
            const lastLoggedDateKey = userStreak.lastLoggedDateKey;
            let newStreak = currentStreak;

            const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;

            if (loggedDate && !isNaN(loggedDate.getTime())) {
                if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) {
                    const dayDifference = differenceInCalendarDays(loggedDate, lastLoggedDate);

                    if (dayDifference === 1) {
                        newStreak = currentStreak + 1;
                    } else if (dayDifference > 1) {
                        newStreak = 1; // Reset streak
                    } else if (dayDifference <= 0 && format(loggedDate, 'yyyy-MM-dd') !== lastLoggedDateKey) {
                        newStreak = currentStreak;
                    }
                } else {
                    newStreak = 1;
                }

                if (!lastLoggedDateKey || (loggedDate > lastLoggedDate)) {
                     userStreak.streakCount = newStreak;
                     userStreak.lastLoggedDateKey = format(loggedDate, 'yyyy-MM-dd');
                } else {
                     newStreak = userStreak.streakCount;
                }
            } else {
                 console.error(`Invalid loggedDate for streak logic (modal): ${loggedDate}`);
                 // Optionally, reply with an embed for this error case
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Logging Failed')
                     .setDescription('Internal error processing log date for streak calculation. Please contact bot administrator.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            console.log(`[${new Date().toISOString()}] Starting database save for streak (modal) for user ${userId}`);
            try {
                 await userStreak.save();
                 console.log(`[${new Date().toISOString()}] Finished database save for streak (modal).`);
            } catch (dbError) {
                 console.error(`Database error during save for streak (modal):`, dbError);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Logging Failed')
                      .setDescription('An error occurred while saving streak data. Please try again later.');
                  await interaction.editReply({ embeds: [embed] });
                  return;
            }


            // --- Create an embed response message ---
            const formattedLoggedDate = format(loggedDate, 'yyyy-MM-dd');

            const embed = new EmbedBuilder()
                .setColor('#0099FF') // Blue color
                .setTitle(`${isUpdatingExistingLog ? 'Updated' : 'New'} Daily Practice Log for ${interaction.user.username} on ${formattedLoggedDate}`)
                .addFields(
                    // Waking Time and Sleeping Time are not in the modal, do NOT display them here.
                    // { name: 'Waking Time', value: `${sadhanaEntry.wakingTime === null ? 'Not Slept' : (sadhanaEntry.wakingTime ? formatInTimeZone(sadhanaEntry.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${sadhanaEntry.wokeUpEarlyStatus ? 'Yes' : 'No'})` }, // REMOVED
                    { name: 'Japa Rounds', value: sadhanaEntry.japaRounds.toString() },
                    // Study Hours is now in the modal, display it.
                    { name: 'Study Hours', value: sadhanaEntry.studyHours.toString(), inline: true },
                    { name: 'Reading', value: sadhanaEntry.readingDetails || 'Not logged' },
                    { name: 'Listening Hours', value: sadhanaEntry.listeningHours.toString(), inline: true },
                    // Sleeping Time is not in the modal, do NOT display it here.
                    // { name: 'Sleeping Time', value: `${sadhanaEntry.sleepingTime === null ? 'Not Slept' : (sadhanaEntry.sleepingTime ? formatInTimeZone(sadhanaEntry.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${sadhanaEntry.sleptEarlyStatus ? 'Yes' : 'No'})` }, // REMOVED
                    // Regulative Principles are not in the modal, do NOT display them here.
                    // { name: 'Regulative Principles Followed', value: `Meat: ${sadhanaEntry.noMeatEating ? 'Yes' : 'No'}, Gambling: ${sadhanaEntry.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${sadhanaEntry.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${sadhanaEntry.noIntoxication ? 'Yes' : 'No'}` } // REMOVED
                )
                 .setFooter({ text: `Score for this log: ${sadhanaEntry.score} | Current Chanting Streak: ${userStreak.streakCount} day(s) 🙏` });

             // Additional Service is not in the modal, display from database if available (This is fine as it's not from modal input)
             if (sadhanaEntry.additionalService) {
                 embed.addFields({ name: 'Additional Service', value: sadhanaEntry.additionalService });
             }

             // --- Add Encouragement Messages to description or a field ---
             let encouragementMessages = [];
            // Waking Time encouragement removed as it's not in the modal
            // if (sadhanaEntry.wakingTime !== null && !sadhanaEntry.wokeUpEarlyStatus) {
            //     encouragementMessages.push("Aim to wake up before 5 AM IST for maximum spiritual benefit!");
            // } else if (sadhanaEntry.wakingTime === null) {
            //      encouragementMessages.push("Taking rest is important. Hope you can establish a regular waking time soon.");
            // }

            // Sleeping Time encouragement removed as it's not in the modal
            // if (sadhanaEntry.sleepingTime !== null && !sadhanaEntry.sleptEarlyStatus) {
            //     encouragementMessages.push("Try to get to bed before 11 PM IST for restful sleep.");
            // } else if (sadhanaEntry.sleepingTime === null) {
            //     encouragementMessages.push("Taking rest is important. Hope you can establish a regular sleeping time soon.");
            // }

            if (!sadhanaEntry.readingDetails || sadhanaEntry.readingDetails.trim() === '') {
                 encouragementMessages.push("Reading is essential! Pick up a spiritual book today.");
            }
            if ((sadhanaEntry.listeningHours || 0) < 0.1) {
                 encouragementMessages.push("Listening to lectures and kirtans nourishes the soul. Find some time to listen!");
            }
             if ((sadhanaEntry.japaRounds || 0) < 16) {
                 encouragementMessages.push(`Great effort on ${sadhanaEntry.japaRounds} rounds! Keep pushing towards 16!`);
            } else if ((sadhanaEntry.japaRounds || 0) >= 16) {
                 encouragementMessages.push(`Fantastic job on chanting ${sadhanaEntry.japaRounds} rounds! Keep it up!`);
            }
            // Regulative principles encouragement removed as it's not in the modal
            // if (!sadhanaEntry.noMeatEating || !sadhanaEntry.noGambling || !sadhanaEntry.noIllicitSex || !sadhanaEntry.noIntoxication) {
            //      const brokenPrinciples = [];
            //      if (!sadhanaEntry.noMeatEating) brokenPrinciples.push('Meat Eating');
            //      if (!sadhanaEntry.noGambling) brokenPrinciples.push('Gambling');
            //      if (!sadhanaEntry.noIllicitSex) brokenPrinciples.push('Illicit Sex');
            //      if (!sadhanaEntry.noIntoxication) brokenPrinciples.push('Intoxication');
            //      encouragementMessages.push(`Remember the importance of following the 4 regulative principles. You logged not following: ${brokenPrinciples.join(', ')}.`);
            // }
            // Added encouragement for study hours
            if ((sadhanaEntry.studyHours || 0) < 0.1) {
                encouragementMessages.push("Studying spiritual literature is vital. Dedicate some time to study today!");
            }


            if (encouragementMessages.length > 0) {
                 embed.setDescription("\n**Encouragement:**\n" + encouragementMessages.map(msg => `- ${msg}`).join('\n'));
            }


            console.log(`[${new Date().toISOString()}] Attempting to editReply for logPracticeModal submission for user ${userId}`);
            // Edit the deferred reply with the confirmation embed
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for logPracticeModal submission for user ${userId}`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for logPracticeModal submission for user ${userId}:`, editError);
            }


        }
        // Handle other modal submissions if you add more later
    }
});


client.login(token);

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
