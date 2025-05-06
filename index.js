// Load environment variables from .env file
// This line should be at the very top of your file.
require('dotenv').config();

// Import necessary classes from discord.js
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags } = require('discord.js');

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
// Corrected import for date-fns-tz v3+
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// Import Mongoose and MongoClient
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb'); // Import MongoClient


// --- ADDED DIAGNOSTIC LOGGING ---
// Updated logs to reflect new import names
console.log(`Type of toZonedTime after import: ${typeof toZonedTime}`);
console.log(`Type of fromZonedTime after import: ${typeof fromZonedTime}`);
console.log(`Type of formatInTimeZone after import: ${typeof formatInTimeZone}`);
// --- END ADDED DIAGNOSTIC LOGGING ---


// Get bot token, client ID, guild ID, and MongoDB URI from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
const mongoUri = process.env.MONGO_URI; // Get the MongoDB URI from .env


// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time


// --- Database Connection using MongoClient ---
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
// Renamed client to mongoClient to avoid conflict with Discord client
const mongoClient = new MongoClient(mongoUri, { // Use mongoUri from .env
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // Add Mongoose recommended options here for consistency if needed,
  // although MongoClient options are slightly different.
  // useNewUrlParser: true, // Deprecated in recent MongoDB driver versions
  // useUnifiedTopology: true, // Deprecated in recent MongoDB driver versions
});

async function connectDB() {
  try {
    console.log("Attempting to connect to MongoDB...");
    // Connect the client to the server
    await mongoClient.connect(); // Use mongoClient here
    console.log("MongoDB client connected. Pinging database...");
    // Send a ping to confirm a successful connection
    await mongoClient.db("admin").command({ ping: 1 }); // Use mongoClient here
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Important: Tell Mongoose to use this existing connection
    mongoose.connection = mongoClient.connection; // Use mongoClient here
    console.log("Mongoose is now using the MongoClient connection.");

  } catch (err) {
    console.error('MongoDB connection error:', err);
    // Exit the process if database connection fails, as it's essential
    process.exit(1);
  }
}

// Call the connection function when the bot starts
connectDB();


// --- Mongoose Schema and Model Definitions ---
// Define the blueprint (Schema) for a Sadhana entry
const sadhanaSchema = new mongoose.Schema({
    // Who logged the entry (Discord user ID)
    userId: {
        type: String, // It's a string of numbers
        required: true, // This must always be there
    },
    // Which server (guild) the entry was logged in (Discord guild ID)
    guildId: {
        type: String, // It's a string of numbers
        required: false, // Not strictly required if commands can be used in DMs
    },
    // The date the practice was done (stored as a Date object, typically start of the day UTC)
    date: {
        type: Date,
        required: true,
    },
    // Number of japa rounds
    japaRounds: {
        type: Number,
        default: 0,
    },
    // Minutes spent studying
    studyHours: { // Kept as hours for now, but schema is flexible
        type: Number,
        default: 0,
    },
    // Minutes spent hearing
    listeningHours: { // Kept as hours for now
        type: Number,
        default: 0,
    },
    // Details of what was read
    readingDetails: {
        type: String,
        default: '',
    },
    // Did they attend mangala arati?
    mangalaArati: {
        type: Boolean,
        default: false,
    },
    // Did they attend morning program?
    morningProgram: {
        type: Boolean,
        default: false,
    },
    // Sleeping time (stored as a Date object in UTC OR the string 'Not Slept')
    sleepingTime: {
        type: mongoose.Schema.Types.Mixed, // Can be Date or String
        default: null,
    },
    // Wake up time (stored as a Date object in UTC OR the string 'Not Slept')
    wakingTime: {
        type: mongoose.Schema.Types.Mixed, // Can be Date or String
        default: null,
    },
    // Calculated status for waking up early
    wokeUpEarlyStatus: {
        type: Boolean,
        default: false,
    },
    // Calculated status for sleeping early
    sleptEarlyStatus: {
        type: Boolean,
        default: false,
    },
    // Regulative principles (stored as true/false)
    noMeatEating: {
        type: Boolean,
        default: false,
    },
    noGambling: {
        type: Boolean,
        default: false,
    },
    noIllicitSex: {
        type: Boolean,
        default: false,
    },
    noIntoxication: {
        type: Boolean,
        default: false,
    },
    // Additional service (stored as text)
    additionalService: {
        type: String,
        default: '',
    },
    // The calculated score for this entry
    score: {
        type: Number,
        default: 0,
    },
    // When this entry was logged (timestamp)
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

// Create the Model from the Schema for daily Sadhana entries
const Sadhana = mongoose.model('Sadhana', sadhanaSchema);

// Define Schema and Model for user streaks
const userStreakSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true, // Each user should only have one streak entry
    },
    streakCount: {
        type: Number,
        default: 0, // Start with 0
    },
    lastLoggedDateKey: {
        type: String, // Store the date key string (e.g., 'YYYY-MM-DD')
        default: null, // Null if no streak yet
    },
});

