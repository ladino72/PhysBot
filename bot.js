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


const estados = {};  // clave: userId, valor: { timer, materia, tema, index }


// Archivos
const preguntas = JSON.parse(fs.readFileSync('preguntas.json', 'utf8'));
const puntajesPath = 'puntajes.json';

// Funciones de puntaje
function cargarPuntajes() {
  if (!fs.existsSync(puntajesPath)) return {};
  return JSON.parse(fs.readFileSync(puntajesPath, 'utf8'));
}

function guardarPuntajes(puntajes) {
  fs.writeFileSync(puntajesPath, JSON.stringify(puntajes, null, 2));
}

// Menú de materias
function sendMateriasMenu(chatId) {
  const materias = Object.keys(preguntas);
  const botones = materias.map(m => [{ text: m, callback_data: `materia_${m}` }]);

  botones.push([{ text: '📊 Mi Nota', callback_data: 'ver_mi_nota' }]);

  bot.sendMessage(chatId, '📘 Elige una materia:', {
    reply_markup: { inline_keyboard: botones }
  });
}


// Menú de temas (por materia)
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

// Mostrar pregunta por índice
function sendPregunta(chatId, materia, tema, index = 0, userId) {
  const lista = preguntas[materia][tema];
  if (!lista || !lista[index]) {
    return bot.sendMessage(chatId, '❌ No hay más preguntas.');
  }

  const total = lista.length;
  const q = lista[index];

  // Guardar estado temporal
  if (!estados[userId]) estados[userId] = {};
  estados[userId].materia = materia;
  estados[userId].tema = tema;
  estados[userId].index = index;

  // Cancelar temporizador anterior si existe
  if (estados[userId].timer) clearTimeout(estados[userId].timer);

  // Programar temporizador de 25 segundos
  estados[userId].timer = setTimeout(() => {
    bot.sendMessage(chatId, `⏱️ Tiempo agotado para la pregunta ${index + 1} de ${total}. Se considera incorrecta.`);
    procesarRespuesta(chatId, userId, materia, tema, index, -1);  // -1 = no respondió
  }, 25000);

  // Crear botones
  const opciones = q.opciones.map((op, i) => [{
    text: op,
    callback_data: `respuesta_${materia}_${tema}_${index}_${i}`
  }]);

  bot.sendMessage(chatId, `❓ Pregunta ${index + 1} de ${total}:\n*${q.pregunta}*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: opciones }
  });
}


// /start
bot.onText(/\/start/, (msg) => {
  sendMateriasMenu(msg.chat.id);
});

// Respuestas a botones
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data = query.data;

  if (data === 'volver_materias') {
    return sendMateriasMenu(chatId);
  }

  if (data.startsWith('materia_')) {
    const materia = data.split('_')[1];
    return sendTemasMenu(chatId, materia);
  }

  if (data.startsWith('tema_')) {
    const [, materia, tema] = data.split('_');
    return sendPregunta(chatId, materia, tema, 0);
  }

  if (data === 'ver_mi_nota') {
    const puntajes = cargarPuntajes();
    const userData = puntajes[userId];

    if (!userData) {
      return bot.sendMessage(chatId, 'ℹ️ Aún no has respondido ningún tema.');
    }

    let resumen = '📊 *Tu Puntaje Acumulado:*\n\n';

    for (const materia in userData) {
      resumen += `📘 *${materia}*\n`;

      for (const tema in userData[materia]) {
        const puntos = userData[materia][tema];
        resumen += `   • ${tema}: ${puntos} punto(s)\n`;
      }

      resumen += '\n';
    }

    bot.sendMessage(chatId, resumen, { parse_mode: 'Markdown' });
    return;
  }

  if (data.startsWith('respuesta_')) {
    const [, materia, tema, indexStr, opcionStr] = data.split('_');
    const userId = query.from.id.toString();
    const chatId = query.message.chat.id;
  
    procesarRespuesta(chatId, userId, materia, tema, parseInt(indexStr), parseInt(opcionStr));
  }
  


  if (data.startsWith('respuesta_')) {
    const [, materia, tema, indexStr, opcionStr] = data.split('_');
    const index = parseInt(indexStr);
    const opcion = parseInt(opcionStr);
    const q = preguntas[materia][tema][index];

    const correcta = q.correcta;

    // Cargar y actualizar puntajes
    const puntajes = cargarPuntajes();
    if (!puntajes[userId]) puntajes[userId] = {};
    if (!puntajes[userId][materia]) puntajes[userId][materia] = {};
    if (!puntajes[userId][materia][tema]) puntajes[userId][materia][tema] = 0;

    if (opcion === correcta) {
      bot.sendMessage(chatId, '✅ ¡Correcto!');
      puntajes[userId][materia][tema] += 1;
    } else {
      bot.sendMessage(chatId, `❌ Incorrecto. La correcta era: *${q.opciones[correcta]}*`, {
        parse_mode: 'Markdown'
      });
    }

    guardarPuntajes(puntajes);

    // Siguiente o fin
    const siguiente = index + 1;
    if (preguntas[materia][tema][siguiente]) {
      sendPregunta(chatId, materia, tema, siguiente);
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
    }
  }

  bot.answerCallbackQuery(query.id);
});

function procesarRespuesta(chatId, userId, materia, tema, index, opcion) {
  const lista = preguntas[materia][tema];
  const pregunta = lista[index];
  const correcta = pregunta.correcta;

  // Limpiar temporizador
  if (estados[userId]?.timer) {
    clearTimeout(estados[userId].timer);
    delete estados[userId].timer;
  }

  // Cargar puntajes
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
    sendPregunta(chatId, materia, tema, siguiente, userId);
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

    delete estados[userId];  // limpiar estado del usuario
  }
}
