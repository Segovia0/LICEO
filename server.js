const express = require('express');
const path = require('path');
const cors = require('cors');

// 1. Importar la conexión a la base de datos de forma obligatoria

const { dbConnection } = require('./config/db');

const estudianteRoutes = require('./routes/estudianteRoutes');
const authRoutes = require('./routes/authRoutes');
const usuarios = require('./models/usuarioModel');

// Función para asegurar que el usuario por defecto exista al arrancar usando tabla-model
async function inicializarAdminPorDefecto() {
  try {
    const existentes = await usuarios.all();
    
    if (!existentes || existentes.length === 0) {
      await usuarios.insert({
        usuario: 'admin',
        clave: '1234',
        rol: 'admin'
      });
      console.log('[SISTEMA] Usuario administrador por defecto creado (Usuario: admin / Clave: 1234)');
    }
  } catch (error) {
    console.error('[AVISO] No se pudo verificar el usuario por defecto:', error.message);
  }
}

// Ejecutar la función al iniciar
inicializarAdminPorDefecto();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir los archivos del frontend desde una carpeta llamada 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Carpeta estática para las fotos (Multer)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rutas de la API
app.use('/api/estudiantes', estudianteRoutes);
app.use('/api/auth', authRoutes);

// Redirección por defecto a login si entra a la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Arranque directo del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor del Liceo Management System corriendo en el puerto ${PORT}`);
});
