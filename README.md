# 🤖 Phys25Bot – Bot Educativo de Física para Telegram

**5thBot** es un bot educativo desarrollado en Node.js que permite a estudiantes de física practicar trivias clasificadas por temáticas como **Cinemática**, **Vectores** y **Unidades**. Incluye retroalimentación inmediata, tiempo límite por pregunta, registros de puntaje, y rankings de desempeño.

Fue diseñado con fines didácticos para cursos de primeros semestres en física universitaria, especialmente en entornos STEM.

---

## ✨ Características principales

- 📚 Banco de preguntas por temática (Cinemática, Vectores, Unidades)
- ✅ Corrección automática de respuestas
- ⏱️ Límite de 20 segundos por pregunta con cuenta regresiva
- 🧠 Registro de puntajes y notas individuales por tema
- 🏆 Rankings de rendimiento por grupo y temática
- 🧾 Historial por estudiante
- 👨‍🏫 Comandos de administración exclusivos para docentes
- 📂 Persistencia local con archivos `.json`
- 🔐 Seguridad con uso de variables de entorno (`.env`)

---

## ⚙️ Instalación y uso local

### 1. Clona el repositorio

```bash
git clone https://github.com/TU_USUARIO/PhysBot.git
cd PhysBot
```

### 2. Instala las dependencias

```bash
npm install
```

### 3. Crea un archivo `.env`

Agrega tu token de bot de Telegram:

```env
BOT_TOKEN=TU_TOKEN_AQUI
```

### 4. Ejecuta el bot

```bash
node bot.js
```

---

## 🧾 Comandos disponibles

### Para estudiantes

- `/start`: Mensaje de bienvenida
- `/temas`: Lista de temáticas disponibles
- `/minota`: Ver tu puntaje por temática
- `/ranking`: Ranking por temática

### Para docentes (solo si el ID coincide con `adminPermitido`)

- `/activar`: Activa el bot para recibir preguntas
- `/desactivar`: Desactiva el bot
- `/activos`: Muestra estudiantes activos actualmente

---

## 🔐 Seguridad

- Usa un archivo `.env` para ocultar tu token.
- Agrega `.env` a `.gitignore` para evitar subirlo a GitHub.
- Nunca compartas el valor de tu token públicamente.

---

## 📁 Estructura del proyecto

```
PhysBot/
├── bot.js
├── preguntas.json
├── puntajes.json
├── historial.json
├── estado_curso.json
├── .env            # (No debe subirse a GitHub)
├── .gitignore
├── README.md
├── package.json
└── package-lock.json
```

---

## 📦 Requisitos

- Node.js (v14 o superior)
- npm

---

## 🛠️ Tecnologías utilizadas

- Node.js
- node-telegram-bot-api
- JSON para almacenamiento local
- dotenv

---

## 👤 Autor

- **Luis Ladino**
- GitHub: [Ladino72](https://github.com/Ladino72)

---

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT.

---

## 📌 Estado del proyecto

- [x] Versión MVP funcionando
- [ ] Soporte para imágenes LaTeX
- [ ] Exportación a Excel
- [ ] Hosting en Railway
- [ ] Modo profesor interactivo

---

## 🤝 Contribuciones

¡Contribuciones bienvenidas! Abre un issue o un pull request.
