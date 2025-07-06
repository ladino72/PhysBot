// Archivo completo actualizado para estructura por materias y tópicos
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

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en puerto ${port}`);
});

const adminPermitido = 8136071960;
const RUTA_PUNTAJES = path.join(__dirname, 'puntajes.json');
const RUTA_PREGUNTAS = path.join(__dirname, 'preguntas.json');
const RUTA_HISTORIAL = path.join(__dirname, 'historial.json');
const RUTA_ESTADO_CURSO = path.join(__dirname, 'estado_curso.json');
const temporizadoresActivos = {};

function leerJSON(ruta) {
  try {
    if (!fs.existsSync(ruta)) return {};
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    console.error(`❌ Error leyendo ${ruta}:`, err.message);
    return {};
  }
}

function guardarJSON(ruta, datos) {
  try {
    fs.writeFileSync(ruta, JSON.stringify(datos, null, 2));
  } catch (err) {
    console.error(`❌ Error guardando en ${ruta}:`, err);
  }
}

function cursoActivo() {
  const estado = leerJSON(RUTA_ESTADO_CURSO);
  return estado.activo !== false;
}

function setCursoActivo(activo) {
  guardarJSON(RUTA_ESTADO_CURSO, { activo });
}

function enviarConReintento(chatId, texto, opciones = {}) {
  const reintentar = (delay) => new Promise(resolve => setTimeout(resolve, delay));
  const intentar = async (retraso = 1000) => {
    try {
      return await bot.sendMessage(chatId, texto, opciones);
    } catch (err) {
      if (err.response && err.response.statusCode === 429) {
        const wait = err.response.body.parameters.retry_after * 1000 || retraso;
        console.warn(`⚠️ Esperando ${wait / 1000}s por límite de rate...`);
        await reintentar(wait);
        return intentar(wait);
      } else {
        console.error('❌ Error al enviar mensaje:', err);
      }
    }
  };
  return intentar();
}

function registrarHistorial(userId, nombre, accion) {
  const historial = leerJSON(RUTA_HISTORIAL);
  const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  if (!historial[userId]) historial[userId] = [];
  historial[userId].push({ nombre, accion, hora: ahora });
  guardarJSON(RUTA_HISTORIAL, historial);
}

let bancoTemas = leerJSON(RUTA_PREGUNTAS);
function mezclarPreguntas(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

let estadoTrivia = {};
let usuariosActivos = new Map();
const LIMITE_USUARIOS_CONCURRENTES = 30;

bot.onText(/\/start/, (msg) => {
  enviarConReintento(
    msg.chat.id,
    '👋 ¡Bienvenido a PhysicsBank!\n' +
    '📚 Usa /temas para elegir una temática.\n' +
    '📈 Usa /ranking para ver el ranking.\n' +
    '📝 Usa /minota para ver tu resultado.\n' +
    '🛑 Usa /terminar para abandonar el quiz actual.\n' +
    '👥 Usa /activos para ver quiénes están resolviendo quizzes.'
  );
});

bot.onText(/\/temas/, (msg) => {
  if (!cursoActivo()) return enviarConReintento(msg.chat.id, '⛔ El curso está desactivado.');
  const materias = Object.keys(bancoTemas);
  if (materias.length === 0) return enviarConReintento(msg.chat.id, '⚠️ No hay materias disponibles.');
  const botones = materias.map(m => ([{ text: m, callback_data: `materia:${m}` }]));
  enviarConReintento(msg.chat.id, '📚 Elige una materia:', {
    reply_markup: { inline_keyboard: botones }
  });
});

bot.on('callback_query', (cb) => {
  const userId = cb.message.chat.id;
  const data = cb.data;
  const nombre = cb.from.first_name;

  if (data.startsWith('materia:')) {
    const materia = data.split(':')[1];
    const topicos = bancoTemas[materia] ? Object.keys(bancoTemas[materia]) : [];
    if (topicos.length === 0) return enviarConReintento(userId, '❌ No hay tópicos para esta materia.');
    const botones = topicos.map(t => ([{ text: t, callback_data: `topico:${materia}:${t}` }]));
    enviarConReintento(userId, `📖 Elige un tópico de *${materia}*`, {
      reply_markup: { inline_keyboard: botones },
      parse_mode: 'Markdown'
    });
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('topico:')) {
    const [, materia, topico] = data.split(':');
    if (!bancoTemas[materia] || !bancoTemas[materia][topico]) {
      return enviarConReintento(userId, '❌ Tópico inválido.');
    }
    if (usuariosActivos.size >= LIMITE_USUARIOS_CONCURRENTES) {
      return enviarConReintento(userId, '🚫 Límite de usuarios activos alcanzado.');
    }

    const preguntas = mezclarPreguntas(bancoTemas[materia][topico]);
    estadoTrivia[userId] = {
      nombre,
      materia,
      topico,
      index: 0,
      puntaje: 0,
      preguntas
    };
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, nombre, `Inició quiz: ${materia}/${topico}`);
    enviarPregunta(userId);
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('r:')) {
    const [, indexStr, seleccionStr] = data.split(':');
    const userId = cb.message.chat.id;
    const estado = estadoTrivia[userId];
    if (!estado) return;

    const pregunta = estado.preguntas[estado.index];
    const correcta = pregunta.correcta;
    const seleccion = parseInt(seleccionStr);

    if (seleccion === correcta) estado.puntaje++;

    estado.index++;
    if (estado.index < estado.preguntas.length) {
      enviarPregunta(userId);
    } else {
      const nota = (estado.puntaje / estado.preguntas.length * 5).toFixed(2);
      const puntajes = leerJSON(RUTA_PUNTAJES);
      if (!puntajes[userId]) puntajes[userId] = {};
      puntajes[userId][`${estado.materia}/${estado.topico}`] = nota;
      guardarJSON(RUTA_PUNTAJES, puntajes);
      registrarHistorial(userId, estado.nombre, `Finalizó quiz con nota: ${nota}`);
      usuariosActivos.delete(userId);
      delete estadoTrivia[userId];
      enviarConReintento(userId, `✅ Has terminado el quiz.
