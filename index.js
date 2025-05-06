// Load environment variables from .env file
// This line should be at the very top of your file.
require('dotenv').config();

// Import necessary classes from discord.js
// Client: The main class for your bot.
// GatewayIntentBits: Used to specify what events your bot listens to from Discord.
// REST: Used to make requests to Discord's API (like registering commands).
// Routes: Provides the specific API endpoints you need to interact with.
// PermissionsBitField: Used for checking user permissions (like Administrator).
// MessageFlags: Contains flags like Ephemeral for interaction responses.
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags } = require('discord.js');
const fs = require('fs').promises; // Import the file system module for saving/loading data
const path = require('path'); // Import path module for joining paths

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
// Corrected import for date-fns-tz v3+
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// --- ADDED DIAGNOSTIC LOGGING ---
// Updated logs to reflect new import names
console.log(`Type of toZonedTime after import: ${typeof toZonedTime}`);
console.log(`Type of fromZonedTime after import: ${typeof fromZonedTime}`);
console.log(`Type of formatInTimeZone after import: ${typeof formatInTimeZone}`);
// --- END ADDED DIAGNOSTIC LOGGING ---


// Get bot token, client ID, and guild ID from environment variables.
// Ensure these are correctly set in your .env file.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID; // Your bot's Client ID from the Developer Portal
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing

// Define the path to the data file
const DATA_FILE = path.join(__dirname, 'sadhana_data.json'); // Use path.join for better compatibility

// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time

// Function to load data from the JSON file
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        // Ensure the data structure has top-level logs and streaks keys
        const parsedData = JSON.parse(data);
        if (!parsedData.logs) parsedData.logs = {};
        if (!parsedData.streaks) parsedData.streaks = {};
        return parsedData;
    } catch (error) {
        // If the file doesn't exist or there's an error reading it, return initial structure
        if (error.code === 'ENOENT') {
            return { logs: {}, streaks: {} };
        }
        console.error('Error loading data:', error);
        return { logs: {}, streaks: {} }; // Return initial structure on other errors too
    }
}

// Function to save data to the JSON file
async function saveData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Function to calculate the score for a single day's log
function calculateScore(log) {
    let score = 0;

    // Chanting: 1 point if any rounds were chanted (1 or more)
    if ((log.chantingRounds || 0) > 0) {
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
    // Use explicit boolean check as the stored value might be undefined if old data exists
    if (log.mangalaAarti === true) {
        score += 1;
    }

    // Morning Program: 1 point if attended
     // Use explicit boolean check
    if (log.morningProgram === true) {
        score += 1;
    }

    // Waking Early (before 5 AM IST): 1 point if wokeUpEarlyStatus is true
    // This will be false if wakingTime is 'Not Slept'
    if (log.wokeUpEarlyStatus === true) {
        score += 1;
    }

    // Sleeping Early (before 11 PM IST): 1 point if sleptEarlyStatus is true
    // This will be false if sleepingTime is 'Not Slept'
    if (log.sleptEarlyStatus === true) {
        score += 1;
    }

    // Regulative Principles: 1 point for each principle followed
     // Use explicit boolean checks
    if (log.noMeatEating === true) score += 1;
    if (log.noGambling === true) score += 1;
    if (log.noIllicitSex === true) score += 1;
    if (log.noIntoxication === true) score += 1;


    return parseFloat(score.toFixed(2)); // Return score rounded to 2 decimal places
}

// Helper function to parse time string with date context and convert to IST
// Assumes timeString is in 'h:mm a' format (e.g., '4:30 AM', '10:00 PM')
// This function now uses fromZonedTime from 'date-fns-tz' v3+.
function parseTimeInIST(dateKey, timeString) {
    try {
        // Combine date (YYYY-MM-DD) and time string
        const dateTimeString = `${dateKey} ${timeString}`;
        // Use date-fns parse with a format string and the dateKey as the reference date
        // This helps parse times around midnight correctly relative to the date.
        // Use the dateKey itself as the base date for parsing to avoid timezone shifts during parsing
        const parsedDate = parse(dateTimeString, 'yyyy-MM-dd h:mm a', new Date(dateKey + 'T00:00:00')); // Anchor parsing to midnight of the dateKey

         // Check if parsing was successful and resulted in a valid date
        if (isNaN(parsedDate.getTime())) {
             console.error(`Parsed date is invalid for string: "${dateTimeString}"`);
             // Return null or throw an error to indicate failure
             return null;
        }

        // The `parse` function creates a Date object representing the *local* time equivalent
        // of the parsed string. We need to treat this as wall-clock time in the *target* timezone (IST)
        // and then find its UTC equivalent.

        // Convert the parsed local date/time directly to UTC, assuming the input time was *intended* for IST.
        // The `fromZonedTime` function takes the date object (which represents local time)
        // and the *target* timezone (IST), returning the corresponding UTC Date object.
        // This function requires 'date-fns-tz' v3 or later.
        const utcDate = fromZonedTime(parsedDate, IST_TIMEZONE);

        // Convert the UTC date back to a zoned date object for IST (optional, depends on how you use it later)
        // If you just need the Date object representing the correct moment in time (UTC), utcDate is sufficient.
        // If you need to format it *as* IST time later, use toZonedTime.
        // const zonedDate = toZonedTime(utcDate, IST_TIMEZONE); // Use this if you need to display/compare in IST later

        // For calculations like comparing against 5 AM IST, you often work with the UTC representation
        // or convert the comparison time (5 AM IST) to UTC as well.

        // Let's return the UTC Date object as it represents the specific moment in time.
        return utcDate;

    } catch (error) {
        // Make sure the error message includes the specific function call that failed if possible
        console.error(`Error parsing time string "${timeString}" for date "${dateKey}":`, error);
        // Consider adding more specific error handling here if needed,
        // e.g., checking if error is a TypeError related to zonedTimeToUtc (though it's now fromZonedTime).
        // Re-throw the error or return null to signal failure
        throw new Error(`Failed to parse time "${timeString}". Please use HH:MM AM/PM format.`);
    }
}


// Create a new Discord client instance.
// Specify the intents your bot needs to receive from Discord.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Required for slash commands to function within servers (guilds).
        // GatewayIntentBits.GuildMessages, // Useful if you need to read regular messages, but not strictly for ONLY slash commands.
        // GatewayIntentBits.MessageContent, // Required to read the content of regular messages (also needs enabling in Developer Portal). Not needed for slash commands.
        GatewayIntentBits.GuildMembers, // Needed if your bot interacts with server members (e.g., getting usernames).
        GatewayIntentBits.GuildPresences, // Needed if you want presence updates (e.g., user online/offline status).
    ],
});

