require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const mega = require('megajs');
const express = require('express');
const axios = require('axios');

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

  if (userState[userId] === 'email') {
    const email = ctx.message.text.trim();
    if (!email.includes('@')) return ctx.reply('Invalid email format. Please try again.');

    const credentials = loadMegaCredentials() || {};
    credentials.email = email;
    saveMegaCredentials(credentials.email, credentials.password);
    ctx.reply('Email saved. Now, please enter your MEGA password.');
    userState[userId] = 'password';

  } else if (userState[userId] === 'password') {
    const password = ctx.message.text.trim();

    const credentials = loadMegaCredentials();
    credentials.password = password;
    saveMegaCredentials(credentials.email, credentials.password);
    ctx.reply('Password saved. Attempting to connect to MEGA...');
    
    initializeMega(ctx);
    userState[userId] = 'connected';

  } else if (userState[userId] === 'connected') {
    ctx.reply('You are connected to MEGA. You can now upload files by sending file links or attachments.');
  } else {
    ctx.reply('Please start the bot with /start to set up your credentials.');
  }
});

// Handle file or link messages
bot.on('message', async (ctx) => {
  const userId = ctx.from.id;

  if (userState[userId] !== 'connected') {
    return ctx.reply('Please complete MEGA setup first by entering email and password.');
  }

  if (ctx.message.document) {
    const fileId = ctx.message.document.file_id;
    const fileName = ctx.message.document.file_name;
    const fileSize = ctx.message.document.file_size;

    ctx.reply(`Uploading file: ${fileName} (${fileSize} bytes)...`);

    try {
      const fileLink = await bot.telegram.getFileLink(fileId);
      const response = await axios({
        url: fileLink.href,
        method: 'GET',
        responseType: 'stream',
      });

      const uploadStream = megaStorage.upload(fileName);

      response.data.pipe(uploadStream);

      uploadStream.on('complete', () => {
        ctx.reply(`File uploaded successfully: ${fileName}`);
      });

      uploadStream.on('error', (error) => {
        console.error('Error uploading file:', error);
        ctx.reply('Error uploading your file. Please try again later.');
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      ctx.reply('There was an error downloading your file. Please try again later.');
    }

  } else if (ctx.message.text && ctx.message.text.startsWith('http')) {
    const url = ctx.message.text;

    ctx.reply('Attempting to download and upload the file from the provided link...');

    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
      });

      const fileName = url.split('/').pop().split('?')[0];
      const uploadStream = megaStorage.upload(fileName);

      response.data.pipe(uploadStream);

      uploadStream.on('complete', () => {
        ctx.reply(`File from link uploaded successfully: ${fileName}`);
      });

      uploadStream.on('error', (error) => {
        console.error('Error uploading file:', error);
        ctx.reply('Error uploading your file from the link. Please try again later.');
      });
    } catch (error) {
      console.error('Error downloading file from link:', error);
      ctx.reply('There was an error downloading the file from the link. Please check the link and try again.');
    }
  } else {
    ctx.reply('Please send a file or a valid URL to upload.');
  }
});

// Express server setup
const app = express();
app.listen(process.env.PORT || 3000, () => console.log(`Web server running`));

// Start bot
bot.launch();
