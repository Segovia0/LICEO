const { dbConnection } = require('../config/db');

const usuarioModel = {
  // Método equivalente a .all()
  async all() {
    return await dbConnection.query('SELECT * FROM usuarios');
  },

  // Método equivalente a .insert()
  async insert(data) {
    return await dbConnection.query(
      'INSERT INTO usuarios (usuario, clave, rol) VALUES (?, ?, ?)',
      [data.usuario, data.clave, data.rol || 'admin']
    );
  }
};

module.exports = usuarioModel;
