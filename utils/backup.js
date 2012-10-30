/**
 * Utilidades de respaldo y restauración.
 * Los respaldos de la base se hacen con VACUUM INTO para obtener una copia
 * consistente aunque la aplicación esté en uso.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const tar = require('tar');

const {
  dbConnection,
  DB_PATH,
  reconnectDatabase
} = require('../config/db');
const { runMigrations } = require('../config/migrations');

const ROOT_DIR = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const FOTOS_DIR = path.join(UPLOADS_DIR, 'estudiantes');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  DatabaseSync = null;
}

function fechaParaArchivo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function nombreRespaldo(extension = '.sqlite') {
  return `StudioCT_Backup_${fechaParaArchivo()}${extension}`;
}

async function asegurarDirectorios() {
  await fsp.mkdir(TEMP_DIR, { recursive: true });
  await fsp.mkdir(FOTOS_DIR, { recursive: true });
}

async function eliminarArchivo(ruta) {
  try {
    await fsp.unlink(ruta);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[RESPALDO] No se pudo eliminar archivo temporal:', error.message);
    }
  }
}

/**
 * Crea una copia consistente de la base activa.
 */
async function crearSnapshotDb(destino) {
  await fsp.mkdir(path.dirname(destino), { recursive: true });
  await eliminarArchivo(destino);

  await dbConnection.query('VACUUM INTO ?', [destino]);

  if (!fs.existsSync(destino)) {
    throw new Error('No se pudo generar la copia de la base de datos');
  }

  return destino;
}

function validarConNodeSqlite(archivo) {
  const db = new DatabaseSync(archivo, { readOnly: true });

  try {
    const integridad = db.prepare('PRAGMA integrity_check').all();
    if (!integridad.length || integridad[0].integrity_check !== 'ok') {
      throw new Error('La base de datos no pasó la verificación de integridad');
    }

    const tablas = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((fila) => fila.name)
    );

    for (const tabla of ['estudiantes', 'notas', 'usuarios']) {
      if (!tablas.has(tabla)) {
        throw new Error(`El archivo no contiene la tabla requerida: ${tabla}`);
      }
    }

    const columnasEstudiantes = new Set(
      db.prepare("PRAGMA table_info('estudiantes')").all().map((fila) => fila.name)
    );

    for (const columna of [
      'id', 'nombre_apellido', 'cedula', 'fecha_nacimiento',
      'ano_cursar', 'seccion', 'condicion', 'codigo_expediente'
    ]) {
      if (!columnasEstudiantes.has(columna)) {
        throw new Error(`La tabla estudiantes no tiene la columna requerida: ${columna}`);
      }
    }

    const columnasNotas = new Set(
      db.prepare("PRAGMA table_info('notas')").all().map((fila) => fila.name)
    );

    for (const columna of ['id', 'estudiante_id', 'nombre_materia', 'lapso1', 'lapso2', 'lapso3']) {
      if (!columnasNotas.has(columna)) {
        throw new Error(`La tabla notas no tiene la columna requerida: ${columna}`);
      }
    }

    const usuarios = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get();
    if (!usuarios || Number(usuarios.total) === 0) {
      throw new Error('El respaldo no contiene usuarios; no sería posible iniciar sesión');
    }

    return true;
  } finally {
    db.close();
  }
}

function validarConSqlite3(archivo) {
  // Compatibilidad con Node.js 18, donde no existe node:sqlite.
  const sqlite3 = require('sqlite3');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(archivo, sqlite3.OPEN_READONLY, (error) => {
      if (error) return reject(new Error('El archivo no es una base SQLite válida'));

      db.all('PRAGMA integrity_check', (errorIntegridad, filas) => {
        if (errorIntegridad) {
          db.close();
          return reject(new Error('No se pudo verificar la integridad del respaldo'));
        }

        if (!filas.length || filas[0].integrity_check !== 'ok') {
          db.close();
          return reject(new Error('La base de datos no pasó la verificación de integridad'));
        }

        db.all(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
          (errorTablas, tablas) => {
            if (errorTablas) {
              db.close();
              return reject(new Error('No se pudieron leer las tablas del respaldo'));
            }

            const nombres = new Set(tablas.map((fila) => fila.name));
            for (const tabla of ['estudiantes', 'notas', 'usuarios']) {
              if (!nombres.has(tabla)) {
                db.close();
                return reject(new Error(`El archivo no contiene la tabla requerida: ${tabla}`));
              }
            }

            db.get('SELECT COUNT(*) AS total FROM usuarios', (errorUsuarios, filaUsuarios) => {
              db.close();

              if (errorUsuarios || !filaUsuarios || Number(filaUsuarios.total) === 0) {
                return reject(new Error('El respaldo no contiene usuarios; no sería posible iniciar sesión'));
              }

              resolve(true);
            });
          }
        );
      });
    });
  });
}

async function validarArchivoSqlite(archivo) {
  if (!archivo || !fs.existsSync(archivo)) {
    throw new Error('El archivo de respaldo no existe');
  }

  if (DatabaseSync) {
    return validarConNodeSqlite(archivo);
  }

  return validarConSqlite3(archivo);
}

