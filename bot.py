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
            db_pool = await asyncpg.create_pool(
                user=db_user,
                password=db_password,
                database=db_name,
                host=db_host,
                port=db_port,
                ssl='require'
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


@bot.tree.command(name="start", description="Start a new daily Sadhana challenge.")
@app_commands.describe(
    sadhana_name="The name of your Sadhana challenge.",
    duration="The duration of the challenge in days."
)
async def start_challenge(interaction: discord.Interaction, sadhana_name: str, duration: int):
    user_id = interaction.user.id
    guild_id = interaction.guild.id
    
    # Check if a user is already in a challenge in this guild
    async with db_pool.acquire() as connection:
        active_challenge = await connection.fetchval(
            "SELECT 1 FROM sadhanas WHERE user_id = $1 AND guild_id = $2 AND status = 'active'",
            user_id, guild_id
        )

        if active_challenge:
            await interaction.response.send_message("You are already in an active challenge. Complete it or use `/cancel` to start a new one.", ephemeral=True)
            return

        # Insert a new challenge, including the new chant_count
        start_date = datetime.date.today()
        end_date = start_date + datetime.timedelta(days=duration)
        await connection.execute(
            """
            INSERT INTO sadhanas (user_id, guild_id, sadhana_name, duration, start_date, end_date, streak, chant_count, last_check_in_date)
            VALUES ($1, $2, $3, $4, $5, $6, 0, 0, NULL)
            """,
            user_id, guild_id, sadhana_name, duration, start_date, end_date
        )

    embed = discord.Embed(
        title=f"Sadhana Challenge Started!",
        description=f"**{sadhana_name}** for **{duration} days**.",
        color=discord.Color.green()
    )
    embed.add_field(name="Started", value=start_date.strftime("%Y-%m-%d"), inline=True)
    embed.add_field(name="Ends", value=end_date.strftime("%Y-%m-%d"), inline=True)
    embed.add_field(name="Streak Score", value="0 points", inline=False)
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="chant", description="Track your chanting rounds for your current challenge.")
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

        if not challenge:
            await interaction.response.send_message("You are not in an active challenge. Use `/start` to begin one.", ephemeral=True)
            return

        # Check if the user has already received a streak point today
        last_check_in_date = challenge['last_check_in_date']
        points_to_add = 0
        if not last_check_in_date or last_check_in_date.date() != today:
            if now_ist < nine_am_ist:
                points_to_add = 2  # 1 base + 1 extra point
            else:
                points_to_add = 1  # 1 base point
            
            # Update last check in date and streak points
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


@bot.tree.command(name="cancel", description="Cancel your current Sadhana challenge.")
async def cancel_challenge(interaction: discord.Interaction):
    user_id = interaction.user.id
    guild_id = interaction.guild.id
    
    async with db_pool.acquire() as connection:
        challenge = await connection.fetchrow(
            "SELECT sadhana_name FROM sadhanas WHERE user_id = $1 AND guild_id = $2 AND status = 'active'",
            user_id, guild_id
        )

        if not challenge:
            await interaction.response.send_message("You are not in an active challenge to cancel.", ephemeral=True)
            return

        sadhana_name = challenge['sadhana_name']
        await connection.execute(
            "UPDATE sadhanas SET status = 'cancelled' WHERE user_id = $1 AND guild_id = $2",
            user_id, guild_id
        )
        await interaction.response.send_message(f"Your '{sadhana_name}' challenge has been successfully cancelled.", ephemeral=True)


@bot.tree.command(name="progress", description="View your current Sadhana challenge progress.")
async def show_progress(interaction: discord.Interaction):
    user_id = interaction.user.id
    guild_id = interaction.guild.id
    
    async with db_pool.acquire() as connection:
        challenge = await connection.fetchrow(
            "SELECT * FROM sadhanas WHERE user_id = $1 AND guild_id = $2 AND status = 'active'",
            user_id, guild_id
        )

        if not challenge:
            await interaction.response.send_message("You are not in an active challenge. Use `/start` to begin one.", ephemeral=True)
            return

        sadhana_name = challenge['sadhana_name']
        duration = challenge['duration']
        start_date = challenge['start_date'].date()
        streak_points = challenge['streak']
        days_passed = (datetime.date.today() - start_date).days + 1
        chant_count = challenge['chant_count']
        
        embed = discord.Embed(
            title=f"Sadhana Card for {interaction.user.display_name}",
            description=f"**{sadhana_name}** ({duration}-day challenge)",
            color=discord.Color.orange()
        )
        embed.add_field(name="Streak Score", value=f"{streak_points} points", inline=True)
        embed.add_field(name="Total Rounds Chanted", value=f"{chant_count} rounds", inline=True)
        embed.add_field(name="Started", value=start_date.strftime("%Y-%m-%d"), inline=False)
        embed.add_field(name="Days in Challenge", value=f"{days_passed}", inline=False)
        
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
        await interaction.response.send_message("There are no active Sadhana challenges in this server yet!", ephemeral=True)
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
