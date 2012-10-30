const crypto = require('crypto');
const { dbConnection } = require('../config/db');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const {
  ANOS,
  SECCIONES,
  CONDICIONES,
  ESTADOS,
  MATERIAS_DEFECTO,
  normalizarAno,
  normalizarCondicion,
  normalizarEstado,
  normalizarCedula
} = require('../config/constants');

const {
  normalizarNota,
  notasConDefinitiva
} = require('../utils/grades');

const { registrarAuditoria } = require('../utils/audit');

function errorValidacion(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  return error;
}

function parsearId(valor) {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Elimina una foto de forma segura, verificando que esté dentro de uploads.
async function safeDeleteFile(relativePath) {
  if (!relativePath) return;

  try {
    const uploadDir = path.resolve(__dirname, '../uploads');
    const targetPath = path.resolve(__dirname, '..', relativePath.replace(/^\/+/, ''));

    if (
      (targetPath === uploadDir || targetPath.startsWith(uploadDir + path.sep)) &&
      fsSync.existsSync(targetPath)
    ) {
      await fs.unlink(targetPath);
    }
  } catch (error) {
    console.error('[AVISO] No se pudo eliminar archivo previo:', error.message);
  }
}

async function limpiarArchivoSubido(req) {
  if (req.file) {
    await safeDeleteFile(`/uploads/estudiantes/${req.file.filename}`);
  }
}

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;

  const fecha = new Date(`${fechaNacimiento}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return null;

  const hoy = new Date();
  let edad = hoy.getFullYear() - fecha.getFullYear();
  const mes = hoy.getMonth() - fecha.getMonth();

  if (mes < 0 || (mes === 0 && hoy.getDate() < fecha.getDate())) {
    edad--;
  }

  return edad >= 0 ? edad : null;
}

function validarPayloadEstudiante(body) {
  const {
    nombreApellido,
    cedula,
    fechaNacimiento,
    anoCursar,
    seccion,
    condicion
  } = body || {};

  if (!nombreApellido || !cedula || !fechaNacimiento || !anoCursar || !seccion || !condicion) {
    throw errorValidacion('Todos los campos del estudiante son obligatorios');
  }

  const nombre = String(nombreApellido).trim().replace(/\s+/g, ' ');

  if (nombre.length < 3 || nombre.length > 120) {
    throw errorValidacion('El nombre debe tener entre 3 y 120 caracteres');
  }

  if (/[\u0000-\u001F\u007F]/.test(nombre)) {
    throw errorValidacion('El nombre contiene caracteres no permitidos');
  }

  const cedulaNormalizada = normalizarCedula(cedula);
  if (!cedulaNormalizada) {
    throw errorValidacion('La cédula no tiene un formato válido (ejemplo: 12345678 o V-12345678)');
  }

  const fecha = String(fechaNacimiento).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw errorValidacion('La fecha de nacimiento debe tener formato AAAA-MM-DD');
  }

  const fechaDate = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(fechaDate.getTime())) {
    throw errorValidacion('La fecha de nacimiento no es válida');
  }

  const hoy = new Date();
  if (fechaDate > hoy || fechaDate.getFullYear() < 1900) {
    throw errorValidacion('La fecha de nacimiento no es válida');
  }

  const edad = calcularEdad(fecha);
  if (edad !== null && (edad < 5 || edad > 100)) {
    throw errorValidacion('La edad del estudiante no está en un rango razonable');
  }

  const ano = normalizarAno(anoCursar);
  if (!ANOS.includes(ano)) {
    throw errorValidacion(`El año a cursar debe ser uno de: ${ANOS.join(', ')}`);
  }

  const seccionNormalizada = String(seccion).trim().toUpperCase();
  if (!SECCIONES.includes(seccionNormalizada)) {
    throw errorValidacion(`La sección debe ser una de: ${SECCIONES.join(', ')}`);
  }

  const condicionNormalizada = normalizarCondicion(condicion);
  if (!CONDICIONES.includes(condicionNormalizada)) {
    throw errorValidacion(`La condición debe ser una de: ${CONDICIONES.join(', ')}`);
  }

  return {
    nombre,
    cedula: cedulaNormalizada,
    fechaNacimiento: fecha,
    ano,
    seccion: seccionNormalizada,
    condicion: condicionNormalizada
  };
}

function mapearEstudiante(estudiante, notas) {
  return {
    ...estudiante,
    _id: estudiante.id,
    nombreApellido: estudiante.nombre_apellido,
    fechaNacimiento: estudiante.fecha_nacimiento,
    anoCursar: estudiante.ano_cursar,
    codigoExpediente: estudiante.codigo_expediente,
    fotoUrl: estudiante.foto_url,
    estado: estudiante.estado || 'Activo',
    fechaRetiro: estudiante.fecha_retiro || null,
    motivoRetiro: estudiante.motivo_retiro || null,
    edad: calcularEdad(estudiante.fecha_nacimiento),
    notas: notasConDefinitiva(notas)
  };
}

// 1. Obtener estudiantes con filtros y carga optimizada de notas
exports.obtenerEstudiantes = async (req, res) => {
  try {
    const { ano, seccion, busqueda, estado } = req.query;

    let sql = 'SELECT * FROM estudiantes WHERE 1=1';
    const params = [];

    // Por defecto solo se muestran expedientes activos.
    let estadoFiltro = 'Activo';
    if (estado === 'TODOS') {
      estadoFiltro = null;
    } else if (estado) {
      const estadoNormalizado = normalizarEstado(estado);
      if (!ESTADOS.includes(estadoNormalizado)) {
        return res.status(400).json({
          success: false,
          message: `El estado debe ser uno de: ${ESTADOS.join(', ')} o TODOS`
        });
      }
      estadoFiltro = estadoNormalizado;
    }

    if (estadoFiltro) {
      sql += ' AND estado = ?';
      params.push(estadoFiltro);
    }

    if (ano && ano !== 'TODOS') {
      const anoNormalizado = normalizarAno(ano);
      if (!ANOS.includes(anoNormalizado)) {
        return res.status(400).json({
          success: false,
          message: `El año debe ser uno de: ${ANOS.join(', ')} o TODOS`
        });
      }
      sql += ' AND ano_cursar = ?';
      params.push(anoNormalizado);
    }

    if (seccion && seccion !== 'TODAS') {
      const seccionNormalizada = String(seccion).trim().toUpperCase();
      if (!SECCIONES.includes(seccionNormalizada)) {
        return res.status(400).json({
          success: false,
          message: `La sección debe ser una de: ${SECCIONES.join(', ')} o TODAS`
        });
      }
      sql += ' AND seccion = ?';
      params.push(seccionNormalizada);
    }

    if (busqueda && String(busqueda).trim() !== '') {
      sql += ' AND (cedula LIKE ? OR nombre_apellido LIKE ? OR codigo_expediente LIKE ?)';
      const termino = `%${String(busqueda).trim()}%`;
      params.push(termino, termino, termino);
    }

    sql += ' ORDER BY nombre_apellido COLLATE NOCASE ASC, id ASC';

    const estudiantes = await dbConnection.query(sql, params);

    if (!estudiantes || estudiantes.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const ids = estudiantes.map((estudiante) => estudiante.id);
    const placeholders = ids.map(() => '?').join(',');

    const notas = await dbConnection.query(
      `SELECT estudiante_id, nombre_materia AS nombre, lapso1, lapso2, lapso3
       FROM notas
       WHERE estudiante_id IN (${placeholders})`,
      ids
    );

    const notasPorEstudiante = new Map();
    for (const nota of notas) {
      if (!notasPorEstudiante.has(nota.estudiante_id)) {
        notasPorEstudiante.set(nota.estudiante_id, []);
      }
      notasPorEstudiante.get(nota.estudiante_id).push(nota);
    }

    const data = estudiantes.map((estudiante) =>
      mapearEstudiante(estudiante, notasPorEstudiante.get(estudiante.id) || [])
    );

    res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('[ERROR] obtenerEstudiantes:', error);
    res.status(500).json({ success: false, message: 'Error al consultar estudiantes' });
  }
};

// 2. Crear estudiante con validación, transacción y expediente seguro
exports.crearEstudiante = async (req, res) => {
  try {
    const datos = validarPayloadEstudiante(req.body);

    const existente = await dbConnection.query(
      'SELECT id FROM estudiantes WHERE cedula = ?',
      [datos.cedula]
    );

    if (existente && existente.length > 0) {
      await limpiarArchivoSubido(req);
      return res.status(409).json({
        success: false,
        message: 'La cédula ya se encuentra registrada en el sistema'
      });
    }

    const year = new Date().getFullYear();
    const codigoTemporal = `TMP-${crypto.randomUUID()}`;
    const fotoUrl = req.file ? `/uploads/estudiantes/${req.file.filename}` : '';
    let estudianteId = null;
    let codigoExpediente = null;

    await dbConnection.transaction(async (tx) => {
      const resultado = await tx.query(
        `INSERT INTO estudiantes
         (nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion, condicion, codigo_expediente, foto_url, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activo')`,
        [
          datos.nombre,
          datos.cedula,
          datos.fechaNacimiento,
          datos.ano,
          datos.seccion,
          datos.condicion,
          codigoTemporal,
          fotoUrl
        ]
      );

      estudianteId = Number(resultado.insertId || resultado.lastID || 0);
      if (!estudianteId) {
        throw new Error('No se pudo obtener el identificador del estudiante creado');
      }

      codigoExpediente = `EXP-${year}-${String(estudianteId).padStart(4, '0')}`;

      await tx.query(
        'UPDATE estudiantes SET codigo_expediente = ? WHERE id = ?',
        [codigoExpediente, estudianteId]
      );

      for (const materia of MATERIAS_DEFECTO) {
        await tx.query(
          `INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3)
           VALUES (?, ?, NULL, NULL, NULL)`,
          [estudianteId, materia]
        );
      }
    });

    await registrarAuditoria(
      req,
      'CREAR_ESTUDIANTE',
      'estudiantes',
      estudianteId,
      null,
      { ...datos, codigoExpediente, fotoUrl }
    );

    res.status(201).json({
      success: true,
      message: 'Estudiante inscrito exitosamente',
      id: estudianteId,
      codigoExpediente
    });
  } catch (error) {
    await limpiarArchivoSubido(req);

    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }

    if (/UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({
        success: false,
        message: 'La cédula o el código de expediente ya existen en el sistema'
      });
    }

    console.error('[ERROR] crearEstudiante:', error);
    res.status(500).json({ success: false, message: 'Error interno al registrar estudiante' });
  }
};