const UserStreak = mongoose.model('UserStreak', userStreakSchema);


// Helper function to parse time string with date context and convert to IST
// Assumes timeString is in 'h:mm a' format (e.g., '4:30 AM', '10:00 PM')
function parseTimeInIST(dateKey, timeString) {
    try {
        const dateTimeString = `${dateKey} ${timeString}`;
        // Use date-fns parse with a format string and the dateKey as the reference date
        // This helps parse times around midnight correctly relative to the date.
        // Anchor parsing to midnight of the dateKey's UTC equivalent
        const parsedDate = parse(dateTimeString, 'yyyy-MM-dd h:mm a', fromZonedTime(new Date(dateKey + 'T00:00:00'), IST_TIMEZONE));

         if (isNaN(parsedDate.getTime())) {
             console.error(`Parsed date is invalid for string: "${dateTimeString}"`);
             return null;
        }

        // The `parse` function creates a Date object representing the *local* time equivalent
        // of the parsed string. We need to treat this as wall-clock time in the *target* timezone (IST)
        // and then find its UTC equivalent.
        // The `fromZonedTime` function takes the date object (which represents local time)
        // and the *target* timezone (IST), returning the corresponding UTC Date object.
        const utcDate = fromZonedTime(parsedDate, IST_TIMEZONE);

        return utcDate;

    } catch (error) {
        console.error(`Error parsing time string "${timeString}" for date "${dateKey}":`, error);
        throw new Error(`Failed to parse time "${timeString}". Please use HH:MM AM/PM format.`);
    }
}


// Function to calculate the score for a single day's log (using Mongoose document)
function calculateScore(log) {
    let score = 0;

    // Chanting: 1 point if any rounds were chanted (1 or more)
    if ((log.japaRounds || 0) > 0) { // Use japaRounds from the Mongoose doc
        score += 1;
    }

    // Study: 0.1 points per hour
    score += (log.studyHours || 0) * 0.1;

    // Listening: 0.1 points per hour
    score += (log.listeningHours || 0) * 0.1;

    // Reading: 1 point if reading details are provided
    if (log.readingDetails && log.readingDetails.trim() !== '') {
        score += 1;
    }

    // Mangala Aarti: 1 point if attended
    if (log.mangalaArati === true) {
        score += 1;
    }

    // Morning Program: 1 point if attended
    if (log.morningProgram === true) {
        score += 1;
    }

    // Waking Early (before 5 AM IST): 1 point if wokeUpEarlyStatus is true
    if (log.wokeUpEarlyStatus === true) {
        score += 1;
    }

    // Sleeping Early (before 11 PM IST): 1 point if sleptEarlyStatus is true
    if (log.sleptEarlyStatus === true) {
        score += 1;
    }

    // Regulative Principles: 1 point for each principle followed
    if (log.noMeatEating === true) score += 1;
    if (log.noGambling === true) score += 1;
    if (log.noIllicitSex === true) score += 1;
    if (log.noIntoxication === true) score += 1;


    return parseFloat(score.toFixed(2)); // Return score rounded to 2 decimal places
}


