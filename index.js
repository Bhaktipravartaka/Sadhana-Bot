// Load environment variables from .env file
require('dotenv').config();

const http = require('http'); // Keep for Render health check

// --- Google Sheets API Setup ---
const { google } = require('googleapis');
// path is not strictly needed for this Sheets integration, but keep if used elsewhere
// const path = require('path');

// Load credentials from environment variable
// IMPORTANT: Ensure GOOGLE_CREDENTIALS_JSON environment variable is set on Render
let credentials;
try {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    if (!credentials || !credentials.client_email || !credentials.private_key) {
         throw new Error('Invalid or missing Google Sheets credentials JSON.');
    }
} catch (error) {
    console.error('FATAL ERROR: Failed to load or parse Google Sheets credentials from environment variable:', error);
    // Exit the process if credentials cannot be loaded
    process.exit(1);
}


// Configure the JWT client for authentication
const jwtClient = new google.auth.JWT(
    credentials.client_email,
    null, // No keyFile needed when using privateKey directly
    credentials.private_key,
    // Scopes for Google Sheets API access
    ['https://www.googleapis.com/auth/spreadsheets']
);

// Global variable to hold the authenticated Sheets API instance
let sheetsAPI = null;

// Authenticate the client and initialize the Sheets API instance
async function authenticateGoogleSheets() {
    try {
        console.log('Attempting to authenticate with Google Sheets API...');
        const tokens = await jwtClient.authorize();
        console.log('Successfully authenticated with Google Sheets API.');
        // Initialize the Sheets API instance after successful authentication
        sheetsAPI = google.sheets({ version: 'v4', auth: jwtClient });
        console.log('Google Sheets API instance initialized.');

        // Now that Sheets API is ready, log in the Discord client
        console.log('Google Sheets API ready. Logging in Discord client...');
        client.login(token);

    } catch (err) {
        console.error('FATAL ERROR: Failed to authenticate with Google Sheets API:', err);
        // Exit the process if authentication fails
        process.exit(1);
    }
}

// You'll also need the Spreadsheet ID you copied earlier
// Updated with the provided Spreadsheet ID
const SPREADSHEET_ID = '1FuXi1veR1yL_XZQ4kSFw2Vt9gPsKOIiwzYFTQjD_X-Q';

// --- End Google Sheets API Setup ---


// --- Google Sheets Data Interaction Functions (Streaks Only) ---
// These functions replace the Sequelize model interactions and focus only on streak data

// Helper function to get the authenticated Sheets API instance
function getSheetsAPI() {
    if (!sheetsAPI) {
        console.error('Google Sheets API client not initialized!');
        // This should ideally not happen if Discord login waits for authentication,
        // but adding a check here for safety.
        throw new Error('Google Sheets API is not ready.');
    }
    return sheetsAPI;
}

// --- User Streak Functions (Interacting with 'user_streaks' sheet) ---

// Function to get a user's streak data from the 'user_streaks' sheet
// Assumes columns: [userId (A), streakCount (B), lastLoggedDateKey (C)]
async function getUserStreak(userId) {
    const sheets = getSheetsAPI();
    // Define the range for the 'user_streaks' sheet, including headers
    const range = 'user_streaks!A:C'; // Adjust columns based on your sheet structure

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;

        if (!rows || rows.length <= 1) { // Check length <= 1 to account for headers
            console.log('No data rows found in user_streaks sheet (or only headers).');
            return null; // Sheet is empty or only has headers
        }

        // Assuming the first row is headers, skip it and find the row that matches the userId
        // userId is expected in the first column (index 0)
        const userRow = rows.slice(1).find(row => row[0] === userId);

        if (userRow) {
            // Find the original 1-based index of the user's row in the sheet
            // We need to find the index in the *original* rows array (including headers)
            const originalRowIndex = rows.findIndex(row => row[0] === userId);

            // Assuming columns are: [userId (0), streakCount (1), lastLoggedDateKey (2)]
            // Note: Data from sheets comes as strings, convert types as needed
            return {
                userId: userRow[0],
                streakCount: parseInt(userRow[1], 10) || 0, // Convert to number, default to 0 if empty/invalid
                lastLoggedDateKey: userRow[2],
                rowIndex: originalRowIndex + 1 // +1 because Sheets rows are 1-indexed
            };
        } else {
            console.log(`User streak not found for userId: ${userId}`);
            return null; // User not found
        }

    } catch (err) {
        console.error('Error reading from Google Sheet (getUserStreak):', err);
        throw new Error('Failed to fetch user streak data.'); // Throw a more user-friendly error
    }
}

