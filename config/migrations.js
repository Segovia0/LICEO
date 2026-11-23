/**
 * Migraciones idempotentes de StudioCT.
 * Se ejecutan al arrancar el servidor y también después de restaurar un respaldo.
 */

const { dbConnection } = require('./db');
const {
  MATERIAS_DEFECTO,
  normalizarAno,
  normalizarCondicion,
  normalizarEstado,
  normalizarCedula
} = require('./constants');

async function tableExists(nombre) {
  const rows = await dbConnection.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [nombre]
  );
  return rows.length > 0;
}

async function columnExists(tabla, columna) {
  const rows = await dbConnection.query(`PRAGMA table_info('${tabla}')`);
  return rows.some((row) => row.name === columna);
}

async function indexExists(nombre) {
  const rows = await dbConnection.query(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    [nombre]
  );
  return rows.length > 0;
}

// Las correcciones sobre datos históricos deben ejecutarse una sola vez.
// De lo contrario, un cero cargado legítimamente por un docente se
// convertiría en NULL en el siguiente arranque.
const MIGRACION_CEROS_HISTORICOS = '2026-11-notas-ceros-historicos';

async function migracionAplicada(nombre) {
  const filas = await dbConnection.query(
    'SELECT nombre FROM migraciones WHERE nombre = ?',
    [nombre]
  );
  return filas.length > 0;
}

async function marcarMigracion(nombre) {
  await dbConnection.query(
    'INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)',
    [nombre]
  );
}

