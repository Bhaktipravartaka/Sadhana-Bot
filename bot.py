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
import datetime
import urllib.parse
import pytz

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
            # Parse the PostgreSQL URI
            uri_parsed = urllib.parse.urlparse(POSTGRES_URI)
            db_user = uri_parsed.username
            db_password = uri_parsed.password
            db_name = uri_parsed.path[1:] # Strip the leading slash
            db_host = uri_parsed.hostname
            db_port = uri_parsed.port
            
            # Create a pool using the parsed components
            # Set statement_cache_size=0 to fix the pgbouncer prepared statement issue
            db_pool = await asyncpg.create_pool(
                user=db_user,
                password=db_password,
                database=db_name,
                host=db_host,
                port=db_port,
                ssl='require',
                statement_cache_size=0
            )
            logging.info("Successfully connected to the PostgreSQL database.")

        except asyncpg.exceptions.PostgresError as e:
            logging.error(f"Failed to connect to the database: {e}")
            # Exit the process if we can't connect to the database.
            exit(1)
        except Exception as e:
            logging.error(f"An unexpected error occurred during database connection: {e}")
            exit(1)

@bot.event
async def on_ready():
    logging.info(f"{bot.user} has connected to Discord!")
    # Connect to the database
    await setup_db_pool()
    # Sync slash commands
    try:
        synced = await bot.tree.sync()
        logging.info(f"Synced {len(synced)} slash commands.")
    except Exception as e:
        logging.error(f"Failed to sync slash commands: {e}")
    
    
    # Run a health check query
    async with db_pool.acquire() as connection:
        result = await connection.fetchval("SELECT 1")
        if result == 1:
            logging.info("Database connection health check successful.")
        else:
            logging.warning("Database connection health check failed.")


@bot.tree.command(name="chant", description="Track your chanting rounds.")
@app_commands.describe(
    rounds="The number of rounds you have chanted."
)
async def chant_rounds(interaction: discord.Interaction, rounds: int):
    user_id = interaction.user.id
    guild_id = interaction.guild.id
    today = datetime.date.today()
    kolkata_tz = pytz.timezone('Asia/Kolkata')
    now_ist = datetime.datetime.now(kolkata_tz)
    nine_am_ist = now_ist.replace(hour=9, minute=0, second=0, microsecond=0)
    
    async with db_pool.acquire() as connection:
        challenge = await connection.fetchrow(
            "SELECT * FROM sadhanas WHERE user_id = $1 AND guild_id = $2 AND status = 'active'",
            user_id, guild_id
        )

        points_to_add = 0
        response_text = ""

        if not challenge:
            # First time user is chanting, create a record
            if now_ist < nine_am_ist:
                points_to_add = 2
            else:
                points_to_add = 1
            
            await connection.execute(
                """
                INSERT INTO sadhanas (user_id, guild_id, sadhana_name, duration, start_date, end_date, streak, chant_count, last_check_in_date, status)
                VALUES ($1, $2, 'Daily Sadhana', 0, $3, $3, $4, $5, $3, 'active')
                """,
                user_id, guild_id, today, points_to_add, rounds
            )
            response_text = f"Welcome! You have logged {rounds} rounds and earned {points_to_add} points for your streak. You are now officially a sadhana devotee!"
        else:
            # User has an existing record
            last_check_in_date = challenge['last_check_in_date']
            
            if not last_check_in_date or last_check_in_date.date() != today:
                if now_ist < nine_am_ist:
                    points_to_add = 2
                else:
                    points_to_add = 1
                
                await connection.execute(
                    """
                    UPDATE sadhanas SET streak = streak + $1, last_check_in_date = $2
                    WHERE user_id = $3 AND guild_id = $4
                    """,
                    points_to_add, today, user_id, guild_id
                )
                
            # Always update the chant count
            new_chant_count = challenge['chant_count'] + rounds
            await connection.execute(
                """
                UPDATE sadhanas SET chant_count = $1
                WHERE user_id = $2 AND guild_id = $3
                """,
                new_chant_count, user_id, guild_id
            )

            response_text = f"You have logged {rounds} rounds. "
            if points_to_add > 0:
                response_text += f"You have also earned {points_to_add} points for your streak!"
            else:
                response_text += "You have already earned points for your streak today."
        
    await interaction.response.send_message(response_text, ephemeral=True)


@bot.tree.command(name="profile", description="View your Sadhana profile and progress.")
async def show_profile(interaction: discord.Interaction):
    user_id = interaction.user.id
    guild_id = interaction.guild.id
    
    async with db_pool.acquire() as connection:
        profile = await connection.fetchrow(
            "SELECT * FROM sadhanas WHERE user_id = $1 AND guild_id = $2 AND status = 'active'",
            user_id, guild_id
        )

        if not profile:
            await interaction.response.send_message("You are not in an active sadhana. Use `/chant` to begin!", ephemeral=True)
            return

        streak_points = profile['streak']
        chant_count = profile['chant_count']
        
        embed = discord.Embed(
            title=f"Sadhana Profile for {interaction.user.display_name}",
            description="Your personal sadhana journey.",
            color=discord.Color.orange()
        )
        embed.add_field(name="Total Streak Score", value=f"**{streak_points}** points", inline=True)
        embed.add_field(name="Total Rounds Chanted", value=f"**{chant_count}** rounds", inline=True)
        
        await interaction.response.send_message(embed=embed)


@bot.tree.command(name="leaderboard", description="View the top Sadhana devotees in this server.")
async def show_leaderboard(interaction: discord.Interaction):
    guild_id = interaction.guild.id
    
    async with db_pool.acquire() as connection:
        # Get the top 10 devotees by streak in the current guild
        leaderboard = await connection.fetch(
            """
            SELECT user_id, streak, chant_count
            FROM sadhanas
            WHERE guild_id = $1 AND status = 'active'
            ORDER BY streak DESC, chant_count DESC
            LIMIT 10
            """,
            guild_id
        )
        
    if not leaderboard:
        await interaction.response.send_message("There are no active Sadhana devotees in this server yet! Be the first one by using `/chant`.", ephemeral=True)
        return
        
    embed = discord.Embed(
        title="Sadhana Leaderboard",
        description="Top devotees by Streak Score.",
        color=discord.Color.gold()
    )
    
    rank = 1
    for entry in leaderboard:
        user_id = entry['user_id']
        streak_points = entry['streak']
        chant_count = entry['chant_count']
        
        try:
            user = await bot.fetch_user(user_id)
            user_name = user.display_name
        except discord.NotFound:
            user_name = "Unknown User"
            
        embed.add_field(
            name=f"#{rank}. {user_name}",
            value=f"Score: **{streak_points}** points ({chant_count} rounds)",
            inline=False
        )
        rank += 1
        
    await interaction.response.send_message(embed=embed)


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
    logging.error(f"HTTPException: Failed to connect to Discord. Check your token. {e}")
except Exception as e:
    logging.error(f"An unexpected error occurred: {e}")
