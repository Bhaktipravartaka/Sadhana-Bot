// dataManager.js
const fs = require('fs/promises');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'sadhana_data.json');

async function loadData() {
    try {
        const fileContent = await fs.readFile(DATA_FILE, 'utf-8');
        if (!fileContent.trim()) {
            return { logs: {}, streaks: {} };
        }
        return JSON.parse(fileContent);
    } catch (err) {
        console.error('Error loading data:', err);
        return { logs: {}, streaks: {} };
    }
}

module.exports = { loadData };
