const SQLiteTab = require('sqlite3-tab');
const TablaModel = require('tabla-model');
const path = require('path');

// Permite usar una base distinta para pruebas o restauraciones controladas.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../liceo.sqlite');

function createConnection() {
  return new SQLiteTab({ filename: DB_PATH });
}

const dbConnection = createConnection();

const EstudianteModel = new TablaModel({
  table: 'estudiantes',
  db: dbConnection
});

const NotaModel = new TablaModel({
  table: 'notas',
  db: dbConnection
});

/**
 * Aplica ajustes de integridad y concurrencia a la conexión activa.
 * SQLite no activa las claves foráneas por defecto en todas las versiones,
 * y busy_timeout evita fallos cuando hay dos usuarios escribiendo a la vez.
 */
async function configureConnection() {
  await dbConnection.query('PRAGMA foreign_keys = ON');
  await dbConnection.query('PRAGMA busy_timeout = 5000');

  try {
    await dbConnection.query('PRAGMA journal_mode = WAL');
    await dbConnection.query('PRAGMA synchronous = NORMAL');
  } catch (error) {
    console.warn('[BD] No se pudo activar WAL:', error.message);
  }
}

/**
 * Cierra la conexión actual y abre una nueva sobre el mismo archivo.
 * Se usa después de restaurar un respaldo para que la aplicación vea
 * inmediatamente la base reemplazada.
 */
async function reconnectDatabase(closeCurrent = true) {
  if (closeCurrent) {
    try {
      dbConnection.close();
    } catch (error) {
      console.warn('[BD] La conexión anterior ya estaba cerrada:', error.message);
    }
  }

  const fresh = createConnection();
  dbConnection.connection = fresh.connection;
  dbConnection._isNative = fresh._isNative;
  dbConnection._caheTablas = {};
  dbConnection._cacheTablas = dbConnection._caheTablas;

  await configureConnection();
}

async function closeDatabase() {
  try {
    dbConnection.close();
  } catch (error) {
    console.warn('[BD] Error al cerrar la conexión:', error.message);
  }
}

module.exports = {
  EstudianteModel,
  NotaModel,
  dbConnection,
  DB_PATH,
  configureConnection,
  reconnectDatabase,
  closeDatabase
};
