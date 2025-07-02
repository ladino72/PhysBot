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


const adminPermitido = 8136071960;
const RUTA_PUNTAJES = path.join(__dirname, 'puntajes.json');
const RUTA_PREGUNTAS = path.join(__dirname, 'preguntas.json');
const RUTA_HISTORIAL = path.join(__dirname, 'historial.json');
const RUTA_ESTADO_CURSO = path.join(__dirname, 'estado_curso.json');
const RUTA_ESTADO_USUARIOS = path.join(__dirname, 'estado_usuario.json');

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

function leerEstadoUsuarios() {
  return leerJSON(RUTA_ESTADO_USUARIOS);
}

function guardarEstadoUsuarios(estado) {
  guardarJSON(RUTA_ESTADO_USUARIOS, estado);
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

bot.onText(/\/activar/, (msg) => {
  if (msg.chat.id !== adminPermitido) return enviarConReintento(msg.chat.id, '🚫 Solo el profesor puede usar este comando.');
  setCursoActivo(true);
  enviarConReintento(msg.chat.id, '✅ Curso activado.');
});

bot.onText(/\/desactivar/, (msg) => {
  if (msg.chat.id !== adminPermitido) return enviarConReintento(msg.chat.id, '🚫 Solo el profesor puede usar este comando.');
  setCursoActivo(false);
  enviarConReintento(msg.chat.id, '⛔ Curso desactivado.');
});

bot.onText(/\/start/, (msg) => {
  enviarConReintento(
    msg.chat.id,
    '👋 ¡Bienvenido a PhysicsBank!\n' +
    '📚 Usa /temas para elegir una temática.\n' +
    '📈 Usa /ranking para ver el ranking.\n' +
    '📝 Usa /minota para ver tu resultado.\n' +
    '⏸ Usa /pausar para detener temporalmente el quiz.\n' +
    '▶️ Usa /reanudar para continuar con el quiz pausado.\n' +
    '👥 Usa /activos para ver quiénes están resolviendo quizzes.'
  );
});



bot.onText(/\/temas/, (msg) => {
  if (!cursoActivo()) return enviarConReintento(msg.chat.id, '⛔ El curso está desactivado.');
  const temas = Object.keys(bancoTemas);
  if (temas.length === 0) return enviarConReintento(msg.chat.id, '⚠️ No hay temáticas disponibles.');
  const botones = temas.map(t => ([{ text: t, callback_data: `tema:${t}` }]));
  enviarConReintento(msg.chat.id, '📚 Elige una temática para comenzar:', {
    reply_markup: { inline_keyboard: botones }
  });
});

bot.onText(/\/minota/, (msg) => {
  const puntajes = leerJSON(RUTA_PUNTAJES);
  const userId = String(msg.chat.id);
  const usuarioNotas = puntajes[userId];
  if (!usuarioNotas) return enviarConReintento(msg.chat.id, '❌ No tienes nota registrada.');
  const botones = Object.entries(usuarioNotas).map(([tema, nota]) => ([{
    text: `${tema} (${nota.puntaje}/${nota.total})`, callback_data: `minota:${tema}`
  }]));
  enviarConReintento(msg.chat.id, '🧪 Elige temática para ver tu nota:', {
    reply_markup: { inline_keyboard: botones }
  });
});

bot.on('callback_query', (cb) => {
  const userId = cb.message.chat.id;
  const data = cb.data;
  const nombre = cb.from.first_name;

  if (data.startsWith('tema:')) {
    const tema = data.split(':')[1];
    if (!bancoTemas[tema]) return enviarConReintento(userId, '❌ Temática inválida.');
    if (usuariosActivos.size >= LIMITE_USUARIOS_CONCURRENTES) return enviarConReintento(userId, '🚫 Límite de usuarios alcanzado.');

    const preguntas = mezclarPreguntas(bancoTemas[tema]);
    estadoTrivia[userId] = { nombre, index: 0, puntaje: 0, preguntas, tema };
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, nombre, `Inició quiz de ${tema}`);
    enviarPregunta(userId);
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('r:')) {
    const [, idx, sel] = data.split(':').map(Number);
    const estado = estadoTrivia[userId];
    if (!estado || idx !== estado.index) return;

    const pregunta = estado.preguntas[idx];
    const correcta = pregunta.correcta;
    if (sel === correcta) {
      estado.puntaje++;
      bot.sendMessage(userId, '✅ ¡Correcto!');
    } else {
      bot.sendMessage(userId, `❌ Incorrecto. Respuesta: ${pregunta.opciones[correcta]}`);
    }

    estado.index++;
    enviarPregunta(userId);
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('ranking:')) {
    const tema = data.split(':')[1];
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const filtrados = Object.values(puntajes).flatMap(u => u[tema] ? [{ nombre: u[tema].nombre, puntaje: u[tema].puntaje }] : []);
    if (filtrados.length === 0) return enviarConReintento(userId, `❌ Sin registros para ${tema}`);
    const lista = filtrados
      .sort((a, b) => b.puntaje - a.puntaje)
      .map((p, i) => `${i + 1}. ${p.nombre}: ${p.puntaje}`)
      .join('\n');
    enviarConReintento(userId, `🏆 Ranking de *${tema}*:\n\n${lista}`, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('minota:')) {
    const tema = data.split(':')[1];
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const p = puntajes[userId] && puntajes[userId][tema];
    if (!p) return enviarConReintento(userId, `❌ No tienes nota registrada para ${tema}.`);
    const porcentaje = Math.round((p.puntaje / p.total) * 100);
    let mensaje = `📊 Tu resultado en ${tema}:\n- Correctas: ${p.puntaje}/${p.total}\n- Aciertos: ${porcentaje}%`;
    if (porcentaje === 100) mensaje += `\n🌟 ¡Excelente!`;
    else if (porcentaje >= 70) mensaje += `\n👍 Buen trabajo.`;
    else mensaje += `\n⚠️ Puedes mejorar.`;
    enviarConReintento(userId, mensaje);
    bot.answerCallbackQuery(cb.id);
  }

  if (data.startsWith('reanudar:')) {
    const tema = data.split(':')[1];
    const estados = leerEstadoUsuarios();
    const pausados = estados[userId];
  
    if (!pausados || !pausados[tema]) {
      return enviarConReintento(userId, `❌ No tienes un quiz pausado en *${tema}*.`, { parse_mode: 'Markdown' });
    }
  
    const estado = pausados[tema];
  
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const nota = puntajes[userId] && puntajes[userId][tema];
  
    if (estado.index >= estado.preguntas.length || (nota && nota.total === estado.preguntas.length)) {
      return enviarConReintento(userId, `✅ Ya finalizaste el quiz de *${tema}*. Usa /minota para ver tu resultado.`, { parse_mode: 'Markdown' });
    }
  
    estadoTrivia[userId] = estado;
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, estado.nombre, `Reanudó quiz de ${tema}`);
    enviarConReintento(userId, `▶️ Continuando quiz de ${tema}...`);
    enviarPregunta(userId);
    bot.answerCallbackQuery(cb.id);
  }
  


function enviarPregunta(userId) {
  const estado = estadoTrivia[userId];
  if (!estado || estado.index >= estado.preguntas.length) return finalizarQuiz(userId);

  // Guardar estado persistente
  const estados = leerEstadoUsuarios();
  estados[userId] = estado;
  guardarEstadoUsuarios(estados);

  const p = estado.preguntas[estado.index];
  const opciones = p.opciones.map((op, i) => [{ text: op, callback_data: `r:${estado.index}:${i}` }]);
  bot.sendMessage(userId, `⏳ 30 segundos...\n\n❓ ${p.pregunta}`, {
    reply_markup: { inline_keyboard: opciones }
  }).then(msg => iniciarCuentaRegresiva(userId, msg.message_id, p.pregunta, opciones));
}


function iniciarCuentaRegresiva(userId, messageId, texto, opciones) {
  // Si ya hay un temporizador activo, lo limpiamos
  if (temporizadoresActivos[userId]) {
    clearInterval(temporizadoresActivos[userId]);
  }

  let tiempo = 30;
  const intervalo = setInterval(async () => {
    tiempo--;

    const estado = estadoTrivia[userId];
    if (!estado || estado.index >= estado.preguntas.length) {
      clearInterval(intervalo);
      delete temporizadoresActivos[userId];
      return;
    }

    if (tiempo <= 0) {
      clearInterval(intervalo);
      delete temporizadoresActivos[userId];
      await enviarConReintento(userId, '⌛ Tiempo agotado.');
      estado.index++;
      await new Promise(res => setTimeout(res, 1500));
      enviarPregunta(userId);
      return;
    }

    bot.editMessageText(`⏳ ${tiempo} segundos restantes\n\n❓ ${texto}`, {
      chat_id: userId,
      message_id: messageId,
      reply_markup: { inline_keyboard: opciones }
    }).catch(() => {});
  }, 1000);

  temporizadoresActivos[userId] = intervalo;
}

function finalizarQuiz(userId) {
  const estado = estadoTrivia[userId];
  const puntajes = leerJSON(RUTA_PUNTAJES);
  const userKey = String(userId);
  if (!puntajes[userKey]) puntajes[userKey] = {};
  puntajes[userKey][estado.tema] = {
    nombre: estado.nombre,
    puntaje: estado.puntaje,
    total: estado.preguntas.length
  };
  guardarJSON(RUTA_PUNTAJES, puntajes);
  const porcentaje = Math.round((estado.puntaje / estado.preguntas.length) * 100);
  let mensaje = `🎉 Quiz finalizado: ${estado.tema}\n\n📊 Total: ${estado.preguntas.length}\n✅ Correctas: ${estado.puntaje}\n📈 Acierto: ${porcentaje}%`;
  if (porcentaje === 100) mensaje += `\n🌟 ¡Excelente!`;
  else if (porcentaje >= 70) mensaje += `\n👍 Buen trabajo.`;
  else mensaje += `\n⚠️ Puedes mejorar.`;
  enviarConReintento(userId, mensaje);
  usuariosActivos.delete(userId);
  delete estadoTrivia[userId];
  if (temporizadoresActivos[userId]) {
    clearInterval(temporizadoresActivos[userId]);
    delete temporizadoresActivos[userId];
  }
}

bot.onText(/\/ranking/, (msg) => {
  const temas = Object.keys(bancoTemas);
  if (temas.length === 0) return enviarConReintento(msg.chat.id, '⚠️ No hay temáticas.');
  const botones = temas.map(t => ([{ text: t, callback_data: `ranking:${t}` }]));
  enviarConReintento(msg.chat.id, '📈 Elige temática para ver ranking:', {
    reply_markup: { inline_keyboard: botones }
  });
});

bot.onText(/\/activos/, (msg) => {
  if (msg.chat.id !== adminPermitido) return enviarConReintento(msg.chat.id, '🚫 Solo el profesor puede usar este comando.');
  if (usuariosActivos.size === 0) return enviarConReintento(msg.chat.id, '📭 No hay estudiantes activos.');
  let conteoPorTema = {}, lista = '';
  for (const [userId] of usuariosActivos.entries()) {
    const estado = estadoTrivia[userId];
    if (!estado) continue;
    const { nombre, tema } = estado;
    lista += `- ${nombre} (${tema})\n`;
    conteoPorTema[tema] = (conteoPorTema[tema] || 0) + 1;
  }
  let resumen = `👥 Estudiantes activos: ${usuariosActivos.size}\n\n`;
  for (const [tema, cantidad] of Object.entries(conteoPorTema)) {
    resumen += `📚 ${tema}: ${cantidad}\n`;
  }
  resumen += `\n📝 Lista:\n${lista}`;
  enviarConReintento(msg.chat.id, resumen);
});

bot.onText(/\/pausar/, (msg) => {
  const userId = msg.chat.id;
  const estado = estadoTrivia[userId];
  if (!estado) return enviarConReintento(userId, '❌ No tienes un quiz en progreso.');

  const estados = leerEstadoUsuarios();
  if (!estados[userId]) estados[userId] = {};
  estados[userId][estado.tema] = estado;
  guardarEstadoUsuarios(estados);

  delete estadoTrivia[userId];
  usuariosActivos.delete(userId);

  if (temporizadoresActivos[userId]) {
    clearInterval(temporizadoresActivos[userId]);
    delete temporizadoresActivos[userId];
  }

  enviarConReintento(userId, `⏸ Quiz *${estado.tema}* pausado. Puedes retomarlo con /reanudar.`, { parse_mode: 'Markdown' });
});
if (data.startsWith('reanudar:')) {

bot.onText(/\/reanudar/, (msg) => {
  const userId = msg.chat.id;
  const estados = leerEstadoUsuarios();
  const pausados = estados[userId];

  if (!pausados || Object.keys(pausados).length === 0) {
    return enviarConReintento(userId, '❌ No tienes quizzes pausados.');
  }

  const temasPausados = Object.entries(pausados).filter(([tema, estado]) => {
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const nota = puntajes[userId] && puntajes[userId][tema];
    return estado.index < estado.preguntas.length && !nota;
  });

  if (temasPausados.length === 0) {
    return enviarConReintento(userId, '✅ Ya finalizaste todos los quizzes que habías pausado.');
  }

  // Si hay solo uno, lo continúa directamente
  if (temasPausados.length === 1) {
    const [tema, estado] = temasPausados[0];
    estadoTrivia[userId] = estado;
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, estado.nombre, `Reanudó quiz de ${tema}`);
    enviarConReintento(userId, `▶️ Continuando quiz de ${tema}...`);
    enviarPregunta(userId);
    return;
  }

  // Si hay varios, muestra menú
  const botones = temasPausados.map(([tema]) => ([{ text: tema, callback_data: `reanudar:${tema}` }]));
  enviarConReintento(userId, '🔄 Tienes varios quizzes pausados. ¿Cuál deseas continuar?', {
    reply_markup: { inline_keyboard: botones }
  });
});


