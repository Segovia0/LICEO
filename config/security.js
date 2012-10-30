/**
 * Configuración de seguridad centralizada.
 * No se permite arrancar la aplicación con un secreto JWT débil o de ejemplo.
 */

const PLACEHOLDER_SECRETS = new Set([
  'tu_clave_secreta_jwt_muy_segura',
  'tu_clave_secreta_jwt_muy_segura_de_al_menos_32_caracteres',
  'cambia_este_secreto_por_uno_aleatorio_de_64_caracteres',
  'fallback_secret_key_liceo_2026',
  'secret',
  'changeme'
]);

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const minusculas = secret.toLowerCase();

  if (!secret) {
    throw new Error('Falta JWT_SECRET en el archivo .env. Genere uno con: openssl rand -hex 32');
  }

  const pareceEjemplo = minusculas.includes('tu_clave_secreta') ||
    minusculas.includes('cambia_este') ||
    minusculas.includes('changeme') ||
    minusculas.includes('example');

  if (PLACEHOLDER_SECRETS.has(minusculas) || pareceEjemplo || secret.length < 32) {
    throw new Error('JWT_SECRET es demasiado débil o es un valor de ejemplo. Use una cadena aleatoria de al menos 32 caracteres.');
  }

  return secret;
}

function getJwtExpiresIn() {
  return process.env.JWT_EXPIRES_IN || '8h';
}

function getPasswordChangeExpiresIn() {
  return process.env.JWT_PASSWORD_CHANGE_EXPIRES_IN || '15m';
}

module.exports = {
  getJwtSecret,
  getJwtExpiresIn,
  getPasswordChangeExpiresIn
};
