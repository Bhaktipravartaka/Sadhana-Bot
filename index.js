// Load environment variables from .env file
require('dotenv').config();

// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder } = require('discord.js'); // Import EmbedBuilder

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// Import Sequelize and DataTypes
const { Sequelize, DataTypes } = require('sequelize'); // Import Sequelize and DataTypes

// Get bot token, client ID, guild ID, and PostgreSQL URI from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
const postgresUri = process.env.POSTGRES_URI; // Get the PostgreSQL URI from .env


// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time


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
    mangalaArati: {
        type: DataTypes.BOOLEAN, // Use BOOLEAN for true/false
        defaultValue: false,
    },
    morningProgram: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
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

    if (log.mangalaArati === true) {
        score += 1;
    }

    if (log.morningProgram === true) {
        score += 1;
    }

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
    ],
});


// --- Define Slash Commands ---
// This array remains the same, but the command handlers will need to use Sequelize
const commands = [
    {
        name: 'logpractice',
        description: 'Log your daily spiritual practices.',
        options: [
            {
                name: 'day',
                type: 4, // INTEGER
                description: 'Day of the month (e.g., 15)',
                required: true,
            },
            {
                name: 'month',
                type: 4, // INTEGER
                description: 'Month (1-12)',
                required: true,
            },
            {
                name: 'year',
                type: 4, // INTEGER
                description: 'Year (e.g., 2023)',
                required: true,
            },
            {
                name: 'waking_time',
                type: 3, // STRING
                description: 'Your waking time (e.g., 4:30 AM) or type "Not Slept". Use HH:MM AM/PM format if entering a time.',
                required: true,
            },
            {
                name: 'japa_rounds',
                type: 4, // INTEGER
                description: 'Number of japa rounds chanted',
                required: true,
            },
            {
                name: 'mangala_aarti',
                type: 5, // BOOLEAN
                description: 'Did you attend Mangala Aarti (in person or online)?',
                required: true,
            },
            {
                name: 'morning_program',
                type: 5, // BOOLEAN
                description: 'Did you attend the morning program (in person or online)?',
                required: true,
            },
            {
                name: 'study_hours',
                type: 10, // NUMBER
                description: 'Hours spent studying',
                required: true,
            },
            {
                name: 'reading_details',
                type: 3, // STRING
                description: 'What you read and how much (e.g., Bhagavad Gita Ch 2, 10 pages)',
                required: true,
            },
            {
                name: 'listening_hours',
                type: 10, // NUMBER
                description: 'Hours spent listening to books/content',
                required: true,
            },
             {
                name: 'sleeping_time',
                type: 3, // STRING
                description: 'Your sleeping time (e.g., 10:30 PM) or type "Not Slept". Use HH:MM AM/PM format if entering a time.',
                required: true,
            },
            {
                 name: 'no_meat_eating',
                 type: 5, // BOOLEAN
                 description: 'Did you follow the no meat eating principle?',
                 required: true,
            },
             {
                 name: 'no_gambling',
                 type: 5, // BOOLEAN
                 description: 'Did you follow the no gambling principle?',
                 required: true,
            },
             {
                 name: 'no_illicit_sex',
                 type: 5, // BOOLEAN
                 description: 'Did you follow the no illicit sex principle?',
                 required: true,
            },
             {
                 name: 'no_intoxication',
                 type: 5, // BOOLEAN
                 description: 'Did you follow the no intoxication principle?',
                 required: true,
            },
            {
                name: 'additional_service',
                type: 3, // STRING
                description: 'Any additional service done (optional)',
                required: false,
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
                    { name: 'Monthly', value: 'monthly' },
                ]
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
        description: 'Provides a link to a helpful YouTube video.',
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
                name: 'day',
                type: 4, // INTEGER
                description: 'Day of the month (required for User Log by Date).',
                required: false,
            },
            {
                name: 'month',
                type: 4, // INTEGER
                description: 'Month (1-12) (required for User Log by Date).',
                required: false,
            },
            {
                name: 'year',
                type: 4, // INTEGER
                description: 'Year (e.g., 2023) (required for User Log by Date).',
                required: false,
            },
        ],
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
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


// --- Bot Event Handlers ---

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online and ready to receive slash commands!');
});

