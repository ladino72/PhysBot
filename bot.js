require('dotenv').config();
const path = require('path');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const url = process.env.URL;
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

//bot.onText(/\/start/, (msg) => {
  //bot.sendMessage(msg.chat.id, '✅ Bot en producción con webhook funcionando.');
//});

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en puerto ${port}`);
});

//---------------------------------------------



const preguntas = JSON.parse(fs.readFileSync('preguntas.json', 'utf8'));
const puntajesPath = 'puntajes.json';
const estados = {}; // Almacena temporales por usuario

function cargarPuntajes() {
  if (!fs.existsSync(puntajesPath)) return {};
  return JSON.parse(fs.readFileSync(puntajesPath, 'utf8'));
}

function guardarPuntajes(puntajes) {
  fs.writeFileSync(puntajesPath, JSON.stringify(puntajes, null, 2));
}

// Menú principal
function sendMateriasMenu(chatId) {
  const materias = Object.keys(preguntas);
  const botones = materias.map(m => [{ text: m, callback_data: `materia_${m}` }]);

  botones.push([{ text: '📊 Mi Nota', callback_data: 'ver_mi_nota' }]);

  bot.sendMessage(chatId, '📘 Elige una materia:', {
    reply_markup: { inline_keyboard: botones }
  });
}

// Menú de temas
function sendTemasMenu(chatId, materia) {
  const temas = Object.keys(preguntas[materia]);
  const botones = temas.map(t => [{
    text: t,
    callback_data: `tema_${materia}_${t}`
  }]);
  botones.push([{ text: '⏪ Volver a materias', callback_data: 'volver_materias' }]);

  bot.sendMessage(chatId, `📚 Temas de *${materia}*:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: botones }
  });
}

// Mostrar pregunta
function sendPregunta(chatId, materia, tema, index = 0, userId) {
  const lista = preguntas[materia][tema];
  if (!lista || !lista[index]) {
    return bot.sendMessage(chatId, '❌ No hay más preguntas.');
  }

  const total = lista.length;
  const q = lista[index];

  if (!estados[userId]) estados[userId] = {};
  estados[userId].materia = materia;
  estados[userId].tema = tema;
  estados[userId].index = index;
  estados[userId].respondido = false;

  // Cancelar temporizadores anteriores
  if (estados[userId].timer) clearTimeout(estados[userId].timer);
  if (estados[userId].interval) clearInterval(estados[userId].interval);

  // ⏲️ Temporizador para evaluar tras 25s
  estados[userId].timer = setTimeout(() => {
    if (!estados[userId].respondido) {
      bot.sendMessage(chatId, `⏱️ Tiempo agotado para la pregunta ${index + 1} de ${total}. Se considera incorrecta.`);
      procesarRespuesta(chatId, userId, materia, tema, index, -1);
    }
  }, 25000);

  // 🕒 Mostrar cronómetro con barra de emojis
bot.sendMessage(chatId, `⏳ Tiempo restante: 🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵`).then(timerMsg => {
  estados[userId].mensajeTimerId = timerMsg.message_id;
  estados[userId].tiempoRestante = 25;

  estados[userId].interval = setInterval(() => {
    estados[userId].tiempoRestante -= 1;

    const restantes = estados[userId].tiempoRestante;
    if (restantes <= 0) {
      clearInterval(estados[userId].interval);
      return;
    }

    const total = 25;
    const filled = '🔵'.repeat(restantes);
    const empty = '⚪'.repeat(total - restantes);
    const barra = filled + empty;

    bot.editMessageText(
      `⏳ Tiempo restante: ${barra} (${restantes}s)`,
      {
        chat_id: chatId,
        message_id: estados[userId].mensajeTimerId
      }
    ).catch(() => {});
  }, 1000);
});



// Evaluar respuesta
function procesarRespuesta(chatId, userId, materia, tema, index, opcion) {
  if (estados[userId]?.respondido) return;
  estados[userId].respondido = true;

  if (estados[userId]?.timer) {
    clearTimeout(estados[userId].timer);
    delete estados[userId].timer;
  }

  const lista = preguntas[materia][tema];
  const pregunta = lista[index];
  const correcta = pregunta.correcta;

  const puntajes = cargarPuntajes();
  if (!puntajes[userId]) puntajes[userId] = {};
  if (!puntajes[userId][materia]) puntajes[userId][materia] = {};
  if (!puntajes[userId][materia][tema]) puntajes[userId][materia][tema] = 0;

  if (opcion === correcta) {
    bot.sendMessage(chatId, '✅ ¡Correcto!');
    puntajes[userId][materia][tema] += 1;
  } else {
    bot.sendMessage(chatId, `❌ Incorrecto. La correcta era: *${pregunta.opciones[correcta]}*`, {
      parse_mode: 'Markdown'
    });
  }

  guardarPuntajes(puntajes);

  const siguiente = index + 1;
  if (lista[siguiente]) {
    setTimeout(() => {
      estados[userId].respondido = false;
      sendPregunta(chatId, materia, tema, siguiente, userId);
    }, 1000);
  } else {
    bot.sendMessage(chatId, `🎉 Has terminado el tema *${tema}* de *${materia}*.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Volver a Temas', callback_data: `materia_${materia}` }],
          [{ text: '🏠 Volver a Materias', callback_data: 'volver_materias' }]
        ]
      }
    });
    delete estados[userId];
  }
}

// /start
bot.onText(/\/start/, (msg) => {
  sendMateriasMenu(msg.chat.id);
});

// Manejador de botones
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;

  if (data === 'volver_materias') return sendMateriasMenu(chatId);
  if (data === 'ver_mi_nota') {
    const puntajes = cargarPuntajes();
    const userData = puntajes[userId];

    if (!userData) return bot.sendMessage(chatId, 'ℹ️ Aún no has respondido ningún tema.');

    let resumen = '📊 *Tu Puntaje Acumulado:*\n\n';
    for (const materia in userData) {
      resumen += `📘 *${materia}*\n`;
      for (const tema in userData[materia]) {
        const puntos = userData[materia][tema];
        resumen += `   • ${tema}: ${puntos} punto(s)\n`;
      }
      resumen += '\n';
    }

    return bot.sendMessage(chatId, resumen, { parse_mode: 'Markdown' });
  }

  if (data.startsWith('materia_')) {
    const materia = data.split('_')[1];
    return sendTemasMenu(chatId, materia);
  }

  if (data.startsWith('tema_')) {
    const [, materia, tema] = data.split('_');
    return sendPregunta(chatId, materia, tema, 0, userId);
  }

  if (data.startsWith('respuesta_')) {
    const [, materia, tema, indexStr, opcionStr] = data.split('_');
    const index = parseInt(indexStr);
    const opcion = parseInt(opcionStr);
    procesarRespuesta(chatId, userId, materia, tema, index, opcion);
  }

  bot.answerCallbackQuery(query.id);
});
}

bot.onText(/\/parar/, (msg) => {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;

  if (!estados[userId]) {
    return bot.sendMessage(chatId, 'ℹ️ No tienes un quiz en curso.');
  }

  if (estados[userId].timer) clearTimeout(estados[userId].timer);
  if (estados[userId].interval) clearInterval(estados[userId].interval);

  if (estados[userId].mensajeTimerId) {
    bot.deleteMessage(chatId, estados[userId].mensajeTimerId).catch(() => {});
  }

  delete estados[userId];

  bot.sendMessage(chatId, '🛑 Has detenido el quiz. Puedes volver a empezar cuando quieras con otro tema.');
});
