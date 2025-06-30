require('dotenv').config();
const axios = require('axios');

const token = process.env.BOT_TOKEN;
const url = process.env.URL;

if (!token || !url) {
  console.error("❌ Falta BOT_TOKEN o URL en el archivo .env");
  process.exit(1);
}

const fullWebhookUrl = `${url}/bot${token}`;

axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
  url: fullWebhookUrl
})
.then(res => {
  if (res.data.ok) {
    console.log(`✅ Webhook configurado correctamente: ${fullWebhookUrl}`);
  } else {
    console.error('❌ Error al configurar webhook:', res.data);
  }
})
.catch(err => {
  if (err.response) {
    console.error('❌ Error en la respuesta:', err.response.data);
  } else {
    console.error('❌ Error en la solicitud:', err.message);
  }
});
