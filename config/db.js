const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../liceo.sqlite');

let db;

// Guardar los cambios del motor SQLite al archivo en disco
function guardarEnDisco() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Inicializar SQLite
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // Sentencias SQL estándar para estructurar la base de datos relacional
  db.run(`
    CREATE TABLE IF NOT EXISTS estudiantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_apellido TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      fecha_nacimiento TEXT NOT NULL,
      ano_cursar TEXT NOT NULL,
      seccion TEXT NOT NULL,
      condicion TEXT NOT NULL,
      codigo_expediente TEXT NOT NULL UNIQUE,
      foto_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estudiante_id INTEGER NOT NULL,
      nombre_materia TEXT NOT NULL,
      lapso1 REAL DEFAULT 0.0,
      lapso2 REAL DEFAULT 0.0,
      lapso3 REAL DEFAULT 0.0,
      FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id) ON DELETE CASCADE
    );
  `);

  guardarEnDisco();
  console.log('✅ Base de datos SQLite (SQL Relacional) inicializada correctamente');
}

// Helper para consultas SELECT (devuelve array de objetos)
function query(sqlText, params = []) {
  const stmt = db.prepare(sqlText);
  stmt.bind(params);
  const result = [];
  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

// Helper para INSERT, UPDATE, DELETE
function run(sqlText, params = []) {
  db.run(sqlText, params);
  guardarEnDisco();
}

module.exports = { initDB, query, run };