// Function to add a new user streak row to the 'user_streaks' sheet
// Assumes columns: [userId (A), streakCount (B), lastLoggedDateKey (C)]
async function addUserStreak(userId, streakCount, lastLoggedDateKey) {
    const sheets = getSheetsAPI();
    // Append to the 'user_streaks' sheet, specifying the columns to append to
    const range = 'user_streaks!A:C'; // Adjust columns based on your sheet structure

    // Data to append - must be an array of arrays
    // Each inner array is a row, values must be in the correct column order (userId, streakCount, lastLoggedDateKey)
    const values = [
        [userId, streakCount, lastLoggedDateKey]
    ];

    const resource = {
        values,
    };

    try {
        const result = await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'RAW', // How input data is interpreted (RAW means don't parse numbers/dates)
            insertDataOption: 'INSERT_ROWS', // Insert new rows, shifting existing ones down
            resource,
        });
        console.log(`Appended new streak row for user ${userId}.`);
        // Return the result of the append operation
        return result;

    } catch (err) {
        console.error(`Error adding new streak row for user ${userId}:`, err);
        throw new Error('Failed to add new user streak data.');
    }
}

// Function to update an existing user streak row by its Sheet row index
// Note: rowIndex is the 1-based index from the Google Sheet
// Assumes columns: [userId (A), streakCount (B), lastLoggedDateKey (C)]
// We update columns B and C for streakCount and lastLoggedDateKey
async function updateExistingUserStreak(rowIndex, streakCount, lastLoggedDateKey) {
    const sheets = getSheetsAPI();
    // Define the range for the update - target the specific row and columns B and C
    // Adjust 'B' and 'C' based on your sheet structure
    const range = `user_streaks!B${rowIndex}:C${rowIndex}`;

    // Data to update - must be an array of arrays, matching the target range columns
    // Order: [streakCount, lastLoggedDateKey]
    const values = [
        [streakCount, lastLoggedDateKey]
    ];

    const resource = {
        values,
    };

    try {
        const result = await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'RAW', // How input data is interpreted
            resource,
        });
        console.log(`Updated streak row ${rowIndex} for user.`);
        // Return the result of the update operation
        return result;

    } catch (err) {
        console.error(`Error updating streak row ${rowIndex}:`, err);
        throw new Error('Failed to update user streak data.');
    }
}

// Helper function to find, create, or update a user's streak
// updateLogicFn is a function that takes the current streak data (or null) and returns { newStreakCount, newLastLoggedDateKey }
async function findOrCreateAndUpdateUserStreak(userId, updateLogicFn) {
    let userStreakData = await getUserStreak(userId);

    // Calculate the new streak details using the provided logic function
    const { newStreakCount, newLastLoggedDateKey } = updateLogicFn(userStreakData);

    if (userStreakData) {
        // User exists, update the row using the stored rowIndex
        await updateExistingUserStreak(userStreakData.rowIndex, newStreakCount, newLastLoggedDateKey);
        // Return the updated data structure (simulate the updated state)
        return { ...userStreakData, streakCount: newStreakCount, lastLoggedDateKey: newLastLoggedDateKey };
    } else {
        // User does not exist, add a new row
        await addUserStreak(userId, newStreakCount, newLastLoggedDateKey);
        // Return the data structure for the newly created entry (simulate the created state)
        return { userId, streakCount: newStreakCount, lastLoggedDateKey: newLastLoggedDateKey, rowIndex: null }; // rowIndex is unknown after append
    }
}

// Function to get all user streaks for the streakboard
// Assumes columns: [userId (A), streakCount (B), lastLoggedDateKey (C)]
async function getAllUserStreaks() {
    const sheets = getSheetsAPI();
    const range = 'user_streaks!A:C'; // Adjust columns based on your sheet structure

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;

        if (!rows || rows.length <= 1) { // Check length <= 1 to account for headers
            console.log('No data rows found in user_streaks sheet (or only headers).');
            return []; // Return empty array if no data
        }

        // Map rows (skipping headers) to objects
        // Assumes columns: [userId (0), streakCount (1), lastLoggedDateKey (2)]
        const streaks = rows.slice(1).map(row => ({
            userId: row[0],
            streakCount: parseInt(row[1], 10) || 0, // Convert to number
            lastLoggedDateKey: row[2],
             // rowIndex is not needed for this function
        }));

        // Sort by streakCount descending
        streaks.sort((a, b) => b.streakCount - a.streakCount);

        return streaks;

    } catch (err) {
        console.error('Error reading from Google Sheet (getAllUserStreaks):', err);
        throw new Error('Failed to fetch all user streak data.');
    }
}

// Function to get the total count of user streak entries
async function getTotalUserStreakCount() {
     const sheets = getSheetsAPI();
     const range = 'user_streaks!A:A'; // Read only the first column to count rows

     try {
         const response = await sheets.spreadsheets.values.get({
             spreadsheetId: SPREADSHEET_ID,
             range: range,
         });

         const rows = response.data.values;

         // If rows exist, the count is rows.length - 1 (subtract header row)
         // If no rows or only header, count is 0
         const count = (rows && rows.length > 0) ? rows.length - 1 : 0;

         console.log(`Total user streak entries counted: ${count}`);
         return count;

     } catch (err) {
         console.error('Error counting user streak entries:', err);
         throw new Error('Failed to count user streak entries.');
     }
}


