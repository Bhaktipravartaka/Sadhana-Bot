#!/bin/bash

# Define the flag file to indicate import has been done
IMPORT_FLAG="/opt/render/project/.import_done"
DB_FILE="database.sqlite"
SQL_FILE="bot_data_export.sql"

# Check if the import flag exists
if [ -f "$IMPORT_FLAG" ]; then
    echo "Import flag found. Skipping data import."
    # Exit the script, allowing the main 'node index.js' command to run next
    exit 0
fi

echo "Import flag not found. Proceeding with data import."

# Ensure the SQL export file exists
if [ ! -f "$SQL_FILE" ]; then
    echo "Error: $SQL_FILE not found. Cannot import data."
    # Exit with an error code if the SQL file is missing
    exit 1
fi

# Run the Node.js app briefly in the background to create the database file and tables
# We use '&' to run in the background
echo "Starting Node.js briefly in background to create database file and tables..."
node index.js &

# Capture the Process ID (PID) of the background Node.js process
NODE_PID=$!

# Wait for a few seconds to give Node.js/Sequelize time to create the database and tables
# Adjust the sleep time if needed, but start with 10-15 seconds
echo "Waiting for 15 seconds for database initialization..."
sleep 15

# Check if the database file was created
if [ ! -f "$DB_FILE" ]; then
    echo "Error: $DB_FILE was not created by the background Node.js process."
    kill $NODE_PID # Attempt to stop the background process
    exit 1
fi

# Now that the database file and tables *should* exist, run the import
echo "Attempting to import data from $SQL_FILE into $DB_FILE..."
# Use -batch for non-interactive mode with sqlite3
if sqlite3 "$DB_FILE" -batch < "$SQL_FILE"; then
    echo "Data import successful!"
    # Create the flag file to prevent future imports
    touch "$IMPORT_FLAG"
else
    echo "Error during data import!"
    # Note: If import fails, the flag is NOT created, so it will be attempted again on next deploy.
    # This is intentional to keep trying until it succeeds.
    kill $NODE_PID # Attempt to stop the background process
    exit 1 # Exit with error code
fi

# Stop the background Node.js process
echo "Stopping background Node.js process (PID: $NODE_PID)..."
kill $NODE_PID

# Wait for the background process to actually terminate
wait $NODE_PID 2>/dev/null
echo "Startup script finished."

# The script now exits. Render will then execute the primary 'node index.js' command.