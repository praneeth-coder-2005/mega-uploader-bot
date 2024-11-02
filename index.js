// index.js

const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const Mega = require('megajs');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://mega-uploader-bot.onrender.com';

let megaStorage = null;  // Store MEGA connection
let isLoggedIn = false;  // Track login state
let awaitingEmail = false;
let awaitingPassword = false;
let awaitingRename = false;
let email = "";
let rename = "";

// Set webhook for Telegram bot
bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`);
app.use(bot.webhookCallback('/bot'));

// Root route to confirm bot is running
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Start command to prompt for email
bot.start((ctx) => {
  isLoggedIn = false;
  awaitingEmail = true;
  awaitingPassword = false;
  ctx.reply("Welcome to the MEGA uploader bot! Please enter your MEGA account email to begin:");
});

// Handle email entry
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (awaitingEmail) {
    email = text;
    awaitingEmail = false;
    awaitingPassword = true;
    ctx.reply("Thank you! Now, please enter your MEGA account password:");
  } else if (awaitingPassword) {
    const password = text;
    ctx.reply("Logging in to MEGA...");

    // Attempt to log in to MEGA
    megaStorage = new Mega.Storage({
      email,
      password,
    });

    megaStorage.on('ready', () => {
      isLoggedIn = true;
      awaitingPassword = false;
      ctx.reply("You are now logged in to MEGA! Send a file link or attachment to upload, or type 'rename' to specify a custom name.");
    });

    megaStorage.on('error', (error) => {
      console.error("Login error:", error);
      ctx.reply("Login failed. Please use /start to try again.");
      isLoggedIn = false;
    });
  } else if (text.toLowerCase() === 'rename') {
    awaitingRename = true;
    ctx.reply("Please enter the new name you want for the uploaded file:");
  } else if (awaitingRename) {
    rename = text;
    awaitingRename = false;
    ctx.reply(`New file name set to: ${rename}`);
  } else if (isLoggedIn && text.startsWith('http')) {
    ctx.reply("Fetching file details...");

    try {
      const response = await axios.head(text); // Get file metadata without downloading
      const fileSize = parseInt(response.headers['content-length'], 10);
      const originalFilename = text.split('/').pop();
      const filename = rename || originalFilename; // Use renamed file or original filename

      if (!fileSize || isNaN(fileSize)) {
        ctx.reply("Error: Unable to retrieve file size. Please check the link and try again.");
        return;
      }

      ctx.reply("Starting download...");

      // Start streaming the file
      const downloadResponse = await axios.get(text, { responseType: 'stream' });
      let downloadedBytes = 0;
      let startTime = Date.now();

      const upload = megaStorage.upload({ name: filename, size: fileSize });

      downloadResponse.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const percentage = ((downloadedBytes / fileSize) * 100).toFixed(2);
        const elapsedTime = (Date.now() - startTime) / 1000; // seconds
        const speed = (downloadedBytes / elapsedTime / 1024).toFixed(2); // KB/s

        ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.message.message_id,
          undefined,
          `Download Progress: ${percentage}% (${speed} KB/s)`
        );
      });

      downloadResponse.data.pipe(upload);

      upload.on('complete', () => {
        ctx.reply(`File uploaded to MEGA as: ${filename}`);
      });

      upload.on('error', (error) => {
        console.error("Upload error:", error);
        ctx.reply("There was an error uploading your file to MEGA.");
      });
    } catch (error) {
      console.error("Error processing link:", error);
      ctx.reply("There was an error processing your link.");
    }
  } else if (!isLoggedIn) {
    ctx.reply("Please log in first by using /start.");
  }
});

// Handle file uploads
bot.on('document', async (ctx) => {
  if (!isLoggedIn) {
    return ctx.reply("Please log in first by using /start.");
  }

  try {
    const fileId = ctx.message.document.file_id;
    const fileLink = await bot.telegram.getFileLink(fileId);
    ctx.reply("Fetching file details...");

    const response = await axios.head(fileLink); // Get file metadata
    const fileSize = parseInt(response.headers['content-length'], 10);
    const originalFilename = ctx.message.document.file_name;
    const filename = rename || originalFilename;

    if (!fileSize || isNaN(fileSize)) {
      ctx.reply("Error: Unable to retrieve file size. Please try again.");
      return;
    }

    ctx.reply("Starting upload to MEGA...");

    let uploadedBytes = 0;
    let startTime = Date.now();

    // Stream file to MEGA
    const downloadResponse = await axios.get(fileLink, { responseType: 'stream' });
    const upload = megaStorage.upload({ name: filename, size: fileSize });

    downloadResponse.data.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      const percentage = ((uploadedBytes / fileSize) * 100).toFixed(2);
      const elapsedTime = (Date.now() - startTime) / 1000;
      const speed = (uploadedBytes / elapsedTime / 1024).toFixed(2); // KB/s

      ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.message.message_id,
        undefined,
        `Upload Progress: ${percentage}% (${speed} KB/s)`
      );
    });

    downloadResponse.data.pipe(upload);

    upload.on('complete', () => {
      ctx.reply(`File uploaded to MEGA as: ${filename}`);
    });

    upload.on('error', (error) => {
      console.error("Upload error:", error);
      ctx.reply("There was an error uploading your file to MEGA.");
    });
  } catch (error) {
    console.error("Error handling document:", error);
    ctx.reply("There was an error processing your file.");
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});