// --- REMOVED Sadhana Log Functions ---
// Function to get a user's sadhana log for a specific date (REMOVED)
// async function getSadhanaLog(userId, date) {...} // REMOVED
// Function to add a new sadhana log row (REMOVED)
// async function addSadhanaLog(logData) {...} // REMOVED
// Function to update an existing sadhana log row (REMOVED)
// async function updateExistingSadhanaLog(rowIndex, logData) {...} // REMOVED
// Helper function to find, create, or update a sadhana log entry (REMOVED)
// async function findOrCreateAndUpdateSadhanaLog(logData) {...} // REMOVED
// Function to get sadhana logs within a date range for a specific user (REMOVED)
// async function getSadhanaLogsInPeriodForUser(userId, startDate, endDate) {...} // REMOVED
// Function to get all sadhana logs for a specific user (REMOVED)
// async function getAllTimeSadhanaLogsForUser(userId) {...} // REMOVED
// Function to get aggregate data for leaderboard (REMOVED)
// async function getLeaderboardData(startDate, endDate) {...} // REMOVED
// Function to get the total count of sadhana entries (REMOVED)
// async function getTotalSadhanaCount() {...} // REMOVED


// --- End Google Sheets Data Interaction Functions ---


// Import necessary classes from discord.js
// Added ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Using date-fns for robust date/time parsing and comparison
// Make sure 'date-fns' is installed: npm install date-fns
const { parse, differenceInCalendarDays, addDays, format, startOfDay, endOfDay, startOfMonth, setHours, setMinutes, setSeconds, isBefore, differenceInMilliseconds } = require('date-fns');

// For timezone handling - Needed for accurate IST time comparisons
// IMPORTANT: Make sure 'date-fns-tz' (v2 or later) is installed: npm install date-fns-tz
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');

// --- REMOVED Sequelize and DataTypes ---
// const { Sequelize, DataTypes } = require('sequelize'); // REMOVED

// Import node-cron for scheduling tasks
// Make sure 'node-cron' is installed: npm install node-cron
const cron = require('node-cron');


// Get bot token, client ID, guild ID, and SQLite URI from environment variables.
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // Your server's ID (Guild ID) for faster testing
// --- REMOVED SQLite DB Path ---
// const SQLITE_DB_PATH = 'database.sqlite'; // REMOVED
// --- REMOVED Postgres URI ---
// const postgresUri = process.env.POSTGRES_URI; // REMOVED
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID; // Add this to your .env file

// Define the timezone for IST
const IST_TIMEZONE = 'Asia/Kolkata'; // IANA timezone name for India Standard Time

// Define the daily cutoff time for logging practice (e.g., 11:59 PM IST)
const DAILY_CUTOFF_HOUR_IST = 23; // 23 for 11 PM
const DAILY_CUTOFF_MINUTE_IST = 59; // 59 for 59 minutes

// Define how many entries per page for the streakboard
const ENTRIES_PER_PAGE = 10;


// --- REMOVED Database Connection using Sequelize ---
// const sequelize = new Sequelize({...}); // REMOVED
// async function connectDB() {...} // REMOVED
// connectDB(); // REMOVED

// --- REMOVED Sequelize Model Definitions ---
// const Sadhana = sequelize.define('Sadhana', {...}); // REMOVED
// const UserStreak = sequelize.define('UserStreak', {...}); // REMOVED


// Helper function to parse time string with date context and convert to IST
// This function remains the same as it works with standard Date objects
// Although not used for Sadhana logs anymore, keeping it in case it's needed elsewhere
function parseTimeInIST(dateKey, timeString) {
    try {
        // Ensure dateKey is a Date object or a string parseable as a date
        const baseDate = typeof dateKey === 'string' ? parse(dateKey, 'yyyy-MM-dd', new Date()) : dateKey;
        if (isNaN(baseDate.getTime())) {
             console.error(`parseTimeInIST: Invalid base date provided: "${dateKey}"`);
             return null;
        }

        const dateTimeString = `${format(baseDate, 'yyyy-MM-dd')} ${timeString}`;
        // Use fromZonedTime with the base date's start of day in the target timezone for context
        const parsedDate = parse(dateTimeString, 'yyyy-MM-dd h:mm a', startOfDay(toZonedTime(baseDate, IST_TIMEZONE)));


         if (isNaN(parsedDate.getTime())) {
             console.error(`parseTimeInIST: Parsed date is invalid for string: "${dateTimeString}"`);
             return null;
        }

        // Convert the parsed date/time (which is in the context of IST) to a UTC Date object
        const utcDate = fromZonedTime(parsedDate, IST_TIMEZONE);

        return utcDate;

    } catch (error) {
        console.error(`parseTimeInIST: Error parsing time string "${timeString}" for date "${dateKey}":`, error);
        // Don't re-throw here, return null or handle gracefully in caller
        return null;
    }
}