async function agregarColumnaSiFalta(tabla, columna, definicion) {
  if (!(await columnExists(tabla, columna))) {
    await dbConnection.query(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    return true;
  }
  return false;
}

async function deduplicarNotas() {
  const filas = await dbConnection.query(
    `SELECT id, estudiante_id, nombre_materia, lapso1, lapso2, lapso3
     FROM notas
     ORDER BY estudiante_id, nombre_materia, id`
  );

  const grupos = new Map();
  for (const fila of filas) {
    const clave = `${fila.estudiante_id}::${fila.nombre_materia}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
  }

  let eliminadas = 0;
  for (const grupo of grupos.values()) {
    if (grupo.length <= 1) continue;

    // Conserva la fila con más lapsos cargados; en empate, la más reciente.
    const puntaje = (fila) => {
      const valores = [fila.lapso1, fila.lapso2, fila.lapso3];
      return valores.filter((valor) => valor !== null && valor !== undefined && valor !== '').length;
    };

    grupo.sort((a, b) => puntaje(b) - puntaje(a) || b.id - a.id);
    const conservar = grupo[0];

    for (const fila of grupo.slice(1)) {
      await dbConnection.query('DELETE FROM notas WHERE id = ?', [fila.id]);
      eliminadas++;
    }

    console.log(
      `[MIGRACIÓN] Nota duplicada depurada: estudiante ${conservar.estudiante_id}, ` +
      `materia "${conservar.nombre_materia}"`
    );
  }

  return eliminadas;
}

async function crearIndices() {
  const duplicados = await dbConnection.query(
    `SELECT estudiante_id, nombre_materia, COUNT(*) AS cantidad
     FROM notas
     GROUP BY estudiante_id, nombre_materia
     HAVING cantidad > 1
     LIMIT 1`
  );

  if (duplicados.length === 0 && !(await indexExists('idx_notas_estudiante_materia'))) {
    await dbConnection.query(
      'CREATE UNIQUE INDEX idx_notas_estudiante_materia ON notas(estudiante_id, nombre_materia)'
    );
  }

  const usuariosDuplicados = await dbConnection.query(
    `SELECT usuario, COUNT(*) AS cantidad
     FROM usuarios
     GROUP BY usuario
     HAVING cantidad > 1
     LIMIT 1`
  );

  if (usuariosDuplicados.length === 0 && !(await indexExists('idx_usuarios_usuario'))) {
    await dbConnection.query('CREATE UNIQUE INDEX idx_usuarios_usuario ON usuarios(usuario)');
  }

  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_estudiantes_ano_seccion ON estudiantes(ano_cursar, seccion)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_estudiantes_estado ON estudiantes(estado)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_notas_estudiante ON notas(estudiante_id)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(created_at)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_notas_historico_estudiante ON notas_historico(estudiante_id)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_notas_historico_periodo ON notas_historico(periodo_escolar, ano_cursado)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_promociones_estudiante ON promociones_historial(estudiante_id)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_promociones_cierre ON promociones_historial(cierre_id)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_cierres_periodo_ano_seccion ON cierres_periodo(periodo_escolar, ano_cursar, seccion)'
  );
}

async function normalizarEstudiantes() {
  const estudiantes = await dbConnection.query(
    'SELECT id, cedula, ano_cursar, condicion, estado FROM estudiantes'
  );

  let cambios = 0;
  let cedulasConConflicto = 0;

  for (const estudiante of estudiantes) {
    const ano = normalizarAno(estudiante.ano_cursar);
    const condicion = normalizarCondicion(estudiante.condicion);
    const estado = normalizarEstado(estudiante.estado || 'Activo');
    const cedula = normalizarCedula(estudiante.cedula);

    let cedulaFinal = estudiante.cedula;

    if (cedula && cedula !== estudiante.cedula) {
      const conflicto = await dbConnection.query(
        'SELECT id FROM estudiantes WHERE cedula = ? AND id <> ?',
        [cedula, estudiante.id]
      );

      if (conflicto.length > 0) {
        cedulasConConflicto++;
      } else {
        cedulaFinal = cedula;
      }
    }

    if (
      ano !== estudiante.ano_cursar ||
      condicion !== estudiante.condicion ||
      estado !== estudiante.estado ||
      cedulaFinal !== estudiante.cedula
    ) {
      await dbConnection.query(
        'UPDATE estudiantes SET cedula = ?, ano_cursar = ?, condicion = ?, estado = ? WHERE id = ?',
        [cedulaFinal, ano, condicion, estado, estudiante.id]
      );
      cambios++;
    }
  }

  if (cedulasConConflicto > 0) {
    console.warn(
      `[MIGRACIÓN] ${cedulasConConflicto} cédula(s) con prefijo no se normalizaron ` +
      'porque su versión numérica ya pertenece a otro expediente.'
    );
  }

  await dbConnection.query(
    `UPDATE estudiantes
     SET nombre_apellido = TRIM(nombre_apellido),
         cedula = TRIM(cedula),
         seccion = UPPER(TRIM(seccion)),
         codigo_expediente = TRIM(codigo_expediente)`
  );

  return cambios;
}

async function crearMateriasFaltantes() {
  const valores = MATERIAS_DEFECTO.map((materia) => `('${materia.replace(/'/g, "''")}')`).join(', ');

  await dbConnection.query(
    `WITH materias(nombre) AS (VALUES ${valores})
     INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3)
     SELECT e.id, m.nombre, NULL, NULL, NULL
     FROM estudiantes e CROSS JOIN materias m
     WHERE NOT EXISTS (
       SELECT 1 FROM notas n
       WHERE n.estudiante_id = e.id AND n.nombre_materia = m.nombre
     )`
  );
}

async function asegurarEsquemaBase() {
  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS estudiantes (
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
    )`
  );

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS notas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estudiante_id INTEGER NOT NULL,
      nombre_materia TEXT NOT NULL,
      lapso1 REAL DEFAULT 0.0,
      lapso2 REAL DEFAULT 0.0,
      lapso3 REAL DEFAULT 0.0,
      FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id) ON DELETE CASCADE
    )`
  );

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT NOT NULL,
      clave TEXT NOT NULL,
      rol TEXT DEFAULT 'administrador'
    )`
  );
}

async function asegurarEsquemaRBAC() {
  // Columnas RBAC en la tabla de usuarios
  await Promise.all([
    agregarColumnaSiFalta('usuarios', 'activo', 'INTEGER NOT NULL DEFAULT 1'),
    agregarColumnaSiFalta('usuarios', 'nombre_completo', "TEXT NOT NULL DEFAULT ''")
  ]);

  // Tabla de asignaciones docentes
  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS asignaciones_docentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nombre_materia TEXT NOT NULL,
      ano_cursar TEXT NOT NULL,
      seccion TEXT NOT NULL,
      periodo_escolar TEXT NOT NULL DEFAULT '2025-2026',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      UNIQUE(usuario_id, nombre_materia, ano_cursar, seccion)
    )`
  );

  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_asignaciones_usuario ON asignaciones_docentes(usuario_id)'
  );
  await dbConnection.query(
    'CREATE INDEX IF NOT EXISTS idx_asignaciones_ano_seccion ON asignaciones_docentes(ano_cursar, seccion)'
  );
}

async function normalizarNotasParciales() {
  const filas = await dbConnection.query('SELECT id, lapso1, lapso2, lapso3 FROM notas');
  let ajustadas = 0;

  for (const fila of filas) {
    const valores = [fila.lapso1, fila.lapso2, fila.lapso3];

    const positivos = valores.filter(
      (valor) => valor !== null && valor !== undefined && Number(valor) > 0
    ).length;

    const ceros = valores.filter(
      (valor) => valor !== null && valor !== undefined && Number(valor) === 0
    ).length;

    // Los ceros históricos eran el valor por defecto de lapsos sin cargar.
    // Si la fila tiene al menos una nota real y algún cero, esos ceros se
    // convierten en NULL para no inventar calificaciones de 0 puntos.
    if (positivos > 0 && ceros > 0) {
      const nuevos = valores.map((valor) =>
        valor !== null && valor !== undefined && Number(valor) === 0 ? null : valor
      );

      await dbConnection.query(
        'UPDATE notas SET lapso1 = ?, lapso2 = ?, lapso3 = ? WHERE id = ?',
        [...nuevos, fila.id]
      );
      ajustadas++;
    }
  }

  return ajustadas;
}

