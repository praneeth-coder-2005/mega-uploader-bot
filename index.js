require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const mega = require('megajs');
const fetch = require('node-fetch');
const express = require('express');
const pTimeout = require('p-timeout');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes

const bot = new Telegraf(process.env.BOT_TOKEN);

// Initialize Mega account
const storage = mega({
  email: process.env.MEGA_EMAIL,
  password: process.env.MEGA_PASSWORD,
  autoload: true
});

storage.on('ready', () => {
  console.log('Connected to Mega account successfully');
});
storage.on('error', (error) => {
  console.error('Error connecting to Mega:', error);
});

// Helper function to download file with a longer timeout
async function downloadFile(fileLink, destPath) {
  try {
    const response = await pTimeout(fetch(fileLink), DOWNLOAD_TIMEOUT, 'Download timed out.');
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

// Handle document uploads
bot.on('document', async (ctx) => {
  console.log("Received a document...");
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;
  const fileSize = ctx.message.document.file_size;

  if (fileSize > 20 * 1024 * 1024) {
    ctx.reply('File is over 20MB. Please send a direct download link instead.');
    return;
  }

  try {
    console.log("Attempting to download file from Telegram...");
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const localPath = path.join(__dirname, fileName);

    await downloadFile(fileLink, localPath);
    const megaLink = await uploadToMega(localPath, fileName);

    fs.unlinkSync(localPath);
    console.log("File uploaded to Mega successfully.");
    ctx.reply(`File uploaded to Mega: ${megaLink}`);
  } catch (error) {
    console.error('Error handling file:', error);
    ctx.reply('Error uploading your file. Try again later.');
  }
});

// Handle text links for large files
bot.on('text', async (ctx) => {
  console.log("Received a text message...");
  const url = ctx.message.text;

  const urlPattern = /^(ftp|http|https):\/\/[^ "]+$/;
  if (!urlPattern.test(url)) {
    ctx.reply('Please send a valid download link.');
    return;
  }

  const fileName = `file_${Date.now()}.bin`;
  const localPath = path.join(__dirname, fileName);

  try {
    console.log("Attempting to download file from URL...");
    await downloadFile(url, localPath);
    const megaLink = await uploadToMega(localPath, fileName);

    fs.unlinkSync(localPath);
    console.log("Link content uploaded to Mega successfully.");
    ctx.reply(`Link uploaded to Mega: ${megaLink}`);
  } catch (error) {
    console.error('Error handling link:', error);
    ctx.reply(error.message.includes('timed out')
      ? 'The download took too long. Try a faster link.'
      : 'Error uploading your file. Try again later.');
  }
});

// Start polling
bot.launch()
  .then(() => console.log('Bot is running with polling...'))
  .catch((error) => console.error('Error launching bot:', error));

// Start Express server
app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});
