const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');
const usuarios = require('../models/usuarioModel');

function extraerToken(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return { error: 'Acceso no autorizado. Se requiere token de autenticación.' };

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { error: 'Formato de token inválido. Use "Bearer <token>".' };
  }

  return { token: parts[1] };
}

function verificarToken(req, res) {
  const { token, error } = extraerToken(req);

  if (error) {
    res.status(401).json({ success: false, message: error });
    return null;
  }

  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    const mensaje = err.name === 'TokenExpiredError'
      ? 'La sesión expiró. Inicie sesión nuevamente.'
      : 'Sesión inválida o token no válido.';

    res.status(401).json({ success: false, message: mensaje, code: 'INVALID_TOKEN' });
    return null;
  }
}

/**
 * Middleware de autenticación principal.
 * Verifica el JWT y consulta la BD para confirmar que el usuario sigue activo
 * y que el rol no ha cambiado (por si el administrador lo modificó).
 */
async function authMiddleware(req, res, next) {
  const decoded = verificarToken(req, res);
  if (!decoded) return;

  if (decoded.scope === 'password_change') {
    return res.status(403).json({
      success: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Debe cambiar la contraseña antes de continuar.'
    });
  }

  // Verificación en BD: el usuario aún existe, está activo y tiene el rol correcto.
  try {
    const user = await usuarios.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado o eliminado.' });
    }
    if (user.activo === 0 || user.activo === false) {
      return res.status(401).json({ success: false, message: 'La cuenta está desactivada. Contacte al administrador.' });
    }
    // Adjuntar datos frescos (el rol puede haber cambiado tras emitir el token)
    req.user = {
      ...decoded,
      rol: user.rol,
      nombre_completo: user.nombre_completo || user.usuario
    };
  } catch (err) {
    console.error('[AUTH] Error al verificar usuario en BD:', err.message);
    // Si la BD falla, usamos los datos del token como fallback
    req.user = decoded;
  }

  next();
}

/**
 * Permite usar el token temporal emitido cuando el usuario debe cambiar su clave.
 */
function passwordChangeAuth(req, res, next) {
  const decoded = verificarToken(req, res);
  if (!decoded) return;

  req.user = decoded;
  next();
}

/**
 * Restringe una ruta a uno o varios roles.
 * Roles válidos del sistema: 'administrador', 'profesor', 'director'
 * (mantiene compatibilidad con roles legacy: 'admin', 'control_estudios', 'docente')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const rol = req.user?.rol || 'consulta';

    // Mapeo de roles legacy a nuevos roles
    const rolNormalizado = normalizarRol(rol);

    if (!roles.includes(rolNormalizado) && !roles.includes(rol)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'No tiene permisos para realizar esta acción.'
      });
    }

    next();
  };
}

/**
 * Normaliza roles legacy para compatibilidad.
 * 'admin' → 'administrador', 'control_estudios' → 'administrador', 'docente' → 'profesor'
 */
function normalizarRol(rol) {
  const mapa = {
    'admin': 'administrador',
    'control_estudios': 'administrador',
    'docente': 'profesor'
  };
  return mapa[rol] || rol;
}

module.exports = authMiddleware;
module.exports.passwordChangeAuth = passwordChangeAuth;
module.exports.requireRole = requireRole;
module.exports.normalizarRol = normalizarRol;
