/**
 * Script de Seed - ~100 Estudiantes de Prueba
 * Distribuidos en años 1ro a 5to, secciones A, B, C, D
 * Con notas en las 9 materias oficiales, 3 lapsos
 */

const { dbConnection } = require('./config/db');
const {
  ANOS,
  SECCIONES,
  MATERIAS_DEFECTO,
  normalizarAno
} = require('./config/constants');

const MATERIAS = MATERIAS_DEFECTO;

// Nombres venezolanos masculinos y femeninos
const NOMBRES_M = [
  'Carlos', 'Miguel', 'Juan', 'Luis', 'José', 'Andrés', 'David', 'Daniel',
  'Pedro', 'Pablo', 'Gabriel', 'Rafael', 'Diego', 'Alejandro', 'Rodolfo',
  'Héctor', 'Óscar', 'Ernesto', 'Ramón', 'Eduardo', 'Reinaldo', 'Francisco',
  'Jesús', 'Simón', 'Víctor', 'Gustavo', 'Alfredo', 'Ricardo', 'Antonio', 'Manuel'
];
const NOMBRES_F = [
  'María', 'Ana', 'Carmen', 'Luisa', 'Gabriela', 'Valentina', 'Isabella',
  'Sofía', 'Paola', 'Daniela', 'Andrea', 'Mariana', 'Patricia', 'Yolanda',
  'Cristina', 'Alejandra', 'Fernanda', 'Beatriz', 'Elena', 'Rosa',
  'Natalia', 'Verónica', 'Irene', 'Milagros', 'Esperanza', 'Génesis', 'Josefina'
];
const APELLIDOS = [
  'González', 'Rodríguez', 'Pérez', 'Hernández', 'López', 'Martínez', 'Ramírez',
  'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Morales', 'Cruz',
  'Ortega', 'Medina', 'Suárez', 'Ramos', 'Vargas', 'Castillo', 'Jiménez',
  'Gutiérrez', 'Acosta', 'Blanco', 'Bravo', 'Mendoza', 'Silva', 'Rojas', 'Núñez',
  'Álvarez', 'Parra', 'Chávez', 'Ferreira', 'Leal', 'Velásquez', 'Pinto', 'Moya'
];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[rand(0, arr.length - 1)];
}

function notaAleatoria(minVal = 6, maxVal = 20) {
  // Distribución más realista: mayoría entre 10-18, algunos bajos, pocos altos
  const base = Math.random();
  if (base < 0.1) return parseFloat((rand(600, 950) / 100).toFixed(2));  // 6-9.5 (bajos)
  if (base < 0.3) return parseFloat((rand(1000, 1299) / 100).toFixed(2)); // 10-12.99
  if (base < 0.7) return parseFloat((rand(1300, 1699) / 100).toFixed(2)); // 13-16.99
  return parseFloat((rand(1700, 2000) / 100).toFixed(2));                 // 17-20
}

function generarFechaNacimiento(ano) {
  // Edad aproximada según año cursando (los años ya vienen normalizados).
  const edadBase = { '1er Año': 12, '2do Año': 13, '3er Año': 14, '4to Año': 15, '5to Año': 16 };
  const edad = (edadBase[normalizarAno(ano)] || 12) + rand(0, 2);
  const yearNac = new Date().getFullYear() - edad;
  const mes = String(rand(1, 12)).padStart(2, '0');
  const dia = String(rand(1, 28)).padStart(2, '0');
  return `${yearNac}-${mes}-${dia}`;
}

function generarCedula(usadas) {
  let cedula;
  do {
    cedula = String(rand(10000000, 32000000));
  } while (usadas.has(cedula));
  usadas.add(cedula);
  return cedula;
}

// Generamos exactamente 102 estudiantes distribuidos uniformemente
// 5 años × 4 secciones = 20 combinaciones → ~5 estudiantes por sección
const estudiantes = [];
const cedulasUsadas = new Set();

