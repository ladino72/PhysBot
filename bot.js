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

// 3. Callback reanudar:<tema> y otros (ranking, minota...)
bot.on('callback_query', (cb) => {
  const userId = cb.message.chat.id;
  const data = cb.data;
  const nombre = cb.from.first_name;

  // 1. Manejo de selección de tema
  if (data.startsWith('tema:')) {
    const tema = data.split(':')[1];
    iniciarQuiz(userId, nombre, tema);
    return bot.answerCallbackQuery(cb.id);
  }

  // 2. Manejo de reanudar
  if (data.startsWith('reanudar:')) {
    const tema = data.split(':')[1];
    const estados = leerEstadoUsuarios();
    const pausados = estados[userId];

    if (!pausados || !pausados[tema]) {
      return enviarConReintento(userId, `❌ No tienes un quiz pausado en *${tema}*.`, { parse_mode: 'Markdown' });
    }

    const estado = pausados[tema];

    if (!estado || estado.index >= estado.preguntas.length) {
      return enviarConReintento(userId, `✅ Ya finalizaste el quiz de *${tema}*. Usa /minota para ver tu resultado.`, { parse_mode: 'Markdown' });
    }

    estadoTrivia[userId] = estado;
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, estado.nombre, `Reanudó quiz de ${tema}`);
    enviarConReintento(userId, `▶️ Continuando quiz de ${tema}...`);
    enviarPregunta(userId);
    return bot.answerCallbackQuery(cb.id);
  }

  // 3. Manejo de respuesta del quiz
  if (data.startsWith('r:')) {
    const [, indexStr, opcionStr] = data.split(':');
    const index = parseInt(indexStr);
    const opcion = parseInt(opcionStr);
    const estado = estadoTrivia[userId];

    if (!estado || index !== estado.index) return bot.answerCallbackQuery(cb.id);

    const correcta = estado.preguntas[index].respuesta;
    const esCorrecta = (opcion === correcta);
    if (esCorrecta) estado.puntaje++;

    estado.index++;
    bot.answerCallbackQuery(cb.id, { text: esCorrecta ? '✅ Correcto' : '❌ Incorrecto' });
    enviarPregunta(userId);
    return;
  }

  // 4. Ranking por tema
  if (data.startsWith('ranking:')) {
    const tema = data.split(':')[1];
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const ranking = Object.entries(puntajes)
      .map(([id, temas]) => ({ nombre: temas[tema]?.nombre || 'Anónimo', puntaje: temas[tema]?.puntaje || 0, total: temas[tema]?.total || 0 }))
      .filter(p => p.total > 0)
      .sort((a, b) => b.puntaje - a.puntaje);

    if (ranking.length === 0) {
      return enviarConReintento(userId, `📊 No hay datos para ${tema}.`);
    }

    const texto = ranking.map((r, i) => `${i + 1}. ${r.nombre}: ${r.puntaje}/${r.total}`).join('\n');
    return enviarConReintento(userId, `🏆 Ranking - ${tema}\n\n${texto}`);
  }

  // 5. Mostrar nota personal por tema
  if (data.startsWith('minota:')) {
    const tema = data.split(':')[1];
    const puntajes = leerJSON(RUTA_PUNTAJES);
    const nota = puntajes[userId] && puntajes[userId][tema];

    if (!nota) {
      return enviarConReintento(userId, `❌ No tienes nota para *${tema}*.`, { parse_mode: 'Markdown' });
    }

    const porcentaje = Math.round((nota.puntaje / nota.total) * 100);
    let mensaje = `📘 Nota en ${tema}\n\n✅ Correctas: ${nota.puntaje}\n📊 Total: ${nota.total}\n📈 Acierto: ${porcentaje}%`;
    if (porcentaje === 100) mensaje += `\n🌟 ¡Excelente!`;
    else if (porcentaje >= 70) mensaje += `\n👍 Buen trabajo.`;
    else mensaje += `\n⚠️ Puedes mejorar.`;

    return enviarConReintento(userId, mensaje);
  }
});


// 4. Limpieza automática al finalizar quiz
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

  // Eliminar estado pausado si existía
  const estados = leerEstadoUsuarios();
  if (estados[userId] && estados[userId][estado.tema]) {
    delete estados[userId][estado.tema];
    guardarEstadoUsuarios(estados);
  }

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

// Función que estaba faltando: iniciarQuiz
function iniciarQuiz(userId, nombre, tema) {
  const preguntasOriginales = bancoTemas[tema];
  if (!preguntasOriginales || preguntasOriginales.length === 0) {
    return enviarConReintento(userId, '⚠️ No hay preguntas disponibles para este tema.');
  }

  const preguntas = mezclarPreguntas(preguntasOriginales).slice(0, 20); // Limitar a 20
  estadoTrivia[userId] = {
    nombre,
    tema,
    preguntas,
    index: 0,
    puntaje: 0
  };

  usuariosActivos.set(userId, true);
  registrarHistorial(userId, nombre, `Inició quiz de ${tema}`);
  enviarConReintento(userId, `🧪 Iniciando quiz de *${tema}*...`, { parse_mode: 'Markdown' });
  enviarPregunta(userId);
}

// 1. Comando /pausar
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

// 2. Comando /reanudar con menú si hay múltiples temas pausados
bot.onText(/\/reanudar/, (msg) => {
  const userId = msg.chat.id;
  const estados = leerEstadoUsuarios();

  if (!estados[userId]) {
    return enviarConReintento(userId, '❌ No tienes ningún quiz pausado.');
  }

  const temasPausados = Object.keys(estados[userId]);

  if (temasPausados.length === 0) {
    return enviarConReintento(userId, '❌ No tienes ningún quiz pausado.');
  }

  if (temasPausados.length === 1) {
    const tema = temasPausados[0];
    const estado = estados[userId][tema];

    if (!estado || estado.index >= estado.preguntas.length) {
      return enviarConReintento(userId, `✅ Ya finalizaste el quiz de *${tema}*. Usa /minota para ver tu resultado.`, { parse_mode: 'Markdown' });
    }

    estadoTrivia[userId] = estado;
    usuariosActivos.set(userId, true);
    registrarHistorial(userId, estado.nombre, `Reanudó quiz de ${tema}`);
    enviarConReintento(userId, `▶️ Continuando quiz de ${tema}...`);
    enviarPregunta(userId);
    return;
  }

  const botones = temasPausados.map(tema => [{ text: tema, callback_data: `reanudar:${tema}` }]);
  enviarConReintento(userId, '🔄 Tienes varios quizzes pausados. Elige uno para continuar:', {
    reply_markup: { inline_keyboard: botones }
  });
});

