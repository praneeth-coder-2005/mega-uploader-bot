const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const mega = require('megajs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const download = promisify(pipeline);

const bot = new Telegraf(process.env.BOT_TOKEN);

// Initialize Mega client
const storage = mega({
  email: process.env.MEGA_EMAIL,
  password: process.env.MEGA_PASSWORD,
  autoload: true
});

// Function to download file from Telegram
async function downloadFile(fileLink, destPath) {
  const response = await fetch(fileLink);
  if (!response.ok) throw new Error(`Error fetching file: ${response.statusText}`);
  await download(response.body, fs.createWriteStream(destPath));
}

// Upload file to Mega
async function uploadToMega(localFilePath, fileName) {
  const file = storage.upload({ name: fileName });
  const readStream = fs.createReadStream(localFilePath);
  readStream.pipe(file);

  return new Promise((resolve, reject) => {
    file.on('complete', () => resolve(file.link()));
    file.on('error', (err) => reject(err));
  });
}

// Handle incoming files
bot.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;

  try {
    // Get file link
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Local file path for temporary download
    const destPath = path.join(__dirname, fileName);

    // Download the file from Telegram
    await downloadFile(fileLink, destPath);

    // Upload to Mega
    const megaLink = await uploadToMega(destPath, fileName);

    // Clean up local file
    fs.unlinkSync(destPath);

    // Send Mega link to the user
    ctx.reply(`File uploaded to Mega: ${megaLink}`);
  } catch (error) {
    console.error('Error handling file:', error);
    ctx.reply('There was an error uploading your file to Mega.');
  }
});

// Launch the bot
bot.launch().then(() => console.log('Mega Uploader Bot is running...'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