// 3. Actualizar estudiante
exports.actualizarEstudiante = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      await limpiarArchivoSubido(req);
      return res.status(400).json({ success: false, message: 'ID de estudiante inválido' });
    }

    const datos = validarPayloadEstudiante(req.body);

    const estudiantes = await dbConnection.query('SELECT * FROM estudiantes WHERE id = ?', [id]);
    if (!estudiantes || estudiantes.length === 0) {
      await limpiarArchivoSubido(req);
      return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
    }

    const actual = estudiantes[0];

    const cedulaDuplicada = await dbConnection.query(
      'SELECT id FROM estudiantes WHERE cedula = ? AND id <> ?',
      [datos.cedula, id]
    );

    if (cedulaDuplicada && cedulaDuplicada.length > 0) {
      await limpiarArchivoSubido(req);
      return res.status(409).json({
        success: false,
        message: 'La cédula ya pertenece a otro estudiante'
      });
    }

    const fotoAnterior = actual.foto_url || '';
    const fotoNueva = req.file ? `/uploads/estudiantes/${req.file.filename}` : null;
    const fotoFinal = fotoNueva || fotoAnterior;

    await dbConnection.query(
      `UPDATE estudiantes
       SET nombre_apellido = ?, cedula = ?, fecha_nacimiento = ?, ano_cursar = ?,
           seccion = ?, condicion = ?, foto_url = ?
       WHERE id = ?`,
      [
        datos.nombre,
        datos.cedula,
        datos.fechaNacimiento,
        datos.ano,
        datos.seccion,
        datos.condicion,
        fotoFinal,
        id
      ]
    );

    if (fotoNueva && fotoAnterior) {
      await safeDeleteFile(fotoAnterior);
    }

    await registrarAuditoria(
      req,
      'ACTUALIZAR_ESTUDIANTE',
      'estudiantes',
      id,
      {
        nombreApellido: actual.nombre_apellido,
        cedula: actual.cedula,
        fechaNacimiento: actual.fecha_nacimiento,
        anoCursar: actual.ano_cursar,
        seccion: actual.seccion,
        condicion: actual.condicion,
        fotoUrl: fotoAnterior
      },
      { ...datos, fotoUrl: fotoFinal }
    );

    res.json({
      success: true,
      message: 'Estudiante actualizado exitosamente',
      fotoUrl: fotoFinal
    });
  } catch (error) {
    await limpiarArchivoSubido(req);

    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }

    if (/UNIQUE constraint failed/i.test(error.message || '')) {
      return res.status(409).json({
        success: false,
        message: 'La cédula ya pertenece a otro estudiante'
      });
    }

    console.error('[ERROR] actualizarEstudiante:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar expediente' });
  }
};

