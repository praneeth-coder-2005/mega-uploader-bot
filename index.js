require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const mega = require('megajs');
const fetch = require('node-fetch');
const express = require('express');

// Initialize Express app and set port
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize bot with webhook
const bot = new Telegraf(process.env.BOT_TOKEN);
const webhookPath = '/bot';
const webhookURL = `https://mega-uploader-bot.onrender.com${webhookPath}`;
bot.telegram.setWebhook(webhookURL);
app.use(bot.webhookCallback(webhookPath));

// Initialize Mega account
const storage = mega({
  email: process.env.MEGA_EMAIL,
  password: process.env.MEGA_PASSWORD,
  autoload: true
});

// Log Mega connection status
storage.on('ready', () => {
  console.log('Connected to Mega account successfully');
});
storage.on('error', (error) => {
  console.error('Error connecting to Mega:', error);
});

// Helper function to download file from URL
async function downloadFile(fileLink, destPath) {
  try {
    const response = await fetch(fileLink);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
    const fileStream = fs.createWriteStream(destPath);
    response.body.pipe(fileStream);
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });
    console.log('File downloaded successfully:', destPath);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

// Function to upload file to Mega
async function uploadToMega(localFilePath, fileName) {
  return new Promise((resolve, reject) => {
    const file = storage.upload({ name: fileName });
    const readStream = fs.createReadStream(localFilePath);
    readStream.pipe(file);

    file.on('complete', () => {
      console.log(`File uploaded to Mega: ${fileName}`);
      resolve(file.link());
    });
    file.on('error', (error) => {
      console.error('Error uploading to Mega:', error);
      reject(error);
    });
  });
}

// Bot start command
bot.start((ctx) => ctx.reply('Welcome! Send me a file under 20MB to upload to Mega, or send a direct download link for larger files (up to 2GB).'));

// Handle files and check size
bot.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;
  const fileSize = ctx.message.document.file_size;

  if (fileSize > 20 * 1024 * 1024) { // 20MB limit for Telegram API
    return ctx.reply('This file is over 20MB. Please send a direct download link (from Google Drive, Dropbox, etc.) instead.');
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const localPath = path.join(__dirname, fileName);

    // Download the file from Telegram
    await downloadFile(fileLink, localPath);

    // Upload to Mega
    const megaLink = await uploadToMega(localPath, fileName);

    // Clean up local file
    fs.unlinkSync(localPath);
    console.log('Local file deleted after upload.');

    // Send Mega link to user
    ctx.reply(`File uploaded to Mega: ${megaLink}`);
  } catch (error) {
    console.error('Error handling file:', error);
    ctx.reply('There was an error uploading your file to Mega. Please try again later.');
  }
});

// Handle links for files larger than 20MB
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  // Validate URL format
  const urlRegex = /^(ftp|http|https):\/\/[^ "]+$/;
  if (!urlRegex.test(text)) {
    return ctx.reply('Please send a valid direct download link (URL).');
  }

  // File name extraction and local path setup
  const fileName = `file_${Date.now()}.bin`; // Use timestamp as filename
  const localPath = path.join(__dirname, fileName);

  try {
    // Download the file from the provided URL
    await downloadFile(text, localPath);

    // Upload to Mega
    const megaLink = await uploadToMega(localPath, fileName);

    // Clean up local file
    fs.unlinkSync(localPath);
    console.log('Local file deleted after upload.');

    // Send Mega link to user
    ctx.reply(`File from link uploaded to Mega: ${megaLink}`);
  } catch (error) {
    console.error('Error handling link:', error);
    ctx.reply('There was an error uploading your file from the link to Mega. Please try again later.');
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});
