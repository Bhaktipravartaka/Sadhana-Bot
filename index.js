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

    // if (log.mangalaArati === true) {
    //     score += 1;
    // }

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
        ]
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
                .setDescription(`Error parsingsleeping time: "${sleepingTimeInput}". ${parseError.message}`);
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
                },
            });

            if (!created) {
                // Update existing entry
                sadhanaEntry.japaRounds = japaRounds;
                sadhanaEntry.wakingTime = parsedWakingTime;
                sadhanaEntry.wokeUpEarlyStatus = wokeUpEarlyStatus;
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
                await sadhanaEntry.save();
                console.log(`[${new Date().toISOString()}] Updated existing sadhana entry for user ${userId} and date ${loggedDate}`);
            } else {
                 console.log(`[${new Date().toISOString()}] Created new sadhana entry for user ${userId} and date ${loggedDate}`);
            }


            // Calculate and save the score
            const score = calculateScore(sadhanaEntry.dataValues); // Pass the dataValues to calculateScore
            sadhanaEntry.score = score;
            await sadhanaEntry.save();


             // --- Streak Management (Sequelize) ---
            const dateKey = format(loggedDate, 'yyyy-MM-dd');
            let userStreak = await UserStreak.findOne({ where: { userId: userId } });

            if (userStreak) {
                const lastLoggedDate = userStreak.lastLoggedDateKey ? parse(userStreak.lastLoggedDateKey, 'yyyy-MM-dd', new Date()) : null;


                if (lastLoggedDate) {
                    const diffDays = differenceInCalendarDays(loggedDate, lastLoggedDate);
                    if (diffDays === 1) {
                        // Consecutive day, increase streak
                        userStreak.streakCount += 1;
                        userStreak.lastLoggedDateKey = dateKey;
                    } else if (diffDays > 1) {
                        // Streak broken, reset to 1
                        userStreak.streakCount = 1;
                        userStreak.lastLoggedDateKey = dateKey;
                    }
                    //  else if (diffDays === 0) {
                    //     //Do nothing.
                    // }
                     else {
                        // do nothing.
                    }
                }
                 else {
                    // First entry, initialize streak
                    userStreak.streakCount = 1;
                    userStreak.lastLoggedDateKey = dateKey;
                }
                await userStreak.save();
            } else {
                // No streak record, create one
                await UserStreak.create({
                    userId: userId,
                    streakCount: 1,
                    lastLoggedDateKey: dateKey,
                });
                console.log(`[${new Date().toISOString()}] Created new user streak entry for user ${userId}`);
            }

            // Construct embed for success message
            const embed = new EmbedBuilder()
                .setColor('#00FF00') // Green for success
                .setTitle('Practice Logged')
                .setDescription(`Your practice for ${format(loggedDate, 'PPP')} has been logged successfully. Your score is ${score}.`)
                .addFields(
                    { name: 'Japa Rounds', value: japaRounds.toString(), inline: true },
                    { name: 'Study Hours', value: studyHours.toFixed(1), inline: true },
                    { name: 'Listening Hours', value: listeningHours.toFixed(1), inline: true },
                    { name: 'Reading Details', value: readingDetails, inline: false },
                    { name: 'Waking Time', value: parsedWakingTime ? format(parsedWakingTime, 'h:mm a') : 'Not Slept', inline: true },
                    { name: 'Sleeping Time', value: parsedSleepingTime ? format(parsedSleepingTime, 'h:mm a') : 'Not Slept', inline: true },
                    { name: 'Woke Up Early?', value: wokeUpEarlyStatus ? 'Yes' : 'No', inline: true },
                    { name: 'Slept Early?', value: sleptEarlyStatus ? 'Yes' : 'No', inline: true },
                    { name: 'No Meat Eating', value: noMeatEating ? 'Yes' : 'No', inline: true },
                    { name: 'No Gambling', value: noGambling ? 'Yes' : 'No', inline: true },
                    { name: 'No Illicit Sex', value: noIllicitSex ? 'Yes' : 'No', inline: true },
                     { name: 'No Intoxication', value: noIntoxication ? 'Yes' : 'No', inline: true },
                    { name: 'Additional Service', value: additionalService || 'None', inline: false },
                );

            // Reply to the user
            await interaction.editReply({ embeds: [embed] });
            console.log(`[${new Date().toISOString()}] Replied to user for /logpractice command`);

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error saving log entry to database:`, error);
             // Reply with an error embed
            const embed = new EmbedBuilder()
                .setColor('#FF0000') // Red for error
                .setTitle('Logging Failed')
                .setDescription('Failed to log your practice. Please try again later.');
            await interaction.editReply({ embeds: [embed] });
        }
    }
    else if (commandName === 'weeklysummary') {
        // ... (rest of the command handlers, adapted for Sequelize)
    }
    else if (commandName === 'monthlysummary') {
       // ...
    }
    else if (commandName === 'leaderboard') {
        // ...
    }
     else if (commandName === 'myscore') {
        // ...
    }
    else if (commandName === 'showscore') {
        // ...
    }
    else if (commandName === 'streakset') {
       // ...
    }
    else if (commandName === 'help') {
       // ...
    }
     else if (commandName === 'checkdata') {
        // ...
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
app.listen(port, () => console.log(`Web server listening on port ${port}!`));