// 4. Guardar calificaciones con validación estricta y transacción
exports.actualizarNotas = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de estudiante inválido' });
    }

    const estudiante = await dbConnection.query(
      'SELECT id, nombre_apellido FROM estudiantes WHERE id = ?',
      [id]
    );

    if (!estudiante || estudiante.length === 0) {
      return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
    }

    const { notas } = req.body || {};

    if (!Array.isArray(notas) || notas.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El formato de las calificaciones es inválido'
      });
    }

    if (notas.length > 30) {
      return res.status(400).json({
        success: false,
        message: 'Se enviaron demasiadas asignaturas en una sola operación'
      });
    }

    const antes = await dbConnection.query(
      'SELECT nombre_materia, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ? ORDER BY nombre_materia',
      [id]
    );

    const nombresVistos = new Set();
    const filas = [];

    for (const item of notas) {
      const nombreMateria = String(item?.nombre || item?.nombre_materia || '').trim();

      if (!nombreMateria) {
        throw errorValidacion('Todas las calificaciones deben indicar la asignatura');
      }

      if (!MATERIAS_DEFECTO.includes(nombreMateria)) {
        throw errorValidacion(`La asignatura "${nombreMateria}" no pertenece al pensum configurado`);
      }

      if (nombresVistos.has(nombreMateria)) {
        throw errorValidacion(`La asignatura "${nombreMateria}" está repetida`);
      }

      nombresVistos.add(nombreMateria);

      filas.push({
        nombreMateria,
        lapso1: normalizarNota(item.lapso1),
        lapso2: normalizarNota(item.lapso2),
        lapso3: normalizarNota(item.lapso3)
      });
    }

    await dbConnection.transaction(async (tx) => {
      for (const fila of filas) {
        await tx.query(
          `INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(estudiante_id, nombre_materia)
           DO UPDATE SET
             lapso1 = excluded.lapso1,
             lapso2 = excluded.lapso2,
             lapso3 = excluded.lapso3`,
          [
            id,
            fila.nombreMateria,
            fila.lapso1,
            fila.lapso2,
            fila.lapso3
          ]
        );
      }
    });

    const despues = await dbConnection.query(
      'SELECT nombre_materia AS nombre, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ? ORDER BY nombre_materia',
      [id]
    );

    await registrarAuditoria(
      req,
      'ACTUALIZAR_NOTAS',
      'estudiantes',
      id,
      antes,
      despues
    );

    res.json({
      success: true,
      message: 'Calificaciones guardadas correctamente',
      notas: notasConDefinitiva(despues)
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }

    console.error('[ERROR] actualizarNotas:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar calificaciones' });
  }
};

