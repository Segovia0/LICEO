const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/security');

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

function authMiddleware(req, res, next) {
  const decoded = verificarToken(req, res);
  if (!decoded) return;

  if (decoded.scope === 'password_change') {
    return res.status(403).json({
      success: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Debe cambiar la contraseña antes de continuar.'
    });
  }

  req.user = decoded;
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
 * Si el token es antiguo y no trae rol, se trata como consulta (sin escritura).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const rol = req.user?.rol || 'consulta';

    if (!roles.includes(rol)) {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos para realizar esta acción.'
      });
    }

    next();
  };
}

module.exports = authMiddleware;
module.exports.passwordChangeAuth = passwordChangeAuth;
module.exports.requireRole = requireRole;
