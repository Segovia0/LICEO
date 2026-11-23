/**
 * Catálogos y normalización de datos académicos.
 * Centralizar estos valores evita que convivan formatos como "1ro" y "1er Año".
 */

const ANOS = ['1er Año', '2do Año', '3er Año', '4to Año', '5to Año'];
const SECCIONES = ['A', 'B', 'C', 'D'];
const CONDICIONES = ['Nuevo Ingreso', 'Regular', 'Repitente', 'Materia Pendiente'];
const ESTADOS = ['Activo', 'Retirado', 'Graduado', 'Trasladado'];

const MATERIAS_DEFECTO = [
  'Castellano',
  'Matemáticas',
  'Inglés y Otras Lenguas',
  'Educación Física',
  'Biología / Ciencias Naturales',
  'Física',
  'Química',
  'Historia de Venezuela y Ciudadanía',
  'Geografía / Arte y Cultura'
];

function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const ANOS_MAP = {
  '1': '1er Año',
  '1ro': '1er Año',
  '1er': '1er Año',
  '1er ano': '1er Año',
  '1er ano de bachillerato': '1er Año',
  'primero': '1er Año',
  'primer ano': '1er Año',
  '2': '2do Año',
  '2do': '2do Año',
  '2do ano': '2do Año',
  '2do ano de bachillerato': '2do Año',
  'segundo': '2do Año',
  'segundo ano': '2do Año',
  '3': '3er Año',
  '3ro': '3er Año',
  '3er': '3er Año',
  '3ro ano': '3er Año',
  '3er ano': '3er Año',
  '3ro ano de bachillerato': '3er Año',
  'tercero': '3er Año',
  'tercer ano': '3er Año',
  '4': '4to Año',
  '4to': '4to Año',
  '4to ano': '4to Año',
  '4to ano de bachillerato': '4to Año',
  'cuarto': '4to Año',
  'cuarto ano': '4to Año',
  '5': '5to Año',
  '5to': '5to Año',
  '5to ano': '5to Año',
  '5to ano de bachillerato': '5to Año',
  'quinto': '5to Año',
  'quinto ano': '5to Año'
};

const CONDICIONES_MAP = {
  'nuevo ingreso': 'Nuevo Ingreso',
  'nuevo': 'Nuevo Ingreso',
  'nuevo-ingreso': 'Nuevo Ingreso',
  'regular': 'Regular',
  'repitente': 'Repitente',
  'repitiente': 'Repitente',
  'repite': 'Repitente',
  'repetidor': 'Repitente',
  'materia pendiente': 'Materia Pendiente',
  'materias pendientes': 'Materia Pendiente',
  'pendiente': 'Materia Pendiente',
  'arrastre': 'Materia Pendiente'
};

const ESTADOS_MAP = {
  'activo': 'Activo',
  'activa': 'Activo',
  'retirado': 'Retirado',
  'retirada': 'Retirado',
  'graduado': 'Graduado',
  'graduada': 'Graduado',
  'trasladado': 'Trasladado',
  'trasladada': 'Trasladado'
};

function normalizarAno(valor) {
  const key = normalizarTexto(valor);
  if (ANOS_MAP[key]) return ANOS_MAP[key];

  const match = key.match(/^([1-5])(?:er|do|ro|to|mo)?\s*(?:ano)?$/);
  if (match) return ANOS[Number(match[1]) - 1];

  return String(valor ?? '').trim();
}

function normalizarCondicion(valor) {
  const key = normalizarTexto(valor);
  return CONDICIONES_MAP[key] || String(valor ?? '').trim();
}

function normalizarEstado(valor) {
  const key = normalizarTexto(valor);
  return ESTADOS_MAP[key] || String(valor ?? '').trim();
}

function normalizarCedula(valor) {
  const raw = String(valor ?? '')
    .trim()
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '');

  if (!raw) return null;

  const match = raw.match(/^([VE])?-?(\d{5,10})$/);
  if (!match) return null;

  // Se almacena sin el prefijo "V-" para que "V-12345678" y "12345678"
  // se reconozcan como la misma cédula. El prefijo "E-" se conserva
  // porque identifica a personas extranjeras y no debe confundirse.
  return match[1] === 'E' ? `E-${match[2]}` : match[2];
}

function esAnoValido(valor) {
  return ANOS.includes(valor);
}

function esSeccionValida(valor) {
  return SECCIONES.includes(String(valor ?? '').trim().toUpperCase());
}

function esCondicionValida(valor) {
  return CONDICIONES.includes(valor);
}

function esEstadoValido(valor) {
  return ESTADOS.includes(valor);
}

const MAPA_PROXIMO_ANO = {
  '1er Año': '2do Año',
  '2do Año': '3er Año',
  '3er Año': '4to Año',
  '4to Año': '5to Año',
  '5to Año': '5to Año'
};

function siguienteAno(ano) {
  const norm = normalizarAno(ano);
  return MAPA_PROXIMO_ANO[norm] || null;
}

module.exports = {
  ANOS,
  SECCIONES,
  CONDICIONES,
  ESTADOS,
  MATERIAS_DEFECTO,
  MAPA_PROXIMO_ANO,
  siguienteAno,
  normalizarTexto,
  normalizarAno,
  normalizarCondicion,
  normalizarEstado,
  normalizarCedula,
  esAnoValido,
  esSeccionValida,
  esCondicionValida,
  esEstadoValido
};
