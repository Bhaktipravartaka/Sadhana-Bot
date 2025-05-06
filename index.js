// Load environment variables from .env file
require('dotenv').config();

// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags } = require('discord.js');

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
             await interaction.editReply({ content: 'Invalid date provided. Please use valid Day, Month, and Year.' });
            return;
        }

        const dateKeyForTimeParsing = format(loggedDate, 'yyyy-MM-dd');

        let fiveAmIST, elevenPmIST;
        try {
            fiveAmIST = parseTimeInIST(dateKeyForTimeParsing, '5:00 AM');
            elevenPmIST = parseTimeInIST(dateKeyForTimeParsing, '11:00 PM');
        } catch (error) {
             console.error("Error parsing comparison times (5 AM / 11 PM IST):", error);
             await interaction.editReply({ content: 'Internal error processing comparison times. Please contact bot administrator.' });
             return;
        }

        if (!fiveAmIST || !elevenPmIST) {
            console.error("Comparison times (5 AM / 11 PM IST) are invalid after parsing.");
             await interaction.editReply({ content: 'Internal error processing times. Please contact bot administrator.' });
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
                     await interaction.editReply({ content: `Invalid waking time format: "${wakingTimeInput}". Please use HH:MM AM/PM (e.g., 4:30 AM) or type "Not Slept".` });
                     return;
                }
            } catch (parseError) {
                console.error(`Error parsing waking time string "${wakingTimeInput}":`, parseError);
                await interaction.editReply({ content: `Error parsing waking time: "${wakingTimeInput}". ${parseError.message}` });
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
                      await interaction.editReply({ content: 'Internal error processing sleeping time comparison. Please contact bot administrator.' });
                     return;
                }

                 if (!elevenPmISTPreviousDay) {
                    console.error("Comparison time (11 PM IST Previous Day) is invalid after parsing.");
                     await interaction.editReply({ content: 'Internal error processing sleeping time comparison. Please contact bot administrator.' });
                    return;
                }

                if (parsedSleepingTime) {
                    sleptEarlyStatus = parsedSleepingTime < elevenPmISTPreviousDay;
                } else {
                     await interaction.editReply({ content: `Invalid sleeping time format: "${sleepingTimeInput}". Please use HH:MM AM/PM (e.g., 10:30 PM) or type "Not Slept".` });
                     return;
                }

            } catch (parseError) {
                console.error(`Error parsing sleeping time string "${sleepingTimeInput}":`, parseError);
                await interaction.editReply({ content: `Error parsing sleeping time: "${sleepingTimeInput}". ${parseError.message}` });
                return;
            }
        }

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        // Find or create a Sadhana entry
        let [sadhanaEntry, created] = await Sadhana.findOrCreate({
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

        // Save the entry to the database
        await sadhanaEntry.save();


        // --- Chanting Streak Logic (Rewritten for Sequelize) ---
        // Find or create the user's streak entry
        let [userStreak, streakCreated] = await UserStreak.findOrCreate({
            where: { userId: userId },
            defaults: {
                userId: userId,
                streakCount: 0,
                lastLoggedDateKey: null,
            }
        });

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
             return;
        }

        await userStreak.save();


        // --- Create a response message ---
        const formattedLoggedDate = format(loggedDate, 'yyyy-MM-dd');

        let responseMessage = isUpdatingExistingLog ?
            `**Updated Daily Practice Log for ${interaction.user.username} on ${formattedLoggedDate}:**\n` :
            `**Daily Practice Logged for ${interaction.user.username} on ${formattedLoggedDate}:**\n`;

        // Display Waking Time - check if it's null (for 'Not Slept') or format the Date
        responseMessage += `Waking Time: ${sadhanaEntry.wakingTime === null ? 'Not Slept' : (sadhanaEntry.wakingTime ? formatInTimeZone(sadhanaEntry.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${sadhanaEntry.wokeUpEarlyStatus ? 'Yes' : 'No'})\n`;
        responseMessage += `Japa Rounds: ${sadhanaEntry.japaRounds}\n`;
        responseMessage += `Mangala Aarti: ${sadhanaEntry.mangalaArati ? 'Yes' : 'No'}\n`;
        responseMessage += `Morning Program: ${sadhanaEntry.morningProgram ? 'Yes' : 'No'}\n`;
        responseMessage += `Study Hours: ${sadhanaEntry.studyHours}\n`;
        responseMessage += `Reading: ${sadhanaEntry.readingDetails || 'Not logged'}\n`;
        responseMessage += `Listening Hours: ${sadhanaEntry.listeningHours}\n`;
        // Display Sleeping Time - check if it's null (for 'Not Slept') or format the Date
        responseMessage += `Sleeping Time: ${sadhanaEntry.sleepingTime === null ? 'Not Slept' : (sadhanaEntry.sleepingTime ? formatInTimeZone(sadhanaEntry.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${sadhanaEntry.sleptEarlyStatus ? 'Yes' : 'No'})\n`;
         if (sadhanaEntry.additionalService) {
            responseMessage += `Additional Service: ${sadhanaEntry.additionalService}\n`;
        }
        responseMessage += `Regulative Principles Followed: Meat: ${sadhanaEntry.noMeatEating ? 'Yes' : 'No'}, Gambling: ${sadhanaEntry.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${sadhanaEntry.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${sadhanaEntry.noIntoxication ? 'Yes' : 'No'}\n`;
        responseMessage += `**Score for this log: ${sadhanaEntry.score}**\n`;
        responseMessage += `**Current Chanting Streak: ${userStreak.streakCount} day(s)!** 🙏\n`;


        // --- Add Encouragement Messages ---
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
             responseMessage += "\n**Encouragement:**\n" + encouragementMessages.map(msg => `- ${msg}`).join('\n');
        }


        await interaction.editReply({ content: responseMessage });

    }
    // Handle other commands (Need to be rewritten for Sequelize)
    else if (commandName === 'weeklysummary') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;

        const now = new Date();
        const todayStart = startOfDay(now);
        const sevenDaysAgoStart = startOfDay(addDays(now, -6));

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        const recentLogs = await Sadhana.findAll({
            where: {
                userId: userId,
                date: {
                    [Sequelize.Op.gte]: sevenDaysAgoStart,
                    [Sequelize.Op.lte]: todayStart
                }
            },
            order: [['date', 'ASC']]
        });

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
            if (log.noIntoxication === true) principlesFollowedCount++;
        }

        const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
        const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
        const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
        const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0;
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / (loggedDaysCount * 4)).toFixed(2) : 0;


        let summaryMessage = `**Weekly Practice Summary for ${interaction.user.username}:**\n`;
        summaryMessage += `(Summary based on ${loggedDaysCount} logged day(s) in the last 7 days)\n`;
        summaryMessage += `Total Score: ${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})\n`;
        summaryMessage += `Total Rounds Chanted: ${totalRounds} (Avg per logged day: ${avgRounds})\n`;
        summaryMessage += `Total Study Hours: ${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})\n`;
        summaryMessage += `Total Listening Hours: ${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})\n`;
        summaryMessage += `Mangala Aarti Attended: ${mangalaAartiCount} time(s)\n`;
        summaryMessage += `Morning Program Attended: ${morningProgramCount} time(s)\n`;
        summaryMessage += `Woke up early (< 5 AM IST): ${earlyWakingCount} time(s)\n`;
        summaryMessage += `Slept early (< 11 PM IST Previous Night): ${earlySleepingCount} time(s)\n`;
        summaryMessage += `Avg. Regulative Principles Followed per Day: ${avgPrinciples} / 1\n`;
        summaryMessage += `Reading Logged: ${booksReadThisWeek.size > 0 ? Array.from(booksReadThisWeek).join('; ') : 'None'}\n`;


        await interaction.editReply({ content: summaryMessage, flags: [MessageFlags.Ephemeral] });

    }
     // Handle the /monthlysummary command (Need to be rewritten for Sequelize)
     else if (commandName === 'monthlysummary') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;

        const now = new Date();
        const startDate = startOfMonth(now);
        const endDate = endOfDay(now);

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        const monthlyLogs = await Sadhana.findAll({
            where: {
                userId: userId,
                date: {
                    [Sequelize.Op.gte]: startDate,
                    [Sequelize.Op.lte]: endDate
                }
            },
            order: [['date', 'ASC']]
        });


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
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / (loggedDaysCount * 4)).toFixed(2) : 0;


        let summaryMessage = `**Monthly Practice Summary for ${interaction.user.username} (${now.toLocaleString('default', { month: 'long', year: 'numeric' })}):**\n`;
        summaryMessage += `(Based on ${loggedDaysCount} logged day(s))\n`;
        summaryMessage += `Total Score: ${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})\n`;
        summaryMessage += `Total Rounds Chanted: ${totalRounds} (Avg per logged day: ${avgRounds})\n`;
        summaryMessage += `Total Study Hours: ${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})\n`;
        summaryMessage += `Total Listening Hours: ${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})\n`;
        summaryMessage += `Mangala Aarti Attended: ${mangalaAartiCount} time(s)\n`;
        summaryMessage += `Morning Program Attended: ${morningProgramCount} time(s)\n`;
        summaryMessage += `Woke up early (< 5 AM IST): ${earlyWakingCount} time(s)\n`;
        summaryMessage += `Slept early (< 11 PM IST Previous Night): ${earlySleepingCount} time(s)\n`;
        summaryMessage += `Avg. Regulative Principles Followed per Day: ${avgPrinciples} / 1\n`;
        summaryMessage += `Reading Logged: ${booksReadThisMonth.size > 0 ? Array.from(booksReadThisMonth).join('; ') : 'None'}\n`;


        await interaction.editReply({ content: summaryMessage, flags: [MessageFlags.Ephemeral] });
     }
     // Handle the /leaderboard command (Need to be rewritten for Sequelize)
    else if (commandName === 'leaderboard') {
        await interaction.deferReply();

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
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".' });
            return;
        }

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        // Use Sequelize's aggregation features
        const userScores = await Sadhana.findAll({
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


        let leaderboardMessage = `**Spiritual Practice Leaderboard (${periodName}):**\n\n`;

        if (userScores.length === 0) {
            leaderboardMessage += "No practice logs found for this period.";
        } else {
            for (let i = 0; i < userScores.length; i++) {
                const userScore = userScores[i];
                let username = 'Unknown User';
                 try {
                     if (interaction.guild) {
                        const member = await interaction.guild.members.fetch(userScore.userId);
                        username = member.user.username;
                     } else {
                         const user = await client.users.fetch(userScore.userId);
                         username = user.username;
                     }
                 } catch (err) {
                     console.warn(`Could not fetch user/member ${userScore.userId}:`, err.message);
                     try {
                          const user = await client.users.fetch(userScore.userId);
                           username = user.globalName || user.username;
                     } catch (userErr) {
                           console.error(`Could not fetch user ${userScore.userId} globally:`, userErr);
                           username = `User ID: ${userScore.userId}`;
                     }
                 }

                // Access aggregated values using userScore.get('totalScore') and userScore.get('loggedDaysCount')
                leaderboardMessage += `${i + 1}. **${username}**: ${parseFloat(userScore.get('totalScore')).toFixed(2)} points (${userScore.get('loggedDaysCount')} day(s) logged)\n`;
            }
        }

        await interaction.editReply({ content: leaderboardMessage });
    }
    // Handle the /myscore command (Need to be rewritten for Sequelize)
    else if (commandName === 'myscore') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

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
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".', flags: [MessageFlags.Ephemeral] });
            return;
        }

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        const userLogsInPeriod = await Sadhana.findAll({
            where: {
                userId: userId,
                date: {
                    [Sequelize.Op.gte]: startDate,
                    [Sequelize.Op.lte]: endDate
                }
            }
        });

        loggedDaysCount = userLogsInPeriod.length;
        for (const log of userLogsInPeriod) {
            totalScore += log.score || 0;
        }

        let responseMessage = `**Your Personal Practice Score (${periodName}):**\n\n`;
        responseMessage += `Total Score: ${totalScore.toFixed(2)} points (${loggedDaysCount} logged day(s))\n`;

        await interaction.editReply({ content: responseMessage, flags: [MessageFlags.Ephemeral] });

    }
    // Handle the /showscore command (Need to be rewritten for Sequelize)
    else if (commandName === 'showscore') {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user');
        const userId = targetUser.id;
        const username = targetUser.username;

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        // Find the user's streak entry
        const userStreak = await UserStreak.findOne({ where: { userId: userId } });
        const currentStreak = userStreak ? userStreak.streakCount : 0;

        const now = new Date();

        // Weekly Score
        const weeklyStartDate = startOfDay(addDays(now, -6));
        const weeklyEndDate = endOfDay(now);
        const weeklyLogs = await Sadhana.findAll({
            where: {
                userId: userId,
                date: { [Sequelize.Op.gte]: weeklyStartDate, [Sequelize.Op.lte]: weeklyEndDate }
            }
        });
        let weeklyScore = 0;
        let weeklyLoggedDays = weeklyLogs.length;
        for (const log of weeklyLogs) weeklyScore += log.score || 0;

        // Monthly Score
        const monthStartDate = startOfMonth(now);
        const monthlyEndDate = endOfDay(now);
        const monthlyLogs = await Sadhana.findAll({
            where: {
                userId: userId,
                date: { [Sequelize.Op.gte]: monthStartDate, [Sequelize.Op.lte]: monthlyEndDate }
            }
        });
        let monthlyScore = 0;
        let monthlyLoggedDays = monthlyLogs.length;
        for (const log of monthlyLogs) monthlyScore += log.score || 0;

        // All-Time Score
        const allTimeLogs = await Sadhana.findAll({ where: { userId: userId } });
        let allTimeScore = 0;
        let allTimeLoggedDays = allTimeLogs.length;
         for (const log of allTimeLogs) allTimeScore += log.score || 0;


        let responseMessage = `**Practice Scores for ${username}:**\n\n`;
        responseMessage += `**Current Chanting Streak:** ${currentStreak} day(s) 🙏\n\n`;
        responseMessage += `**Weekly (Last 7 Days - ${weeklyLoggedDays} logged):** ${weeklyScore.toFixed(2)} points\n`;
        responseMessage += `**Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })} - ${monthlyLoggedDays} logged):** ${monthlyScore.toFixed(2)} points\n`;
        responseMessage += `**All-Time (${allTimeLoggedDays} logged):** ${allTimeScore.toFixed(2)} points\n`;

        await interaction.editReply({ content: responseMessage });

    }
     // Handle the /streakset command (Admin only) (Need to be rewritten for Sequelize)
    else if (commandName === 'streakset') {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
             await interaction.reply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        const newStreak = interaction.options.getInteger('streak');

        if (newStreak < 0) {
             await interaction.reply({ content: 'Streak value cannot be negative.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const targetUserId = targetUser.id;

        // --- Database Interaction Logic (Rewritten for Sequelize) ---
        // Find or create the user's streak entry
        let [userStreak, created] = await UserStreak.findOrCreate({
            where: { userId: targetUserId },
            defaults: {
                userId: targetUserId,
                streakCount: 0,
                lastLoggedDateKey: null,
            }
        });

        // Update the streak count
        userStreak.streakCount = newStreak;

        try {
            const now = new Date();
            const yesterday = addDays(now, -1);
            const yesterdayKey = format(yesterday, 'yyyy-MM-dd');

            userStreak.lastLoggedDateKey = yesterdayKey;

        } catch (error) {
             console.error('Error during date calculation for streakset:', error);
             await interaction.reply({ content: 'An internal error occurred while setting the streak date. Please contact bot administrator.', flags: [MessageFlags.Ephemeral] });
             return;
        }

        await userStreak.save();

        await interaction.reply({ content: `Successfully set ${targetUser.username}'s chanting streak to ${newStreak}. Their last logged date is set for streak calculation.`, flags: [MessageFlags.Ephemeral] });
    }
    // Handle the /help command
    else if (commandName === 'help') {
        const youtubeLink = 'Yet to be uploaded'; // Replace with your actual YouTube link
        const responseMessage = `Here is a helpful video: ${youtubeLink}`;

        await interaction.reply({ content: responseMessage });
    }
    // --- New /checkdata command handler (Need to be rewritten for Sequelize) ---
    else if (commandName === 'checkdata') {
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
             await interaction.reply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const dataType = interaction.options.getString('type');
        const targetUser = interaction.options.getUser('user');
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');

        let responseMessage = `**Data Check Results:**\n\n`;

        try {
            switch (dataType) {
                case 'user_log_by_date':
                    if (!targetUser || day === null || month === null || year === null) {
                         await interaction.editReply({ content: 'For "User Log by Date", you must provide a user, day, month, and year.' });
                        return;
                    }
                    const checkDate = startOfDay(new Date(year, month - 1, day));
                     if (isNaN(checkDate.getTime())) {
                         await interaction.editReply({ content: 'Invalid date provided for check.' });
                        return;
                    }

                    // --- Database Interaction Logic (Rewritten for Sequelize) ---
                    const userLog = await Sadhana.findOne({ where: { userId: targetUser.id, date: checkDate } });

                    if (userLog) {
                        const formattedDate = format(userLog.date, 'yyyy-MM-dd');
                        responseMessage += `**Log for ${targetUser.username} on ${formattedDate}:**\n`;
                        // Access data using userLog.propertyName
                        responseMessage += `Waking Time: ${userLog.wakingTime === null ? 'Not Slept' : (userLog.wakingTime ? formatInTimeZone(userLog.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${userLog.wokeUpEarlyStatus ? 'Yes' : 'No'})\n`;
                        responseMessage += `Japa Rounds: ${userLog.japaRounds}\n`;
                        responseMessage += `Mangala Aarti: ${userLog.mangalaArati ? 'Yes' : 'No'}\n`;
                        responseMessage += `Morning Program: ${userLog.morningProgram ? 'Yes' : 'No'}\n`;
                        responseMessage += `Study Hours: ${userLog.studyHours}\n`;
                        responseMessage += `Reading: ${userLog.readingDetails || 'Not logged'}\n`;
                        responseMessage += `Listening Hours: ${userLog.listeningHours}\n`;
                        responseMessage += `Sleeping Time: ${userLog.sleepingTime === null ? 'Not Slept' : (userLog.sleepingTime ? formatInTimeZone(userLog.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${userLog.sleptEarlyStatus ? 'Yes' : 'No'})\n`;
                         if (userLog.additionalService) {
                            responseMessage += `Additional Service: ${userLog.additionalService}\n`;
                        }
                         responseMessage += `Regulative Principles Followed: Meat: ${userLog.noMeatEating ? 'Yes' : 'No'}, Gambling: ${userLog.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${userLog.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${userLog.noIntoxication ? 'Yes' : 'No'}\n`;
                        responseMessage += `Score: ${userLog.score}\n`;
                        // If you enabled Sequelize timestamps, you'd access createdAt/updatedAt
                        // responseMessage += `Logged At: ${formatInTimeZone(userLog.createdAt, IST_TIMEZONE, 'yyyy-MM-dd HH:mm:ss z')}\n`;


                    } else {
                        const formattedDate = format(checkDate, 'yyyy-MM-dd');
                        responseMessage += `No log found for ${targetUser.username} on ${formattedDate}.\n`;
                    }
                    break;

                case 'user_streak':
                    if (!targetUser) {
                         await interaction.editReply({ content: 'For "User Streak", you must provide a user.' });
                        return;
                    }
                    // --- Database Interaction Logic (Rewritten for Sequelize) ---
                    const userStreak = await UserStreak.findOne({ where: { userId: targetUser.id } });
                    if (userStreak) {
                        responseMessage += `**Streak for ${targetUser.username}:**\n`;
                        responseMessage += `Current Streak: ${userStreak.streakCount} day(s)\n`;
                        responseMessage += `Last Logged Date Key: ${userStreak.lastLoggedDateKey || 'None'}\n`;
                    } else {
                        responseMessage += `No streak data found for ${targetUser.username}.\n`;
                    }
                    break;

                case 'total_sadhana_count':
                    // --- Database Interaction Logic (Rewritten for Sequelize) ---
                    const totalSadhanaCount = await Sadhana.count(); // Use count() for total count
                    responseMessage += `**Total Sadhana Entries in Database:** ${totalSadhanaCount}\n`;
                    break;

                case 'total_streak_count':
                    // --- Database Interaction Logic (Rewritten for Sequelize) ---
                    const totalStreakCount = await UserStreak.count(); // Use count() for total count
                    responseMessage += `**Total User Streak Entries in Database:** ${totalStreakCount}\n`;
                    break;

                default:
                    responseMessage += 'Invalid data type specified.';
                    break;
            }
        } catch (error) {
            console.error('Error fetching data for /checkdata command:', error);
            responseMessage += 'An error occurred while fetching data.';
        }

        await interaction.editReply({ content: responseMessage, flags: [MessageFlags.Ephemeral] });

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
