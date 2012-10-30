const { dbConnection } = require('../config/db');

function serializar(valor) {
  if (valor === null || valor === undefined) return null;

  try {
    const texto = JSON.stringify(valor);
    return texto.length > 50000 ? texto.slice(0, 50000) + '…' : texto;
  } catch (error) {
    return JSON.stringify({ error: 'No se pudo serializar el dato' });
  }
}

/**
 * Registra una acción sensible sin interrumpir la operación principal.
 * La auditoría es especialmente importante para cambios de notas y expedientes.
 */
async function registrarAuditoria(req, accion, entidad, entidadId, antes, despues, actor = null) {
  try {
    const usuario = actor || req.user || {};

    await dbConnection.query(
      `INSERT INTO auditoria
       (usuario_id, usuario, accion, entidad, entidad_id, datos_antes, datos_despues, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario.id ?? null,
        usuario.usuario ?? 'sistema',
        accion,
        entidad ?? null,
        entidadId !== null && entidadId !== undefined ? String(entidadId) : null,
        serializar(antes),
        serializar(despues),
        req.ip || null
      ]
    );
  } catch (error) {
    console.error('[AUDITORÍA] No se pudo registrar la acción:', error.message);
  }
}

module.exports = {
  registrarAuditoria
};