// Create a new Discord client instance.
const client = new Client({ // This is the Discord client - Should only be declared ONCE
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
});


// --- Define Slash Commands ---
// This array remains the same as before, defining the commands and their options.
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
                name: 'japa_rounds', // Changed name to match schema
                type: 4, // INTEGER
                description: 'Number of japa rounds chanted', // Updated description
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
    // --- New /checkdata command ---
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
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(), // Restrict to Admins
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
    console.log('Logged in as ${client.user.tag}!'); // Corrected closing quote
    console.log('Bot is online and ready to receive slash commands!'); // Corrected closing quote
});

client.on('interactionCreate', async interaction => {
    console.log(`[${new Date().toISOString()}] Interaction received: ${interaction.id}, Type: ${interaction.type}, Command: ${interaction.isCommand() ? interaction.commandName : 'N/A'}`);

    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // --- Handle Specific Commands ---

    if (commandName === 'logpractice') {
        console.log(`[${new Date().toISOString()}] Handling /logpractice command for user ${interaction.user.tag}`);
        console.log(`[${new Date().toISOString()}] Attempting to defer reply for interaction ${interaction.id}`);

        try {
            // Defer the reply immediately
            await interaction.deferReply();
            console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
        } catch (deferError) {
             console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
             // If deferring fails, the interaction is likely expired.
             return;
        }

        console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

        // Get the values provided by the user
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');
        const wakingTimeInput = interaction.options.getString('waking_time');
        const japaRounds = interaction.options.getInteger('japa_rounds'); // Changed name
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
        const guildId = interaction.guild?.id; // Use optional chaining in case command is used outside guild


        // --- Date and Time Parsing/Calculation ---
        // Create a Date object for the start of the logged day in UTC
        const loggedDate = startOfDay(new Date(year, month - 1, day)); // month is 0-indexed

        if (isNaN(loggedDate.getTime())) {
             await interaction.editReply({ content: 'Invalid date provided. Please use valid Day, Month, and Year.' });
            return;
        }

        // Create Date objects for comparison times (5 AM and 11 PM IST) relative to the logged date
        const dateKeyForTimeParsing = format(loggedDate, 'yyyy-MM-dd'); // Use formatted loggedDate for time parsing context

        let fiveAmIST, elevenPmIST;
        try {
            fiveAmIST = parseTimeInIST(dateKeyForTimeParsing, '5:00 AM');
            elevenPmIST = parseTimeInIST(dateKeyForTimeParsing, '11:00 PM'); // 11 PM on the *logged* day
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

        // --- Handle "Not Slept" for Waking Time ---
        let parsedWakingTime = null;
        let wokeUpEarlyStatus = false;

        if (wakingTimeInput && wakingTimeInput.toLowerCase() === 'not slept') {
            parsedWakingTime = 'Not Slept';
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

        // --- Handle "Not Slept" for Sleeping Time ---
        // Sleeping time refers to the night before the logged day
        const previousDayDate = addDays(loggedDate, -1); // Use loggedDate for correct previous day
        const previousDateKey = format(previousDayDate, 'yyyy-MM-dd');

        let parsedSleepingTime = null;
        let sleptEarlyStatus = false;

        if (sleepingTimeInput && sleepingTimeInput.toLowerCase() === 'not slept') {
            parsedSleepingTime = 'Not Slept';
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

        // --- Database Storage Logic ---
        // Find if a Sadhana entry already exists for this user and date
        // We query by userId and the start of the logged date (UTC)
        let sadhanaEntry = await Sadhana.findOne({ userId: userId, date: loggedDate });

        const isUpdatingExistingLog = !!sadhanaEntry; // Check if we found an existing entry

        if (!sadhanaEntry) {
            // If no entry exists, create a new one
            sadhanaEntry = new Sadhana({
                userId: userId,
                guildId: guildId, // Store guildId
                date: loggedDate, // Store the start of the day UTC
                // Default values are set in the schema, so no need to initialize here
            });
        }

        // Update the entry with the new data from the command options
        sadhanaEntry.japaRounds = japaRounds;
        sadhanaEntry.wakingTime = parsedWakingTime; // Store parsed time (UTC Date) or "Not Slept" string
        sadhanaEntry.wokeUpEarlyStatus = wokeUpEarlyStatus; // Store calculated status
        sadhanaEntry.mangalaArati = mangalaArati;
        sadhanaEntry.morningProgram = morningProgram;
        sadhanaEntry.studyHours = studyHours;
        sadhanaEntry.readingDetails = readingDetails;
        sadhanaEntry.listeningHours = listeningHours;
        sadhanaEntry.sleepingTime = parsedSleepingTime; // Store parsed time (UTC Date) or "Not Slept" string
        sadhanaEntry.sleptEarlyStatus = sleptEarlyStatus; // Store calculated status
        sadhanaEntry.noMeatEating = noMeatEating;
        sadhanaEntry.noGambling = noGambling;
        sadhanaEntry.noIllicitSex = noIllicitSex;
        sadhanaEntry.noIntoxication = noIntoxication;
        sadhanaEntry.additionalService = additionalService;
        sadhanaEntry.timestamp = new Date(); // Update timestamp on save/update


        // Calculate and store the score
        sadhanaEntry.score = calculateScore(sadhanaEntry);

        // Save the entry to the database
        await sadhanaEntry.save();


        // --- Chanting Streak Logic (using UserStreak model) ---
        // Find the user's streak entry
        let userStreak = await UserStreak.findOne({ userId: userId });

        if (!userStreak) {
            // If no streak entry exists, create a new one
            userStreak = new UserStreak({
                userId: userId,
                streakCount: 0,
                lastLoggedDateKey: null,
            });
        }

        let currentStreak = userStreak.streakCount;
        const lastLoggedDateKey = userStreak.lastLoggedDateKey;
        let newStreak = currentStreak;

        // Parse the logged date and last logged date for comparison
        // Use the loggedDate (start of day UTC) for comparison
        const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;


        if (loggedDate && !isNaN(loggedDate.getTime())) {
            if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) {
                const dayDifference = differenceInCalendarDays(loggedDate, lastLoggedDate);

                if (dayDifference === 1) {
                    newStreak = currentStreak + 1;
                } else if (dayDifference > 1) {
                    newStreak = 1; // Reset streak
                } else if (dayDifference <= 0 && format(loggedDate, 'yyyy-MM-dd') !== lastLoggedDateKey) {
                    // Logging a past date that doesn't extend the streak
                    newStreak = currentStreak; // Keep current streak value for response
                }
                // If dayDifference is 0 (same day), newStreak is currentStreak
            } else {
                // First log entry
                newStreak = 1;
            }

            // Update streak data ONLY if the current logged date is LATER than the last logged date
            // OR if it's the very first log.
            if (!lastLoggedDateKey || (loggedDate > lastLoggedDate)) {
                 userStreak.streakCount = newStreak;
                 userStreak.lastLoggedDateKey = format(loggedDate, 'yyyy-MM-dd'); // Store the date key string
            } else {
                 // If logging for the same or past day, ensure the response shows the *actual* current streak
                 newStreak = userStreak.streakCount;
            }
        } else {
             console.error(`Invalid loggedDate for streak logic: ${loggedDate}`);
             // Error message already sent for invalid date, just return.
             return;
        }

        // Save the updated streak entry
        await userStreak.save();


        // --- Create a response message ---
        const formattedLoggedDate = format(loggedDate, 'yyyy-MM-dd'); // Format the logged date for the message

        let responseMessage = isUpdatingExistingLog ?
            `**Updated Daily Practice Log for ${interaction.user.username} on ${formattedLoggedDate}:**\n` :
            `**Daily Practice Logged for ${interaction.user.username} on ${formattedLoggedDate}:**\n`;

        // Display Waking Time - show 'Not Slept' if it's the string, otherwise format the Date
        responseMessage += `Waking Time: ${sadhanaEntry.wakingTime === 'Not Slept' ? 'Not Slept' : (sadhanaEntry.wakingTime ? formatInTimeZone(sadhanaEntry.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${sadhanaEntry.wokeUpEarlyStatus ? 'Yes' : 'No'})\n`;
        responseMessage += `Japa Rounds: ${sadhanaEntry.japaRounds}\n`;
        responseMessage += `Mangala Aarti: ${sadhanaEntry.mangalaArati ? 'Yes' : 'No'}\n`;
        responseMessage += `Morning Program: ${sadhanaEntry.morningProgram ? 'Yes' : 'No'}\n`;
        responseMessage += `Study Hours: ${sadhanaEntry.studyHours}\n`;
        responseMessage += `Reading: ${sadhanaEntry.readingDetails || 'Not logged'}\n`;
        responseMessage += `Listening Hours: ${sadhanaEntry.listeningHours}\n`;
        // Display Sleeping Time - show 'Not Slept' if it's the string, otherwise format the Date
        responseMessage += `Sleeping Time: ${sadhanaEntry.sleepingTime === 'Not Slept' ? 'Not Slept' : (sadhanaEntry.sleepingTime ? formatInTimeZone(sadhanaEntry.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${sadhanaEntry.sleptEarlyStatus ? 'Yes' : 'No'})\n`;
         if (sadhanaEntry.additionalService) {
            responseMessage += `Additional Service: ${sadhanaEntry.additionalService}\n`;
        }
        responseMessage += `Regulative Principles Followed: Meat: ${sadhanaEntry.noMeatEating ? 'Yes' : 'No'}, Gambling: ${sadhanaEntry.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${sadhanaEntry.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${sadhanaEntry.noIntoxication ? 'Yes' : 'No'}\n`;
        responseMessage += `**Score for this log: ${sadhanaEntry.score}**\n`;
        // Display the current streak count from the potentially updated data
        responseMessage += `**Current Chanting Streak: ${userStreak.streakCount} day(s)!** 🙏\n`;


        // --- Add Encouragement Messages ---
        let encouragementMessages = [];
        if (sadhanaEntry.wakingTime !== 'Not Slept' && !sadhanaEntry.wokeUpEarlyStatus) {
            encouragementMessages.push("Aim to wake up before 5 AM IST for maximum spiritual benefit!");
        } else if (sadhanaEntry.wakingTime === 'Not Slept') {
             encouragementMessages.push("Taking rest is important. Hope you can establish a regular waking time soon.");
        }

        if (sadhanaEntry.sleepingTime !== 'Not Slept' && !sadhanaEntry.sleptEarlyStatus) {
            encouragementMessages.push("Try to get to bed before 11 PM IST for restful sleep.");
        } else if (sadhanaEntry.sleepingTime === 'Not Slept') {
            encouragementMessages.push("Taking rest is important. Hope you can establish a regular sleeping time soon.");
        }

        if (!sadhanaEntry.readingDetails || sadhanaEntry.readingDetails.trim() === '') {
             encouragementMessages.push("Reading is essential! Pick up a spiritual book today.");
        }
        if ((sadhanaEntry.listeningHours || 0) < 0.1) {
             encouragementMessages.push("Listening to lectures and kirtans nourishes the soul. Find some time to listen!");
        }
         if ((sadhanaEntry.japaRounds || 0) < 16) { // Changed from chantingRounds
             encouragementMessages.push(`Great effort on ${sadhanaEntry.japaRounds} rounds! Keep pushing towards 16!`);
        } else if ((sadhanaEntry.japaRounds || 0) >= 16) { // Changed from chantingRounds
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


        // Use editReply since we deferred earlier
        await interaction.editReply({ content: responseMessage });

    }
    // Handle the /weeklysummary command
    else if (commandName === 'weeklysummary') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;

        const now = new Date();
        const todayStart = startOfDay(now); // Start of today in local time
        const sevenDaysAgoStart = startOfDay(addDays(now, -6)); // Start of 7 days ago

        // Find all sadhana entries for this user within the last 7 days
        const recentLogs = await Sadhana.find({
            userId: userId,
            date: {
                $gte: sevenDaysAgoStart, // Greater than or equal to the start of 7 days ago UTC
                $lte: todayStart // Less than or equal to the start of today UTC
            }
        }).sort({ date: 1 }); // Sort by date ascending

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
        const loggedDaysCount = recentLogs.length; // Number of entries found

        for (const log of recentLogs) {
            totalRounds += log.japaRounds || 0; // Use japaRounds from the Mongoose doc
            totalStudyHours += log.studyHours || 0;
            totalListeningHours += log.listeningHours || 0;
            if (log.mangalaArati === true) mangalaAartiCount++;
            if (log.morningProgram === true) morningProgramCount++;
            totalScore += log.score || 0;
            if (log.readingDetails && log.readingDetails.trim() !== '') {
                booksReadThisWeek.add(log.readingDetails);
            }
            if (log.wakingTime !== 'Not Slept' && log.wokeUpEarlyStatus === true) earlyWakingCount++;
            if (log.sleepingTime !== 'Not Slept' && log.sleptEarlyStatus === true) earlySleepingCount++;
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
     // Handle the /monthlysummary command
     else if (commandName === 'monthlysummary') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        const startDate = startOfMonth(now); // Start of the current month UTC
        const endDate = endOfDay(now); // End of today UTC

        // Find all sadhana entries for this user within the current month
        const monthlyLogs = await Sadhana.find({
            userId: userId,
            date: {
                $gte: startDate, // Greater than or equal to the start of the month UTC
                $lte: endDate // Less than or equal to the end of today UTC
            }
        }).sort({ date: 1 }); // Sort by date ascending

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
            totalRounds += log.japaRounds || 0; // Use japaRounds from Mongoose doc
            totalStudyHours += log.studyHours || 0;
            totalListeningHours += log.listeningHours || 0;
            if (log.mangalaArati === true) mangalaAartiCount++;
            if (log.morningProgram === true) morningProgramCount++;
            totalScore += log.score || 0;
            if (log.readingDetails && log.readingDetails.trim() !== '') {
                booksReadThisMonth.add(log.readingDetails);
            }
             if (log.wakingTime !== 'Not Slept' && log.wokeUpEarlyStatus === true) earlyWakingCount++;
             if (log.sleepingTime !== 'Not Slept' && log.sleptEarlyStatus === true) earlySleepingCount++;
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
     // Handle the /leaderboard command
    else if (commandName === 'leaderboard') {
        await interaction.deferReply();

        const period = interaction.options.getString('period');
        const now = new Date();

        let startDate;
        let endDate = endOfDay(now); // End of today UTC

        let periodName;

        if (period === 'weekly') {
            startDate = startOfDay(addDays(now, -6)); // Start of 7 days ago UTC
            periodName = 'Last 7 Days';
        } else if (period === 'monthly') {
            startDate = startOfMonth(now); // Start of current month UTC
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".' });
            return;
        }

        // Find all sadhana entries within the specified date range
        const allLogsInPeriod = await Sadhana.find({
            date: {
                $gte: startDate,
                $lte: endDate
            }
        });

        // Aggregate scores per user
        const userScoresMap = new Map();
        for (const log of allLogsInPeriod) {
            const userId = log.userId;
            const score = log.score || 0;
            if (!userScoresMap.has(userId)) {
                userScoresMap.set(userId, { totalScore: 0, loggedDaysCount: 0 });
            }
            const userData = userScoresMap.get(userId);
            userData.totalScore += score;
            // Count unique days logged within the period for each user
            const logDateKey = format(log.date, 'yyyy-MM-dd'); // Format the stored Date back to key for counting
            if (!userData.loggedDates) {
                userData.loggedDates = new Set();
            }
            if (!userData.loggedDates.has(logDateKey)) {
                userData.loggedDates.add(logDateKey);
                userData.loggedDaysCount++;
            }
        }

        // Convert map to array for sorting
        const userScores = Array.from(userScoresMap.entries()).map(([userId, data]) => ({
            userId,
            totalScore: data.totalScore,
            loggedDaysCount: data.loggedDaysCount
        }));


        // Sort users by total score in descending order
        userScores.sort((a, b) => b.totalScore - a.totalScore);

        // Get the top 10 users
        const topUsers = userScores.slice(0, 10);

        let leaderboardMessage = `**Spiritual Practice Leaderboard (${periodName}):**\n\n`;

        if (topUsers.length === 0) {
            leaderboardMessage += "No practice logs found for this period.";
        } else {
            for (let i = 0; i < topUsers.length; i++) {
                const userScore = topUsers[i];
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
                           // Use the fetched user's global name or username
                           username = user.globalName || user.username;
                     } catch (userErr) {
                           console.error(`Could not fetch user ${userScore.userId} globally:`, userErr);
                           username = `User ID: ${userScore.userId}`; // Fallback
                     }
                 }

                leaderboardMessage += `${i + 1}. **${username}**: ${userScore.totalScore.toFixed(2)} points (${userScore.loggedDaysCount} day(s) logged)\n`;
            }
        }

        await interaction.editReply({ content: leaderboardMessage });
    }
    // Handle the /myscore command
    else if (commandName === 'myscore') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const userId = interaction.user.id;
        const username = interaction.user.username;

        const now = new Date();
        let startDate;
        let endDate = endOfDay(now); // End of today UTC

        const period = interaction.options.getString('period');
        let periodName;
        let totalScore = 0;
        let loggedDaysCount = 0;

        if (period === 'weekly') {
            startDate = startOfDay(addDays(now, -6)); // Start of 7 days ago UTC
            periodName = 'Last 7 Days';
        } else if (period === 'monthly') {
            startDate = startOfMonth(now); // Start of current month UTC
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".', flags: [MessageFlags.Ephemeral] });
            return;
        }

        // Find sadhana entries for the user within the period
        const userLogsInPeriod = await Sadhana.find({
            userId: userId,
            date: {
                $gte: startDate,
                $lte: endDate
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
    // Handle the /showscore command
    else if (commandName === 'showscore') {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user');
        const userId = targetUser.id;
        const username = targetUser.username;

        // Find the user's streak entry
        const userStreak = await UserStreak.findOne({ userId: userId });
        const currentStreak = userStreak ? userStreak.streakCount : 0;

        const now = new Date();

        // Weekly Score
        const weeklyStartDate = startOfDay(addDays(now, -6)); // Start of 7 days ago UTC
        const weeklyEndDate = endOfDay(now); // End of today UTC
        const weeklyLogs = await Sadhana.find({
            userId: userId,
            date: { $gte: weeklyStartDate, $lte: weeklyEndDate }
        });
        let weeklyScore = 0;
        let weeklyLoggedDays = weeklyLogs.length;
        for (const log of weeklyLogs) weeklyScore += log.score || 0;

        // Monthly Score
        const monthStartDate = startOfMonth(now); // Start of current month UTC
        const monthlyEndDate = endOfDay(now); // End of today UTC
        const monthlyLogs = await Sadhana.find({
            userId: userId,
            date: { $gte: monthStartDate, $lte: monthlyEndDate }
        });
        let monthlyScore = 0;
        let monthlyLoggedDays = monthlyLogs.length;
        for (const log of monthlyLogs) monthlyScore += log.score || 0;

        // All-Time Score
        const allTimeLogs = await Sadhana.find({ userId: userId });
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
     // Handle the /streakset command (Admin only)
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

        // Find or create the user's streak entry
        let userStreak = await UserStreak.findOne({ userId: targetUserId });

        if (!userStreak) {
            userStreak = new UserStreak({
                userId: targetUserId,
                streakCount: 0,
                lastLoggedDateKey: null,
            });
        }

        // Update the streak count
        userStreak.streakCount = newStreak;

        // When manually setting a streak, set the last logged date to yesterday
        // relative to *today* to allow the streak to continue tomorrow.
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
    // --- New /checkdata command handler ---
    else if (commandName === 'checkdata') {
        // Restrict this command to Administrators
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
             await interaction.reply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply, make it ephemeral

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
                    const checkDate = startOfDay(new Date(year, month - 1, day)); // month is 0-indexed
                     if (isNaN(checkDate.getTime())) {
                         await interaction.editReply({ content: 'Invalid date provided for check.' });
                        return;
                    }

                    const userLog = await Sadhana.findOne({ userId: targetUser.id, date: checkDate });

                    if (userLog) {
                        const formattedDate = format(userLog.date, 'yyyy-MM-dd');
                        responseMessage += `**Log for ${targetUser.username} on ${formattedDate}:**\n`;
                        // Display Waking Time - show 'Not Slept' if it's the string, otherwise format the Date
                        responseMessage += `Waking Time: ${userLog.wakingTime === 'Not Slept' ? 'Not Slept' : (userLog.wakingTime ? formatInTimeZone(userLog.wakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${userLog.wokeUpEarlyStatus ? 'Yes' : 'No'})\n`;
                        responseMessage += `Japa Rounds: ${userLog.japaRounds}\n`;
                        responseMessage += `Mangala Aarti: ${userLog.mangalaArati ? 'Yes' : 'No'}\n`;
                        responseMessage += `Morning Program: ${userLog.morningProgram ? 'Yes' : 'No'}\n`;
                        responseMessage += `Study Hours: ${userLog.studyHours}\n`;
                        responseMessage += `Reading: ${userLog.readingDetails || 'Not logged'}\n`;
                        responseMessage += `Listening Hours: ${userLog.listeningHours}\n`;
                        // Display Sleeping Time - show 'Not Slept' if it's the string, otherwise format the Date
                        responseMessage += `Sleeping Time: ${userLog.sleepingTime === 'Not Slept' ? 'Not Slept' : (userLog.sleepingTime ? formatInTimeZone(userLog.sleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${userLog.sleptEarlyStatus ? 'Yes' : 'No'})\n`;
                         if (userLog.additionalService) {
                            responseMessage += `Additional Service: ${userLog.additionalService}\n`;
                        }
                         responseMessage += `Regulative Principles Followed: Meat: ${userLog.noMeatEating ? 'Yes' : 'No'}, Gambling: ${userLog.noGambling ? 'Yes' : 'No'}, Illicit Sex: ${userLog.noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${userLog.noIntoxication ? 'Yes' : 'No'}\n`;
                        responseMessage += `Score: ${userLog.score}\n`;
                        responseMessage += `Logged At: ${formatInTimeZone(userLog.timestamp, IST_TIMEZONE, 'yyyy-MM-dd HH:mm:ss z')}\n`;

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
                    const userStreak = await UserStreak.findOne({ userId: targetUser.id });
                    if (userStreak) {
                        responseMessage += `**Streak for ${targetUser.username}:**\n`;
                        responseMessage += `Current Streak: ${userStreak.streakCount} day(s)\n`;
                        responseMessage += `Last Logged Date Key: ${userStreak.lastLoggedDateKey || 'None'}\n`;
                    } else {
                        responseMessage += `No streak data found for ${targetUser.username}.\n`;
                    }
                    break;

                case 'total_sadhana_count':
                    const totalSadhanaCount = await Sadhana.countDocuments();
                    responseMessage += `**Total Sadhana Entries in Database:** ${totalSadhanaCount}\n`;
                    break;

                case 'total_streak_count':
                    const totalStreakCount = await UserStreak.countDocuments();
                    responseMessage += `**Total User Streak Entries in Database:** ${totalStreakCount}\n`;
                    break;

                default:
                    responseMessage += 'Invalid data type specified.';
                    break;
            }
        } catch (error) {
            console.error('Error fetching data for /checkdata command:', error);
            responseMessage += 'An error occurred while fetching data.';
             // If a Mongoose timeout happens here, the initial deferReply might prevent a second Unknown Interaction
             // but the user will get the error message in the ephemeral reply.
        }

        await interaction.editReply({ content: responseMessage, flags: [MessageFlags.Ephemeral] }); // Edit the deferred reply

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