async function runMigrations() {
  await dbConnection.query('PRAGMA foreign_keys = ON');

  // Permite arrancar también sobre una base nueva, sin tablas previas.
  await asegurarEsquemaBase();
  await asegurarEsquemaRBAC();

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS migraciones (
      nombre TEXT PRIMARY KEY,
      aplicada_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Esquema: columnas nuevas y tabla de auditoría.
  const nuevasColumnas = [];

  if (await agregarColumnaSiFalta('estudiantes', 'estado', "TEXT NOT NULL DEFAULT 'Activo'")) {
    nuevasColumnas.push('estudiantes.estado');
  }
  if (await agregarColumnaSiFalta('estudiantes', 'fecha_retiro', 'TEXT')) {
    nuevasColumnas.push('estudiantes.fecha_retiro');
  }
  if (await agregarColumnaSiFalta('estudiantes', 'motivo_retiro', 'TEXT')) {
    nuevasColumnas.push('estudiantes.motivo_retiro');
  }
  if (await agregarColumnaSiFalta('estudiantes', 'periodo_escolar', "TEXT DEFAULT '2025-2026'")) {
    nuevasColumnas.push('estudiantes.periodo_escolar');
  }
  if (await agregarColumnaSiFalta('usuarios', 'debe_cambiar_clave', 'INTEGER NOT NULL DEFAULT 0')) {
    nuevasColumnas.push('usuarios.debe_cambiar_clave');
  }

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      usuario TEXT,
      accion TEXT NOT NULL,
      entidad TEXT,
      entidad_id TEXT,
      datos_antes TEXT,
      datos_despues TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Módulo de Cierre y Promoción Masiva: tablas de historial y auditoría académica
  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS cierres_periodo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo_escolar TEXT NOT NULL,
      nuevo_periodo_escolar TEXT,
      ano_cursar TEXT NOT NULL,
      seccion TEXT NOT NULL,
      total_estudiantes INTEGER NOT NULL,
      promovidos INTEGER DEFAULT 0,
      graduados INTEGER DEFAULT 0,
      pendientes INTEGER DEFAULT 0,
      repitientes INTEGER DEFAULT 0,
      retirados INTEGER DEFAULT 0,
      trasladados INTEGER DEFAULT 0,
      sin_cambio INTEGER DEFAULT 0,
      usuario_id INTEGER,
      usuario TEXT,
      observaciones TEXT,
      fecha_cierre DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS notas_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER,
      estudiante_id INTEGER NOT NULL,
      periodo_escolar TEXT NOT NULL,
      ano_cursado TEXT NOT NULL,
      seccion TEXT NOT NULL,
      nombre_materia TEXT NOT NULL,
      lapso1 REAL,
      lapso2 REAL,
      lapso3 REAL,
      definitiva REAL,
      aprobada INTEGER,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id),
      FOREIGN KEY (cierre_id) REFERENCES cierres_periodo(id)
    )`
  );

  await dbConnection.query(
    `CREATE TABLE IF NOT EXISTS promociones_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER,
      estudiante_id INTEGER NOT NULL,
      periodo_escolar TEXT NOT NULL,
      ano_anterior TEXT NOT NULL,
      seccion_anterior TEXT NOT NULL,
      estado_anterior TEXT NOT NULL,
      condicion_anterior TEXT NOT NULL,
      accion TEXT NOT NULL,
      ano_nuevo TEXT NOT NULL,
      seccion_nueva TEXT NOT NULL,
      estado_nuevo TEXT NOT NULL,
      condicion_nueva TEXT NOT NULL,
      materias_aprobadas INTEGER DEFAULT 0,
      materias_reprobadas INTEGER DEFAULT 0,
      promedio REAL,
      observacion TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id),
      FOREIGN KEY (cierre_id) REFERENCES cierres_periodo(id)
    )`
  );

  // Integridad de notas: sin duplicados y con valores nulos para "sin cargar".
  const notasDuplicadas = await deduplicarNotas();
  let notasParcialesAjustadas = 0;

  // Corrección única de ceros de relleno heredados de la versión anterior.
  if (!(await migracionAplicada(MIGRACION_CEROS_HISTORICOS))) {
    notasParcialesAjustadas = await normalizarNotasParciales();

    await dbConnection.query(
      `UPDATE notas
       SET lapso1 = NULL, lapso2 = NULL, lapso3 = NULL
       WHERE COALESCE(lapso1, 0) = 0
         AND COALESCE(lapso2, 0) = 0
         AND COALESCE(lapso3, 0) = 0`
    );

    await marcarMigracion(MIGRACION_CEROS_HISTORICOS);
  }

  await crearMateriasFaltantes();
  await crearIndices();

  const estudiantesNormalizados = await normalizarEstudiantes();

  console.log(
    `[MIGRACIÓN] Esquema actualizado. Columnas nuevas: ${nuevasColumnas.length}. ` +
    `Estudiantes normalizados: ${estudiantesNormalizados}. Notas duplicadas depuradas: ${notasDuplicadas}. ` +
    `Notas parciales ajustadas: ${notasParcialesAjustadas}.`
  );

  return {
    nuevasColumnas,
    estudiantesNormalizados,
    notasDuplicadas,
    notasParcialesAjustadas
  };
}

module.exports = {
  runMigrations
};
