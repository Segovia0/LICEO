/**
 * Controlador de gestión de usuarios (solo para el rol administrador).
 * CRUD de cuentas + gestión de asignaciones docentes.
 */

const bcrypt = require('bcryptjs');
const usuarios = require('../models/usuarioModel');
const { registrarAuditoria } = require('../utils/audit');
const { ANOS, SECCIONES, MATERIAS_DEFECTO } = require('../config/constants');

const ROLES_VALIDOS = ['administrador', 'profesor', 'director'];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizar(valor, maxLen = 255) {
  return String(valor ?? '').trim().slice(0, maxLen);
}

function parsearId(valor) {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function datosPublicos(user) {
  return {
    id: user.id,
    usuario: user.usuario,
    nombre_completo: user.nombre_completo || '',
    rol: user.rol,
    activo: user.activo !== 0 && user.activo !== false,
    debe_cambiar_clave: Boolean(user.debe_cambiar_clave)
  };
}

// ── Gestión de usuarios ─────────────────────────────────────────────────────

exports.listarUsuarios = async (req, res) => {
  try {
    const lista = await usuarios.all();
    res.json({ success: true, data: lista.map(datosPublicos) });
  } catch (error) {
    console.error('[ERROR] listarUsuarios:', error);
    res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
  }
};

exports.crearUsuario = async (req, res) => {
  try {
    const { usuario, clave, rol, nombre_completo, activo } = req.body || {};

    const usuarioLimpio = sanitizar(usuario, 50);
    const claveOriginal = sanitizar(clave, 72);
    const rolLimpio = sanitizar(rol, 30);
    const nombreCompleto = sanitizar(nombre_completo || '', 120);

    if (!usuarioLimpio) {
      return res.status(400).json({ success: false, message: 'El nombre de usuario es obligatorio' });
    }
    if (!/^[a-zA-Z0-9._\-]{3,50}$/.test(usuarioLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El usuario solo puede contener letras, números, puntos, guiones y guiones bajos (3–50 caracteres)'
      });
    }
    if (!claveOriginal || claveOriginal.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (!ROLES_VALIDOS.includes(rolLimpio)) {
      return res.status(400).json({ success: false, message: `El rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}` });
    }

    // Verificar duplicado
    const existente = await usuarios.findByUsername(usuarioLimpio);
    if (existente) {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario con ese nombre' });
    }

    const claveHash = await bcrypt.hash(claveOriginal, 12);
    const activoVal = activo !== false && activo !== 0 && activo !== 'false' && activo !== '0';

    const resultado = await usuarios.insert({
      usuario: usuarioLimpio,
      clave: claveHash,
      rol: rolLimpio,
      nombre_completo: nombreCompleto,
      activo: activoVal,
      debe_cambiar_clave: 1
    });

    const nuevoId = Number(resultado.insertId || resultado.lastID || 0);

    await registrarAuditoria(req, 'CREAR_USUARIO', 'usuarios', nuevoId, null, {
      usuario: usuarioLimpio, rol: rolLimpio, nombre_completo: nombreCompleto
    });

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente. Deberá cambiar su contraseña al iniciar sesión.',
      id: nuevoId
    });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario con ese nombre' });
    }
    console.error('[ERROR] crearUsuario:', error);
    res.status(500).json({ success: false, message: 'Error al crear usuario' });
  }
};

