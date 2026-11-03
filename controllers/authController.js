const usuarios = require('../models/usuarioModel');

exports.login = async (req, res) => {
  try {
    const { usuario, clave } = req.body;

    if (!usuario || !clave) {
      return res.status(400).json({ success: false, message: 'Debe ingresar usuario y contraseña' });
    }

    // Obtenemos los usuarios usando el modelo
    const allUsers = await usuarios.all();
    const userFound = allUsers.find(u => u.usuario === usuario.trim() && u.clave === clave.trim());

    if (!userFound) {
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
    }

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      user: { usuario: userFound.usuario, rol: userFound.rol || 'admin' }
    });
  } catch (error) {
    console.error('[ERROR] Al intentar iniciar sesión:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
