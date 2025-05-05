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
const { parse, differenceInCalendarDays, addDays, format } = require('date-fns');
// For timezone handling - Needed for accurate IST time comparisons
// Using direct destructuring for importing timezone functions
const { utcToZonedTime, zonedTimeToUtc } = require('date-fns-tz');


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
    if (log.wokeUpEarlyStatus === true) {
        score += 1;
    }

    // Sleeping Early (before 11 PM IST): 1 point if sleptEarlyStatus is true
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
function parseTimeInIST(dateKey, timeString) {
    try {
        // Combine date (YYYY-MM-DD) and time string
        const dateTimeString = `${dateKey} ${timeString}`;
        // Use date-fns parse with a format string and the dateKey as the reference date
        // This helps parse times around midnight correctly relative to the date.
        const parsedDate = parse(dateTimeString, 'yyyy-MM-dd h:mm a', new Date(dateKey));

         // Check if parsing was successful and resulted in a valid date
        if (isNaN(parsedDate.getTime())) {
             console.error(`Parsed date is invalid for string: "${dateTimeString}"`);
             return null;
        }

        // The parse function in date-fns by default creates a Date object in the system's local timezone.
        // To ensure consistency and work with IST correctly, we should convert this local time Date object to UTC,
        // and then to the target timezone (IST).

        // Get the local timezone name
        const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Convert the parsed local date/time to UTC using the imported function
        const utcDate = zonedTimeToUtc(parsedDate, localTimeZone);

        // Convert UTC date to IST using the imported function
        const zonedDate = utcToZonedTime(utcDate, IST_TIMEZONE);

        return zonedDate;

    } catch (error) {
        console.error(`Error parsing time string "${timeString}" for date "${dateKey}":`, error);
        return null; // Return null if parsing fails
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
                description: 'Your waking time (e.g., 4:30 AM). Use HH:MM AM/PM format.',
                required: true,
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
                description: 'Your sleeping time (e.g., 10:30 PM). Use HH:MM AM/PM format.', // Updated description
                required: true,
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
        // Get the values provided by the user for each option of the command.
        const day = interaction.options.getInteger('day');
        const month = interaction.options.getInteger('month');
        const year = interaction.options.getInteger('year');
        const wakingTime = interaction.options.getString('waking_time');
        const chantingRounds = interaction.options.getInteger('chanting_rounds');
        const mangalaAarti = interaction.options.getBoolean('mangala_aarti');
        const morningProgram = interaction.options.getBoolean('morning_program');
        const studyHours = interaction.options.getNumber('study_hours');
        const readingDetails = interaction.options.getString('reading_details'); // Get reading details (string)
        const listeningHours = interaction.options.getNumber('listening_hours'); // Get listening hours (number)
        const sleepingTime = interaction.options.getString('sleeping_time');
        // Get regulative principle values
        const noMeatEating = interaction.options.getBoolean('no_meat_eating');
        const noGambling = interaction.options.getBoolean('no_gambling');
        const noIllicitSex = interaction.options.getBoolean('no_illicit_sex');
        const noIntoxication = interaction.options.getBoolean('no_intoxication');
        const additionalService = interaction.options.getString('additional_service'); // Will be null if not provided


        // --- Date and Time Parsing/Calculation ---
        const dateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        // Create a Date object for the logged date (start of the day in IST)
        const loggedDate = parseTimeInIST(dateKey, '12:00 AM'); // Use midnight as reference for the start of the logged day

        // Check if the provided date is valid before proceeding
        if (!loggedDate) {
             await interaction.reply({ content: 'Invalid date provided. Please use valid Day, Month, and Year.', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }


        // Parse waking time for the logged date in IST
        const parsedWakingTime = parseTimeInIST(dateKey, wakingTime);

        // Parse sleeping time. It's for the *previous* day relative to the log date.
        const previousDay = new Date(year, month - 1, day); // Create date object for the log date
        previousDay.setDate(previousDay.getDate() - 1); // Go back one day
        const previousDateKey = `${previousDay.getFullYear()}-${(previousDay.getMonth() + 1).toString().padStart(2, '0')}-${previousDay.getDate().toString().padStart(2, '0')}`;

        const parsedSleepingTime = parseTimeInIST(previousDateKey, sleepingTime);

        // Add validation for time parsing
        if (!parsedWakingTime || !parsedSleepingTime) {
             await interaction.reply({ content: 'Invalid time format provided. Please use HH:MM AM/PM format (e.g., 4:30 AM, 10:00 PM).', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }


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

        // Only update streak if logging for a date that hasn't been logged yet,
        // or if logging for a date *later* than the last logged date.
        const lastLoggedDate = lastLoggedDateKey ? parseTimeInIST(lastLoggedDateKey, '12:00 AM') : null;

        if (loggedDate && lastLoggedDate) { // If both dates are valid and a previous log exists
             const dayDifference = differenceInCalendarDays(loggedDate, lastLoggedDate);

             if (dayDifference === 1) {
                 // Logged date is exactly one calendar day after the last logged date
                 newStreak = currentStreak + 1;
             } else if (dayDifference > 1) {
                 // Logged date is more than one calendar day after the last logged date
                 newStreak = 1; // Reset streak to 1
             }
             // If dayDifference is 0 (same day) or negative (logging a past date already logged),
             // the streak doesn't change based on this log.
        } else if (loggedDate && !lastLoggedDateKey) {
             // First log entry for this user
             newStreak = 1;
        }
        // If loggedDate is null (parsing failed), the streak is not updated.

        // Update streak data ONLY if the current logged date is LATER than the last logged date
        // This handles logging past dates without incorrectly affecting the streak
        // If logging for a date that's already logged, we don't update the streak state.
        if (!lastLoggedDateKey || (loggedDate && lastLoggedDate && loggedDate > lastLoggedDate)) {
             data.streaks[userId].streakCount = newStreak;
             data.streaks[userId].lastLoggedDateKey = dateKey;
        } else {
             // If logging for the same day or a past day already logged, keep the existing streak state.
             // Ensure the response message shows the correct current streak for context.
             newStreak = currentStreak; // Revert newStreak to currentStreak for the response message
        }


        // Check if this date has already been logged
        const isUpdatingExistingLog = data.logs[userId] && data.logs[userId][dateKey] !== undefined;


        // Store the logged data for the specific user and date
        const loggedData = {
            wakingTime,
            wokeUpEarlyStatus, // Store calculated boolean
            chantingRounds,
            mangalaAarti,
            morningProgram,
            studyHours,
            readingDetails,
            listeningHours,
            additionalService,
            sleepingTime,
            sleptEarlyStatus, // Store calculated boolean
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

        responseMessage += `Waking Time: ${wakingTime} (Woke Early: ${wokeUpEarlyStatus ? 'Yes' : 'No'})\n`; // Include calculated early waking status
        responseMessage += `Chanting Rounds: ${chantingRounds}\n`;
        responseMessage += `Mangala Aarti: ${mangalaAarti ? 'Yes' : 'No'}\n`;
        responseMessage += `Morning Program: ${morningProgram ? 'Yes' : 'No'}\n`;
        responseMessage += `Study Hours: ${studyHours}\n`;
        responseMessage += `Reading: ${readingDetails || 'Not logged'}\n`; // Display reading details, show 'Not logged' if empty
        responseMessage += `Listening Hours: ${listeningHours}\n`;
        responseMessage += `Sleeping Time: ${sleepingTime} (Slept Early: ${sleptEarlyStatus ? 'Yes' : 'No'})\n`; // Include calculated early sleeping status
         if (additionalService) {
            responseMessage += `Additional Service: ${additionalService}\n`;
        }
        responseMessage += `Regulative Principles Followed: Meat: ${noMeatEating ? 'Yes' : 'No'}, Gambling: ${noGambling ? 'Yes' : 'No'}, Illicit Sex: ${noIllicitSex ? 'Yes' : 'No'}, Intoxication: ${noIntoxication ? 'Yes' : 'No'}\n`; // Display regulative principles
        responseMessage += `**Score for this log: ${score}**\n`; // Display the score for the day
        // Only show streak message if it's a new log or updating the most recent day's log
        if (!isUpdatingExistingLog || (lastLoggedDateKey === dateKey)) {
             responseMessage += `**Chanting Streak: ${data.streaks[userId].streakCount} day(s)!** 🙏\n`; // Display the current streak from data
        }


        // --- Add Encouragement Messages ---
        let encouragementMessages = [];
        if (!wokeUpEarlyStatus) {
            encouragementMessages.push("Aim to wake up before 5 AM for maximum spiritual benefit!");
        }
        if (!sleptEarlyStatus) {
            encouragementMessages.push("Try to get to bed before 11 PM for restful sleep.");
        }
        if (!readingDetails || readingDetails.trim() === '') {
             encouragementMessages.push("Reading is essential! Pick up a spiritual book today.");
        }
        if ((listeningHours || 0) < 0.1) { // Check if listening hours are very low or zero
             encouragementMessages.push("Listening to lectures and kirtans nourishes the soul. Find some time to listen!");
        }
         if ((chantingRounds || 0) < 16) {
             encouragementMessages.push(`Great job on ${chantingRounds} rounds!`);
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
        // Response is visible to everyone in the channel.
        await interaction.reply({ content: responseMessage });

    }
    // Handle the /weeklysummary command
    else if (commandName === 'weeklysummary') {
        const data = await loadData();
        const userId = interaction.user.id;
        const userData = data.logs[userId] || {}; // Access logs data

        // --- Weekly Summary Logic ---
        const now = new Date();
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0); // Start of the day 7 days ago
        now.setHours(23, 59, 59, 999); // End of today


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
             const [year, month, day] = dateKey.split('-').map(Number);
            const logDate = new Date(year, month - 1, day); // month - 1 because Date month is 0-indexed

            // Check if the log date is within the last 7 days (inclusive)
            if (logDate >= sevenDaysAgo && logDate <= now) {
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
                 if (log.wokeUpEarlyStatus === true) earlyWakingCount++; // Count early waking
                 if (log.sleptEarlyStatus === true) earlySleepingCount++; // Count early sleeping
                 if (log.noMeatEating === true) principlesFollowedCount++; // Count principles followed
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
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / loggedDaysCount).toFixed(2) : 0; // Average principles followed per day


        let summaryMessage = `**Weekly Practice Summary for ${interaction.user.username}:**\n`;
        summaryMessage += `(Summary based on ${loggedDaysCount} logged day(s) in the last 7 days)\n`;
        summaryMessage += `Total Score: ${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})\n`; // Display total and avg score
        summaryMessage += `Total Rounds Chanted: ${totalRounds} (Avg per logged day: ${avgRounds})\n`;
        summaryMessage += `Total Study Hours: ${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})\n`;
        summaryMessage += `Total Listening Hours: ${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})\n`;
        summaryMessage += `Mangala Aarti Attended: ${mangalaAartiCount} time(s)\n`;
        summaryMessage += `Morning Program Attended: ${morningProgramCount} time(s)\n`;
        summaryMessage += `Woke up early (< 5 AM IST): ${earlyWakingCount} time(s)\n`; // Display early waking count
        summaryMessage += `Slept early (< 11 PM IST): ${earlySleepingCount} time(s)\n`; // Display early sleeping count
         summaryMessage += `Principles Followed: ${principlesFollowedCount} total (Avg per logged day: ${avgPrinciples})\n`; // Display principles count
        summaryMessage += `Reading Logged: ${booksReadThisWeek.size > 0 ? Array.from(booksReadThisWeek).join(', ') : 'None'}\n`;


        await interaction.reply({ content: summaryMessage, ephemeral: true, flags: MessageFlags.Ephemeral }); // Keep summary ephemeral

    }
    // Handle the /monthlysummary command
    else if (commandName === 'monthlysummary') {
         const data = await loadData();
        const userId = interaction.user.id;
        const userData = data.logs[userId] || {}; // Access logs data

        // --- Monthly Summary Logic ---
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // getMonth() is 0-indexed (0 for January)

        let totalRounds = 0;
        let totalStudyHours = 0;
        let totalListeningHours = 0;
        let mangalaAartiCount = 0;
        let morningProgramCount = 0;
        let totalScore = 0; // New total score
        let loggedDaysCount = 0;
        const booksReadThisMonth = new Set();
        let earlyWakingCount = 0; // Count of days woke up early
        let earlySleepingCount = 0; // Count of days slept early
        let principlesFollowedCount = 0; // Count of principles followed across logged days


         // Iterate through logged practices for the user
        for (const dateKey in userData) {
            const [year, month, day] = dateKey.split('-').map(Number);
            // Parse the dateKey (YYYY-MM-DD) into a Date object for comparison
            // Note: month - 1 because Date month is 0-indexed (0 for January)
            const logDate = new Date(year, month - 1, day);

            // Check if the log is in the current month and year
            if (logDate.getFullYear() === currentYear && logDate.getMonth() === currentMonth) {
                 const log = userData[dateKey];
                 totalRounds += log.chantingRounds || 0;
                 totalStudyHours += log.studyHours || 0;
                 totalListeningHours += log.listeningHours || 0;
                 if (log.mangalaAarti === true) mangalaAartiCount++;
                 if (log.morningProgram === true) morningProgramCount++;
                 totalScore += log.score || 0; // Sum the scores
                 loggedDaysCount++;
                  if (log.readingDetails && log.readingDetails.trim() !== '') {
                     booksReadThisMonth.add(log.readingDetails);
                 }
                 if (log.wokeUpEarlyStatus === true) earlyWakingCount++; // Count early waking
                 if (log.sleptEarlyStatus === true) earlySleepingCount++; // Count early sleeping
                 if (log.noMeatEating === true) principlesFollowedCount++; // Count principles followed
                 if (log.noGambling === true) principlesFollowedCount++;
                 if (log.noIllicitSex === true) principlesFollowedCount++;
                 if (log.noIntoxication === true) principlesFollowedCount++;
            }
        }

        // Calculate averages based on the number of days logs were found for in the month
        const avgRounds = loggedDaysCount > 0 ? (totalRounds / loggedDaysCount).toFixed(2) : 0;
        const avgStudyHours = loggedDaysCount > 0 ? (totalStudyHours / loggedDaysCount).toFixed(2) : 0;
        const avgListeningHours = loggedDaysCount > 0 ? (totalListeningHours / loggedDaysCount).toFixed(2) : 0;
        const avgScore = loggedDaysCount > 0 ? (totalScore / loggedDaysCount).toFixed(2) : 0; // Average score
        const avgPrinciples = loggedDaysCount > 0 ? (principlesFollowedCount / loggedDaysCount).toFixed(2) : 0; // Average principles followed per day


        const monthName = now.toLocaleString('default', { month: 'long' });

        let summaryMessage = `**Monthly Practice Summary for ${interaction.user.username} (${monthName} ${currentYear}):**\n`;
        summaryMessage += `(Summary based on ${loggedDaysCount} logged day(s) in the month)\n`;
        summaryMessage += `Total Score: ${totalScore.toFixed(2)} (Avg per logged day: ${avgScore})\n`; // Display total and avg score
        summaryMessage += `Total Rounds Chanted: ${totalRounds} (Avg per logged day: ${avgRounds})\n`;
        summaryMessage += `Total Study Hours: ${totalStudyHours.toFixed(2)} (Avg per logged day: ${avgStudyHours})\n`;
        summaryMessage += `Total Listening Hours: ${totalListeningHours.toFixed(2)} (Avg per logged day: ${avgListeningHours})\n`;
        summaryMessage += `Mangala Aarti Attended: ${mangalaAartiCount} time(s)\n`;
        summaryMessage += `Morning Program Attended: ${morningProgramCount} time(s)\n`;
        summaryMessage += `Woke up early (< 5 AM IST): ${earlyWakingCount} time(s)\n`; // Display early waking count
        summaryMessage += `Slept early (< 11 PM IST): ${earlySleepingCount} time(s)\n`; // Display early sleeping count
         summaryMessage += `Principles Followed: ${principlesFollowedCount} total (Avg per logged day: ${avgPrinciples})\n`; // Display principles count
        summaryMessage += `Reading Logged: ${booksReadThisMonth.size > 0 ? Array.from(booksReadThisMonth).join(', ') : 'None'}\n`;


        await interaction.reply({ content: summaryMessage, ephemeral: true, flags: MessageFlags.Ephemeral }); // Keep summary ephemeral

    }
     // Handle the /leaderboard command
    else if (commandName === 'leaderboard') {
        await interaction.deferReply({ ephemeral: true, flags: MessageFlags.Ephemeral }); // Defer reply because fetching usernames can take time

        const period = interaction.options.getString('period'); // 'weekly' or 'monthly'
        const data = await loadData();
        const now = new Date();

        let startDate;
        let periodName;

        if (period === 'weekly') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
             startDate.setHours(0, 0, 0, 0); // Start of the day 7 days ago
             now.setHours(23, 59, 59, 999); // End of today
            periodName = 'Last 7 Days';
        } else if (period === 'monthly') {
             startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of the current month
             now.setHours(23, 59, 59, 999); // End of today
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        } else {
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }

        const userScores = [];

        // Calculate total score for each user within the period
        for (const userId in data.logs) { // Iterate through logs data
            const userData = data.logs[userId];
            let totalScore = 0;
            let loggedDaysCount = 0;

            for (const dateKey in userData) {
                 const [year, month, day] = dateKey.split('-').map(Number);
                 const logDate = new Date(year, month - 1, day); // month - 1 because Date month is 0-indexed

                 // Check if the log date is within the selected period
                 if (logDate >= startDate && logDate <= now) {
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

        // Get the top 5 users
        const topUsers = userScores.slice(0, 5);

        let leaderboardMessage = `**Spiritual Practice Leaderboard (${periodName}):**\n\n`;

        if (topUsers.length === 0) {
            leaderboardMessage += "No practice logs found for this period.";
        } else {
            for (let i = 0; i < topUsers.length; i++) {
                const userScore = topUsers[i];
                // Fetch username - this is an async operation
                let username = 'Unknown User';
                 try {
                     // Use interaction.guild.members.fetch for guild-specific member data
                     const member = await interaction.guild.members.fetch(userScore.userId);
                     username = member.user.username; // Get username from the User object within the Member
                 } catch (err) {
                     console.error(`Could not fetch member ${userScore.userId} in guild ${interaction.guild.id}:`, err);
                     // Fallback to fetching user globally if member fetch fails
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

        // Edit the deferred reply
        await interaction.editReply({ content: leaderboardMessage, ephemeral: true, flags: MessageFlags.Ephemeral });
    }
    // Handle the /myscore command (shows invoking user's score for a period)
    else if (commandName === 'myscore') {
        await interaction.deferReply({ ephemeral: true, flags: MessageFlags.Ephemeral }); // Defer reply (ephemeral)

        const period = interaction.options.getString('period'); // 'weekly' or 'monthly'
        const userId = interaction.user.id; // Get the invoking user's ID
        const username = interaction.user.username; // Get the invoking user's username

        const data = await loadData();
        const userData = data.logs[userId] || {}; // Access logs data for the invoking user

        // --- Calculate Score for the selected period ---
        const now = new Date();
        let startDate;
        let periodName;
        let totalScore = 0;
        let loggedDaysCount = 0;

        if (period === 'weekly') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0, 0, 0, 0); // Start of the day 7 days ago
            const weeklyEndDate = new Date(now);
            weeklyEndDate.setHours(23, 59, 59, 999);
            periodName = 'Last 7 Days';

            // Iterate through logged practices for the user within the weekly period
            for (const dateKey in userData) {
                 const [year, month, day] = dateKey.split('-').map(Number);
                const logDate = new Date(year, month - 1, day); // month - 1 because Date month is 0-indexed

                // Check if the log date is within the weekly period
                if (logDate >= startDate && logDate <= weeklyEndDate) {
                    const log = userData[dateKey];
                    totalScore += log.score || 0;
                    loggedDaysCount++;
                }
            }

        } else if (period === 'monthly') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1); // Start of the current month
            const monthlyEndDate = new Date(now);
            monthlyEndDate.setHours(23, 59, 59, 999);
            periodName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

            // Iterate through logged practices for the user within the monthly period
            for (const dateKey in userData) {
                 const [year, month, day] = dateKey.split('-').map(Number);
                const logDate = new Date(year, month - 1, day); // month - 1 because Date month is 0-indexed

                // Check if the log is in the current month and year
                if (logDate.getFullYear() === now.getFullYear() && logDate.getMonth() === now.getMonth()) {
                    const log = userData[dateKey];
                    totalScore += log.score || 0;
                    loggedDaysCount++;
                }
            }
        } else {
             await interaction.editReply({ content: 'Invalid period specified. Choose "weekly" or "monthly".', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }


        // --- Create response message ---
        let responseMessage = `**Your Personal Practice Score (${periodName}):**\n\n`;
        responseMessage += `Total Score: ${totalScore.toFixed(2)} points (${loggedDaysCount} logged day(s))\n`;


        // Use editReply since we deferred earlier
        await interaction.editReply({ content: responseMessage, ephemeral: true, flags: MessageFlags.Ephemeral });

    }
    // Handle the /showscore command (shows another user's score and streak)
    else if (commandName === 'showscore') { // Changed commandName check
        await interaction.deferReply(); // Defer reply (not ephemeral)

        const targetUser = interaction.options.getUser('user'); // Get the target user
        const userId = targetUser.id; // Use target user's ID
        const username = targetUser.username; // Use target user's username

        const data = await loadData();
        const userData = data.logs[userId] || {}; // Access logs data for target user
        const userStreakData = data.streaks[userId] || { streakCount: 0 }; // Access streak data for target user

        // Get the current streak count for the target user
        const currentStreak = userStreakData.streakCount || 0;


        // --- Calculate Scores for different periods ---
        const now = new Date();

        // Weekly Score (last 7 days)
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const weeklyEndDate = new Date(now);
        weeklyEndDate.setHours(23, 59, 59, 999);

        let weeklyScore = 0;
        let weeklyLoggedDays = 0;

        // Monthly Score (current month)
        const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyEndDate = new Date(now);
        monthlyEndDate.setHours(23, 59, 59, 999);


        let monthlyScore = 0;
        let monthlyLoggedDays = 0;

        // All-Time Score
        let allTimeScore = 0;
        let allTimeLoggedDays = 0;


        // Iterate through all logged practices for the target user
        for (const dateKey in userData) {
            const [year, month, day] = dateKey.split('-').map(Number);
            const logDate = new Date(year, month - 1, day); // month - 1 because Date month is 0-indexed

            const log = userData[dateKey];
            const score = log.score || 0;

            // Check for Weekly
            if (logDate >= sevenDaysAgo && logDate <= weeklyEndDate) {
                weeklyScore += score;
                weeklyLoggedDays++;
            }

            // Check for Monthly
            if (logDate.getFullYear() === now.getFullYear() && logDate.getMonth() === now.getMonth()) {
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
        responseMessage += `**Weekly (Last ${weeklyLoggedDays} logged days):** ${weeklyScore.toFixed(2)} points\n`;
        responseMessage += `**Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })} - ${monthlyLoggedDays} logged days):** ${monthlyScore.toFixed(2)} points\n`;
        responseMessage += `**All-Time (${allTimeLoggedDays} logged days):** ${allTimeScore.toFixed(2)} points\n`;


        // Use editReply since we deferred earlier, and remove ephemeral flag
        await interaction.editReply({ content: responseMessage });

    }
     // Handle the /streakset command (Admin only)
    else if (commandName === 'streakset') {
        // Discord's default_member_permissions handles the primary check,
        // but a redundant check here is good practice.
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
             await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }

        const targetUser = interaction.options.getUser('user'); // Get the target user object
        const newStreak = interaction.options.getInteger('streak'); // Get the new streak number

        if (newStreak < 0) {
             await interaction.reply({ content: 'Streak value cannot be negative.', ephemeral: true, flags: MessageFlags.Ephemeral });
            return;
        }

        const data = await loadData();
        const targetUserId = targetUser.id;

         if (!data.streaks[targetUserId]) {
             data.streaks[targetUserId] = { streakCount: 0, lastLoggedDateKey: null };
         }

        // Update the streak count
        data.streaks[targetUserId].streakCount = newStreak;

        // When manually setting a streak, we should also set the last logged date
        // to the previous day relative to *today* in IST, so the next log
        // correctly increments the streak.

        // --- Calculate yesterday's date using standard Date and format ---
        try {
            // Get current date in the system's local time
            const now = new Date();

            // Calculate yesterday's date in the system's local time
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);

            // Format yesterday's date into YYYY-MM-DD format
            // This uses date-fns format, which should be available.
            const yesterdayKey = format(yesterday, 'yyyy-MM-dd');

            data.streaks[targetUserId].lastLoggedDateKey = yesterdayKey;

        } catch (error) {
             console.error('Error during date calculation for streakset:', error);
             // Removed the specific error check and message as it wasn't helpful
             await interaction.reply({ content: 'An internal error occurred while setting the streak date. Please contact bot administrator.', ephemeral: true, flags: MessageFlags.Ephemeral });
             return; // Stop execution if date calculation fails
        }
        // --- End alternative date calculation ---


        await saveData(data);

        await interaction.reply({ content: `Successfully set ${targetUser.username}'s chanting streak to ${newStreak}. Their last logged date is set for streak calculation.`, ephemeral: true, flags: MessageFlags.Ephemeral });
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
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(port, () => console.log(`Web server running on port ${port}`));
