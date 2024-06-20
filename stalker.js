const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const configFilePath = path.join(__dirname, 'config.json');
const steamIdsFilePath = 'steam_ids.txt';
const namesFilePath = 'data.json';

let usernameMap = new Map();

// Default configuration
const defaultConfig = {
    apiKey: 'steam api key',
    intervalMinutes: 2,
    discordToken: 'your_discord_bot_token',
    channelId: 'your_channel_id'
};

// Function to load configuration
function loadConfig() {
    if (!fs.existsSync(configFilePath)) {
        fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        return defaultConfig;
    } else {
        const data = fs.readFileSync(configFilePath, 'utf8');
        return JSON.parse(data);
    }
}

const config = loadConfig();
const { apiKey, intervalMinutes, discordToken, channelId } = config;

// Discord client setup
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    // Initial load of the username map from the JSON file
    loadUsernameMap();
    checkSteamProfiles();
    setInterval(checkSteamProfiles, intervalMinutes * 60 * 1000); // Set interval based on config
});

client.login(discordToken);

// Function to load username map from JSON file
function loadUsernameMap() {
    if (fs.existsSync(namesFilePath)) {
        const data = fs.readFileSync(namesFilePath, 'utf8');
        const json = JSON.parse(data);
        usernameMap = new Map(Object.entries(json));
    }
}

// Function to save username map to JSON file
function saveUsernameMap() {
    const json = JSON.stringify(Object.fromEntries(usernameMap), null, 2);
    fs.writeFileSync(namesFilePath, json, 'utf8');
}

// Function to update username map with new name
function updateUsernameMap(steamId, newName) {
    if (!usernameMap.has(steamId)) {
        usernameMap.set(steamId, [newName]);
    } else {
        const names = usernameMap.get(steamId);
        if (names[names.length - 1] !== newName) {
            names.push(newName);
            usernameMap.set(steamId, names);
        }
    }
    saveUsernameMap();
}

// Function to get original name of a Steam ID
function getOriginalName(steamId) {
    const names = usernameMap.get(steamId);
    return names ? names[0] : null;
}

// Function to check for username change and send notification
function checkForUsernameChange(steamId, currentName) {
    const names = usernameMap.get(steamId);
    if (names && names[names.length - 1] !== currentName) {
        const originalName = names[0];
        const previousName = names[names.length - 1];
        sendDiscordNotification(originalName, previousName, currentName, steamId, names.length > 1);
    }
    updateUsernameMap(steamId, currentName);
}

// Function to send a notification via Discord
function sendDiscordNotification(originalName, oldName, newName, steamId, showOriginal) {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const notificationContent = showOriginal
        ? `${oldName} (og: ${originalName}) has changed their name to [${newName}](${profileUrl})`
        : `${oldName} has changed their name to [${newName}](${profileUrl})`;

    const channel = client.channels.cache.get(channelId);
    if (channel) {
        channel.send(notificationContent).catch(err => {
            console.error('Error sending message to Discord:', err);
        });
    } else {
        console.error('Channel not found');
    }
}

// Function to fetch and process Steam profiles
function checkSteamProfiles() {
    fs.readFile(steamIdsFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading Steam IDs file:', err);
            return;
        }

        const steamIds = data.split('\n').filter(id => id.trim());
        steamIds.forEach(id => {
            const url = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${id}`;
            axios.get(url)
                .then(response => {
                    const player = response.data.response.players[0];
                    const currentName = player.personaname;
                    checkForUsernameChange(id, currentName);
                })
                .catch(error => {
                    console.error('Error fetching Steam profile:', error);
                });
        });
    });
}
