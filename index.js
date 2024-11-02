// index.js

const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');
const Mega = require('megajs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = 'https://mega-uploader-bot.onrender.com';

let megaStorage = null; // Store MEGA connection
let isLoggedIn = false;
let email = "";
let rename = "";

// Set webhook for Telegram bot
bot.telegram.setWebhook(`${WEBHOOK_URL}/bot`);
app.use(bot.webhookCallback('/bot'));

// Root route to confirm bot is running
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Start command: prompts for login if not already done
bot.start((ctx) => {
  if (isLoggedIn) {
    ctx.reply("You are already logged in! Send a file link or attachment to upload.");
  } else {
    ctx.reply("Welcome! Please enter your MEGA account email to begin:");
  }
});

// Handle user input
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (!isLoggedIn && !email) {
    email = text;
    ctx.reply("Thank you! Now, please enter your MEGA account password:");
  } else if (!isLoggedIn && email) {
    const password = text;
    ctx.reply("Logging in to MEGA...");

    // Attempt to log in to MEGA
    megaStorage = new Mega.Storage({ email, password });
    megaStorage.on('ready', () => {
      isLoggedIn = true;
      ctx.reply("You are now logged in to MEGA! Send a file link or attachment to upload, or type 'rename' to specify a custom name.");
    });
    megaStorage.on('error', (error) => {
      console.error("Login error:", error);
      ctx.reply("Login failed. Please use /start to try again.");
      isLoggedIn = false;
      email = ""; // reset email to re-prompt if needed
    });
  } else if (text.toLowerCase() === 'rename') {
    ctx.reply("Please enter the new name you want for the uploaded file:");
  } else if (rename === "") {
    rename = text;
    ctx.reply(`New file name set to: ${rename}`);
  } else if (isLoggedIn && text.startsWith('http')) {
    handleFileUpload(ctx, text);
  }
});

// Handle file uploads
bot.on('document', async (ctx) => {
  if (isLoggedIn) {
    const fileLink = await bot.telegram.getFileLink(ctx.message.document.file_id);
    handleFileUpload(ctx, fileLink);
  } else {
    ctx.reply("Please log in first by using /start.");
  }
});

// Function to handle file upload
async function handleFileUpload(ctx, fileUrl) {
  try {
    const response = await axios.head(fileUrl);
    const fileSize = parseInt(response.headers['content-length'], 10);
    const originalFilename = fileUrl.split('/').pop();
    const filename = rename || originalFilename;

    if (!fileSize || isNaN(fileSize)) {
      ctx.reply("Error: Unable to retrieve file size. Please check the link and try again.");
      return;
    }

    ctx.reply("Starting download and upload to MEGA...");
    let downloadedBytes = 0;
    let startTime = Date.now();
    let progressMessageId = null;

    const downloadStream = await axios.get(fileUrl, { responseType: 'stream' });
    const upload = megaStorage.upload({ name: filename, size: fileSize });

    downloadStream.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const percentage = ((downloadedBytes / fileSize) * 100).toFixed(2);
      const elapsedTime = (Date.now() - startTime) / 1000;
      const speed = (downloadedBytes / elapsedTime / 1024).toFixed(2); // KB/s

      const progressMessage = `Download & Upload Progress: ${percentage}% (${speed} KB/s)`;

      if (!progressMessageId) {
        // Send the initial progress message
        ctx.reply(progressMessage).then((message) => {
          progressMessageId = message.message_id;
        });
      } else {
        // Edit the existing progress message
        ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMessageId,
          null,
          progressMessage
        );
      }
    });

    downloadStream.data.pipe(upload);

    upload.on('complete', () => {
      ctx.reply(`File uploaded to MEGA as: ${filename}`);
      rename = ""; // Reset rename after upload
    });

    upload.on('error', (error) => {
      console.error("Upload error:", error);
      ctx.reply("There was an error uploading your file to MEGA.");
    });
  } catch (error) {
    console.error("Error processing file:", error);
    ctx.reply("There was an error processing your file.");
  }
}

// Start Express server
app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});