// Function to calculate the score (logic remains the same, operates on log object)
// This function is no longer used as Sadhana logs are removed, but keeping it for reference
// in case you re-introduce Sadhana logging later.
function calculateScore(log) {
    let score = 0;

    // Access data using object properties (matching the keys returned by Sheets functions)
    if ((log.japaRounds || 0) > 0) {
        score += 1;
    }

    score += (log.studyHours || 0) * 0.1;
    score += (log.listeningHours || 0) * 0.1;

    if (log.readingDetails && log.readingDetails.trim() !== '') {
        score += 1;
    }

    // Note: Accessing the boolean status from the log object
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
        GatewayIntentBits.DirectMessages,
    ],
});


// --- Define Slash Commands ---
// Removed /logpractice, weeklysummary, monthlysummary, leaderboard, myscore commands
const commands = [
     {
        name: 'chant',
        description: 'Log your japa rounds chanted for today and update your streak.', // Updated description
        options: [
            {
                name: 'rounds',
                type: 4, // INTEGER
                description: 'The number of rounds chanted.',
                required: true,
            },
        ],
    },
    // Removed /logpractice command
    // { name: 'logpractice', description: 'Log your daily spiritual practices using a form.' },
    // Removed weeklysummary command
    // { name: 'weeklysummary', description: 'Shows your spiritual practice summary for the last 7 days.' },
    // Removed monthlysummary command
    // { name: 'monthlysummary', description: 'Shows your spiritual practice summary for the current month.' },
    // Removed leaderboard command
    // {
    //     name: 'leaderboard',
    //     description: 'Shows the top devotees based on practice scores.',
    //     options: [
    //         {
    //             name: 'period',
    //             type: 3, // STRING
    //             description: 'Select the period for the leaderboard',
    //             required: true,
    //             choices: [
    //                 { name: 'Weekly', value: 'weekly' },
    //                 { name: 'Monthly', value: 'monthly' },
    //             ],
    //         },
    //     ],
    // },
    // Removed myscore command
    // {
    //     name: 'myscore',
    //     description: 'Shows your personal practice score for a specific period.',
    //     options: [
    //         {
    //             name: 'period',
    //             type: 3, // STRING
    //             description: 'Select the period for your score',
    //             required: true,
    //             choices: [
    //                 { name: 'Weekly', value: 'weekly' },
    //                 { name: 'Monthly', value: 'monthly'},
    //             ],
    //         },
    //     ],
    // },
    {
        name: 'showscore',
        description: 'Shows a user\'s chanting streak.', // Updated description
        options: [
            {
                name: 'user',
                type: 6, // USER
                description: 'The user whose streak to show.', // Updated description
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
        description: 'Check specific data from the Google Sheet (Admin only).', // Updated description
        options: [
            {
                name: 'type',
                type: 3, // STRING
                description: 'Type of data to check',
                required: true,
                choices: [
                    // Removed Sadhana log options
                    // { name: 'User Log by Date', value: 'user_log_by_date' },
                    { name: 'User Streak', value: 'user_streak' },
                    // Removed Total Sadhana entries count
                    // { name: 'Total Sadhana Entries Count', value: 'total_sadhana_count' },
                    { name: 'Total User Streak Entries Count', value: 'total_streak_count' },
                ],
            },
            {
                name: 'user',
                type: 6, // USER
                description: 'The user to check data for (required for User Streak).', // Updated description
                required: false,
            },
            // Removed date-related options as they were for Sadhana logs
            // { name: 'date_string', type: 3, description: 'Date of the log (e.g., 07/05/2025) (required for User Log by Date).', required: false },
            // { name: 'day', type: 4, description: 'Day of the month (optional, use date_string instead).', required: false },
            // { name: 'month', type: 4, description: 'Month (1-12) (optional, use date_string instead).', required: false },
            // { name: 'year', type: 4, description: 'Year (e.g., 2023) (optional, use date_string instead).', required: false },
        ],
        default_member_permissions: PermissionsBitField.Flags.Administrator.toString(),
    },
     {
        name: 'streakboard', // Renamed from streaklog
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


// --- REMOVED Define the Log Practice Modal ---
// const logPracticeModal = new ModalBuilder() {...} // REMOVED


// --- Helper function to generate a streakboard page embed and components ---
// This function remains the same, it operates on an array of streak objects
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
                 // Fetch user/member to get username
                 if (interaction.guild) {
                    const member = await interaction.guild.members.fetch(userStreak.userId);
                     username = member.user.globalName || member.user.username; // Prefer global name
                 } else {
                     // If not in a guild context (e.g., DM), fetch the user directly
                     const user = await client.users.fetch(userStreak.userId);
                     username = user.globalName || user.username; // Prefer global name
                 }
             } catch (err) {
                 console.warn(`Could not fetch user/member ${userStreak.userId} for streakboard:`, err.message);
                 username = `User ID: ${userStreak.userId}`; // Fallback to user ID if fetch fails
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

    return { embeds: [embed], components: [row] };
}


// --- Bot Event Handlers ---

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online and ready to receive slash commands and modal submissions!');

    // --- Schedule Cron Jobs ---

    // Schedule daily streak warning DM (e.g., at 10:00 PM IST)
    // This cron job now only checks streak data
    cron.schedule('0 22 * * *', async () => {
        console.log(`[${new Date().toISOString()}] Running daily streak warning job.`);
        try {
            const now = new Date();
            const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE));
            const todayKey = format(todayIST, 'yyyy-MM-dd');

            // Calculate the cutoff time for today in IST
            let cutoffTimeTodayIST = setHours(setMinutes(setSeconds(todayIST, 0), DAILY_CUTOFF_MINUTE_IST), DAILY_CUTOFF_HOUR_IST);
             // If the current time is past the cutoff time, the cutoff is for the *next* day.
             // However, for the warning, we want to warn *before* today's cutoff.
             // So, we just need today's cutoff time.

            // --- Sheets Interaction: Fetch all users with a streak > 0 ---
            // We need to fetch all streaks to find users with streaks > 0
            const allUserStreaks = await getAllUserStreaks();
            const usersWithStreaks = allUserStreaks.filter(streak => streak.streakCount > 0);

            console.log(`[${new Date().toISOString()}] Found ${usersWithStreaks.length} users with streaks.`);

            for (const userStreak of usersWithStreaks) {
                const userId = userStreak.userId;
                const lastLoggedDateKey = userStreak.lastLoggedDateKey;

                // Check if the last logged date is NOT today
                const lastLoggedDate = lastLoggedDateKey ? startOfDay(parse(lastLoggedDateKey, 'yyyy-MM-dd', new Date())) : null;

                // Send warning if last logged date is before today (meaning they haven't logged today yet)
                if (!lastLoggedDate || isBefore(lastLoggedDate, todayIST)) {
                    try {
                        const user = await client.users.fetch(userId);
                        if (user) {
                            // Calculate remaining time until cutoff
                            const nowIST = toZonedTime(new Date(), IST_TIMEZONE);
                            const timeRemainingMs = differenceInMilliseconds(cutoffTimeTodayIST, nowIST);

                            if (timeRemainingMs > 0) { // Only send if there's time remaining today
                                const hours = Math.floor(timeRemainingMs / (1000 * 60 * 60));
                                const minutes = Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60));

                                const warningMessage = `Hare Krishna! 🙏 Your chanting streak of ${userStreak.streakCount} day(s) is about to be lost! You haven't logged your chanting for today yet.`; // Updated message
                                const timeRemainingMessage = `You have about ${hours} hours and ${minutes} minutes remaining to log your rounds using \`/chant <rounds>\`. Don't miss your streak!`; // Updated message

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
    // Updated message to reflect available commands
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
                    .setTitle('Daily Chanting Reminder!') // Updated title
                    .setDescription(`Hare Krishna! 🙏 Remember to log your japa rounds for today using \`/chant <rounds>\` to keep your streak alive!`); // Updated description

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

    // --- REMOVED Call to connectDB() ---
    // connectDB(); // REMOVED

});

// Start the Google Sheets authentication process
// Discord client login is moved inside the authentication success callback
authenticateGoogleSheets();


client.on('interactionCreate', async interaction => {
    console.log(`[${new Date().toISOString()}] Interaction received: ${interaction.id}, Type: ${interaction.type}, Command: ${interaction.isCommand() ? interaction.commandName : 'N/A'}, Modal: ${interaction.isModalSubmit() ? interaction.customId : 'N/A'}, Button: ${interaction.isButton() ? interaction.customId : 'N/A'}`);

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
            // guildId is not used in streak logic, but kept for potential future use
            // const guildId = interaction.guild?.id;
            const now = new Date();
            const todayIST = startOfDay(toZonedTime(now, IST_TIMEZONE)); // Get start of today in IST
            const todayKey = format(todayIST, 'yyyy-MM-dd');

            if (rounds < 0) {
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription('Number of rounds cannot be negative.');
                 await interaction.editReply({ embeds: [embed] });
                 return;
            }

            try {
                // --- Sheets Interaction: Chanting Streak Logic for /chant ---
                 // Find or create and update the user's streak entry
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
                                 newStreak = 1; // Reset streak
                             } else if (dayDifference <= 0 && format(todayIST, 'yyyy-MM-dd') !== lastLoggedDateKey) {
                                 newStreak = currentStreak; // Already logged today
                             }
                         } else {
                             newStreak = 1; // First log ever
                         }

                         // Only update streak count and last logged date if the current log date is after the last logged date
                         // This prevents logging multiple times on the same day from increasing the streak
                         if (!lastLoggedDateKey || (todayIST > lastLoggedDate)) {
                             return { newStreakCount: newStreak, newLastLoggedDateKey: format(todayIST, 'yyyy-MM-dd') };
                         } else {
                              // If logging for a date <= last logged date, keep the current streak and date
                             return { newStreakCount: currentStreak, newLastLoggedDateKey: lastLoggedDateKey };
                         }

                     } else {
                          console.error(`Invalid todayIST date for streak logic (/chant): ${todayIST}`);
                          // In case of invalid date, return current streak details to avoid data loss
                          return { newStreakCount: currentStreak, newLastLoggedDateKey: lastLoggedDateKey };
                     }
                 });


                // --- Test: Send a basic text reply instead of embed ---
                console.log(`[${new Date().toISOString()}] Sheets update complete. Attempting to send plain text reply for user ${userId}`);
                try {
                     // Use content instead of embeds
                     await interaction.editReply({ content: `Logged ${rounds} rounds. Your streak is now ${userStreak.streakCount} day(s).` });
                     console.log(`[${new Date().toISOString()}] Successfully sent plain text reply for /chant command for user ${userId}`);
                } catch (editError) {
                     console.error(`[${new Date().toISOString()}] Error editing reply with plain text for /chant command for user ${userId}:`, editError);
                }

                // Removed the original embed creation and editReply with embed


            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error during /chant command for user ${userId}:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Chanting Log Failed')
                     .setDescription(`An error occurred while logging your rounds: ${error.message}`);
                 // Ensure we editReply since we deferred earlier
                 await interaction.editReply({ embeds: [embed] });
            }


        }
        // Removed /logpractice command handler
        // else if (commandName === 'logpractice') { ... } // REMOVED
        // Removed weeklysummary command handler
        // else if (commandName === 'weeklysummary') { ... } // REMOVED
        // Removed monthlysummary command handler
        // else if (commandName === 'monthlysummary') { ... } // REMOVED
        // Removed leaderboard command handler
        // else if (commandName === 'leaderboard') { ... } // REMOVED
        // Removed myscore command handler
        // else if (commandName === 'myscore') { ... } // REMOVED

        // Handle the /showscore command (Updated to only show streak)
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

            try {
                // --- Sheets Interaction: Get user's streak ---
                const userStreak = await getUserStreak(userId);
                const currentStreak = userStreak ? userStreak.streakCount : 0;

                // Removed logic for weekly, monthly, and all-time scores

                // Create an embed for showing user's score (only streak)
                const embed = new EmbedBuilder()
                    .setColor('#00CED1') // Dark Cyan color
                    .setTitle(`Chanting Streak for ${username}`) // Updated title
                    .addFields(
                        { name: 'Current Chanting Streak', value: `${currentStreak} day(s) 🙏` }
                        // Removed score fields
                        // { name: 'Weekly (Last 7 Days)', value: `${weeklyScore.toFixed(2)} points (${weeklyLoggedDays} logged)`, inline: true },
                        // { name: `Monthly (${now.toLocaleString('default', { month: 'long', year: 'numeric' })})`, value: `${monthlyScore.toFixed(2)} points (${monthlyLoggedDays} logged)`, inline: true },
                        // { name: 'All-Time', value: `${allTimeScore.toFixed(2)} points (${allTimeLoggedDays} logged)`, inline: true }
                    );

                console.log(`[${new Date().toISOString()}] Attempting to editReply for showscore for user ${userId}`);
                try {
                     await interaction.editReply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] Successfully edited reply for showscore for user ${userId}`);
                } catch (editError) {
                     console.error(`[${new Date().toISOString()}] Error editing reply for showscore for user ${userId}:`, editError);
                }
            } catch (error) {
                 console.error(`[${new Date().toISOString()}] Error during /showscore command for user ${userId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Show Streak Failed') // Updated title
                      .setDescription(`An error occurred while fetching streak data: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
            }

        }
         // Handle the /streakset command (Admin only)
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
            const newStreakValue = interaction.options.getInteger('streak');

            if (newStreakValue < 0) {
                 // Reply with embed for invalid streak value
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000') // Red color for error
                     .setTitle('Streak Set Failed')
                     .setDescription('Streak value cannot be negative.');
                 await interaction.reply({ embeds: [embed] });
                return;
            }

            const targetUserId = targetUser.id;

            try {
                // --- Sheets Interaction: Find or create and update the user's streak entry ---
                 const userStreak = await findOrCreateAndUpdateUserStreak(targetUserId, (currentUserStreak) => {
                     // This logic sets the streak to the new value and the last logged date to yesterday
                     // so the streak continues correctly on the next log.
                     const now = new Date();
                     const yesterday = addDays(now, -1);
                     const yesterdayKey = format(yesterday, 'yyyy-MM-dd');

                     return {
                         newStreakCount: newStreakValue,
                         newLastLoggedDateKey: yesterdayKey
                     };
                 });

                // Create an embed for successful streak set
                const embed = new EmbedBuilder()
                    .setColor('#32CD32') // Lime Green color
                    .setTitle('Streak Set Successfully')
                    .setDescription(`Successfully set ${targetUser.username}'s chanting streak to ${userStreak.streakCount}. Their last logged date is set for streak calculation.`);

                console.log(`[${new Date().toISOString()}] Attempting to reply for streakset for user ${targetUserId}`);
                try {
                     await interaction.reply({ embeds: [embed] });
                     console.log(`[${new Date().toISOString()}] Successfully replied for streakset for user ${targetUserId}`);
                } catch (replyError) {
                     console.error(`[${new Date().toISOString()}] Error replying for streakset for user ${targetUserId}:`, replyError);
                }

            } catch (error) {
                 console.error(`[${new Date().toISOString()}] Error during /streakset command for user ${targetUserId}:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Set Failed')
                      .setDescription(`An error occurred while setting the streak: ${error.message}`);
                  await interaction.reply({ embeds: [embed] });
            }
        }
        // Handle the /help command
        // Updated description to reflect available commands
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
                              // Removed /logpractice from help
                              // `- \`/logpractice\`: Open a form to log your full daily practice details.\n`
                              // Removed weeklysummary from help
                              // `- \`/weeklysummary\`: Shows your practice summary for the last 7 days.\n`
                              // Removed monthlysummary from help
                              // `- \`/monthlysummary\`: Shows your practice summary for the current month.\n`
                              // Removed leaderboard from help
                              // `- \`/leaderboard <period>\`: Shows the top devotees based on practice scores (weekly or monthly).\n`
                              // Removed myscore from help
                              // `- \`/myscore <period>\`: Shows your personal practice score for a specific period (weekly or monthly).\n`
                              + `- \`/showscore <user>\`: Shows a user's chanting streak.\n` // Updated description
                              + `- \`/streakboard\`: Shows the current chanting streak leaderboard with pagination.\n` // Updated command name and description
                              + `- \`/streakset <user> <streak>\`: Sets a user's chanting streak (Admin only).\n`
                              + `- \`/checkdata <type> [user]\`: Check specific data from the Google Sheet (Admin only).`); // Updated description and options

            console.log(`[${new Date().toISOString()}] Attempting to reply for help command for user ${interaction.user.tag}`);
            // Reply with embed
            try {
                 await interaction.reply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully replied for help command for user ${interaction.user.tag}`);
            } catch (replyError) {
                 console.error(`[${new Date().toISOString()}] Error replying for help command for user ${interaction.user.tag}:`, replyError);
            }
        }
        // --- Handle /checkdata command (Updated for streaks only) ---
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
            // Removed dateString and date component options
            // const dateString = interaction.options.getString('date_string'); // REMOVED
            // const day = interaction.options.getInteger('day'); // REMOVED
            // const month = interaction.options.getInteger('month'); // REMOVED
            // const year = interaction.options.getInteger('year'); // REMOVED


            // Create an embed for the checkdata results
            const embed = new EmbedBuilder()
                 .setColor('#800080') // Purple color
                .setTitle('Data Check Results');

            let embedDescription = ''; // Use description or fields for results

            try {
                switch (dataType) {
                    // Removed case for 'user_log_by_date'
                    // case 'user_log_by_date': { ... } // REMOVED

                    case 'user_streak':
                        if (!targetUser) {
                             embedDescription = 'For "User Streak", you must provide a user.';
                             embed.setColor('#FF0000'); // Change color for error
                             embed.setDescription(embedDescription);
                             await interaction.editReply({ embeds: [embed] });
                            return;
                        }
                        // --- Sheets Interaction: Get user streak ---
                        const userStreak = await getUserStreak(targetUser.id);

                        if (userStreak) {
                            embed.setTitle(`Streak for ${targetUser.username}`);
                            // Access properties directly from the streak object
                            embed.addFields(
                                { name: 'Current Streak', value: `${userStreak.streakCount} day(s)` },
                                { name: 'Last Logged Date Key', value: userStreak.lastLoggedDateKey || 'None' }
                            );
                        } else {
                            embedDescription = `No streak data found for ${targetUser.username}.`;
                             embed.setDescription(embedDescription);
                        }
                        break;

                    // Removed case for 'total_sadhana_count'
                    // case 'total_sadhana_count': { ... } // REMOVED

                    case 'total_streak_count':
                        // --- Sheets Interaction: Get total streak count ---
                        const totalStreakCount = await getTotalUserStreakCount();
                        embedDescription = `**Total User Streak Entries in Sheet:** ${totalStreakCount}`;
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
                embedDescription = `An unexpected error occurred while fetching data: ${error.message}`;
                embed.setColor('#FF0000'); // Change color for error
                embed.setDescription(embedDescription);
            }

            console.log(`[${new Date().toISOString()}] Attempting to editReply for checkdata command`);
            try {
                 await interaction.editReply({ embeds: [embed] });
                 console.log(`[${new Date().toISOString()}] Successfully edited reply for checkdata command`);
            } catch (editError) {
                 console.error(`[${new Date().toISOString()}] Error editing reply for checkdata command:`, editError);
            }

        }
         // --- Handle /streakboard command (Renamed from /streaklog) ---
        else if (commandName === 'streakboard') {
            console.log(`[${new Date().toISOString()}] Handling /streakboard command for user ${interaction.user.tag}`);
            // Defer the reply immediately
            try {
                await interaction.deferReply();
                console.log(`[${new Date().toISOString()}] Reply deferred successfully for interaction ${interaction.id}`);
            } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring reply for interaction ${interaction.id}:`, deferError);
                 return;
            }
            console.log(`[${new Date().toISOString()}] Deferral complete for ${interaction.id}. Proceeding with command logic.`);

            try {
                // --- Sheets Interaction: Fetch all streaks ---
                const userStreaks = await getAllUserStreaks();

                const totalPages = Math.ceil(userStreaks.length / ENTRIES_PER_PAGE);
                const page = 0; // Start on the first page

                // Generate and send the initial page
                const { embeds, components } = await generateStreakboardPage(userStreaks, page, totalPages, interaction);

                console.log(`[${new Date().toISOString()}] Attempting to editReply for /streakboard command`);
                try {
                     await interaction.editReply({ embeds: embeds, components: components });
                     console.log(`[${new Date().toISOString()}] Successfully edited reply for /streakboard command`);
                } catch (editError) {
                     console.error(`[${new Date().toISOString()}] Error editing reply for /streakboard command:`, editError);
                }
            } catch (error) {
                 console.error(`[${new Date().toISOString()}] Error during /streakboard command:`, error);
                  const embed = new EmbedBuilder()
                      .setColor('#FF0000')
                      .setTitle('Streak Leaderboard Failed')
                      .setDescription(`An error occurred while fetching streak data: ${error.message}`);
                  await interaction.editReply({ embeds: [embed] });
            }
        }
    }

    // --- Handle Button Interactions ---
    if (interaction.isButton()) {
        console.log(`[${new Date().toISOString()}] Button interaction received: ${interaction.customId} for user ${interaction.user.tag}`);
        // Check if the button custom ID starts with 'streakboard_page_'
        if (interaction.customId.startsWith('streakboard_page_')) {
             console.log(`[${new Date().toISOString()}] Handling streakboard pagination button.`);
            // Defer the button update
             try {
                 await interaction.deferUpdate();
                 console.log(`[${new Date().toISOString()}] Button update deferred successfully.`);
             } catch (deferError) {
                 console.error(`[${new Date().toISOString()}] Error deferring button update:`, deferError);
                 return;
             }
             console.log(`[${new Date().toISOString()}] Deferral complete for button interaction. Proceeding with logic.`);


            const requestedPage = parseInt(interaction.customId.split('_')[2], 10); // Extract page number from custom ID

            try {
                // --- Sheets Interaction: Re-fetch all streaks ---
                // Re-fetch all streaks (can optimize this by storing in memory if needed)
                const userStreaks = await getAllUserStreaks();

                const totalPages = Math.ceil(userStreaks.length / ENTRIES_PER_PAGE);

                // Validate the requested page number
                if (isNaN(requestedPage) || requestedPage < 0 || requestedPage >= totalPages) {
                     console.warn(`[${new Date().toISOString()}] Invalid page requested: ${requestedPage}. Total pages: ${totalPages}`);
                     // Optionally, send a message indicating invalid page, or just do nothing.
                     // For now, we'll just log and not update the message.
                     return;
                }

                // Generate and update the message with the new page
                const { embeds, components } = await generateStreakboardPage(userStreaks, requestedPage, totalPages, interaction);

                console.log(`[${new Date().toISOString()}] Attempting to editReply for streakboard pagination.`);
                try {
                     await interaction.editReply({ embeds: embeds, components: components });
                     console.log(`[${new Date().toISOString()}] Successfully edited reply for streakboard pagination.`);
                } catch (editError) {
                     console.error(`[${new Date().toISOString()}] Error editing reply for streakboard pagination:`, editError);
                }
            } catch (error) {
                 console.error(`[${new Date().toISOString()}] Error during streakboard pagination button:`, error);
                 const embed = new EmbedBuilder()
                     .setColor('#FF0000')
                     .setTitle('Streak Leaderboard Failed')
                     .setDescription(`An error occurred while fetching streak data: ${error.message}`);
                 await interaction.editReply({ embeds: [embed], components: [] }); // Remove buttons on error
            }

        }
    }

    // --- REMOVED Handle Modal Submit Interactions ---
    // if (interaction.isModalSubmit()) { ... } // REMOVED
});


// Start the Google Sheets authentication process
// Discord client login is moved inside the authentication success callback
authenticateGoogleSheets();


// --- Optional: Keep alive web server for hosting platforms ---
// This remains the same.
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(port, () => console.log(`Web server running on port ${port}`));