let idx = 0;
for (const ano of ANOS) {
  for (const seccion of SECCIONES) {
    const count = idx < 2 ? 6 : 5; // Primeras 2 combinaciones con 6 para llegar a 102
    for (let i = 0; i < count; i++) {
      const esMasculino = Math.random() > 0.5;
      const nombre = esMasculino ? pick(NOMBRES_M) : pick(NOMBRES_F);
      const apellido1 = pick(APELLIDOS);
      const apellido2 = pick(APELLIDOS);
      const cedula = generarCedula(cedulasUsadas);
      const suerte = Math.random();
      const condicion = suerte < 0.75
        ? 'Regular'
        : suerte < 0.9
          ? 'Nuevo Ingreso'
          : suerte < 0.97
            ? 'Repitente'
            : 'Materia Pendiente';

      estudiantes.push({
        nombre_apellido: `${nombre} ${apellido1} ${apellido2}`,
        cedula,
        fecha_nacimiento: generarFechaNacimiento(ano),
        ano_cursar: ano,
        seccion,
        condicion,
        foto_url: ''
      });
    }
    idx++;
  }
}

async function seed() {
  console.log(`\n🌱 Iniciando seed de ${estudiantes.length} estudiantes...\n`);

  // Verificar cuántos estudiantes hay actualmente
  const existing = await dbConnection.query('SELECT COUNT(*) AS total FROM estudiantes');
  console.log(`📊 Estudiantes existentes en BD: ${existing[0].total}`);

  // Obtener el MAX(id) actual para el correlativo de expediente
  const maxRow = await dbConnection.query('SELECT MAX(id) AS maxId FROM estudiantes');
  let nextSeq = (maxRow[0] && maxRow[0].maxId ? Number(maxRow[0].maxId) : 0);
  const year = new Date().getFullYear();

  let insertados = 0;
  let duplicados = 0;

  for (const est of estudiantes) {
    // Verificar que la cédula no exista
    const existe = await dbConnection.query('SELECT id FROM estudiantes WHERE cedula = ?', [est.cedula]);
    if (existe && existe.length > 0) {
      duplicados++;
      continue;
    }

    nextSeq++;
    const correlativo = String(nextSeq).padStart(4, '0');
    const codigoExpediente = `EXP-${year}-${correlativo}`;

    await dbConnection.query(
      `INSERT INTO estudiantes (nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion, condicion, codigo_expediente, foto_url, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo')`,
      [est.nombre_apellido, est.cedula, est.fecha_nacimiento, est.ano_cursar, est.seccion, est.condicion, codigoExpediente, '']
    );

    // Obtener el id del estudiante recién insertado
    const nuevoEst = await dbConnection.query('SELECT id FROM estudiantes WHERE cedula = ?', [est.cedula]);
    const estudianteId = nuevoEst[0].id;

    // Insertar notas con valores aleatorios realistas
    for (const materia of MATERIAS) {
      const lapso1 = notaAleatoria();
      const lapso2 = notaAleatoria();
      const lapso3 = notaAleatoria();

      await dbConnection.query(
        'INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3) VALUES (?, ?, ?, ?, ?)',
        [estudianteId, materia, lapso1, lapso2, lapso3]
      );
    }

    insertados++;
    if (insertados % 10 === 0) {
      console.log(`  ✅ ${insertados} estudiantes insertados...`);
    }
  }

  console.log(`\n✅ Seed completado:`);
  console.log(`   • Insertados: ${insertados}`);
  console.log(`   • Duplicados (omitidos): ${duplicados}`);
  
  // Resumen por año y sección
  console.log('\n📋 Resumen por año y sección:');
  const resumen = await dbConnection.query(
    `SELECT ano_cursar, seccion, COUNT(*) AS total 
     FROM estudiantes 
     GROUP BY ano_cursar, seccion 
     ORDER BY ano_cursar, seccion`
  );
  
  let anoActual = '';
  for (const row of resumen) {
    if (row.ano_cursar !== anoActual) {
      anoActual = row.ano_cursar;
      console.log(`\n  ${anoActual} año:`);
    }
    console.log(`    Sección ${row.seccion}: ${row.total} estudiantes`);
  }
  
  const totalFinal = await dbConnection.query('SELECT COUNT(*) AS total FROM estudiantes');
  console.log(`\n📊 Total en BD: ${totalFinal[0].total} estudiantes`);

  const totalNotas = await dbConnection.query('SELECT COUNT(*) AS total FROM notas');
  console.log(`📝 Total registros de notas: ${totalNotas[0].total}`);

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Error durante el seed:', err);
  process.exit(1);
});