// 5. Cambiar estado del estudiante (archivar, reactivar, graduar o trasladar)
exports.cambiarEstadoEstudiante = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de estudiante inválido' });
    }

    const estado = normalizarEstado(req.body?.estado || 'Retirado');
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: `El estado debe ser uno de: ${ESTADOS.join(', ')}`
      });
    }

    const estudiantes = await dbConnection.query('SELECT * FROM estudiantes WHERE id = ?', [id]);
    if (!estudiantes || estudiantes.length === 0) {
      return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
    }

    const actual = estudiantes[0];
    const motivo = req.body?.motivo
      ? String(req.body.motivo).trim().slice(0, 255)
      : null;

    const requiereFechaRetiro = ['Retirado', 'Graduado', 'Trasladado'].includes(estado);
    const fechaRetiro = requiereFechaRetiro ? new Date().toISOString() : null;

    await dbConnection.query(
      `UPDATE estudiantes
       SET estado = ?, fecha_retiro = ?, motivo_retiro = ?
       WHERE id = ?`,
      [estado, fechaRetiro, requiereFechaRetiro ? motivo : null, id]
    );

    await registrarAuditoria(
      req,
      'CAMBIAR_ESTADO_ESTUDIANTE',
      'estudiantes',
      id,
      { estado: actual.estado || 'Activo', fechaRetiro: actual.fecha_retiro, motivoRetiro: actual.motivo_retiro },
      { estado, fechaRetiro, motivoRetiro: requiereFechaRetiro ? motivo : null }
    );

    const mensajes = {
      Activo: 'Estudiante reactivado correctamente',
      Retirado: 'Estudiante archivado correctamente. Sus datos y notas se conservan.',
      Graduado: 'Estudiante marcado como graduado correctamente',
      Trasladado: 'Estudiante marcado como trasladado correctamente'
    };

    res.json({
      success: true,
      message: mensajes[estado],
      estado
    });
  } catch (error) {
    console.error('[ERROR] cambiarEstadoEstudiante:', error);
    res.status(500).json({ success: false, message: 'Error al cambiar el estado del estudiante' });
  }
};

// 6. Compatibilidad: DELETE ya no borra físicamente, solo archiva.
exports.eliminarEstudiante = async (req, res) => {
  req.body = {
    ...(req.body || {}),
    estado: 'Retirado',
    motivo: req.body?.motivo || 'Archivado desde el módulo de estudiantes'
  };

  return exports.cambiarEstadoEstudiante(req, res);
};