exports.actualizarUsuario = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
    }

    // No permite auto-editarse el rol/estado a través de esta ruta (evitar escalada)
    if (req.user.id === id && (req.body.rol !== undefined || req.body.activo !== undefined)) {
      return res.status(403).json({
        success: false,
        message: 'No puede modificar su propio rol o estado de activación'
      });
    }

    const userExistente = await usuarios.findById(id);
    if (!userExistente) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const cambios = {};
    if (req.body.nombre_completo !== undefined) {
      cambios.nombre_completo = sanitizar(req.body.nombre_completo, 120);
    }
    if (req.body.rol !== undefined) {
      const rolLimpio = sanitizar(req.body.rol, 30);
      if (!ROLES_VALIDOS.includes(rolLimpio)) {
        return res.status(400).json({ success: false, message: `El rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}` });
      }
      cambios.rol = rolLimpio;
    }
    if (req.body.activo !== undefined) {
      cambios.activo = req.body.activo !== false && req.body.activo !== 0 && req.body.activo !== 'false' && req.body.activo !== '0';
    }
    if (req.body.debe_cambiar_clave !== undefined) {
      cambios.debe_cambiar_clave = Boolean(req.body.debe_cambiar_clave);
    }

    // Cambio de nombre de usuario
    if (req.body.usuario !== undefined) {
      const usuarioLimpio = sanitizar(req.body.usuario, 50);
      if (!/^[a-zA-Z0-9._\-]{3,50}$/.test(usuarioLimpio)) {
        return res.status(400).json({ success: false, message: 'Formato de nombre de usuario inválido' });
      }
      const dup = await usuarios.findByUsername(usuarioLimpio);
      if (dup && dup.id !== id) {
        return res.status(409).json({ success: false, message: 'Ya existe un usuario con ese nombre' });
      }
      cambios.usuario = usuarioLimpio;
    }

    // Cambio de contraseña por el admin
    if (req.body.clave_nueva !== undefined) {
      const nueva = sanitizar(req.body.clave_nueva, 72);
      if (nueva.length < 8) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
      }
      const hash = await bcrypt.hash(nueva, 12);
      await usuarios.updatePassword(id, hash, false);
      await usuarios.setDebeCambiarClave(id, true);
    }

    if (Object.keys(cambios).length > 0) {
      await usuarios.update(id, cambios);
    }

    await registrarAuditoria(req, 'ACTUALIZAR_USUARIO', 'usuarios', id,
      { usuario: userExistente.usuario, rol: userExistente.rol },
      cambios
    );

    res.json({ success: true, message: 'Usuario actualizado correctamente' });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario con ese nombre' });
    }
    console.error('[ERROR] actualizarUsuario:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
  }
};

exports.eliminarUsuario = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
    }
    if (req.user.id === id) {
      return res.status(403).json({ success: false, message: 'No puede eliminar su propia cuenta' });
    }

    const userExistente = await usuarios.findById(id);
    if (!userExistente) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    await usuarios.deleteAsignacionesByUsuario(id);
    await usuarios.delete(id);

    await registrarAuditoria(req, 'ELIMINAR_USUARIO', 'usuarios', id, { usuario: userExistente.usuario }, null);

    res.json({ success: true, message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('[ERROR] eliminarUsuario:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
  }
};

// ── Gestión de asignaciones docentes ───────────────────────────────────────

exports.listarAsignaciones = async (req, res) => {
  try {
    const { usuario_id } = req.query;
    let data;
    if (usuario_id) {
      const id = parsearId(usuario_id);
      if (!id) return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
      data = await usuarios.getAsignacionesByUsuario(id);
    } else {
      data = await usuarios.getAllAsignaciones();
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ERROR] listarAsignaciones:', error);
    res.status(500).json({ success: false, message: 'Error al obtener asignaciones' });
  }
};

exports.misAsignaciones = async (req, res) => {
  try {
    const data = await usuarios.getAsignacionesByUsuario(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[ERROR] misAsignaciones:', error);
    res.status(500).json({ success: false, message: 'Error al obtener asignaciones' });
  }
};

exports.crearAsignacion = async (req, res) => {
  try {
    const { usuario_id, nombre_materia, ano_cursar, seccion, periodo_escolar } = req.body || {};

    const uid = parsearId(usuario_id);
    if (!uid) return res.status(400).json({ success: false, message: 'ID de usuario inválido' });

    const materia = sanitizar(nombre_materia, 120);
    const ano = sanitizar(ano_cursar, 20);
    const sec = sanitizar(seccion, 5).toUpperCase();
    const periodo = sanitizar(periodo_escolar || '2025-2026', 20);

    if (!MATERIAS_DEFECTO.includes(materia)) {
      return res.status(400).json({ success: false, message: `Materia inválida. Opciones: ${MATERIAS_DEFECTO.join(', ')}` });
    }
    if (!ANOS.includes(ano)) {
      return res.status(400).json({ success: false, message: `Año inválido. Opciones: ${ANOS.join(', ')}` });
    }
    if (!SECCIONES.includes(sec)) {
      return res.status(400).json({ success: false, message: `Sección inválida. Opciones: ${SECCIONES.join(', ')}` });
    }

    const userExistente = await usuarios.findById(uid);
    if (!userExistente) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    if (userExistente.rol !== 'profesor') {
      return res.status(400).json({ success: false, message: 'Solo se pueden asignar materias a usuarios con rol profesor' });
    }

    // Evitar duplicados
    const existente = await usuarios.profesorTieneAsignacion(uid, materia, ano, sec);
    if (existente) {
      return res.status(409).json({ success: false, message: 'Esta asignación ya existe para ese profesor' });
    }

    const resultado = await usuarios.insertAsignacion({ usuario_id: uid, nombre_materia: materia, ano_cursar: ano, seccion: sec, periodo_escolar: periodo });
    const nuevoId = Number(resultado.insertId || resultado.lastID || 0);

    await registrarAuditoria(req, 'CREAR_ASIGNACION_DOCENTE', 'asignaciones_docentes', nuevoId, null, {
      usuario_id: uid, nombre_materia: materia, ano_cursar: ano, seccion: sec, periodo_escolar: periodo
    });

    res.status(201).json({ success: true, message: 'Asignación docente creada correctamente', id: nuevoId });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({ success: false, message: 'Esta asignación ya existe' });
    }
    console.error('[ERROR] crearAsignacion:', error);
    res.status(500).json({ success: false, message: 'Error al crear asignación docente' });
  }
};

exports.eliminarAsignacion = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID de asignación inválido' });

    await usuarios.deleteAsignacion(id);
    await registrarAuditoria(req, 'ELIMINAR_ASIGNACION_DOCENTE', 'asignaciones_docentes', id, null, null);

    res.json({ success: true, message: 'Asignación eliminada correctamente' });
  } catch (error) {
    console.error('[ERROR] eliminarAsignacion:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar asignación' });
  }
};