📊 Tu nota es: *${nota}*`, { parse_mode: 'Markdown' });
    }
    bot.answerCallbackQuery(cb.id);
  }
});

function enviarPregunta(userId) {
  const estado = estadoTrivia[userId];
  if (!estado || estado.index >= estado.preguntas.length) return;
  const p = estado.preguntas[estado.index];
  const opciones = p.opciones.map((op, i) => [{ text: op, callback_data: `r:${estado.index}:${i}` }]);
  const actual = estado.index + 1;
  const total = estado.preguntas.length;
  bot.sendMessage(userId, `📘 Pregunta ${actual}/${total}

❓ ${p.pregunta}`, {
    reply_markup: { inline_keyboard: opciones }
  });
}

bot.onText(/\/minota/, (msg) => {
  const userId = msg.chat.id;
  const puntajes = leerJSON(RUTA_PUNTAJES);
  const notas = puntajes[userId];
  if (!notas) return enviarConReintento(userId, '📭 No hay notas registradas.');
  let resumen = '📋 Tus notas:
';
  for (const [clave, nota] of Object.entries(notas)) {
    resumen += `📚 ${clave}: ${nota}
`;
  }
  enviarConReintento(userId, resumen);
});

bot.onText(/\/ranking/, (msg) => {
  const puntajes = leerJSON(RUTA_PUNTAJES);
  let acumulado = {};
  for (const [userId, topicos] of Object.entries(puntajes)) {
    for (const [tema, nota] of Object.entries(topicos)) {
      if (!acumulado[tema]) acumulado[tema] = [];
      acumulado[tema].push({ userId, nota: parseFloat(nota) });
    }
  }
  let mensaje = '🏆 Ranking por tema:
';
  for (const [tema, lista] of Object.entries(acumulado)) {
    const top = lista.sort((a, b) => b.nota - a.nota).slice(0, 3);
    mensaje += `
📚 ${tema}
`;
    top.forEach((e, i) => {
      mensaje += ` ${i + 1}. ID ${e.userId} - ${e.nota}
`;
    });
  }
  enviarConReintento(msg.chat.id, mensaje);
});

bot.onText(/\/activos/, (msg) => {
  if (msg.chat.id !== adminPermitido) return enviarConReintento(msg.chat.id, '🚫 Solo el profesor puede usar este comando.');
  if (usuariosActivos.size === 0) return enviarConReintento(msg.chat.id, '📭 No hay estudiantes activos.');

  let conteoPorTema = {}, lista = '';
  for (const [userId] of usuariosActivos.entries()) {
    const estado = estadoTrivia[userId];
    if (!estado) continue;
    const { nombre, materia, topico, index, preguntas } = estado;
    const clave = `${materia} / ${topico}`;
    lista += `- ${nombre} (${clave}) Pregunta ${index + 1}/${preguntas.length}
`;
    conteoPorTema[clave] = (conteoPorTema[clave] || 0) + 1;
  }

  let resumen = `👥 Estudiantes activos: ${usuariosActivos.size}

`;
  for (const [tema, cantidad] of Object.entries(conteoPorTema)) {
    resumen += `📚 ${tema}: ${cantidad}
`;
  }
  resumen += `
📝 Lista:
${lista}`;
  enviarConReintento(msg.chat.id, resumen);
});

bot.onText(/\/terminar/, (msg) => {
  const userId = msg.chat.id;
  const estado = estadoTrivia[userId];

  if (!estado) {
    return enviarConReintento(userId, '⚠️ No estás presentando ningún quiz actualmente.');
  }

  if (temporizadoresActivos[userId]) {
    clearInterval(temporizadoresActivos[userId]);
    delete temporizadoresActivos[userId];
  }

  delete estadoTrivia[userId];
  usuariosActivos.delete(userId);

  enviarConReintento(userId, '🛑 Has terminado voluntariamente tu quiz. Puedes volver a intentarlo desde /temas cuando lo desees.');
});

bot.onText(/\/historial/, (msg) => {
  const userId = String(msg.chat.id);
  const historial = leerJSON(RUTA_HISTORIAL);
  const registros = historial[userId];
  if (!registros || registros.length === 0) return enviarConReintento(msg.chat.id, '📭 No hay historial registrado.');

  const resumen = registros.map(r => `🕒 ${r.hora}\n👤 ${r.nombre}\n📌 ${r.accion}`).join('\n\n');
  enviarConReintento(msg.chat.id, `📜 Tu historial:\n\n${resumen}`);
});
