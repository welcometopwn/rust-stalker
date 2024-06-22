const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
const interval = debug ? 5000 : intervalMinutes * 60 * 1000;

// Discord client setup
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
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
            await handleAddCommand(message, args);
            break;
        case 'remove':
            handleRemoveCommand(message, args);
            break;
        case 'list':
            handleListCommand(message);
            break;
        case 'check':
            await handleCheckCommand(message, args);
            break;
        default:
            message.reply('Unknown command.');
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    
    const steamId = interaction.customId.split('_')[1];
    const notes = interaction.fields.getTextInputValue('notesInput');
    
    const addResponse = await addSteamId(steamId, notes);
    await interaction.reply(addResponse);
    checkSteamProfiles(); // Check the profile immediately after adding
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
    try {
        fs.writeFileSync(namesFilePath, json, 'utf8');
        if (debug) console.log('Successfully saved username map to data.json');
    } catch (error) {
        console.error('Error saving username map to data.json:', error);
    }
}

// Function to handle add command
async function handleAddCommand(message, args) {
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
}

// Function to handle remove command
function handleRemoveCommand(message, args) {
    if (args.length < 1) {
        message.reply('Please provide a Steam ID.');
        return;
    }
    const removeResponse = removeSteamId(args[0]);
    message.reply(removeResponse);
}

// Function to handle list command
function handleListCommand(message) {
    const listResponse = listSteamIds();
    message.reply(listResponse);
}

// Function to handle check command
async function handleCheckCommand(message, args) {
    if (args.length < 1) {
        message.reply('Please provide a Steam ID or Steam community link.');
        return;
    }
    const steamId = await resolveSteamId(args[0]);
    if (!steamId) {
        message.reply('Invalid Steam ID or Steam community link.');
        return;
    }
    await checkSteamProfile(message, steamId);
}

// Function to add a Steam ID
async function addSteamId(steamId, notes) {
    loadUsernameMap();

    const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
    try {
        const playerSummaryResponse = await axios.get(playerSummaryUrl);
        const player = playerSummaryResponse.data.response.players[0];
        const currentName = player.personaname;

        if (!usernameMap.has(steamId)) {
            usernameMap.set(steamId, { names: [currentName], data: {}, notes: notes });
            saveUsernameMap();
            removedIds.delete(steamId);
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
        const currentName = usernameMap.get(steamId).names[0];
        usernameMap.delete(steamId);
        saveUsernameMap();
        removedIds.add(steamId);
        return `[${currentName}](<https://steamcommunity.com/profiles/${steamId}>) (${steamId}) has been removed.`;
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
            return profileUrlMatch[1];
        }
    }
    return null;
}

// Function to update username map with new name and data
function updateUsernameMap(steamId, newName, newData) {
    loadUsernameMap();
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
        entry.data = { ...entry.data, ...newData };
        usernameMap.set(steamId, entry);
    }
    saveUsernameMap();
}

// Function to check for username change and send notification
function checkForUsernameChange(steamId, currentName) {
    loadUsernameMap();
    const entry = usernameMap.get(steamId);
    if (entry && entry.names && entry.names[entry.names.length - 1] !== currentName) {
        const originalName = entry.names[0];
        const previousName = entry.names[entry.names.length - 1];
        sendDiscordNotification(originalName, previousName, currentName, steamId, entry.names.length > 1);
    }
    updateUsernameMap(steamId, currentName, entry ? entry.data : {});
}

