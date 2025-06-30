import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Respuesta al comando /start
bot.start((ctx) => {
  ctx.reply('✅ ¡Hola! Este es un bot básico con webhook funcionando en Railway.');
});

// Activar Webhook
bot.launch({
  webhook: {
    domain: process.env.WEBHOOK_DOMAIN,
    port: parseInt(process.env.PORT) || 3000
  }
});

console.log(`🚀 Bot escuchando en ${process.env.WEBHOOK_DOMAIN}/bot${process.env.BOT_TOKEN}`);

// Detener el bot limpiamente en caso de señal
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