// --- Define Slash Commands ---
// This is an array containing the definitions for all your slash commands.
// Each object in the array represents one command.
const commands = [
    {
        // The name of the command. Must be lowercase, 1-32 characters, no spaces.
        name: 'logpractice',
        // A short description of the command (appears in Discord).
        description: 'Log your daily spiritual practices.',
        // The options (inputs) that the user can provide with the command.
        // REQUIRED options MUST come before NON-REQUIRED options.
        options: [
            // Date Inputs (Required)
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
            // Practice Inputs (Required)
            {
                name: 'waking_time',
                type: 3, // STRING
                // Updated description to include the "Not Slept" option
                description: 'Your waking time (e.g., 4:30 AM) or type "Not Slept". Use HH:MM AM/PM format if entering a time.',
                required: true,
                // Removed .addChoices() if they were ever here, to allow free text input
            },
            {
                name: 'chanting_rounds',
                type: 4, // INTEGER
                description: 'Number of chanting rounds completed',
                required: true,
            },
            {
                name: 'mangala_aarti',
                type: 5, // BOOLEAN (True/False toggle)
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
                type: 10, // NUMBER (allows decimals)
                description: 'Hours spent studying',
                required: true,
            },
            {
                name: 'reading_details', // Changed name
                type: 3, // Changed type to STRING
                description: 'What you read and how much (e.g., Bhagavad Gita Ch 2, 10 pages)', // Updated description
                required: true, // Still required
            },
            {
                name: 'listening_hours', // Kept as is
                type: 10, // NUMBER
                description: 'Hours spent listening to books/content',
                required: true,
            },
             {
                name: 'sleeping_time',
                type: 3, // STRING
                // Updated description to include the "Not Slept" option
                description: 'Your sleeping time (e.g., 10:30 PM) or type "Not Slept". Use HH:MM AM/PM format if entering a time.',
                required: true,
                // Removed .addChoices() to allow free text input
            },
            // New Regulative Principle Options (Required Booleans)
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
            // Optional Inputs (Must come after required)
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
        // Add options if needed, e.g., to specify a start date
    },
    {
        name: 'monthlysummary',
        description: 'Shows your spiritual practice summary for the current month.',
         // Add options if needed, e.g., to specify a month/year
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
                choices: [ // Provide predefined choices
                    {
                        name: 'Weekly',
                        value: 'weekly',
                    },
                    {
                        name: 'Monthly',
                        value: 'monthly',
                    },
                ],
            },
        ],
    },
    {
        name: 'myscore', // New command
        description: 'Shows your personal practice score for a specific period.', // Updated description
        options: [ // Add period option
            {
                name: 'period',
                type: 3, // STRING
                description: 'Select the period for your score',
                required: true,
                choices: [ // Provide predefined choices
                    {
                        name: 'Weekly',
                        value: 'weekly',
                    },
                    {
                        name: 'Monthly',
                        value: 'monthly',
                    },
                ],
            },
        ],
    },
    {
        name: 'showscore', // Renamed from myscore
        description: 'Shows a user\'s personal practice scores (weekly, monthly, all-time) and streak.', // Updated description
        options: [ // Added user option
            {
                name: 'user',
                type: 6, // USER type for mentioning a user
                description: 'The user whose score to show.',
                required: true,
            },
        ],
    },
     {
        name: 'streakset', // New admin command
        description: 'Sets the chanting streak for a user (Admin only).',
        options: [
            {
                name: 'user',
                type: 6, // USER type for mentioning a user
                description: 'The user whose streak to set.',
                required: true,
            },
            {
                name: 'streak',
                type: 4, // INTEGER type for the streak number
                description: 'The new streak value.',
                required: true,
            },
        ],
        // Default permission: only administrators can use this command
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    },
     {
        name: 'help', // New command
        description: 'Provides a link to a helpful YouTube video.',
    },
];

// --- Debugging Line ---
// This console.log helps confirm that the code execution reaches the command registration section.
console.log('Code reached command registration block.');

// --- Command Registration ---
// This code block registers the defined slash commands with Discord's API.
// It uses the REST API and should run once when your script starts.
// We use an Immediately Invoked Async Function Expression (IIAFE) to run this code right away.

const rest = new REST({ version: '10' }).setToken(token); // Create a REST client instance, authenticated with your bot token.

// Start of the IIAFE
(async () => {
    try {
        // This console.log should print if the IIAFE starts executing.
        console.log(`Started refreshing application (/) commands for client ID: ${clientId}.`);

        // Use rest.put() to send the commands data to Discord's API endpoint.
        // We are using GUILD-SPECIFIC commands here for faster testing.
        // Make sure GUILD_ID is set in your .env file and uncommented above.
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId), // Endpoint for guild commands
            // Routes.applicationCommands(clientId), // Use this for GLOBAL commands (takes up to 1 hour to appear)
            { body: commands }, // The body of the request is our commands array
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // If any error occurs during the registration process, it will be caught and logged here.
        console.error('Error registering commands:', error);
    }
})(); // The () at the end immediately calls the async function defined above.