client.on('interactionCreate', async interaction => {
    console.log(`[${new Date().toISOString()}] Interaction received: ${interaction.id}, Type: ${interaction.type}, Command: ${interaction.isCommand() ? interaction.commandName : 'N/A'}`);

    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // --- Handle Specific Commands (Need to be rewritten for Sequelize) ---

    if (commandName === 'logpractice') {
        console.log(`[${new Date().toISOString()}] Handling /logpractice command for user ${interaction.user.tag}`);
        console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);

        try {
            // Removed ephemeral flag from deferReply
            await interaction.deferReply();
            console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
        } catch (deferError) {
             console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
             return;
        }

        console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

        // Get the values provided by the user
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');
        const wakingTimeInput = interaction.options.getString('waking_time');
        const japaRounds = interaction.options.getInteger('japa_rounds');
        const mangalaArati = interaction.options.getBoolean('mangala_aarti');
        const morningProgram = interaction.options.getBoolean('morning_program');
        const studyHours = interaction.options.getNumber('study_hours');
        const readingDetails = interaction.options.getString('reading_details');
        const listeningHours = interaction.options.getNumber('listening_hours');
        const sleepingTimeInput = interaction.options.getString('sleeping_time');
        const noMeatEating = interaction.options.getBoolean('no_meat_eating');
        const noGambling = interaction.options.getBoolean('no_gambling');
        const noIllicitSex = interaction.options.getBoolean('no_illicit_sex');
        const noIntoxication = interaction.options.getBoolean('no_intoxication');
        const additionalService = interaction.options.getString('additional_service');

        const userId = interaction.user.id;
        const guildId = interaction.guild?.id;

        const loggedDate = startOfDay(new Date(year, month - 1, day));

        if (isNaN(loggedDate.getTime())) {
            // Reply with embed for invalid date
            const embed = new EmbedBuilder()
                .setColor('#FF0000') // Red color for error
                .setTitle('Logging Failed')
                .setDescription('Invalid date provided. Please use valid Day, Month, and Year.');
             await interaction.editReply({ embeds: [embed] });
            return;
        }

        const dateKeyForTimeParsing = format(loggedDate, 'yyyy-MM-dd');

        let fiveAmIST, elevenPmIST;
        try {
            fiveAmIST = parseTimeInIST(dateKeyForTimeParsing, '5:00 AM');
            elevenPmIST = parseTimeInIST(dateKeyForTimeParsing, '11:00 PM');
        } catch (error) {
             console.error("Error parsing comparison times (5 AM / 11 PM IST):", error);
             // Reply with embed for internal error
             const embed = new EmbedBuilder()
                 .setColor('#FF0000') // Red color for error
                 .setTitle('Logging Failed')
                 .setDescription('Internal error processing comparison times. Please contact bot administrator.');
             await interaction.editReply({ embeds: [embed] });
             return;
        }

        if (!fiveAmIST || !elevenPmIST) {
            console.error("Comparison times (5 AM / 11 PM IST) are invalid after parsing.");
             // Reply with embed for internal error
             const embed = new EmbedBuilder()
                 .setColor('#FF0000') // Red color for error
                 .setTitle('Logging Failed')
                 .setDescription('Internal error processing times. Please contact bot administrator.');
             await interaction.editReply({ embeds: [embed] });
            return;
        }

        let parsedWakingTime = null;
        let wokeUpEarlyStatus = false;

        if (wakingTimeInput && wakingTimeInput.toLowerCase() === 'not slept') {
            parsedWakingTime = null; // Store as null in PostgreSQL DATE column
            wokeUpEarlyStatus = false;
        } else {
            try {
                parsedWakingTime = parseTimeInIST(dateKeyForTimeParsing, wakingTimeInput);
                if (parsedWakingTime) {
                    wokeUpEarlyStatus = parsedWakingTime < fiveAmIST;
                } else {
                     // Reply with embed for invalid waking time format
                     const embed = new EmbedBuilder()
                         .setColor('#FF0000') // Red color for error
                         .setTitle('Logging Failed')
                         .setDescription(`Invalid waking time format: "${wakingTimeInput}". Please use HH:MM AM/PM (e.g., 4:30 AM) or type "Not Slept".`);
                     await interaction.editReply({ embeds: [embed] });
                     return;
                }
            } catch (parseError) {
                console.error(`Error parsing waking time string "${wakingTimeInput}":`, parseError);
                // Reply with embed for parsing error
                const embed = new EmbedBuilder()
                    .setColor('#FF0000') // Red color for error
                    .setTitle('Logging Failed')
                    .setDescription(`Error parsing waking time: "${wakingTimeInput}". ${parseError.message}`);
                await interaction.editReply({ embeds: [embed] });
                return;
            }
        }

        const previousDayDate = addDays(loggedDate, -1);
        const previousDateKey = format(previousDayDate, 'yyyy-MM-dd');

        let parsedSleepingTime = null;
        let sleptEarlyStatus = false;

        if (sleepingTimeInput && sleepingTimeInput.toLowerCase() === 'not slept') {
            parsedSleepingTime = null; // Store as null in PostgreSQL DATE column
            sleptEarlyStatus = false;
        } else {
            try {
                parsedSleepingTime = parseTimeInIST(previousDateKey, sleepingTimeInput);

                let elevenPmISTPreviousDay;
                try {
                     elevenPmISTPreviousDay = parseTimeInIST(previousDateKey, '11:00 PM');
                } catch (error) {
                     console.error("Error parsing comparison time (11 PM IST Previous Day):", error);
                     // Reply with embed for internal error
                     const embed = new EmbedBuilder()
                         .setColor('#FF0000') // Red color for error
                         .setTitle('Logging Failed')
                         .setDescription('Internal error processing sleeping time comparison. Please contact bot administrator.');
                      await interaction.editReply({ embeds: [embed] });
                     return;
                }

                 if (!elevenPmISTPreviousDay) {
                    console.error("Comparison time (11 PM IST Previous Day) is invalid after parsing.");
                     // Reply with embed for internal error
                     const embed = new EmbedBuilder()
                         .setColor('#FF0000') // Red color for error
                         .setTitle('Logging Failed')
                         .setDescription('Internal error processing sleeping time comparison. Please contact bot administrator.');
                     await interaction.editReply({ embeds: [embed] });
                    return;
                }

                if (parsedSleepingTime) {
                    sleptEarlyStatus = parsedSleepingTime < elevenPmISTPreviousDay;
                } else {
                     // Reply with embed for invalid sleeping time format
                     const embed = new EmbedBuilder()
                         .setColor('#FF0000') // Red color for error
                         .setTitle('Logging Failed')
                         .setDescription(`Invalid sleeping time format: "${sleepingTimeInput}". Please use HH:MM AM/PM (e.g., 10:30 PM) or type "Not Slept".`);
                     await interaction.editReply({ embeds: [embed] });
                     return;
                }

            } catch (parseError) {
                console.error(`Error parsing sleeping time string "${sleepingTimeInput}":`, parseError);
                // Reply with embed for parsing error
                const embed = new EmbedBuilder()
                    .setColor('#FF0000') // Red color for error
                    .setTitle('Logging Failed')
                    .setDescription(`Error parsing sleeping time: "${sleepingTimeInput}". ${parseError.message}`);
                await interaction.editReply({ embeds: [embed] });
                return;
            }
        }

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        let sadhanaEntry;
        let created;
        try {
             [sadhanaEntry, created] = await Sadhana.findOrCreate({
                where: { userId: userId, date: loggedDate },
                defaults: { // Default values if a new entry is created
                    userId: userId,
                    guildId: guildId,
                    date: loggedDate,
                    japaRounds: japaRounds,
                    wakingTime: parsedWakingTime,
                    wokeUpEarlyStatus: wokeUpEarlyStatus,
                    mangalaArati: mangalaArati,
                    morningProgram: morningProgram,
                    studyHours: studyHours,
                    readingDetails: readingDetails,
                    listeningHours: listeningHours,
                    sleepingTime: parsedSleepingTime,
                    sleptEarlyStatus: sleptEarlyStatus,
                    noMeatEating: noMeatEating,
                    noGambling: noGambling,
                    noIllicitSex: noIllicitSex,
                    noIntoxication: noIntoxication,
                    additionalService: additionalService,
                    score: 0, // Calculate score after updating
                }
            });
        } catch (dbError) {
            console.error(`Database error during findOrCreate for logpractice:`, dbError);
             const embed = new EmbedBuilder()
                 .setColor('#FF0000')
                 .setTitle('Logging Failed')
                 .setDescription('An error occurred while accessing the database. Please try again later.');
             await interaction.editReply({ embeds: [embed] });
             return;
        }


        const isUpdatingExistingLog = !created; // If not created, it was found

        // If updating, update the found entry
        if (isUpdatingExistingLog) {
            sadhanaEntry.japaRounds = japaRounds;
            sadhanaEntry.wakingTime = parsedWakingTime;
            sadhanaEntry.wokeUpEarlyStatus = wokeUpEarlyStatus;
            sadhanaEntry.mangalaArati = mangalaArati;
            sadhanaEntry.morningProgram = morningProgram;
            sadhanaEntry.studyHours = studyHours;
            sadhanaEntry.readingDetails = readingDetails;
            sadhanaEntry.listeningHours = listeningHours;
            sadhanaEntry.sleepingTime = parsedSleepingTime;
            sadhanaEntry.sleptEarlyStatus = sleptEarlyStatus;
            sadhanaEntry.noMeatEating = noMeatEating;
            sadhanaEntry.noGambling = noGambling;
            sadhanaEntry.noIllicitSex = noIllicitSex;
            sadhanaEntry.noIntoxication = noIntoxication;
            sadhanaEntry.additionalService = additionalService;
            // Sequelize automatically manages timestamps if enabled, but we set timestamps: false
            // If you need a 'logged at' timestamp, you'd add a column and manage it manually or enable Sequelize timestamps.
        }

        // Calculate and store the score
        sadhanaEntry.score = calculateScore(sadhanaEntry);

        try {
            // Save the entry to the database
            await sadhanaEntry.save();
        } catch (dbError) {
            console.error(`Database error during save for logpractice:`, dbError);
             const embed = new EmbedBuilder()
                 .setColor('#FF0000')
                 .setTitle('Logging Failed')
                 .setDescription('An error occurred while saving to the database. Please try again later.');
             await interaction.editReply({ embeds: [embed] });
             return;
        }


        // --- Chanting Streak Logic (Rewritten for Sequelize) ---
        // Find or create the user's streak entry
        let userStreak;
        let streakCreated;
        try {
             [userStreak, streakCreated] = await UserStreak.findOrCreate({
                where: { userId: userId },
                defaults: {
                    userId: userId,
                    streakCount: 0,
                    lastLoggedDateKey: null,
                }
            });
        } catch (dbError) {
             console.error(`Database error during findOrCreate for streak:`, dbError);
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
             console.error(`Invalid loggedDate for streak logic: ${loggedDate}`);
             // Optionally, reply with an embed for this error case
             const embed = new EmbedBuilder()
                 .setColor('#FF0000')
                 .setTitle('Logging Failed')
                 .setDescription('Internal error processing log date for streak calculation. Please contact bot administrator.');
             await interaction.editReply({ embeds: [embed] });
             return;
        }

        try {
             await userStreak.save();
        } catch (dbError) {
             console.error(`Database error during save for streak:`, dbError);
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
                { name: 'Waking Time', value: `${sadhanaEntry.wakingTime === null ? 'Not Slept' : (sadhanaEntry.wakingTime ? formatInTimeZone(sadhanaEntry.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${sadhanaEntry.wokeUpEarlyStatus ? 'Yes' : 'No'})` },
                { name: 'Japa Rounds', value: sadhanaEntry.japaRounds.toString() },
                { name: 'Mangala Aarti', value: sadhanaEntry.mangalaArati ? 'Yes' : 'No', inline: true },
                { name: 'Morning Program', value: sadhanaEntry.morningProgram ? 'Yes' : 'No', inline: true },
                { name: 'Study Hours', value: sadhanaEntry.studyHours.toString(), inline: true },
                { name: 'Reading', value: sadhanaEntry.readingDetails || 'Not logged' },
                { name: 'Listening Hours', value: sadhanaEntry.listeningHours.toString(), inline: true },
                { name: 'Sleeping Time', value: `${sadhanaEntry.sleepingTime === null ? 'Not Slept' : (sadhanaEntry.sleepingTime ? formatInTimeZone(sadhanaEntry.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${sadhanaEntry.sleptEarlyStatus ? 'Yes' : 'No'})` },
                { name: 'Regulative Principles Followed', value: `Meat: ${sadhanaEntry.noMeatEating ? 'Yes' : 'No'}, Gambling: ${sadhanaEntry.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${sadhanaEntry.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${sadhanaEntry.noIntoxication ? 'Yes' : 'No'}` }
            )
             .setFooter({ text: `Score for this log: ${sadhanaEntry.score} | Current Chanting Streak: ${userStreak.streakCount} day(s) 🙏` });

         if (sadhanaEntry.additionalService) {
             embed.addFields({ name: 'Additional Service', value: sadhanaEntry.additionalService });
         }

         // --- Add Encouragement Messages to description or a field ---
         let encouragementMessages = [];
        if (sadhanaEntry.wakingTime !== null && !sadhanaEntry.wokeUpEarlyStatus) {
            encouragementMessages.push("Aim to wake up before 5 AM IST for maximum spiritual benefit!");
        } else if (sadhanaEntry.wakingTime === null) {
             encouragementMessages.push("Taking rest is important. Hope you can establish a regular waking time soon.");
        }

        if (sadhanaEntry.sleepingTime !== null && !sadhanaEntry.sleptEarlyStatus) {
            encouragementMessages.push("Try to get to bed before 11 PM IST for restful sleep.");
        } else if (sadhanaEntry.sleepingTime === null) {
            encouragementMessages.push("Taking rest is important. Hope you can establish a regular sleeping time soon.");
        }

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
        if (!sadhanaEntry.noMeatEating || !sadhanaEntry.noGambling || !sadhanaEntry.noIllicitSex || !sadhanaEntry.noIntoxication) {
             const brokenPrinciples = [];
             if (!sadhanaEntry.noMeatEating) brokenPrinciples.push('Meat Eating');
             if (!sadhanaEntry.noGambling) brokenPrinciples.push('Gambling');
             if (!sadhanaEntry.noIllicitSex) brokenPrinciples.push('Illicit Sex');
             if (!sadhanaEntry.noIntoxication) brokenPrinciples.push('Intoxication');
             encouragementMessages.push(`Remember the importance of following the 4 regulative principles. You logged not following: ${brokenPrinciples.join(', ')}.`);
        }

        if (encouragementMessages.length > 0) {
             embed.setDescription("\n**Encouragement:**\n" + encouragementMessages.map(msg => `- ${msg}`).join('\n'));
        }


        // Edited reply to use embeds
        await interaction.editReply({ embeds: [embed] });

    }
    // Handle other commands (Need to be rewritten for Sequelize)
    else if (commandName === 'weeklysummary') {
        console.log(`[${new Date().toISOString()}] Handling /weeklysummary command for user ${interaction.user.tag}`);
        console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);
        try {
            // Removed ephemeral flag from deferReply
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
        let mangalaAartiCount = 0;
        let morningProgramCount = 0;
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
            if (log.mangalaArati === true) mangalaAartiCount++;
            if (log.morningProgram === true) morningProgramCount++;
            totalScore += log.score || 0;
            if (log.readingDetails && log.readingDetails.trim() !== '') {
                booksReadThisWeek.add(log.readingDetails);
            }
            if (log.wakingTime !== null && log.wokeUpEarlyStatus === true) earlyWakingCount++; // Check for null
            if (log.sleepingTime !== null && log.sleptEarlyStatus === true) earlySleepingCount++; // Check for null
            if (log.noMeatEating === true) principlesFollowedCount++;
            if (log.noGambling === true) principlesFollowedCount++;
            if (log.noIllicitSex === true) principlesFollowedCount++;
            if (log.noIntendedSex === true) principlesFollowedCount++; // Assuming noIntendedSex is a typo and should be noIllicitSex
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
                { name: 'Mangala Aarti Attended', value: `${mangalaAartiCount} time(s)`, inline: true },
                { name: 'Morning Program Attended', value: `${morningProgramCount} time(s)`, inline: true },
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
            // Removed ephemeral flag from deferReply
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
        let mangalaAartiCount = 0;
        let morningProgramCount = 0;
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
            if (log.mangalaArati === true) mangalaAartiCount++;
            if (log.morningProgram === true) morningProgramCount++;
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
                 { name: 'Mangala Aarti Attended', value: `${mangalaAartiCount} time(s)`, inline: true },
                 { name: 'Morning Program Attended', value: `${morningProgramCount} time(s)`, inline: true },
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
            .setTitle('Helpful Resources')
            .setDescription(`Here is a helpful video: ${youtubeLink}`);

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
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');

        // Create an embed for the checkdata results
        const embed = new EmbedBuilder()
             .setColor('#800080') // Purple color
            .setTitle('Data Check Results');

        let embedDescription = ''; // Use description or fields for results

        try {
            switch (dataType) {
                case 'user_log_by_date':
                    if (!targetUser || day === null || month === null || year === null) {
                         embedDescription = 'For "User Log by Date", you must provide a user, day, month, and year.';
                         embed.setColor('#FF0000'); // Change color for error
                         embed.setDescription(embedDescription);
                         await interaction.editReply({ embeds: [embed] });
                        return;
                    }
                    const checkDate = startOfDay(new Date(year, month - 1, day));
                     if (isNaN(checkDate.getTime())) {
                         embedDescription = 'Invalid date provided for check.';
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
                            { name: 'Mangala Aarti', value: userLog.mangalaArati ? 'Yes' : 'No', inline: true },
                            { name: 'Morning Program', value: userLog.morningProgram ? 'Yes' : 'No', inline: true },
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
