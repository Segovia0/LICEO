const { dbConnection } = require('../config/db');

const usuarioModel = {
  // Obtener todos los usuarios (sin exponer las claves)
  async all() {
    return await dbConnection.query(
      'SELECT id, usuario, rol, activo, debe_cambiar_clave, nombre_completo FROM usuarios'
    );
  },

  // Buscar un usuario por su nombre de usuario de forma directa y parametrizada
  async findByUsername(usuario) {
    const rows = await dbConnection.query(
      `SELECT id, usuario, clave, rol, activo, debe_cambiar_clave, nombre_completo
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
      `SELECT id, usuario, rol, activo, debe_cambiar_clave, nombre_completo
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
      `SELECT id, usuario, clave, rol, activo, debe_cambiar_clave, nombre_completo
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
    const activo = data.activo !== undefined ? (data.activo ? 1 : 0) : 1;
    const nombreCompleto = data.nombre_completo || '';

    return await dbConnection.query(
      `INSERT INTO usuarios (usuario, clave, rol, debe_cambiar_clave, activo, nombre_completo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.usuario, data.clave, data.rol || 'administrador', debeCambiar, activo, nombreCompleto]
    );
  },

  // Actualizar datos básicos de un usuario
  async update(id, data) {
    const fields = [];
    const values = [];

    if (data.usuario !== undefined) { fields.push('usuario = ?'); values.push(data.usuario); }
    if (data.rol !== undefined) { fields.push('rol = ?'); values.push(data.rol); }
    if (data.activo !== undefined) { fields.push('activo = ?'); values.push(data.activo ? 1 : 0); }
    if (data.nombre_completo !== undefined) { fields.push('nombre_completo = ?'); values.push(data.nombre_completo); }
    if (data.debe_cambiar_clave !== undefined) { fields.push('debe_cambiar_clave = ?'); values.push(data.debe_cambiar_clave ? 1 : 0); }

    if (fields.length === 0) return;
    values.push(id);
    return await dbConnection.query(`UPDATE usuarios SET ${fields.join(', ')} WHERE id = ?`, values);
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
  },

  async delete(id) {
    return await dbConnection.query('DELETE FROM usuarios WHERE id = ?', [id]);
  },

  // ── Asignaciones docentes ──────────────────────────────────────────────────

  async getAsignacionesByUsuario(usuarioId) {
    return await dbConnection.query(
      `SELECT id, usuario_id, nombre_materia, ano_cursar, seccion, periodo_escolar
       FROM asignaciones_docentes
       WHERE usuario_id = ?
       ORDER BY ano_cursar, seccion, nombre_materia`,
      [usuarioId]
    );
  },

  async getAllAsignaciones() {
    return await dbConnection.query(
      `SELECT a.id, a.usuario_id, u.usuario, u.nombre_completo, u.rol,
              a.nombre_materia, a.ano_cursar, a.seccion, a.periodo_escolar
       FROM asignaciones_docentes a
       JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY u.usuario, a.ano_cursar, a.seccion, a.nombre_materia`
    );
  },

  async insertAsignacion(data) {
    return await dbConnection.query(
      `INSERT INTO asignaciones_docentes (usuario_id, nombre_materia, ano_cursar, seccion, periodo_escolar)
       VALUES (?, ?, ?, ?, ?)`,
      [data.usuario_id, data.nombre_materia, data.ano_cursar, data.seccion, data.periodo_escolar]
    );
  },

  async deleteAsignacion(id) {
    return await dbConnection.query('DELETE FROM asignaciones_docentes WHERE id = ?', [id]);
  },

  async deleteAsignacionesByUsuario(usuarioId) {
    return await dbConnection.query('DELETE FROM asignaciones_docentes WHERE usuario_id = ?', [usuarioId]);
  },

  // Verifica si un profesor tiene asignada una combinación materia/año/sección
  async profesorTieneAsignacion(usuarioId, nombreMateria, anoCursar, seccion) {
    const rows = await dbConnection.query(
      `SELECT id FROM asignaciones_docentes
       WHERE usuario_id = ? AND nombre_materia = ? AND ano_cursar = ? AND seccion = ?
       LIMIT 1`,
      [usuarioId, nombreMateria, anoCursar, seccion]
    );
    return rows.length > 0;
  }
};

module.exports = usuarioModel;
