const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const configFilePath = path.join(__dirname, 'config.json');
const namesFilePath = 'data.json';

let usernameMap = new Map();
let removedIds = new Set();

// Default configuration
const defaultConfig = {
    apiKey: 'steam api key',
    intervalMinutes: 60,
    discordToken: 'your_discord_bot_token',
    channelId: 'your_channel_id',
    debug: false
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
const { apiKey, intervalMinutes, discordToken, channelId, debug } = config;

// Set interval based on debug mode
const interval = debug ? 10000 : intervalMinutes * 60 * 1000;

// Discord client setup
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    // Initial load of the username map from the JSON file
    loadUsernameMap();
    checkSteamProfiles();
    setInterval(checkSteamProfiles, interval);
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith('/')) return;

    const args = message.content.slice(1).split(' ');
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'add':
            if (args.length < 1) {
                message.reply('Please provide a Steam ID or Steam community link.');
                return;
            }
            const steamId = await resolveSteamId(args[0]);
            if (!steamId) {
                message.reply('Invalid Steam ID or Steam community link.');
                return;
            }
            const notes = args.slice(1).join(' ');
            const addResponse = await addSteamId(steamId, notes);
            message.reply(addResponse);
            checkSteamProfiles(); // Check the profile immediately after adding
            break;

        case 'remove':
            if (args.length < 1) {
                message.reply('Please provide a Steam ID.');
                return;
            }
            const removeResponse = removeSteamId(args[0]);
            message.reply(removeResponse);
            break;

        default:
            message.reply('Unknown command.');
    }
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

// Function to add a Steam ID
async function addSteamId(steamId, notes) {
    loadUsernameMap();

    // Fetch current username
    const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
    try {
        const playerSummaryResponse = await axios.get(playerSummaryUrl);
        const player = playerSummaryResponse.data.response.players[0];
        const currentName = player.personaname;

        if (!usernameMap.has(steamId)) {
            usernameMap.set(steamId, { names: [currentName], data: {}, notes: notes });
            saveUsernameMap();
            removedIds.delete(steamId); // Ensure the ID is not in the removed set
            return `[${currentName}](<https://steamcommunity.com/profiles/${steamId}>) (${steamId}) has been added.`;
        } else {
            return `Steam ID ${steamId} already exists.`;
        }
    } catch (error) {
        console.error('Error fetching Steam profile:', error);
        return `Failed to fetch the username for Steam ID ${steamId}.`;
    }
}

// Function to remove a Steam ID
function removeSteamId(steamId) {
    loadUsernameMap();
    if (usernameMap.has(steamId)) {
        const currentName = usernameMap.get(steamId).names[0]; // Get the first name in the names array
        usernameMap.delete(steamId);
        saveUsernameMap();
        removedIds.add(steamId); // Add the ID to the removed set
        return `[${currentName}](<https://steamcommunity.com/profiles/${steamId}>) (${steamId}) has been removed.`;
    } else {
        return `Steam ID ${steamId} not found.`;
    }
}

