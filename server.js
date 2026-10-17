const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./config/db');
const estudianteRoutes = require('./routes/estudianteRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/estudiantes', estudianteRoutes);

// Inicializar la base de datos SQL antes de levantar el servidor HTTP
db.initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log('📁 Base de datos relacional SQLite activa en liceo.sqlite');
  });
}).catch(err => {
  console.error('❌ Error al iniciar SQLite:', err);
});
