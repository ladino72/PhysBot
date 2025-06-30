// Archivo: bot.js (usando CommonJS para compatibilidad)
const { Telegraf } = require('telegraf');
const express = require('express');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Ruta de Webhook (Telegram enviará actualizaciones aquí)
const webhookPath = `/bot${process.env.BOT_TOKEN}`;

// Configurar respuesta al comando /start
bot.start((ctx) => ctx.reply('👋 ¡Hola! Este es un bot funcionando con Webhook en Railway.'));

// Configurar Express para escuchar el webhook
const app = express();
app.use(express.json());
app.use(bot.webhookCallback(webhookPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);

  // Establecer Webhook (Telegram -> Railway)
  bot.telegram.setWebhook(`${process.env.WEBHOOK_DOMAIN}${webhookPath}`);
});