// --- Bot Event Handlers ---

// Event handler for when the bot successfully connects to Discord and is ready to operate.
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online and ready to receive slash commands!');
});

// Event handler for handling interactions. Slash commands are a type of interaction.
client.on('interactionCreate', async interaction => {
    // Check if the interaction is specifically a command interaction.
    if (!interaction.isCommand()) return;

    // Get the name of the command that was used by the user.
    const { commandName } = interaction;

    // --- Handle Specific Commands ---

    // Handle the /logpractice command
    if (commandName === 'logpractice') {
        // Defer the reply as time parsing and saving might take a moment
        // Removed ephemeral: true to make the reply public
        await interaction.deferReply();

        // Get the values provided by the user for each option of the command.
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');
        const wakingTimeInput = interaction.options.getString('waking_time'); // Get the raw input string
        const chantingRounds = interaction.options.getInteger('chanting_rounds');
        const mangalaAarti = interaction.options.getBoolean('mangala_aarti');
        const morningProgram = interaction.options.getBoolean('morning_program');
        const studyHours = interaction.options.getNumber('study_hours');
        const readingDetails = interaction.options.getString('reading_details'); // Get reading details (string)
        const listeningHours = interaction.options.getNumber('listening_hours'); // Get listening hours (number)
        const sleepingTimeInput = interaction.options.getString('sleeping_time'); // Get the raw input string
        // Get regulative principle values
        const noMeatEating = interaction.options.getBoolean('no_meat_eating');
        const noGambling = interaction.options.getBoolean('no_gambling');
        const noIllicitSex = interaction.options.getBoolean('no_illicit_sex');
        const noIntoxication = interaction.options.getBoolean('no_intoxication');
        const additionalService = interaction.options.getString('additional_service'); // Will be null if not provided


        // --- Date and Time Parsing/Calculation ---
        const dateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        // Create Date objects for comparison times (5 AM and 11 PM IST)
        // We need to parse these relative to the *logged date*
        let fiveAmIST, elevenPmIST;
        try {
            fiveAmIST = parseTimeInIST(dateKey, '5:00 AM');
            elevenPmIST = parseTimeInIST(dateKey, '11:00 PM'); // 11 PM on the *logged* day
        } catch (error) {
             console.error("Error parsing comparison times (5 AM / 11 PM IST):", error);
             await interaction.editReply({ content: 'Internal error processing comparison times. Please contact bot administrator.' }); // Removed ephemeral
             return;
        }


        // Check if the comparison times parsed correctly
        if (!fiveAmIST || !elevenPmIST) {
            // This check might be redundant if parseTimeInIST throws errors, but good for safety
            console.error("Comparison times (5 AM / 11 PM IST) are invalid after parsing.");
             await interaction.editReply({ content: 'Internal error processing times. Please contact bot administrator.' }); // Removed ephemeral
            return;
        }

        // --- Handle "Not Slept" for Waking Time ---
        let parsedWakingTime = null; // Initialize as null
        let wokeUpEarlyStatus = false; // Initialize wokeUpEarlyStatus to false

        // Check if the user entered "Not Slept" (case-insensitive)
        if (wakingTimeInput && wakingTimeInput.toLowerCase() === 'not slept') {
            parsedWakingTime = 'Not Slept'; // Store the specific string "Not Slept"
            wokeUpEarlyStatus = false; // Cannot have woken up early if not slept
            console.log(`User ${interaction.user.id} in guild ${interaction.guild?.id} reported "Not Slept" for waking time on ${dateKey}.`);
        } else {
            // If not "Not Slept", attempt to parse it as a time
            try {
                parsedWakingTime = parseTimeInIST(dateKey, wakingTimeInput);

                // Determine if woke up early (strictly before 5 AM IST on the logged date)
                // Only set wokeUpEarlyStatus if parsing was successful
                if (parsedWakingTime) {
                    wokeUpEarlyStatus = parsedWakingTime < fiveAmIST;
                } else {
                     // If parsing failed for a non-"Not Slept" input
                     await interaction.editReply({ content: `Invalid waking time format: "${wakingTimeInput}". Please use HH:MM AM/PM (e.g., 4:30 AM) or type "Not Slept".` }); // Removed ephemeral
                     return;
                }

            } catch (parseError) {
                 // If parsing fails for a non-"Not Slept" input
                console.error(`Error parsing waking time string "${wakingTimeInput}":`, parseError);
                await interaction.editReply({ content: `Error parsing waking time: "${wakingTimeInput}". ${parseError.message}` }); // Removed ephemeral
                return;
            }
        }
        // --- End Handling "Not Slept" for Waking Time ---


        // Parse sleeping time. This is tricky - it usually refers to the *night before* the logged day.
        // Example: Log for May 6th includes sleeping time from the night of May 5th.
        const previousDayDate = new Date(year, month - 1, day); // Create date object for the log date
        previousDayDate.setDate(previousDayDate.getDate() - 1); // Go back one day
        const previousDateKey = format(previousDayDate, 'yyyy-MM-dd'); // Format previous day correctly

        // --- Handle "Not Slept" for Sleeping Time ---
        let parsedSleepingTime = null; // Initialize as null
        let sleptEarlyStatus = false; // Initialize sleptEarlyStatus to false

        // Check if the user entered "Not Slept" (case-insensitive)
        if (sleepingTimeInput && sleepingTimeInput.toLowerCase() === 'not slept') {
            parsedSleepingTime = 'Not Slept'; // Store the specific string "Not Slept"
            sleptEarlyStatus = false; // Cannot have slept early if not slept
            console.log(`User ${interaction.user.id} in guild ${interaction.guild?.id} reported "Not Slept" for sleeping time on ${dateKey}.`);
        } else {
            // If not "Not Slept", attempt to parse it as a time
            try {
                parsedSleepingTime = parseTimeInIST(previousDateKey, sleepingTimeInput);

                // Determine if slept early (before 11 PM IST *on the night before the logged date*)
                // We need 11 PM IST for the *previous* day for comparison.
                let elevenPmISTPreviousDay;
                try {
                     elevenPmISTPreviousDay = parseTimeInIST(previousDateKey, '11:00 PM');
                } catch (error) {
                     console.error("Error parsing comparison time (11 PM IST Previous Day):", error);
                      await interaction.editReply({ content: 'Internal error processing sleeping time comparison. Please contact bot administrator.' }); // Removed ephemeral
                     return;
                }

                 if (!elevenPmISTPreviousDay) {
                    console.error("Comparison time (11 PM IST Previous Day) is invalid after parsing.");
                     await interaction.editReply({ content: 'Internal error processing sleeping time comparison. Please contact bot administrator.' }); // Removed ephemeral
                    return;
                }
                // Only set sleptEarlyStatus if parsing was successful
                if (parsedSleepingTime) {
                    sleptEarlyStatus = parsedSleepingTime < elevenPmISTPreviousDay;
                } else {
                     // If parsing failed but it wasn't "Not Slept"
                     await interaction.editReply({ content: `Invalid sleeping time format: "${sleepingTimeInput}". Please use HH:MM AM/PM (e.g., 10:30 PM) or type "Not Slept".` }); // Removed ephemeral
                     return;
                }

            } catch (parseError) {
                 // If parsing fails for a non-"Not Slept" input
                console.error(`Error parsing sleeping time string "${sleepingTimeInput}":`, parseError);
                await interaction.editReply({ content: `Error parsing sleeping time: "${sleepingTimeInput}". ${parseError.message}` }); // Removed ephemeral
                return;
            }
        }
         // --- End Handling "Not Slept" ---


        // --- Data Storage Logic ---
        const data = await loadData(); // Load existing data
        const userId = interaction.user.id;

        if (!data.logs[userId]) {
            data.logs[userId] = {};
        }
         if (!data.streaks[userId]) {
             data.streaks[userId] = { streakCount: 0, lastLoggedDateKey: null };
         }

        // --- Chanting Streak Logic ---
        let currentStreak = data.streaks[userId].streakCount;
        const lastLoggedDateKey = data.streaks[userId].lastLoggedDateKey;
        let newStreak = currentStreak; // Initialize newStreak with currentStreak

        // Parse the logged date and last logged date for comparison
        const loggedDate = parse(dateKey, 'yyyy-MM-dd', new Date()); // Use current date as base for parsing
        const lastLoggedDate = lastLoggedDateKey ? parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date()) : null;

        if (loggedDate && !isNaN(loggedDate.getTime())) { // Check if loggedDate is valid
            if (lastLoggedDate && !isNaN(lastLoggedDate.getTime())) { // Check if lastLoggedDate is valid
                const dayDifference = differenceInCalendarDays(loggedDate, lastLoggedDate);

                if (dayDifference === 1) {
                    // Logged date is exactly one calendar day after the last logged date
                    newStreak = currentStreak + 1;
                } else if (dayDifference > 1) {
                    // Logged date is more than one calendar day after the last logged date
                    newStreak = 1; // Reset streak to 1
                } else if (dayDifference <= 0 && dateKey !== lastLoggedDateKey) {
                    // Logging a past date that is earlier than or same as last logged date,
                    // but *not* the exact same date (which means updating).
                    // Don't reset streak, just keep the current one.
                    // If it *is* the same day, streak doesn't change based on this log *yet*.
                    newStreak = currentStreak;
                }
                // If dayDifference is 0 (same day), streak doesn't change based on this log *yet*.
            } else {
                // First log entry for this user
                newStreak = 1;
            }

            // Update streak data ONLY if the current logged date is LATER than the last logged date
            // OR if it's the very first log.
            if (!lastLoggedDateKey || (loggedDate > lastLoggedDate)) {
                data.streaks[userId].streakCount = newStreak;
                data.streaks[userId].lastLoggedDateKey = dateKey;
            } else if (dateKey === lastLoggedDateKey) {
                // If logging for the *same* day as the last logged date (updating),
                // ensure the streak count reflects the state *before* this log.
                newStreak = currentStreak; // Keep the streak as it was for the response message
            } else {
                // Logging a past date that was already covered by the streak.
                // Keep the existing streak state and show the current streak in the message.
                 newStreak = data.streaks[userId].streakCount; // Ensure response shows the actual current streak
            }
        } else {
             console.error(`Invalid dateKey generated or parsed: ${dateKey}`);
             await interaction.editReply({ content: 'Invalid date provided. Please use valid Day, Month, and Year.' }); // Removed ephemeral
            return; // Stop if the date is invalid
        }


        // Check if this date has already been logged
        const isUpdatingExistingLog = data.logs[userId] && data.logs[userId][dateKey] !== undefined;


        // Store the logged data for the specific user and date
        const loggedData = {
            wakingTime: parsedWakingTime, // Store the Date object OR the string 'Not Slept'
            wokeUpEarlyStatus, // Store calculated boolean (false if 'Not Slept')
            chantingRounds,
            mangalaAarti,
            morningProgram,
            studyHours,
            readingDetails,
            listeningHours,
            additionalService,
            sleepingTime: parsedSleepingTime, // Store the Date object OR the string 'Not Slept'
            sleptEarlyStatus, // Store calculated boolean (false if 'Not Slept')
            // Store regulative principle values
            noMeatEating,
            noGambling,
            noIllicitSex,
            noIntoxication,
            timestamp: new Date().toISOString(), // Store when it was logged
        };

        // Calculate score for this log entry
        const score = calculateScore(loggedData);
        loggedData.score = score; // Add score to the logged data

        data.logs[userId][dateKey] = loggedData; // Store the data with the score

        await saveData(data); // Save the updated data

        // --- Create a response message ---
        let responseMessage = isUpdatingExistingLog ?
            `**Updated Daily Practice Log for ${interaction.user.username} on ${dateKey}:**\n` :
            `**Daily Practice Logged for ${interaction.user.username} on ${dateKey}:**\n`;

        // Display Waking Time - show 'Not Slept' if it's the string, otherwise format the Date
        responseMessage += `Waking Time: ${parsedWakingTime === 'Not Slept' ? 'Not Slept' : (parsedWakingTime ? formatInTimeZone(parsedWakingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Woke Early < 5 AM IST: ${wokeUpEarlyStatus ? 'Yes' : 'No'})\n`; // Include calculated early waking status
        responseMessage += `Chanting Rounds: ${chantingRounds}\n`;
        responseMessage += `Mangala Aarti: ${mangalaAarti ? 'Yes' : 'No'}\n`;
        responseMessage += `Morning Program: ${morningProgram ? 'Yes' : 'No'}\n`;
        responseMessage += `Study Hours: ${studyHours}\n`;
        responseMessage += `Reading: ${readingDetails || 'Not logged'}\n`; // Display reading details, show 'Not logged' if empty
        responseMessage += `Listening Hours: ${listeningHours}\n`;
        // Display Sleeping Time - show 'Not Slept' if it's the string, otherwise format the Date
        responseMessage += `Sleeping Time: ${parsedSleepingTime === 'Not Slept' ? 'Not Slept' : (parsedSleepingTime ? formatInTimeZone(parsedSleepingTime, IST_TIMEZONE, 'h:mm a') : 'Invalid Time')} (Slept Early < 11 PM IST Previous Night: ${sleptEarlyStatus ? 'Yes' : 'No'})\n`; // Include calculated early sleeping status
         if (additionalService) {
            responseMessage += `Additional Service: ${additionalService}\n`;
        }
        responseMessage += `Regulative Principles Followed: Meat: ${noMeatEating ? 'Yes' : 'No'}, Gambling: ${noGambling ? 'Yes' : 'No'}, Illicit Sex: ${noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${noIntoxication ? 'Yes' : 'No'}\n`; // Display regulative principles
        responseMessage += `**Score for this log: ${score}**\n`; // Display the score for the day
        // Display the current streak count from the potentially updated data
        responseMessage += `**Current Chanting Streak: ${data.streaks[userId].streakCount} day(s)!** 🙏\n`;


        // --- Add Encouragement Messages ---
        let encouragementMessages = [];
        // Only show waking early encouragement if wakingTime was not 'Not Slept'
        if (parsedWakingTime !== 'Not Slept' && !wokeUpEarlyStatus) {
            encouragementMessages.push("Aim to wake up before 5 AM for maximum spiritual benefit!");
        } else if (parsedWakingTime === 'Not Slept') {
             encouragementMessages.push("Taking rest is important. Hope you can establish a regular waking time soon.");
        }

        // Only show sleeping early encouragement if sleepingTime was not 'Not Slept' and status is false
        if (parsedSleepingTime !== 'Not Slept' && !sleptEarlyStatus) {
            encouragementMessages.push("Try to get to bed before 11 PM for restful sleep.");
        } else if (parsedSleepingTime === 'Not Slept') {
            encouragementMessages.push("Taking rest is important. Hope you can establish a regular sleeping time soon.");
        }

        if (!readingDetails || readingDetails.trim() === '') {
             encouragementMessages.push("Reading is essential! Pick up a spiritual book today.");
        }
        if ((listeningHours || 0) < 0.1) { // Check if listening hours are very low or zero
             encouragementMessages.push("Listening to lectures and kirtans nourishes the soul. Find some time to listen!");
        }
         if ((chantingRounds || 0) < 16) {
             encouragementMessages.push(`Great effort on ${chantingRounds} rounds! Keep pushing towards 16!`);
        } else if ((chantingRounds || 0) >= 16) {
             encouragementMessages.push(`Fantastic job on chanting ${chantingRounds} rounds! Keep it up!`);
        }
        if (!noMeatEating || !noGambling || !noIllicitSex || !noIntoxication) {
             const brokenPrinciples = [];
             if (!noMeatEating) brokenPrinciples.push('Meat Eating');
             if (!noGambling) brokenPrinciples.push('Gambling');
             if (!noIllicitSex) brokenPrinciples.push('Illicit Sex');
             if (!noIntoxication) brokenPrinciples.push('Intoxication');
             encouragementMessages.push(`Remember the importance of following the 4 regulative principles. You logged not following: ${brokenPrinciples.join(', ')}.`);
        }


        if (encouragementMessages.length > 0) {
             responseMessage += "\n**Encouragement:**\n" + encouragementMessages.map(msg => `- ${msg}`).join('\n');
        }


        // --- Respond to the user's command ---
        // Use editReply since we deferred earlier (non-ephemeral now)
        await interaction.editReply({ content: responseMessage });

    }
    // Handle the /weeklysummary command
    else if (commandName === 'weeklysummary') {
        // Defer ephemeral reply
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const data = await loadData();
        const userId = interaction.user.id;
        const userData = data.logs[userId] || {}; // Access logs data

        // --- Weekly Summary Logic ---
        // Use date-fns for reliable date calculations
        const now = new Date(); // Current local time
        const todayKey = format(now, 'yyyy-MM-dd'); // Today's date key
        const sevenDaysAgoDate = addDays(now, -6); // Go back 6 days to include today (total 7 days)
        const sevenDaysAgoKey = format(sevenDaysAgoDate, 'yyyy-MM-dd'); // Key for 7 days ago


        let totalRounds = 0;
        let totalStudyHours = 0;
        let totalListeningHours = 0;
        let mangalaAartiCount = 0;
        let morningProgramCount = 0;
        let totalScore = 0; // New total score
        let loggedDaysCount = 0;
        const booksReadThisWeek = new Set();
         let earlyWakingCount = 0; // Count of days woke up early
         let earlySleepingCount = 0; // Count of days slept early
         let principlesFollowedCount = 0; // Count of principles followed across logged days


        // Iterate through logged practices for the user
        for (const dateKey in userData) {
            // Check if the log dateKey is within the last 7 days (inclusive)
            if (dateKey >= sevenDaysAgoKey && dateKey <= todayKey) {
                 const log = userData[dateKey];
                 totalRounds += log.chantingRounds || 0;
                 totalStudyHours += log.studyHours || 0;
                 totalListeningHours += log.listeningHours || 0;
                 if (log.mangalaAarti === true) mangalaAartiCount++;
                 if (log.morningProgram === true) morningProgramCount++;
                 totalScore += log.score || 0; // Sum the scores
                 loggedDaysCount++;
                 if (log.readingDetails && log.readingDetails.trim() !== '') {
                     booksReadThisWeek.add(log.readingDetails);
                 }
                 // Only count early waking if it wasn't "Not Slept" and status is true
                 if (log.wakingTime !== 'Not Slept' && log.wokeUpEarlyStatus === true) earlyWakingCount++; // Count early waking
                 // Only count early sleeping if it wasn't "Not Slept" and status is true
                 if (log.sleepingTime !== 'Not Slept' && log.sleptEarlyStatus === true) earlySleepingCount++; // Count early sleeping
                 // Count each principle followed for that day
                 if (log.noMeatEating === true) principlesFollowedCount++;
                 if (log.noGambling === true) principlesFollowedCount++;
                 if (log.noIllicitSex === true) principlesFollowedCount++;
                 if (log.noIntoxication === true) principlesFollowedCount++;
            }
        }

        // Calculate averages based on the number of days logs were found for in the period
        const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
        const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
        const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
        const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0; // Average score
        // Average number of principles followed *per logged day* (max 4)
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / (loggedDaysCount * 4)).toFixed(2) : 0; // Divide by loggedDaysCount * 4 for avg per day out of 4


        let summaryMessage = `**Weekly Practice Summary for ${interaction.user.username}:**\n`;
        summaryMessage += `(Summary from ${sevenDaysAgoKey} to ${todayKey}, based on ${loggedDaysCount} logged day(s))\n`;
        summaryMessage += `Total Score: ${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})\n`; // Display total and avg score
        summaryMessage += `Total Rounds Chanted: ${totalRounds} (Avg per logged day: ${avgRounds})\n`;
        summaryMessage += `Total Study Hours: ${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})\n`;
        summaryMessage += `Total Listening Hours: ${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})\n`;
        summaryMessage += `Mangala Aarti Attended: ${mangalaAartiCount} time(s)\n`;
        summaryMessage += `Morning Program Attended: ${morningProgramCount} time(s)\n`;
        summaryMessage += `Woke up early (< 5 AM IST): ${earlyWakingCount} time(s)\n`; // Display early waking count
        summaryMessage += `Slept early (< 11 PM IST Previous Night): ${earlySleepingCount} time(s)\n`; // Display early sleeping count
         summaryMessage += `Avg. Regulative Principles Followed per Day: ${avgPrinciples} / 1\n`; // Display principles count (out of 1 point per principle)
        summaryMessage += `Reading Logged: ${booksReadThisWeek.size > 0 ? Array.from(booksReadThisWeek).join('; ') : 'None'}\n`;


        // Use editReply since we deferred earlier (ephemeral)
        await interaction.editReply({ content: summaryMessage, flags: [MessageFlags.Ephemeral] });

    }
     // Handle the /monthlysummary command
     else if (commandName === 'monthlysummary') {
        // Defer ephemeral reply
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const data = await loadData();
        const userId = interaction.user.id;
        const userData = data.logs[userId] || {}; // Access logs data

        // --- Monthly Summary Logic ---
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-indexed month

        const startDate = new Date(year, month, 1); // First day of current month
        const startKey = format(startDate, 'yyyy-MM-dd');
        const endKey = format(now, 'yyyy-MM-dd'); // Today's date key
        const periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

        let totalRounds = 0;
        let totalStudyHours = 0;
        let totalListeningHours = 0;
        let mangalaAartiCount = 0;
        let morningProgramCount = 0;
        let totalScore = 0;
        let loggedDaysCount = 0;
        const booksReadThisMonth = new Set();
        let earlyWakingCount = 0;
        let earlySleepingCount = 0;
        let principlesFollowedCount = 0;


        // Iterate through logged practices for the user
        for (const dateKey in userData) {
            // Check if the log dateKey is within the current month (inclusive)
            if (dateKey >= startKey && dateKey <= endKey) {
                 const log = userData[dateKey];
                 totalRounds += log.chantingRounds || 0;
                 totalStudyHours += log.studyHours || 0;
                 totalListeningHours += log.listeningHours || 0;
                 if (log.mangalaAarti === true) mangalaAartiCount++;
                 if (log.morningProgram === true) morningProgramCount++;
                 totalScore += log.score || 0;
                 loggedDaysCount++;
                 if (log.readingDetails && log.readingDetails.trim() !== '') {
                     booksReadThisMonth.add(log.readingDetails);
                 }
                 // Only count early waking if it wasn't "Not Slept" and status is true
                 if (log.wakingTime !== 'Not Slept' && log.wokeUpEarlyStatus === true) earlyWakingCount++;
                 // Only count early sleeping if it wasn't "Not Slept" and status is true
                 if (log.sleepingTime !== 'Not Slept' && log.sleptEarlyStatus === true) earlySleepingCount++;
                 // Count each principle followed for that day
                 if (log.noMeatEating === true) principlesFollowedCount++;
                 if (log.noGambling === true) principlesFollowedCount++;
                 if (log.noIllicitSex === true) principlesFollowedCount++;
                 if (log.noIntoxication === true) principlesFollowedCount++;
            }
        }

        // Calculate averages
        const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
        const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
        const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
        const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0;
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / (loggedDaysCount * 4)).toFixed(2) : 0;


        let summaryMessage = `**Monthly Practice Summary for ${interaction.user.username} (${periodName}):**\n`;
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


        // Use editReply since we deferred earlier (ephemeral)
        await interaction.editReply({ content: summaryMessage, flags: [MessageFlags.Ephemeral] });
     }
     // Handle the /leaderboard command
    else if (commandName === 'leaderboard') {
        // Defer reply because fetching usernames can take time
        // Make it non-ephemeral by default
        await interaction.deferReply();

        const period = interaction.options.getString('period'); // 'weekly' or 'monthly'
        const data = await loadData();
        const now = new Date();

        let startKey;
        let endKey;
        let periodName;

        if (period === 'weekly') {
            endKey = format(now, 'yyyy-MM-dd'); // Today
            const startDate = addDays(now, -6); // 6 days ago to include today (total 7 days)
            startKey = format(startDate, 'yyyy-MM-dd');
            periodName = 'Last 7 Days';
        } else if (period === 'monthly') {
            const year = now.getFullYear();
            const month = now.getMonth();
            const startDate = new Date(year, month, 1); // First day of current month
            startKey = format(startDate, 'yyyy-MM-dd');
            endKey = format(now, 'yyyy-MM-dd'); // Today
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
            // Edit the deferred reply
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".' }); // Removed ephemeral
            return;
        }

        const userScores = [];

        // Calculate total score for each user within the period
        for (const userId in data.logs) { // Iterate through logs data
            const userData = data.logs[userId];
            let totalScore = 0;
            let loggedDaysCount = 0;

            for (const dateKey in userData) {
                 // Check if the log dateKey is within the selected period
                 if (dateKey >= startKey && dateKey <= endKey) {
                     totalScore += userData[dateKey].score || 0;
                     loggedDaysCount++;
                 }
            }

             // Only include users who logged at least one day in the period
            if (loggedDaysCount > 0) {
                 userScores.push({ userId, totalScore, loggedDaysCount });
            }
        }

        // Sort users by total score in descending order
        userScores.sort((a, b) => b.totalScore - a.totalScore);

        // Get the top 10 users (or fewer if less than 10 logged)
        const topUsers = userScores.slice(0, 10);

        let leaderboardMessage = `**Spiritual Practice Leaderboard (${periodName}):**\n\n`;

        if (topUsers.length === 0) {
            leaderboardMessage += "No practice logs found for this period.";
        } else {
            for (let i = 0; i < topUsers.length; i++) {
                const userScore = topUsers[i];
                // Fetch username - this is an async operation
                let username = 'Unknown User';
                 try {
                     // Use interaction.guild.members.fetch for guild-specific member data if available
                     if (interaction.guild) {
                        const member = await interaction.guild.members.fetch(userScore.userId);
                        username = member.user.username; // Get username from the User object within the Member
                     } else {
                         // Fallback to fetching user globally if not in a guild context
                         const user = await client.users.fetch(userScore.userId);
                         username = user.username;
                     }
                 } catch (err) {
                     console.warn(`Could not fetch user/member ${userScore.userId}:`, err.message);
                     // Attempt global fetch as a fallback even if guild fetch failed
                     try {
                          const user = await client.users.fetch(userScore.userId);
                          username = user.username;
                     } catch (userErr) {
                           console.error(`Could not fetch user ${userScore.userId} globally:`, userErr);
                          // Keep 'Unknown User' if both fetches fail
                     }
                 }

                leaderboardMessage += `${i + 1}. **${username}**: ${userScore.totalScore.toFixed(2)} points (${userScore.loggedDaysCount} day(s) logged)\n`;
            }
        }

        // Edit the deferred reply (non-ephemeral)
        await interaction.editReply({ content: leaderboardMessage });
    }
    // Handle the /myscore command (shows invoking user's score for a period)
    else if (commandName === 'myscore') {
        // Defer ephemeral reply
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const period = interaction.options.getString('period'); // 'weekly' or 'monthly'
        const userId = interaction.user.id; // Get the invoking user's ID
        const username = interaction.user.username; // Get the invoking user's username

        const data = await loadData();
        const userData = data.logs[userId] || {}; // Access logs data for the invoking user

        // --- Calculate Score for the selected period ---
        const now = new Date();
        let startKey;
        let endKey;
        let periodName;
        let totalScore = 0;
        let loggedDaysCount = 0;

        if (period === 'weekly') {
            endKey = format(now, 'yyyy-MM-dd'); // Today
            const startDate = addDays(now, -6); // 6 days ago
            startKey = format(startDate, 'yyyy-MM-dd');
            periodName = 'Last 7 Days';
        } else if (period === 'monthly') {
            const year = now.getFullYear();
            const month = now.getMonth();
            const startDate = new Date(year, month, 1); // First day of current month
            startKey = format(startDate, 'yyyy-MM-dd');
            endKey = format(now, 'yyyy-MM-dd'); // Today
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".', flags: [MessageFlags.Ephemeral] });
            return;
        }

        // Iterate through logged practices for the user within the period
        for (const dateKey in userData) {
            if (dateKey >= startKey && dateKey <= endKey) {
                const log = userData[dateKey];
                totalScore += log.score || 0;
                loggedDaysCount++;
            }
        }


        // --- Create response message ---
        let responseMessage = `**Your Personal Practice Score (${periodName}):**\n\n`;
        responseMessage += `Total Score: ${totalScore.toFixed(2)} points (${loggedDaysCount} logged day(s))\n`;


        // Use editReply since we deferred earlier (ephemeral)
        await interaction.editReply({ content: responseMessage, flags: [MessageFlags.Ephemeral] });

    }
    // Handle the /showscore command (shows another user's score and streak)
    else if (commandName === 'showscore') { // Changed commandName check
         // Defer non-ephemeral reply
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user'); // Get the target user
        const userId = targetUser.id; // Use target user's ID
        const username = targetUser.username; // Use target user's username

        const data = await loadData();
        const userData = data.logs[userId] || {}; // Access logs data for target user
        const userStreakData = data.streaks[userId] || { streakCount: 0, lastLoggedDateKey: null }; // Access streak data for target user

        // Get the current streak count for the target user
        const currentStreak = userStreakData.streakCount || 0;


        // --- Calculate Scores for different periods ---
        const now = new Date();

        // Weekly Score (last 7 days)
        const weeklyEndKey = format(now, 'yyyy-MM-dd');
        const weeklyStartDate = addDays(now, -6);
        const weeklyStartKey = format(weeklyStartDate, 'yyyy-MM-dd');
        let weeklyScore = 0;
        let weeklyLoggedDays = 0;

        // Monthly Score (current month)
        const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthStartKey = format(monthStartDate, 'yyyy-MM-dd');
        const monthlyEndKey = format(now, 'yyyy-MM-dd');
        let monthlyScore = 0;
        let monthlyLoggedDays = 0;

        // All-Time Score
        let allTimeScore = 0;
        let allTimeLoggedDays = 0;


        // Iterate through all logged practices for the target user
        for (const dateKey in userData) {
            const log = userData[dateKey];
            const score = log.score || 0;

            // Check for Weekly
            if (dateKey >= weeklyStartKey && dateKey <= weeklyEndKey) {
                weeklyScore += score;
                weeklyLoggedDays++;
            }

            // Check for Monthly
             if (dateKey >= monthStartKey && dateKey <= monthlyEndKey) {
                 monthlyScore += score;
                 monthlyLoggedDays++;
            }

            // Add to All-Time
            allTimeScore += score;
            allTimeLoggedDays++;
        }

        // --- Create response message ---
        // Updated message to show scores for the target user
        let responseMessage = `**Practice Scores for ${username}:**\n\n`;
        responseMessage += `**Current Chanting Streak:** ${currentStreak} day(s) 🙏\n\n`; // Added streak here!
        responseMessage += `**Weekly (Last 7 Days - ${weeklyLoggedDays} logged):** ${weeklyScore.toFixed(2)} points\n`;
        responseMessage += `**Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })} - ${monthlyLoggedDays} logged):** ${monthlyScore.toFixed(2)} points\n`;
        responseMessage += `**All-Time (${allTimeLoggedDays} logged):** ${allTimeScore.toFixed(2)} points\n`;


        // Use editReply since we deferred earlier (non-ephemeral)
        await interaction.editReply({ content: responseMessage });

    }
     // Handle the /streakset command (Admin only)
    else if (commandName === 'streakset') {
        // Check for Administrator permission
        if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
             await interaction.reply({ content: 'You do not have permission to use this command.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const targetUser = interaction.options.getUser('user'); // Get the target user object
        const newStreak = interaction.options.getInteger('streak'); // Get the new streak number

        if (newStreak < 0) {
             await interaction.reply({ content: 'Streak value cannot be negative.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const data = await loadData();
        const targetUserId = targetUser.id;

         if (!data.streaks[targetUserId]) {
             data.streaks[targetUserId] = { streakCount: 0, lastLoggedDateKey: null };
         }

        // Update the streak count
        data.streaks[targetUserId].streakCount = newStreak;

        // When manually setting a streak, set the last logged date to yesterday
        // relative to *today* to allow the streak to continue tomorrow.
        try {
            const now = new Date();
            const yesterday = addDays(now, -1); // Get yesterday using date-fns
            const yesterdayKey = format(yesterday, 'yyyy-MM-dd'); // Format correctly

            data.streaks[targetUserId].lastLoggedDateKey = yesterdayKey;

        } catch (error) {
             console.error('Error during date calculation for streakset:', error);
             await interaction.reply({ content: 'An internal error occurred while setting the streak date. Please contact bot administrator.', flags: [MessageFlags.Ephemeral] });
             return; // Stop execution if date calculation fails
        }

        await saveData(data);

        await interaction.reply({ content: `Successfully set ${targetUser.username}'s chanting streak to ${newStreak}. Their last logged date is set for streak calculation.`, flags: [MessageFlags.Ephemeral] });
    }
    // Handle the /help command
    else if (commandName === 'help') {
        const youtubeLink = 'YOUR_YOUTUBE_VIDEO_LINK_HERE'; // Replace with your actual YouTube link
        const responseMessage = `Here is a helpful video: ${youtubeLink}`;

        // Reply publicly in the channel
        await interaction.reply({ content: responseMessage });
    }
});

// Log in to Discord using the bot token from the .env file.
// This line initiates the connection to Discord. It should typically be at the end of your setup code.
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