exports.reemplazarAsignaciones = async (req, res) => {
  try {
    const id = parsearId(req.params.usuario_id);
    if (!id) return res.status(400).json({ success: false, message: 'ID de usuario inválido' });

    const { asignaciones, periodo_escolar } = req.body || {};
    if (!Array.isArray(asignaciones)) {
      return res.status(400).json({ success: false, message: 'Se esperaba un array de asignaciones' });
    }

    const userExistente = await usuarios.findById(id);
    if (!userExistente) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    if (userExistente.rol !== 'profesor') {
      return res.status(400).json({ success: false, message: 'Solo se pueden asignar materias a profesores' });
    }

    const periodo = sanitizar(periodo_escolar || '2025-2026', 20);

    // Validar todas las entradas antes de proceder
    for (const a of asignaciones) {
      const materia = sanitizar(a.nombre_materia, 120);
      const ano = sanitizar(a.ano_cursar, 20);
      const sec = sanitizar(a.seccion, 5).toUpperCase();
      if (!MATERIAS_DEFECTO.includes(materia) || !ANOS.includes(ano) || !SECCIONES.includes(sec)) {
        return res.status(400).json({ success: false, message: `Asignación inválida: ${materia} / ${ano} / ${sec}` });
      }
    }

    await usuarios.deleteAsignacionesByUsuario(id);

    for (const a of asignaciones) {
      await usuarios.insertAsignacion({
        usuario_id: id,
        nombre_materia: sanitizar(a.nombre_materia, 120),
        ano_cursar: sanitizar(a.ano_cursar, 20),
        seccion: sanitizar(a.seccion, 5).toUpperCase(),
        periodo_escolar: periodo
      });
    }

    await registrarAuditoria(req, 'REEMPLAZAR_ASIGNACIONES_DOCENTES', 'asignaciones_docentes', id, null, {
      usuario_id: id, total: asignaciones.length
    });

    res.json({ success: true, message: `Asignaciones actualizadas (${asignaciones.length} registradas)` });
  } catch (error) {
    console.error('[ERROR] reemplazarAsignaciones:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar asignaciones' });
  }
};
