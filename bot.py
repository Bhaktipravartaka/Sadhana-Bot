# bot.py
# This bot code is a direct conversion from your Node.js bot to Python, optimized for
# minimum RAM usage and faster response times.

# It is highly recommended to use the aiohttp and asyncpg libraries
# for high-performance Discord bots in Python.

import os
import asyncio
import asyncpg
import discord
from discord.ext import commands
from discord import app_commands, ui
import logging
from flask import Flask
from threading import Thread
import datetime # Added this import to fix the "datetime is not defined" error

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.INFO)

# Get the PostgreSQL connection URI from environment variables
POSTGRES_URI = os.getenv('POSTGRES_URI')
if not POSTGRES_URI:
    logging.error('FATAL ERROR: POSTGRES_URI environment variable is not set.')
    exit(1)

# Set up the bot with intents
intents = discord.Intents.default()
intents.messages = True
intents.guilds = True
intents.members = True
intents.message_content = True

bot = commands.Bot(command_prefix='!', intents=intents)

# Database pool
db_pool = None

async def setup_db_pool():
    global db_pool
    if db_pool is None:
        try:
            db_pool = await asyncpg.create_pool(POSTGRES_URI, ssl='require')
            logging.info("Successfully connected to the PostgreSQL database.")
            # Create the 'Sadhana' table if it doesn't exist
            await db_pool.execute('''
                CREATE TABLE IF NOT EXISTS "Sadhana" (
                    "userId" VARCHAR(255) PRIMARY KEY,
                    "date" DATE NOT NULL,
                    "count" INTEGER NOT NULL
                );
            ''')
            logging.info("Database schema synchronized successfully.")
        except Exception as e:
            logging.error(f"Failed to connect to the database: {e}")
            raise

@bot.event
async def on_ready():
    logging.info(f'{bot.user} has connected to Discord!')
    await setup_db_pool()
    # Sync command tree
    try:
        synced = await bot.tree.sync()
        logging.info(f"Synced {len(synced)} command(s).")
    except Exception as e:
    # Do not use early return here, just log the error.
        logging.error(f"Failed to sync commands: {e}")

@bot.tree.command(name="daily_challenge", description="Start a daily challenge")
async def daily_challenge_command(interaction: discord.Interaction):
    await interaction.response.send_message(
        "Welcome to the daily challenge! Click the button below to complete the challenge.",
        components=[
            discord.ui.ActionRow(
                ui.Button(label="Complete Challenge", style=discord.ButtonStyle.green, custom_id="complete_challenge")
            )
        ]
    )

# Button interaction handler
@bot.event
async def on_interaction(interaction: discord.Interaction):
    if interaction.type == discord.InteractionType.component:
        custom_id = interaction.data.get('custom_id')

        # Handler for complete challenge button
        if custom_id == 'complete_challenge':
            user_id = str(interaction.user.id)
            current_date = datetime.date.today()
            date_string = current_date.isoformat()

            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    try:
                        # Check if the user has already completed the challenge today
                        record = await conn.fetchrow(
                            'SELECT * FROM "Sadhana" WHERE "userId" = $1 AND "date" = $2',
                            user_id, date_string
                        )

                        if record:
                            await interaction.response.send_message("You've already completed today's challenge!", ephemeral=True)
                        else:
                            await conn.execute(
                                'INSERT INTO "Sadhana" ("userId", "date", "count") VALUES ($1, $2, $3)',
                                user_id, date_string, 1
                            )
                            # Get the total count for the user
                            total_count = await conn.fetchval(
                                'SELECT COUNT(*) FROM "Sadhana" WHERE "userId" = $1',
                                user_id
                            )
                            await interaction.response.send_message(f"Challenge completed! You have completed {total_count} challenges.", ephemeral=True)
                    except Exception as e:
                        logging.error(f"Database error during complete_challenge: {e}")
                        await interaction.response.send_message('An error occurred. Please try again later.', ephemeral=True)

        # Handler for extra rounds button
        elif custom_id.startswith('extra_rounds_button_'):
            parts = custom_id.split('_')
            button_user_id = parts[3]
            button_date_string = parts[4]

            if str(interaction.user.id) != button_user_id:
                await interaction.response.send_message("This button is not for you.", ephemeral=True)
                return

            try:
                async with db_pool.acquire() as conn:
                    await conn.execute(
                        'UPDATE "Sadhana" SET "count" = "count" + 1 WHERE "userId" = $1 AND "date" = $2',
                        button_user_id, button_date_string
                    )
                await interaction.response.send_message("You have added an extra round!", ephemeral=True)

                # Disable the extra rounds button after it's clicked
                updated_components = [
                    discord.ui.ActionRow(
                        ui.Button(label=comp.label, style=comp.style, custom_id=comp.custom_id, disabled=True)
                        for comp in row.components
                    ) for row in interaction.message.components
                ]
                await interaction.edit_original_response(components=updated_components)
            except Exception as e:
                logging.error(f"Error handling extra rounds challenge for user {button_user_id} on date {button_date_string}: {e}")
                await interaction.followup.send("There was an error with the extra rounds challenge. Please try again later.", ephemeral=True)


# Keep alive web server for hosting platforms
app = Flask(__name__)

@app.route("/")
def home():
    return "Bot is alive!"

def run_flask_app():
    app.run(host="0.0.0.0", port=os.environ.get('PORT', 3000))

# Start the Flask server in a separate thread
flask_thread = Thread(target=run_flask_app)
flask_thread.start()

# Run the bot
try:
    bot.run(os.getenv('DISCORD_TOKEN'))
except discord.HTTPException as e:
    logging.error(f"HTTPException: {e}. Check your bot token and intents.")
except Exception as e:
    logging.error(f"An unexpected error occurred: {e}")
