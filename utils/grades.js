/**
 * Reglas de calificaciones compartidas por los controladores.
 * Una nota vacía representa "sin cargar" y no debe promediarse como 0.
 */

function redondear(valor) {
  return Math.round(valor * 100) / 100;
}

function normalizarNota(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    const error = new Error('La calificación debe ser un número válido');
    error.status = 400;
    throw error;
  }

  if (numero < 0 || numero > 20) {
    const error = new Error('La calificación debe estar entre 0 y 20 puntos');
    error.status = 400;
    throw error;
  }

  return redondear(numero);
}

function calcularDefinitiva(nota) {
  if (!nota) return null;

  const valores = [nota.lapso1, nota.lapso2, nota.lapso3].map((valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  });

  // La definitiva solo existe cuando los tres lapsos están cargados.
  if (valores.some((valor) => valor === null)) return null;

  return redondear(valores.reduce((total, valor) => total + valor, 0) / valores.length);
}

function notasConDefinitiva(notas) {
  return (notas || []).map((nota) => {
    const definitiva = calcularDefinitiva(nota);

    return {
      ...nota,
      definitiva,
      completa: definitiva !== null,
      aprobada: definitiva !== null ? definitiva >= 10 : null
    };
  });
}

module.exports = {
  redondear,
  normalizarNota,
  calcularDefinitiva,
  notasConDefinitiva
};
