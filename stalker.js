const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const configFilePath = path.join(__dirname, 'config.json');
const namesFilePath = 'data.json';

let usernameMap = new Map();

// Default configuration
const defaultConfig = {
    apiKey: 'steam api key',
    intervalMinutes: 60,
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
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    // Initial load of the username map from the JSON file
    loadUsernameMap();
    checkSteamProfiles();
    setInterval(checkSteamProfiles, intervalMinutes * 60 * 1000); // Set interval based on config
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
            const addResponse = addSteamId(steamId);
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
function addSteamId(steamId) {
    loadUsernameMap();
    if (!usernameMap.has(steamId)) {
        usernameMap.set(steamId, { names: [], data: {} });
        saveUsernameMap();
        return `Steam ID ${steamId} added successfully.`;
    } else {
        return `Steam ID ${steamId} already exists.`;
    }
}

// Function to remove a Steam ID
function removeSteamId(steamId) {
    loadUsernameMap();
    if (usernameMap.has(steamId)) {
        usernameMap.delete(steamId);
        saveUsernameMap();
        return `Steam ID ${steamId} removed successfully.`;
    } else {
        return `Steam ID ${steamId} not found.`;
    }
}

// Function to resolve a Steam ID from a community link or SteamID64
async function resolveSteamId(input) {
    if (/^\d{17}$/.test(input)) {
        return input;
    } else if (input.includes('steamcommunity.com')) {
        const vanityUrlMatch = input.match(/\/id\/([^\/]+)/);
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
    const entry = usernameMap.get(steamId);
    if (entry && entry.names && entry.names[entry.names.length - 1] !== currentName) {
        const originalName = entry.names[0];
        const previousName = entry.names[entry.names.length - 1];
        sendDiscordNotification(originalName, previousName, currentName, steamId, entry.names.length > 1);
    }
    updateUsernameMap(steamId, currentName, entry.data);
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
async function checkSteamProfiles() {
    const steamIds = Array.from(usernameMap.keys());
    for (const id of steamIds) {
        try {
            const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${id}`;
            const playerSummaryResponse = await axios.get(playerSummaryUrl);
            const player = playerSummaryResponse.data.response.players[0];
            const currentName = player.personaname;

            const playerLevelUrl = `http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${apiKey}&steamid=${id}`;
            const playerLevelResponse = await axios.get(playerLevelUrl);
            const steamLevel = playerLevelResponse.data.response.player_level;

            const playerBansUrl = `http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${id}`;
            const playerBansResponse = await axios.get(playerBansUrl);
            const playerBans = playerBansResponse.data.players[0];

            const ownedGamesUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${id}&include_appinfo=true&include_played_free_games=true`;
            const ownedGamesResponse = await axios.get(ownedGamesUrl);
            const rustGame = ownedGamesResponse.data.response.games.find(game => game.appid === 252490);
            const rustHours = rustGame ? rustGame.playtime_forever / 60 : 0;

            const friendsUrl = `http://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${id}&relationship=friend`;
            const friendsResponse = await axios.get(friendsUrl);
            const friendsCount = friendsResponse.data.friendslist ? friendsResponse.data.friendslist.friends.length : 0;

            const newData = {
                accountCreated: player.timecreated,
                steamLevel: steamLevel,
                rustHours: rustHours,
                friendsCount: friendsCount,
                gameBans: playerBans.NumberOfGameBans,
                lastGameBan: playerBans.NumberOfGameBans > 0 ? playerBans.GameBanDate : null,
                vacBans: playerBans.NumberOfVACBans,
                lastVacBan: playerBans.NumberOfVACBans > 0 ? playerBans.DaysSinceLastBan : null,
                lastOnline: player.lastlogoff,
                profileStatus: player.communityvisibilitystate === 3 ? 'public' : 'private'
            };

            updateUsernameMap(id, currentName, newData); // Update map before checking for username change
            checkForUsernameChange(id, currentName);
        } catch (error) {
            console.error('Error fetching Steam profile:', error);
        }
    }
}
