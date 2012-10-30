const { dbConnection } = require('../config/db');

const usuarioModel = {
  // Obtener todos los usuarios (sin exponer las claves)
  async all() {
    return await dbConnection.query(
      'SELECT id, usuario, rol, debe_cambiar_clave FROM usuarios'
    );
  },

  // Buscar un usuario por su nombre de usuario de forma directa y parametrizada
  async findByUsername(usuario) {
    const rows = await dbConnection.query(
      `SELECT id, usuario, clave, rol, debe_cambiar_clave
       FROM usuarios
       WHERE usuario = ?
       LIMIT 1`,
      [usuario]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  },

  // Buscar usuario por su ID
  async findById(id) {
    const rows = await dbConnection.query(
      `SELECT id, usuario, rol, debe_cambiar_clave
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  },

  // Búsqueda interna para validar la contraseña actual
  async findByIdWithPassword(id) {
    const rows = await dbConnection.query(
      `SELECT id, usuario, clave, rol, debe_cambiar_clave
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  },

  // Insertar un nuevo usuario con clave hasheada
  async insert(data) {
    const debeCambiar = data.debe_cambiar_clave ? 1 : 0;

    return await dbConnection.query(
      `INSERT INTO usuarios (usuario, clave, rol, debe_cambiar_clave)
       VALUES (?, ?, ?, ?)`,
      [data.usuario, data.clave, data.rol || 'admin', debeCambiar]
    );
  },

  // Actualizar contraseña; por defecto limpia la obligación de cambiarla
  async updatePassword(id, claveHash, limpiarObligacion = true) {
    if (limpiarObligacion) {
      return await dbConnection.query(
        'UPDATE usuarios SET clave = ?, debe_cambiar_clave = 0 WHERE id = ?',
        [claveHash, id]
      );
    }

    return await dbConnection.query(
      'UPDATE usuarios SET clave = ? WHERE id = ?',
      [claveHash, id]
    );
  },

  async setDebeCambiarClave(id, valor) {
    return await dbConnection.query(
      'UPDATE usuarios SET debe_cambiar_clave = ? WHERE id = ?',
      [valor ? 1 : 0, id]
    );
  }
};

module.exports = usuarioModel;
