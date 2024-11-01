require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const mega = require('megajs');
const fetch = require('node-fetch'); // Ensure this is installed if needed: npm install node-fetch
const express = require('express');

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

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

// Express to serve basic routes
app.use(express.json());
app.listen(PORT, () => {
  console.log(`Web server is running on port ${PORT}`);
});

// Helper function to download file from Telegram
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
      resolve(file.link()); // Get the file link
    });
    file.on('error', (error) => {
      console.error('Error uploading to Mega:', error);
      reject(error);
    });
  });
}

// Bot start command
bot.start((ctx) => ctx.reply('Welcome! Send me a file to upload to Mega.'));

// Handle file uploads from users
bot.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;

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

// Launch bot
bot.launch()
  .then(() => console.log('Bot is running...'))
  .catch((error) => console.error('Error launching bot:', error));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
