#!/bin/bash

DB_FILE="database.sqlite"
SQL_FILE="bot_data_export.sql"
# A flag file to check if import has already run
IMPORT_DONE_FLAG=".import_done"

echo "Running startup script..."

# Check if the SQLite database file exists (created by the bot on first run)
if [ ! -f "$DB_FILE" ]; then
  echo "$DB_FILE not found. The bot needs to run once to create it."
  echo "Please ensure the bot runs at least once with the SQLite config."
  # Exit or continue, depending on if you want the main app to start anyway
  # For now, we'll assume the bot will create it on its first real start after deploy
  # If you stopped after it created the empty DB, this message is just informative.
fi

# Check if the import flag file exists
if [ -f "$IMPORT_DONE_FLAG" ]; then
  echo "Data import already performed. Skipping import."
else
  # Check if the SQL export file exists
  if [ -f "$SQL_FILE" ]; then
    echo "Importing data from $SQL_FILE into $DB_FILE..."
    # Execute the import command
    sqlite3 "$DB_FILE" < "$SQL_FILE"

    # Check if the import command was successful
    if [ $? -eq 0 ]; then
      echo "Data import successful."
      # Create the flag file so the import doesn't run again
      touch "$IMPORT_DONE_FLAG"
      echo "Created import flag file: $IMPORT_DONE_FLAG"
    else
      echo "Error during data import!"
      # Depending on how critical this is, you might want to exit here
      # exit 1
    fi
  else
    echo "SQL export file ($SQL_FILE) not found in the repository. Skipping import."
  fi
fi

echo "Startup script finished."

# Now execute the original command to start the Node.js application
# Render's Start Command might handle this chaining, but explicit is safer
# If Render's Start Command is just this script, you'll put the node command *after* this script call in Render's config.