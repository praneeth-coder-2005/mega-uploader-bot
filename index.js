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
const DOWNLOAD_TIMEOUT = 20 * 60 * 1000; // 20 minutes
const UPLOAD_TIMEOUT = 30 * 60 * 1000; // 30 minutes for upload
const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

const bot = new Telegraf(process.env.BOT_TOKEN);
let activeDownload = null;
let activeUpload = null;
let cancelRequested = false;

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

// Cancel command
bot.command('cancel', async (ctx) => {
  if (!activeDownload && !activeUpload) {
    return ctx.reply('No active download or upload to cancel.');
  }
  cancelRequested = true;
  ctx.reply('Canceling the current operation...');
});

// Retry helper function
async function retryOperation(operation, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed. Retrying in ${RETRY_DELAY / 1000} seconds...`);
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      else throw error;
    }
  }
}

// Function to download a file with progress updates
async function downloadFileWithProgress(fileLink, destPath, ctx) {
  const progressMessage = await ctx.reply('Download Progress: [░░░░░] 0%');
  const messageId = progressMessage.message_id;

  const response = await retryOperation(() => pTimeout(fetch(fileLink), DOWNLOAD_TIMEOUT));
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);

  const totalBytes = Number(response.headers.get('content-length'));
  let downloadedBytes = 0;

  const fileStream = fs.createWriteStream(destPath);
  activeDownload = response.body;

  activeDownload.on('data', async (chunk) => {
    downloadedBytes += chunk.length;
    const progress = Math.round((downloadedBytes / totalBytes) * 100);
    if (progress % 20 === 0) {
      await updateProgress(ctx, messageId, 'Download', progress);
    }
    if (cancelRequested) {
      response.body.destroy();
      fileStream.close();
      cancelRequested = false;
      throw new Error('Download canceled by user.');
    }
  });

  response.body.pipe(fileStream);
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
  activeDownload = null;
}

// Function to upload file with progress updates
async function uploadFileWithProgress(localFilePath, fileName, ctx) {
  const progressMessage = await ctx.reply('Upload Progress: [░░░░░] 0%');
  const messageId = progressMessage.message_id;

  return await retryOperation(async () => {
    const file = storage.upload({ name: fileName });
    const readStream = fs.createReadStream(localFilePath);
    const totalBytes = fs.statSync(localFilePath).size;
    let uploadedBytes = 0;
    activeUpload = readStream;

    readStream.on('data', async (chunk) => {
      uploadedBytes += chunk.length;
      const progress = Math.round((uploadedBytes / totalBytes) * 100);
      if (progress % 20 === 0) {
        await updateProgress(ctx, messageId, 'Upload', progress);
      }
      if (cancelRequested) {
        readStream.destroy();
        file.emit('error', new Error('Upload canceled by user.'));
        cancelRequested = false;
        throw new Error('Upload canceled by user.');
      }
    });

    readStream.pipe(file);

    return new Promise((resolve, reject) => {
      file.on('complete', () => {
        activeUpload = null;
        resolve(file.link());
      });
      file.on('error', (error) => {
        activeUpload = null;
        reject(error);
      });
    });
  });
}

// Bot start command
bot.start((ctx) => ctx.reply('Welcome! Send a file under 20MB or a direct download link for larger files. Use /cancel to cancel an ongoing download or upload.'));

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
    console.error('Error during upload process:', error);
    ctx.reply(error.message.includes('canceled') ? 'Operation canceled.' : 'Error uploading your file. Try again later.');
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
    console.error('Error during link upload process:', error);
    ctx.reply(error.message.includes('canceled') ? 'Operation canceled.' : 'Error uploading your file. Try again later.');
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
