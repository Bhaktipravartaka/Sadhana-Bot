// This line loads the variables from your .env file into process.env
require('dotenv').config();

// We need the Client and GatewayIntentBits classes from discord.js
const { Client, GatewayIntentBits } = require('discord.js');

// Create a new Client instance. This is like creating the bot itself.
// We need to tell it what kinds of events it should listen for using "intents".
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Needed for basic server information
        GatewayIntentBits.GuildMessages, // Needed to receive messages in servers
        GatewayIntentBits.MessageContent, // **IMPORTANT:** Needed to read the actual text content of messages (requires enabling in Developer Portal too)
        // You might add more intents later depending on what your bot needs to do
    ],
});

// This is an "event listener". It waits for the 'ready' event, which happens when the bot successfully connects to Discord.
client.once('ready', () => {
    // This message will be printed in your terminal when the bot is online
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('Bot is online!');
});

// This event listener waits for the 'messageCreate' event, which happens every time a message is sent in a server the bot is in.
client.on('messageCreate', msg => {
    // We don't want the bot to respond to its own messages or other bots' messages,
    // as this could cause an infinite loop!
    if (msg.author.bot) return;

    // Check if the message content is exactly "!ping"
    if (msg.content === '!ping') {
        // If it is, send a message back to the channel saying "Pong!"
        msg.channel.send('Pong!');
    }

    // You can add more checks here for different commands
    // Example: Respond to "!hello"
    if (msg.content.toLowerCase() === '!hello') {
        msg.channel.send(`Hello there, ${msg.author.username}!`); // Sends a personalized greeting
    }

    // This is where you would add logic for other commands you want the bot to respond to
});

// This line tells the bot to log in to Discord using the token from your .env file
client.login(process.env.DISCORD_TOKEN);

// Basic error handling for login issues
client.on('error', error => {
    console.error('Something went wrong with the Discord client:', error);
});
