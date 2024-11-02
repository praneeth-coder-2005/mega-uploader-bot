const { Telegraf } = require('telegraf');
const mega = require('megajs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

let megaStorage;

// Connect to MEGA when the bot starts
async function connectToMega() {
  megaStorage = new mega.Storage({
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD
  });

  await new Promise((resolve, reject) => {
    megaStorage.on('ready', resolve).on('error', reject);
  });
  console.log("Connected to MEGA successfully.");
}

// Start command: connect to MEGA and prompt the user to upload files
bot.start(async (ctx) => {
  await connectToMega();
  ctx.reply("You are connected to MEGA. You can now upload files by sending file links or attachments.");
});

// Function to handle file uploads
async function uploadToMega(filePath, fileName, ctx) {
  return new Promise((resolve, reject) => {
    const file = megaStorage.upload({ name: fileName, size: fs.statSync(filePath).size }, fs.createReadStream(filePath));

    file.on('complete', () => {
      fs.unlinkSync(filePath); // Delete local file after upload
      file.link((err, link) => {
        if (err) reject(err);
        ctx.reply(`File uploaded successfully: ${link}`);
        resolve();
      });
    });

    file.on('error', (err) => {
      ctx.reply("Error uploading your file. Try again later.");
      reject(err);
    });
  });
}

// Handle file and URL uploads
bot.on('message', async (ctx) => {
  const message = ctx.message;

  // Check if the message contains a document (file attachment)
  if (message.document) {
    const fileId = message.document.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const filePath = path.join(__dirname, message.document.file_name);

    // Download the file
    const response = await axios.get(fileLink.href, { responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);
    writer.on('finish', async () => {
      await uploadToMega(filePath, message.document.file_name, ctx);
    });
    writer.on('error', () => {
      ctx.reply("Error downloading the file. Try again later.");
    });

  // Check if the message contains a URL link
  } else if (message.entities && message.entities[0].type === 'url') {
    const url = message.text;
    const fileName = path.basename(url);
    const filePath = path.join(__dirname, fileName);

    // Download the file
    const response = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);
    writer.on('finish', async () => {
      await uploadToMega(filePath, fileName, ctx);
    });
    writer.on('error', () => {
      ctx.reply("Error downloading the file. Try again later.");
    });
  } else {
    ctx.reply("Please send a file or a valid link to upload.");
  }
});

// Launch the bot
bot.launch().then(() => {
  console.log("Bot is running...");
});
