require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const mega = require('megajs');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const dataFilePath = 'megaCredentials.json';
let megaStorage;
let userState = {}; // Tracks if the user is entering email or password

// Save MEGA credentials
function saveMegaCredentials(email, password) {
  fs.writeFileSync(dataFilePath, JSON.stringify({ email, password }));
}

// Load MEGA credentials
function loadMegaCredentials() {
  if (fs.existsSync(dataFilePath)) {
    return JSON.parse(fs.readFileSync(dataFilePath));
  }
  return null;
}

// Initialize MEGA storage
function initializeMega(ctx) {
  const credentials = loadMegaCredentials();
  if (!credentials || !credentials.email || !credentials.password) return ctx.reply('Incomplete MEGA credentials.');

  megaStorage = mega({
    email: credentials.email,
    password: credentials.password,
    autoload: true,
  });

  megaStorage.on('ready', () => ctx.reply('Connected to MEGA account successfully. You can now upload files.'));
  megaStorage.on('error', (error) => {
    console.error('Error connecting to MEGA:', error);
    ctx.reply('Failed to connect to MEGA. Please check your credentials.');
    userState[ctx.from.id] = 'email'; // Reset to email prompt in case of error
  });
}

// Start command - Initiate email input
bot.start((ctx) => {
  ctx.reply('Welcome! Please enter your MEGA email to get started.');
  userState[ctx.from.id] = 'email';
});

// Handle incoming messages for email and password setup
bot.on('text', (ctx) => {
  const userId = ctx.from.id;

  // Check if the user is in the "email" state
  if (userState[userId] === 'email') {
    const email = ctx.message.text.trim();
    if (!email.includes('@')) return ctx.reply('Invalid email format. Please try again.');

    // Save email and prompt for password
    const credentials = loadMegaCredentials() || {};
    credentials.email = email;
    saveMegaCredentials(credentials.email, credentials.password);
    ctx.reply('Email saved. Now, please enter your MEGA password.');
    userState[userId] = 'password';

  } else if (userState[userId] === 'password') {
    const password = ctx.message.text.trim();

    // Save password and attempt MEGA connection
    const credentials = loadMegaCredentials();
    credentials.password = password;
    saveMegaCredentials(credentials.email, credentials.password);
    ctx.reply('Password saved. Attempting to connect to MEGA...');
    
    initializeMega(ctx);
    userState[userId] = 'connected'; // Set state to connected after successful login

  } else if (userState[userId] === 'connected') {
    ctx.reply('You are connected to MEGA. You can now upload files by sending file links or attachments.');
  } else {
    ctx.reply('Please start the bot with /start to set up your credentials.');
  }
});

// Express server setup
const app = express();
app.listen(process.env.PORT || 3000, () => console.log(`Web server running`));

// Start bot
bot.launch();