// Function to send a notification via Discord
function sendDiscordNotification(originalName, oldName, newName, steamId, showOriginal) {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const notificationContent = showOriginal
        ? `${oldName} (og: ${originalName}) has changed their name to [${newName}](<${profileUrl}>)`
        : `${oldName} has changed their name to [${newName}](<${profileUrl}>)`;

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
    const steamIds = Array.from(usernameMap.keys()).filter(id => !removedIds.has(id));
    if (steamIds.length === 0) return;

    const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamIds.join(',')}`;
    try {
        const playerSummaryResponse = await axios.get(playerSummaryUrl);
        const players = playerSummaryResponse.data.response.players;

        // Fetch player bans in parallel
        const playerBansUrl = `http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${steamIds.join(',')}`;
        const playerBansResponse = await axios.get(playerBansUrl);
        const playerBans = playerBansResponse.data.players.reduce((acc, ban) => {
            acc[ban.SteamId] = ban;
            return acc;
        }, {});

        for (const player of players) {
            const steamId = player.steamid;
            const currentName = player.personaname;
            const bans = playerBans[steamId];

            // Default values if data is not available
            let steamLevel = null;
            let rustHours = 0;
            let friendsCount = 0;

            // Fetch additional data if profile is public
            if (player.communityvisibilitystate === 3) { // Profile is public
                try {
                    const [playerLevelResponse, ownedGamesResponse, friendsResponse] = await Promise.all([
                        axios.get(`http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${apiKey}&steamid=${steamId}`),
                        axios.get(`http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`),
                        axios.get(`http://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamId}&relationship=friend`)
                    ]);

                    steamLevel = playerLevelResponse.data.response.player_level;
                    rustHours = (ownedGamesResponse.data.response.games?.find(game => game.appid === 252490)?.playtime_forever || 0) / 60;
                    friendsCount = friendsResponse.data.friendslist?.friends.length || 0;
                } catch (error) {
                    console.error('Error fetching additional data for public profile:', error);
                }
            }

            const newData = {
                accountCreated: player.timecreated || null,
                steamLevel: steamLevel,
                rustHours: rustHours,
                friendsCount: friendsCount,
                gameBans: bans.NumberOfGameBans || 0,
                lastGameBan: bans.NumberOfGameBans > 0 ? bans.GameBanDate : null,
                vacBans: bans.NumberOfVACBans || 0,
                lastVacBan: bans.NumberOfVACBans > 0 ? bans.DaysSinceLastBan : null,
                lastOnline: player.lastlogoff || null,
                profileStatus: player.communityvisibilitystate === 3 ? 'Public' : 'Private',
            };

            checkForUsernameChange(steamId, currentName);
            updateUsernameMap(steamId, currentName, newData);
        }
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.error('Unauthorized request. Check your API key.');
        } else {
            console.error('Error fetching Steam profiles:', error);
        }
    }
}

// Function to check a Steam profile and send an embed to Discord
async function checkSteamProfile(message, steamId) {
    try {
        const playerSummaryUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
        const playerSummaryResponse = await axios.get(playerSummaryUrl);
        const player = playerSummaryResponse.data.response.players[0];

        if (!player) {
            message.reply(`No summary available for Steam ID ${steamId}`);
            return;
        }

        const currentName = player.personaname;

        let steamLevel = null;
        try {
            const playerLevelUrl = `http://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${apiKey}&steamid=${steamId}`;
            const playerLevelResponse = await axios.get(playerLevelUrl);
            steamLevel = playerLevelResponse.data.response.player_level;
        } catch (error) {
            if (debug) console.error('Error fetching Steam level:', error);
        }

        let playerBans = {};
        try {
            const playerBansUrl = `http://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${apiKey}&steamids=${steamId}`;
            const playerBansResponse = await axios.get(playerBansUrl);
            playerBans = playerBansResponse.data.players[0];
        } catch (error) {
            if (debug) console.error('Error fetching player bans:', error);
        }

        let rustHours = 0;
        try {
            const ownedGamesUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`;
            const ownedGamesResponse = await axios.get(ownedGamesUrl);
            const rustGame = ownedGamesResponse.data.response.games?.find(game => game.appid === 252490);
            rustHours = rustGame ? rustGame.playtime_forever / 60 : 0;
        } catch (error) {
            if (debug) console.error('Error fetching owned games:', error);
        }

        let friendsCount = 0;
        try {
            const friendsUrl = `http://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamId}&relationship=friend`;
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
            profileStatus: player.communityvisibilitystate === 3 ? 'Public' : 'Private',
        };

        const accountAge = calculateAccountAge(newData.accountCreated);
        const lastOnlineFormatted = formatLastOnline(newData.lastOnline);
        const notes = usernameMap.get(steamId)?.notes || 'No notes available';

        const embed = new EmbedBuilder()
            .setAuthor({
                name: currentName,
                url: `https://steamcommunity.com/profiles/${steamId}`,
                iconURL: player.avatar
            })
            .addFields(
                { name: "Historical Names", value: usernameMap.get(steamId)?.names.join(", ") || "No historical names", inline: true },
                { name: "Steam Level", value: steamLevel ? steamLevel.toString() : "Unknown", inline: true },
                { name: "Account Age", value: accountAge, inline: true },
                { name: "VAC Bans", value: newData.vacBans > 0 ? `${newData.vacBans} (${newData.lastVacBan} days ago)` : "0", inline: true },
                { name: "Game Bans", value: newData.gameBans > 0 ? `${newData.gameBans} (${newData.lastGameBan} days ago)` : "0", inline: true },
                { name: "Friends", value: friendsCount.toString(), inline: true },
                { name: "Rust Hours", value: rustHours.toFixed(0), inline: true },
                { name: "Profile Status", value: newData.profileStatus, inline: true },
                { name: "Last Online", value: lastOnlineFormatted, inline: true }
            )
            .setColor("#00b0f4")
            .setFooter({ text: `Steam ID: ${steamId}` })
            .setTimestamp();

        if (usernameMap.has(steamId)) {
            embed.addFields({ name: "Notes", value: "```" + `${notes}` + "```", inline: false });
        }

        const actionRow = new ActionRowBuilder();

        loadUsernameMap();
        if (!usernameMap.has(steamId)) {
            actionRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`add_${steamId}`)
                    .setLabel('Track Profile')
                    .setStyle(ButtonStyle.Primary)
            );
        }

        const replyMessage = await message.reply({ embeds: [embed], components: actionRow.components.length ? [actionRow] : [] });

        // Handle button interactions
        const filter = i => i.customId === `add_${steamId}` && i.user.id === message.author.id;
        const collector = replyMessage.createMessageComponentCollector({ filter, time: 60000 });

        collector.on('collect', async i => {
            if (i.customId === `add_${steamId}`) {
                // Create and show the modal to get notes from the user
                const modal = new ModalBuilder()
                    .setCustomId(`addNotes_${steamId}`)
                    .setTitle('Add Notes for Steam Profile');

                const notesInput = new TextInputBuilder()
                    .setCustomId('notesInput')
                    .setLabel('Notes')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(notesInput)
                );

                await i.showModal(modal);
            }
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                replyMessage.edit({ components: [] });
            }
        });
    } catch (error) {
        console.error('Error checking Steam profile:', error);
        message.reply(`Failed to check the Steam profile for Steam ID ${steamId}.`);
    }
}