// Function to resolve a Steam ID from a community link or SteamID64
async function resolveSteamId(input) {
    if (/^\d{17}$/.test(input)) {
        // Input is already a SteamID64
        return input;
    } else if (input.includes('steamcommunity.com')) {
        const vanityUrlMatch = input.match(/\/id\/([^\/]+)/);
        const profileUrlMatch = input.match(/\/profiles\/(\d{17})/);

        if (vanityUrlMatch) {
            const vanityUrl = vanityUrlMatch[1];
            const resolveUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${apiKey}&vanityurl=${vanityUrl}`;
            try {
                const response = await axios.get(resolveUrl);
                if (response.data.response.success === 1) {
                    return response.data.response.steamid;
                }
            } catch (error) {
                console.error('Error resolving Steam community ID:', error);
            }
        } else if (profileUrlMatch) {
            // Directly extract the SteamID from the URL
            return profileUrlMatch[1];
        }
    }
    return null;
}

// Function to update username map with new name and data
function updateUsernameMap(steamId, newName, newData) {
    if (!usernameMap.has(steamId)) {
        usernameMap.set(steamId, { names: [newName], data: newData });
    } else {
        const entry = usernameMap.get(steamId);
        if (!entry.names) {
            entry.names = [];
        }
        if (entry.names[entry.names.length - 1] !== newName) {
            entry.names.push(newName);
        }
        entry.data = newData;
        usernameMap.set(steamId, entry);
    }
    saveUsernameMap();
}

// Function to get original name of a Steam ID
function getOriginalName(steamId) {
    const entry = usernameMap.get(steamId);
    return entry && entry.names ? entry.names[0] : null;
}

// Function to check for username change and send notification
function checkForUsernameChange(steamId, currentName) {
    loadUsernameMap(); // Ensure latest data is loaded
    const entry = usernameMap.get(steamId);
    console.log(`Checking for username change for Steam ID: ${steamId}`);
    if (entry && entry.names && entry.names[entry.names.length - 1] !== currentName) {
        console.log(`Username change detected for Steam ID: ${steamId}`);
        const originalName = entry.names[0];
        const previousName = entry.names[entry.names.length - 1];
        sendDiscordNotification(originalName, previousName, currentName, steamId, entry.names.length > 1);
    } else {
        console.log(`No username change detected for Steam ID: ${steamId}`);
    }
    updateUsernameMap(steamId, currentName, entry ? entry.data : {});
}

// Function to send a notification via Discord
function sendDiscordNotification(originalName, oldName, newName, steamId, showOriginal) {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const notificationContent = showOriginal
        ? `${oldName} (og: ${originalName}) has changed their name to [${newName}](${profileUrl})`
        : `${oldName} has changed their name to [${newName}](${profileUrl})`;

    const channel = client.channels.cache.get(channelId);
    if (channel) {
        console.log(`Sending Discord notification for Steam ID: ${steamId}`);
        channel.send(notificationContent).catch(err => {
            console.error('Error sending message to Discord:', err);
        });
    } else {
        console.error('Channel not found');
    }
}

// Function to fetch and process Steam profiles
async function checkSteamProfiles() {
    const steamIds = Array.from(usernameMap.keys());
    for (const id of steamIds) {
        if (removedIds.has(id)) {
            continue; // Skip IDs that have been removed
        }

        try {
            const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${id}`;
            const playerSummaryResponse = await axios.get(playerSummaryUrl);
            const player = playerSummaryResponse.data.response.players[0];

            // Check if the player summary is available
            if (!player) {
                console.error(`No summary available for Steam ID ${id}`);
                continue;
            }

            const currentName = player.personaname;

            // Fetch player level
            let steamLevel = null;
            try {
                const playerLevelUrl = `http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${apiKey}&steamid=${id}`;
                const playerLevelResponse = await axios.get(playerLevelUrl);
                steamLevel = playerLevelResponse.data.response.player_level;
            } catch (error) {
                if (debug) console.error('Error fetching Steam level:', error);
            }

            // Fetch player bans
            let playerBans = {};
            try {
                const playerBansUrl = `http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${id}`;
                const playerBansResponse = await axios.get(playerBansUrl);
                playerBans = playerBansResponse.data.players[0];
            } catch (error) {
                if (debug) console.error('Error fetching player bans:', error);
            }

            // Fetch owned games
            let rustHours = 0;
            try {
                const ownedGamesUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${id}&include_appinfo=true&include_played_free_games=true`;
                const ownedGamesResponse = await axios.get(ownedGamesUrl);
                const rustGame = ownedGamesResponse.data.response.games?.find(game => game.appid === 252490);
                rustHours = rustGame ? rustGame.playtime_forever / 60 : 0;
            } catch (error) {
                if (debug) console.error('Error fetching owned games:', error);
            }

            // Fetch friends list
            let friendsCount = 0;
            try {
                const friendsUrl = `http://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${id}&relationship=friend`;
                const friendsResponse = await axios.get(friendsUrl);
                friendsCount = friendsResponse.data.friendslist ? friendsResponse.data.friendslist.friends.length : 0;
            } catch (error) {
                if (debug) console.error('Error fetching friends list:', error);
            }

            const newData = {
                accountCreated: player.timecreated || null,
                steamLevel: steamLevel,
                rustHours: rustHours,
                friendsCount: friendsCount,
                gameBans: playerBans.NumberOfGameBans || 0,
                lastGameBan: playerBans.NumberOfGameBans > 0 ? playerBans.GameBanDate : null,
                vacBans: playerBans.NumberOfVACBans || 0,
                lastVacBan: playerBans.NumberOfVACBans > 0 ? playerBans.DaysSinceLastBan : null,
                lastOnline: player.lastlogoff || null,
                profileStatus: player.communityvisibilitystate === 3 ? 'public' : 'private',
                avatarhash: player.avatarhash || null
            };

            checkForUsernameChange(id, currentName); // Check for changes before updating
            updateUsernameMap(id, currentName, newData); // Update map after checking for username change
        } catch (error) {
            if (debug) console.error('Error fetching Steam profile:', error);
        }
    }
}
