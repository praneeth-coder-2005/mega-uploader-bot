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
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000; // 15 minutes

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

// Helper to update progress bar in a single message
async function updateProgress(ctx, messageId, label, progress) {
  const progressBar = '█'.repeat(progress / 20) + '░'.repeat(5 - progress / 20);
  const text = `${label} Progress: [${progressBar}] ${progress}%`;
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text);
  } catch (error) {
    console.error('Error updating progress:', error);
  }
}

// Function to retry API calls if rate limited
async function safeApiCall(fn, args, retryDelay = 5000, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(...args);
    } catch (error) {
      if (error.response?.error_code === 429) {
        const waitTime = error.response.parameters?.retry_after || retryDelay / 1000;
        console.warn(`Rate limited. Retrying in ${waitTime}s...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
}

// Function to download a file with progress updates
async function downloadFileWithProgress(fileLink, destPath, ctx) {
  const progressMessage = await ctx.reply('Download Progress: [░░░░░] 0%');
  const messageId = progressMessage.message_id;

  const response = await pTimeout(fetch(fileLink), DOWNLOAD_TIMEOUT, 'Download timed out.');
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

  const totalBytes = Number(response.headers.get('content-length'));
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(destPath);
  response.body.on('data', async (chunk) => {
    downloadedBytes += chunk.length;
    const progress = Math.round((downloadedBytes / totalBytes) * 100);
    if (progress % 20 === 0) { // Update every 20%
      await safeApiCall(updateProgress, [ctx, messageId, 'Download', progress]);
    }
  });

  response.body.pipe(fileStream);
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

// Function to upload file with progress updates
async function uploadFileWithProgress(localFilePath, fileName, ctx) {
  const progressMessage = await ctx.reply('Upload Progress: [░░░░░] 0%');
  const messageId = progressMessage.message_id;

  return new Promise((resolve, reject) => {
    const file = storage.upload({ name: fileName });
    const readStream = fs.createReadStream(localFilePath);
    const totalBytes = fs.statSync(localFilePath).size;
    let uploadedBytes = 0;

    readStream.on('data', async (chunk) => {
      uploadedBytes += chunk.length;
      const progress = Math.round((uploadedBytes / totalBytes) * 100);
      if (progress % 20 === 0) {
        await safeApiCall(updateProgress, [ctx, messageId, 'Upload', progress]);
      }
    });

    readStream.pipe(file);

    file.on('complete', () => {
      console.log(`File uploaded to Mega: ${fileName}`);
      safeApiCall(ctx.telegram.editMessageText, [ctx.chat.id, messageId, undefined, 'Upload complete! Link will be shared shortly.']);
      resolve(file.link());
    });
    file.on('error', (error) => {
      console.error('Error uploading to Mega:', error);
      safeApiCall(ctx.telegram.editMessageText, [ctx.chat.id, messageId, undefined, 'Upload failed. Please try again.']);
      reject(error);
    });
  });
}

// Bot start command
bot.start((ctx) => ctx.reply('Welcome! Send a file under 20MB or a direct download link for larger files.'));

// Handle document uploads
bot.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;
  const fileSize = ctx.message.document.file_size;

  if (fileSize > 20 * 1024 * 1024) {
    return ctx.reply('File is over 20MB. Please send a direct download link instead.');
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const localPath = path.join(__dirname, fileName);

    await downloadFileWithProgress(fileLink, localPath, ctx);
    const megaLink = await uploadFileWithProgress(localPath, fileName, ctx);

    fs.unlinkSync(localPath);
    ctx.reply(`File uploaded to Mega: ${megaLink}`);
  } catch (error) {
    ctx.reply('Error uploading your file. Try again later.');
  }
});

// Handle text links for large files
bot.on('text', async (ctx) => {
  const url = ctx.message.text;

  const urlPattern = /^(ftp|http|https):\/\/[^ "]+$/;
  if (!urlPattern.test(url)) {
    return ctx.reply('Please send a valid download link.');
  }

  const fileName = `file_${Date.now()}.bin`;
  const localPath = path.join(__dirname, fileName);

  try {
    await downloadFileWithProgress(url, localPath, ctx);
    const megaLink = await uploadFileWithProgress(localPath, fileName, ctx);

    fs.unlinkSync(localPath);
    ctx.reply(`Link uploaded to Mega: ${megaLink}`);
  } catch (error) {
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