async function crearBackupCompleto(destino) {
  await asegurarDirectorios();
  await fsp.mkdir(path.dirname(destino), { recursive: true });

  const staging = path.join(TEMP_DIR, `full-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(staging, { recursive: true });

  try {
    const dbSnapshot = path.join(staging, 'liceo.sqlite');
    await crearSnapshotDb(dbSnapshot);

    const entradas = ['liceo.sqlite'];

    if (fs.existsSync(FOTOS_DIR)) {
      const destinoFotos = path.join(staging, 'uploads', 'estudiantes');
      await fsp.mkdir(path.dirname(destinoFotos), { recursive: true });
      await fsp.cp(FOTOS_DIR, destinoFotos, { recursive: true, force: true });
      entradas.push('uploads');
    }

    await eliminarArchivo(destino);
    await tar.c(
      {
        gzip: true,
        file: destino,
        cwd: staging,
        portable: true
      },
      entradas
    );

    return destino;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

async function reemplazarBaseDeDatos(archivoSqlite) {
  await validarArchivoSqlite(archivoSqlite);

  const preRestore = path.join(TEMP_DIR, `prerestore-${fechaParaArchivo()}.sqlite`);
  await crearSnapshotDb(preRestore);

  try {
    // Vaciar el WAL antes de cerrar para no perder cambios recientes.
    try {
      await dbConnection.query('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.warn('[RESPALDO] No se pudo hacer checkpoint del WAL:', error.message);
    }

    try {
      dbConnection.close();
    } catch (error) {
      console.warn('[RESPALDO] La conexión ya estaba cerrada:', error.message);
    }

    for (const sufijo of ['-wal', '-shm', '-journal']) {
      await eliminarArchivo(`${DB_PATH}${sufijo}`);
    }

    await fsp.copyFile(archivoSqlite, DB_PATH);

    await reconnectDatabase(false);
    await runMigrations();

    return preRestore;
  } catch (error) {
    // Intentar volver a la base anterior si algo falló durante el reemplazo.
    try {
      if (fs.existsSync(preRestore)) {
        try {
          dbConnection.close();
        } catch (errorCierre) {
          // La conexión puede estar cerrada.
        }

        for (const sufijo of ['-wal', '-shm', '-journal']) {
          await eliminarArchivo(`${DB_PATH}${sufijo}`);
        }

        await fsp.copyFile(preRestore, DB_PATH);
        await reconnectDatabase(false);
        await runMigrations();
      }
    } catch (errorRecuperacion) {
      console.error('[RESPALDO] No se pudo recuperar la base anterior:', errorRecuperacion);
    }

    throw error;
  }
}

async function buscarArchivoPorExtension(directorio, extension) {
  const entradas = await fsp.readdir(directorio, { withFileTypes: true });

  for (const entrada of entradas) {
    if (entrada.isSymbolicLink()) continue;

    const ruta = path.join(directorio, entrada.name);

    if (entrada.isDirectory()) {
      const encontrado = await buscarArchivoPorExtension(ruta, extension);
      if (encontrado) return encontrado;
    } else if (entrada.name.toLowerCase().endsWith(extension)) {
      return ruta;
    }
  }

  return null;
}

async function restaurarDesdeArchivo(archivo, nombreOriginal = '') {
  const nombre = String(nombreOriginal || archivo).toLowerCase();
  const esTar = nombre.endsWith('.tar.gz') || nombre.endsWith('.tgz');

  if (!esTar) {
    const preRestore = await reemplazarBaseDeDatos(archivo);
    return { preRestore, restauroFotos: false };
  }

  await asegurarDirectorios();
  const extraccion = path.join(TEMP_DIR, `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fsp.mkdir(extraccion, { recursive: true });

  try {
    await tar.x({
      file: archivo,
      cwd: extraccion,
      strict: true,
      filter: (rutaEntrada) => {
        const normalizada = path.normalize(rutaEntrada);
        return !normalizada.startsWith('..') && !path.isAbsolute(normalizada);
      }
    });

    const dbFile = await buscarArchivoPorExtension(extraccion, '.sqlite');
    if (!dbFile) {
      throw new Error('El respaldo completo no contiene un archivo .sqlite');
    }

    const preRestore = await reemplazarBaseDeDatos(dbFile);

    let restauroFotos = false;
    const fotosExtraidas = path.join(extraccion, 'uploads', 'estudiantes');

    if (fs.existsSync(fotosExtraidas)) {
      await fsp.mkdir(FOTOS_DIR, { recursive: true });
      await fsp.cp(fotosExtraidas, FOTOS_DIR, { recursive: true, force: true });
      restauroFotos = true;
    }

    return { preRestore, restauroFotos };
  } finally {
    await fsp.rm(extraccion, { recursive: true, force: true });
  }
}

module.exports = {
  TEMP_DIR,
  nombreRespaldo,
  crearSnapshotDb,
  crearBackupCompleto,
  validarArchivoSqlite,
  restaurarDesdeArchivo,
  eliminarArchivo
};
