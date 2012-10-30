require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// 1. Conexión y configuración de la base de datos
const {
  dbConnection,
  configureConnection,
  closeDatabase
} = require('./config/db');
const { runMigrations } = require('./config/migrations');
const { getJwtSecret } = require('./config/security');

const estudianteRoutes = require('./routes/estudianteRoutes');
const authRoutes = require('./routes/authRoutes');
const backupRoutes = require('./routes/backupRoutes');
const usuarios = require('./models/usuarioModel');

const securityHeaders = require('./middleware/securityHeaders');

// Validación temprana: la aplicación no debe arrancar con un secreto JWT débil.
try {
  getJwtSecret();
} catch (error) {
  console.error(`[CONFIGURACIÓN] ${error.message}`);
  process.exit(1);
}

// Crear directorios necesarios para uploads y temporales
const uploadsDir = path.join(__dirname, 'uploads/estudiantes');
const tempDir = path.join(__dirname, 'uploads/temp');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const CLAVES_DEBILES = new Set([
  '1234',
  'admin',
  'admin123',
  'admin1234',
  'password',
  'liceo1234'
]);

function esBcryptHash(valor) {
  return typeof valor === 'string' && (
    valor.startsWith('$2a$') ||
    valor.startsWith('$2b$') ||
    valor.startsWith('$2y$')
  );
}

async function inicializarAdminPorDefecto() {
  try {
    const adminUser = process.env.ADMIN_DEFAULT_USER || 'admin';
    const adminPass = process.env.ADMIN_DEFAULT_PASS || 'admin1234';
    const existentes = await usuarios.all();

    if (!existentes || existentes.length === 0) {
      const claveHash = await bcrypt.hash(adminPass, 12);
      await usuarios.insert({
        usuario: adminUser,
        clave: claveHash,
        rol: 'admin',
        debe_cambiar_clave: CLAVES_DEBILES.has(adminPass)
      });

      console.log(
        `[SISTEMA] Administrador creado (Usuario: ${adminUser}).` +
        (CLAVES_DEBILES.has(adminPass) ? ' Se solicitará cambiar la contraseña al iniciar sesión.' : '')
      );
      return;
    }

    const adminExistente = await usuarios.findByUsername(adminUser);
    if (!adminExistente) {
      console.warn(`[SISTEMA] No existe el usuario administrador '${adminUser}'.`);
      return;
    }

    // Migración defensiva de contraseñas antiguas en texto plano.
    if (!esBcryptHash(adminExistente.clave)) {
      const clavePlana = String(adminExistente.clave);
      const claveHash = await bcrypt.hash(clavePlana, 12);
      await usuarios.updatePassword(adminExistente.id, claveHash, false);

      if (CLAVES_DEBILES.has(clavePlana)) {
        await usuarios.setDebeCambiarClave(adminExistente.id, true);
      }

      console.log(
        `[SEGURIDAD] Contraseña plana de '${adminUser}' migrada a Bcrypt.` +
        (CLAVES_DEBILES.has(clavePlana) ? ' Se solicitará cambiarla al iniciar sesión.' : '')
      );
      return;
    }

    // Si el administrador conserva una clave débil conocida, obligarlo a cambiarla.
    if (!adminExistente.debe_cambiar_clave) {
      for (const claveDebil of CLAVES_DEBILES) {
        if (await bcrypt.compare(claveDebil, adminExistente.clave)) {
          await usuarios.setDebeCambiarClave(adminExistente.id, true);
          console.warn(
            `[SEGURIDAD] La contraseña de '${adminUser}' es débil. ` +
            'Se solicitará cambiarla al iniciar sesión.'
          );
          break;
        }
      }
    }
  } catch (error) {
    console.error('[AVISO] No se pudo verificar el usuario administrador:', error.message);
  }
}

const app = express();

// Seguridad en cabeceras HTTP
app.disable('x-powered-by');
app.use(securityHeaders);

// Si está detrás de un proxy inverso (Caddy/Nginx), confiar en su IP real.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// CORS: por defecto solo mismo origen. Configure CORS_ORIGIN si usa otro dominio.
const allowedOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origen) => origen.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// Middlewares globales
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Servir frontend y carpeta de fotos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Verificación de salud para monitoreo y respaldos
app.get('/api/health', async (req, res) => {
  try {
    await dbConnection.query('SELECT 1 AS ok');
    res.json({
      success: true,
      status: 'ok',
      engine: dbConnection.engine,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'error',
      message: 'La base de datos no responde'
    });
  }
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/estudiantes', estudianteRoutes);
app.use('/api/backup', backupRoutes);

// Redirección por defecto al login si entra a la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Manejador global de errores para evitar fugas de información
app.use((err, req, res, next) => {
  console.error('[EXCEPCIÓN NO CONTROLADA]:', err);

  if (res.headersSent) {
    return next(err);
  }

  if (err.name === 'MulterError') {
    const mensaje = err.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo supera el tamaño permitido.'
      : 'No se pudo procesar el archivo adjunto.';
    return res.status(400).json({ success: false, message: mensaje });
  }

  const status = Number(err.status) || 500;
  const mensaje = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'Ocurrió un error inesperado en el servidor'
    : (err.message || 'Ocurrió un error inesperado en el servidor');

  res.status(status).json({ success: false, message: mensaje });
});

const PORT = process.env.PORT || 3000;
let server = null;

async function start() {
  await configureConnection();
  await runMigrations();
  await inicializarAdminPorDefecto();

  server = app.listen(PORT, () => {
    console.log(`🚀 Servidor del Liceo Management System corriendo en el puerto ${PORT}`);
    console.log(`📁 Base de datos: ${dbConnection.engine}`);
  });
}

async function shutdown(signal) {
  console.log(`\n[${signal}] Cerrando servidor...`);

  const finalizar = async () => {
    await closeDatabase();
    process.exit(0);
  };

  if (server) {
    server.close(() => {
      finalizar().catch(() => process.exit(1));
    });

    setTimeout(() => process.exit(1), 5000).unref();
  } else {
    await finalizar();
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error('[ARRANQUE] No se pudo iniciar la aplicación:', error);
  process.exit(1);
});
