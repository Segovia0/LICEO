const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const usuarios = require('../models/usuarioModel');
const {
  getJwtSecret,
  getJwtExpiresIn,
  getPasswordChangeExpiresIn
} = require('../config/security');
const { registrarAuditoria } = require('../utils/audit');

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

function esBcryptHash(valor) {
  return typeof valor === 'string' && (
    valor.startsWith('$2a$') ||
    valor.startsWith('$2b$') ||
    valor.startsWith('$2y$')
  );
}

function firmarToken(usuario, { soloCambioClave = false } = {}) {
  const payload = {
    id: usuario.id,
    usuario: usuario.usuario,
    rol: usuario.rol || 'administrador'
  };

  if (soloCambioClave) {
    payload.scope = 'password_change';
  }

  return jwt.sign(
    payload,
    getJwtSecret(),
    { expiresIn: soloCambioClave ? getPasswordChangeExpiresIn() : getJwtExpiresIn() }
  );
}

function datosPublicosUsuario(usuario) {
  return {
    id: usuario.id,
    usuario: usuario.usuario,
    nombre_completo: usuario.nombre_completo || '',
    rol: usuario.rol || 'administrador',
    activo: usuario.activo !== 0 && usuario.activo !== false,
    debeCambiarClave: Boolean(usuario.debe_cambiar_clave)
  };
}

exports.login = async (req, res) => {
  try {
    const { usuario, clave } = req.body || {};

    if (!usuario || !clave) {
      return res.status(400).json({
        success: false,
        message: 'Debe ingresar usuario y contraseña'
      });
    }

    const usuarioLimpio = String(usuario).trim();
    const claveLimpia = String(clave).trim();

    if (!usuarioLimpio || !claveLimpia) {
      return res.status(400).json({
        success: false,
        message: 'Debe ingresar usuario y contraseña'
      });
    }

    const userFound = await usuarios.findByUsername(usuarioLimpio);

    if (!userFound) {
      // Comparación ficticia para reducir diferencias de tiempo entre usuario existente e inexistente.
      await bcrypt.compare(claveLimpia, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos'
      });
    }

    // Verificar que la cuenta esté activa antes de validar la contraseña
    if (userFound.activo === 0 || userFound.activo === false) {
      await bcrypt.compare(claveLimpia, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: 'La cuenta está desactivada. Contacte al administrador.'
      });
    }

    let passwordValida = false;

    if (esBcryptHash(userFound.clave)) {
      passwordValida = await bcrypt.compare(claveLimpia, userFound.clave);
    } else if (userFound.clave === claveLimpia) {
      // Compatibilidad con contraseñas antiguas en texto plano.
      passwordValida = true;
      const nuevoHash = await bcrypt.hash(claveLimpia, 12);
      await usuarios.updatePassword(userFound.id, nuevoHash, false);
      console.log(`[SEGURIDAD] Contraseña del usuario '${usuarioLimpio}' migrada a Bcrypt.`);
    }

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos'
      });
    }

    const debeCambiarClave = Boolean(userFound.debe_cambiar_clave);
    const token = firmarToken(userFound, { soloCambioClave: debeCambiarClave });
    const usuarioPublico = datosPublicosUsuario(userFound);

    await registrarAuditoria(
      req,
      'LOGIN',
      'usuarios',
      userFound.id,
      null,
      { usuario: userFound.usuario },
      { id: userFound.id, usuario: userFound.usuario }
    );

    res.json({
      success: true,
      message: debeCambiarClave
        ? 'Inicio de sesión correcto. Debe cambiar la contraseña antes de continuar.'
        : 'Inicio de sesión exitoso',
      token,
      debeCambiarClave,
      user: usuarioPublico
    });
  } catch (error) {
    console.error('[ERROR] Al intentar iniciar sesión:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor al autenticar'
    });
  }
};

exports.verificarSesion = async (req, res) => {
  try {
    const user = await usuarios.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    res.json({
      success: true,
      user: datosPublicosUsuario(user)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al verificar sesión' });
  }
};

exports.cambiarClave = async (req, res) => {
  try {
    const { claveActual, claveNueva } = req.body || {};

    if (!claveActual || !claveNueva) {
      return res.status(400).json({
        success: false,
        message: 'Debe indicar la contraseña actual y la nueva'
      });
    }

    const actual = String(claveActual).trim();
    const nueva = String(claveNueva).trim();

    if (nueva.length < 8 || nueva.length > 72) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener entre 8 y 72 caracteres'
      });
    }

    if (nueva === actual) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe ser diferente a la actual'
      });
    }

    const userFound = await usuarios.findByIdWithPassword(req.user.id);

    if (!userFound) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    let actualValida = false;

    if (esBcryptHash(userFound.clave)) {
      actualValida = await bcrypt.compare(actual, userFound.clave);
    } else {
      actualValida = userFound.clave === actual;
    }

    if (!actualValida) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña actual no es correcta'
      });
    }

    const nuevoHash = await bcrypt.hash(nueva, 12);
    await usuarios.updatePassword(userFound.id, nuevoHash, true);

    const usuarioActualizado = {
      ...userFound,
      clave: nuevoHash,
      debe_cambiar_clave: 0
    };
    const token = firmarToken(usuarioActualizado, { soloCambioClave: false });
    const usuarioPublico = datosPublicosUsuario(usuarioActualizado);

    await registrarAuditoria(
      req,
      'CAMBIAR_CLAVE',
      'usuarios',
      userFound.id,
      null,
      { usuario: userFound.usuario }
    );

    res.json({
      success: true,
      message: 'Contraseña actualizada correctamente',
      token,
      debeCambiarClave: false,
      user: usuarioPublico
    });
  } catch (error) {
    console.error('[ERROR] Al cambiar contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'No se pudo actualizar la contraseña'
    });
  }
};