function calculateAccountAge(accountCreatedTimestamp) {
    if (!accountCreatedTimestamp) return "Unknown";
    
    const now = new Date();
    const accountCreated = new Date(accountCreatedTimestamp * 1000);
    let years = now.getFullYear() - accountCreated.getFullYear();
    let months = now.getMonth() - accountCreated.getMonth();
    let days = Math.floor((now - accountCreated) / (1000 * 60 * 60 * 24));

    if (months < 0) {
        years--;
        months += 12;
    }

    return `${years} years, ${months} months (${days} days)`;
}


function formatLastOnline(lastOnlineTimestamp) {
    if (!lastOnlineTimestamp) return "Unknown";
    const lastOnline = new Date(lastOnlineTimestamp * 1000);
    const now = new Date();
    const daysAgo = Math.floor((now - lastOnline) / (1000 * 60 * 60 * 24));
    const hoursAgo = Math.floor((now - lastOnline) / (1000 * 60 * 60));
    const minutesAgo = Math.floor((now - lastOnline) / (1000 * 60));

    if (daysAgo > 0) {
        return `${lastOnline.toLocaleDateString('en-GB')} ${lastOnline.toLocaleTimeString('en-GB')} (${daysAgo} days ago)`;
    } else if (hoursAgo > 0) {
        return `${lastOnline.toLocaleDateString('en-GB')} ${lastOnline.toLocaleTimeString('en-GB')} (${hoursAgo} hours ago)`;
    } else {
        return `${lastOnline.toLocaleDateString('en-GB')} ${lastOnline.toLocaleTimeString('en-GB')} (${minutesAgo} minutes ago)`;
    }
}

// Function to list all Steam IDs with their current name, original name, and notes
function listSteamIds() {
    loadUsernameMap();
    let listMessage = '';
    usernameMap.forEach((value, key) => {
        const currentName = value.names[value.names.length - 1];
        const originalName = value.names[0];
        const notes = value.notes || 'no notes';
        listMessage += `${currentName} (og: ${originalName}) (${key}) - ${notes}\n`;
    });
    return listMessage || 'No players found.';
}
