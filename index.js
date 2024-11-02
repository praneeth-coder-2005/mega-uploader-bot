require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');
const fetch = require('node-fetch');
const mega = require('megajs');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const UPLOAD_TIMEOUT = 20 * 60 * 1000; // 20 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

// Initialize MEGA storage
const storage = mega({
  email: process.env.MEGA_EMAIL,
  password: process.env.MEGA_PASSWORD,
  autoload: true,
});

storage.on('ready', () => console.log('Connected to MEGA account'));
storage.on('error', (error) => console.error('Error connecting to MEGA:', error));

app.listen(process.env.PORT || 3000, () => console.log(`Web server running`));

let activeDownload = null;
let activeUpload = null;
let cancelRequested = false;

// Helper to update progress
async function updateProgress(ctx, messageId, label, progress) {
  const progressBar = '█'.repeat(progress / 10) + '░'.repeat(10 - progress / 10);
  const text = `${label} Progress: [${progressBar}] ${progress}%`;
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text);
  } catch (error) {
    if (error.response && error.response.error_code === 429) {
      console.warn('Rate limit hit, skipping update.');
    } else {
      console.error('Error updating progress:', error);
    }
  }
}

// Command to cancel ongoing download or upload
bot.command('cancel', async (ctx) => {
  if (!activeDownload && !activeUpload) {
    await ctx.reply('No active download or upload to cancel.');
    return;
  }
  cancelRequested = true;
  await ctx.reply('Canceling the current operation...');
});

// Download function
async function downloadFile(ctx, url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (cancelRequested) return;
    try {
      const response = await fetch(url, { timeout: DOWNLOAD_TIMEOUT });
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      const dest = fs.createWriteStream('tempfile');

      return new Promise((resolve, reject) => {
        response.body.pipe(dest);
        response.body.on('data', (chunk) => {
          const progress = Math.round((dest.bytesWritten / response.headers.get('content-length')) * 100);
          if (progress % 10 === 0) updateProgress(ctx, ctx.message.message_id, 'Downloading', progress);
        });
        response.body.on('error', reject);
        response.body.on('end', () => resolve('tempfile'));
      });
    } catch (error) {
      console.error(`Download attempt ${attempt} failed:`, error);
      if (attempt < MAX_RETRIES) await new Promise((res) => setTimeout(res, RETRY_DELAY));
      else throw error;
    }
  }
}

// Upload function to MEGA
async function uploadFile(ctx, filePath) {
  if (cancelRequested) return;
  return new Promise((resolve, reject) => {
    const uploadStream = storage.upload(filePath, fs.statSync(filePath).size);
    let uploadedBytes = 0;

    uploadStream.on('progress', (bytes) => {
      uploadedBytes += bytes;
      const progress = Math.round((uploadedBytes / fs.statSync(filePath).size) * 100);
      if (progress % 10 === 0) updateProgress(ctx, ctx.message.message_id, 'Uploading', progress);
    });

    uploadStream.on('complete', (file) => {
      resolve(file.link());
    });
    uploadStream.on('error', reject);
  });
}

// Main handler for links
bot.on('text', async (ctx) => {
  const url = ctx.message.text;
  if (!url.startsWith('http')) {
    return ctx.reply('Please send a valid download link.');
  }

  activeDownload = downloadFile(ctx, url);
  try {
    const filePath = await activeDownload;
    if (!filePath) return ctx.reply('Download was canceled.');

    await ctx.reply('File downloaded successfully. Starting upload to MEGA...');
    activeUpload = uploadFile(ctx, filePath);

    const link = await activeUpload;
    if (!link) return ctx.reply('Upload was canceled.');

    await ctx.reply(`File uploaded successfully! Here’s your link: ${link}`);
  } catch (error) {
    console.error('Error during download/upload:', error);
    await ctx.reply('An error occurred. Please try again later.');
  } finally {
    activeDownload = null;
    activeUpload = null;
    cancelRequested = false;
    fs.unlinkSync('tempfile'); // Remove temp file after process
  }
});

bot.catch((err) => console.error('Bot Error:', err));
bot.launch();
