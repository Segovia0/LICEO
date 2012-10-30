/**
 * Mantenimiento manual: normaliza años, condiciones y estados.
 *
 * Las mismas correcciones se ejecutan automáticamente al arrancar el servidor
 * (config/migrations.js). Este script queda para ejecutarlas sin iniciar la API.
 */

const { dbConnection, configureConnection } = require('./config/db');
const { runMigrations } = require('./config/migrations');

async function fix() {
  console.log('\n🔧 Normalizando datos académicos...\n');

  await configureConnection();
  const resultado = await runMigrations();

  const anos = await dbConnection.query(
    'SELECT ano_cursar, COUNT(*) AS total FROM estudiantes GROUP BY ano_cursar ORDER BY ano_cursar'
  );
  console.log('📊 Distribución por año:');
  anos.forEach((fila) => console.log(`   "${fila.ano_cursar}" → ${fila.total} estudiantes`));

  const condiciones = await dbConnection.query(
    'SELECT condicion, COUNT(*) AS total FROM estudiantes GROUP BY condicion ORDER BY condicion'
  );
  console.log('\n📊 Distribución por condición:');
  condiciones.forEach((fila) => console.log(`   "${fila.condicion}" → ${fila.total} estudiantes`));

  const estados = await dbConnection.query(
    'SELECT estado, COUNT(*) AS total FROM estudiantes GROUP BY estado ORDER BY estado'
  );
  console.log('\n📊 Distribución por estado:');
  estados.forEach((fila) => console.log(`   "${fila.estado}" → ${fila.total} estudiantes`));

  const total = await dbConnection.query('SELECT COUNT(*) AS total FROM estudiantes');
  console.log(`\n✅ Total en BD: ${total[0].total} estudiantes.`);
  console.log(
    `   Migración: ${resultado.estudiantesNormalizados} estudiantes normalizados, ` +
    `${resultado.notasDuplicadas} notas duplicadas depuradas, ` +
    `${resultado.notasParcialesAjustadas} notas parciales ajustadas.`
  );

  await dbConnection.close();
  process.exit(0);
}

fix().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
