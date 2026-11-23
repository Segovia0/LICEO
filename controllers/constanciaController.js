const { dbConnection } = require('../config/db');
const {
  ANOS,
  SECCIONES,
  ESTADOS,
  normalizarEstado,
  normalizarCedula
} = require('../config/constants');
const { notasConDefinitiva, redondear } = require('../utils/grades');
const { registrarAuditoria } = require('../utils/audit');

function parsearId(valor) {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
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

// Búsqueda bajo demanda de estudiantes para la emisión de constancias
exports.buscarEstudiantes = async (req, res) => {
  try {
    const { busqueda, estado } = req.query;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);

    let sql = `
      SELECT id, nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion,
             condicion, codigo_expediente, foto_url, estado, fecha_retiro, motivo_retiro, created_at
      FROM estudiantes
      WHERE 1=1
    `;
    const params = [];

    if (estado && estado !== 'TODOS') {
      const normalizado = normalizarEstado(estado);
      if (ESTADOS.includes(normalizado)) {
        sql += ' AND estado = ?';
        params.push(normalizado);
      }
    }

    if (busqueda && String(busqueda).trim() !== '') {
      const termino = `%${String(busqueda).trim()}%`;
      sql += ' AND (cedula LIKE ? OR nombre_apellido LIKE ? OR codigo_expediente LIKE ?)';
      params.push(termino, termino, termino);
    }

    sql += ' ORDER BY nombre_apellido COLLATE NOCASE ASC LIMIT ?';
    params.push(limit);

    const rows = await dbConnection.query(sql, params);

    const estudiantes = (rows || []).map((row) => ({
      id: row.id,
      _id: row.id,
      nombreApellido: row.nombre_apellido,
      cedula: row.cedula,
      fechaNacimiento: row.fecha_nacimiento,
      anoCursar: row.ano_cursar,
      seccion: row.seccion,
      condicion: row.condicion,
      codigoExpediente: row.codigo_expediente,
      fotoUrl: row.foto_url,
      estado: row.estado || 'Activo',
      fechaRetiro: row.fecha_retiro || null,
      motivoRetiro: row.motivo_retiro || null,
      createdAt: row.created_at,
      edad: calcularEdad(row.fecha_nacimiento)
    }));

    res.json({
      success: true,
      count: estudiantes.length,
      data: estudiantes
    });
  } catch (error) {
    console.error('[ERROR] buscarEstudiantes (Constancias):', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar estudiantes para constancias'
    });
  }
};

// Obtención del perfil académico detallado y notas del estudiante bajo demanda
exports.obtenerDetalleEstudiante = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Identificador de estudiante inválido'
      });
    }

    const filas = await dbConnection.query(
      `SELECT id, nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion,
              condicion, codigo_expediente, foto_url, estado, fecha_retiro, motivo_retiro, created_at
       FROM estudiantes
       WHERE id = ?`,
      [id]
    );

    if (!filas || filas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Estudiante no encontrado'
      });
    }

    const estudiante = filas[0];

    // Consultar notas del estudiante
    const notasFilas = await dbConnection.query(
      `SELECT id, nombre_materia AS nombre, lapso1, lapso2, lapso3
       FROM notas
       WHERE estudiante_id = ?
       ORDER BY nombre_materia COLLATE NOCASE ASC`,
      [id]
    );

    const notasConDef = notasConDefinitiva(notasFilas || []);

    // Calcular estadísticas académicas seguras (manejando casos con o sin notas cargadas)
    let sumaDefinitivas = 0;
    let cantDefinitivas = 0;
    let aprobadas = 0;
    let reprobadas = 0;

    for (const n of notasConDef) {
      if (n.definitiva !== null && n.definitiva !== undefined) {
        sumaDefinitivas += Number(n.definitiva);
        cantDefinitivas++;
        if (Number(n.definitiva) >= 10) {
          aprobadas++;
        } else {
          reprobadas++;
        }
      }
    }

    const promedioGeneral = cantDefinitivas > 0
      ? redondear(sumaDefinitivas / cantDefinitivas)
      : null;

    // Sugerencia de próximo año para prosecución
    const mapaPromocion = {
      '1er Año': '2do Año',
      '2do Año': '3er Año',
      '3er Año': '4to Año',
      '4to Año': '5to Año',
      '5to Año': 'Educación Universitaria (Bachiller de la República)'
    };
    const proximoAnoSugerido = mapaPromocion[estudiante.ano_cursar] || 'Siguiente Nivel Académico';

    // Consultar también historial de notas de períodos cerrados anteriores
    const notasHistoricas = await dbConnection.query(
      `SELECT id, periodo_escolar, ano_cursado, seccion, nombre_materia AS nombre,
              lapso1, lapso2, lapso3, definitiva, aprobada
       FROM notas_historico
       WHERE estudiante_id = ?
       ORDER BY periodo_escolar DESC, id ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        id: estudiante.id,
        _id: estudiante.id,
        nombreApellido: estudiante.nombre_apellido,
        cedula: estudiante.cedula,
        fechaNacimiento: estudiante.fecha_nacimiento,
        edad: calcularEdad(estudiante.fecha_nacimiento),
        anoCursar: estudiante.ano_cursar,
        seccion: estudiante.seccion,
        condicion: estudiante.condicion,
        codigoExpediente: estudiante.codigo_expediente,
        fotoUrl: estudiante.foto_url,
        estado: estudiante.estado || 'Activo',
        fechaRetiro: estudiante.fecha_retiro || null,
        motivoRetiro: estudiante.motivo_retiro || null,
        periodoEscolar: estudiante.periodo_escolar || '2025-2026',
        createdAt: estudiante.created_at,
        proximoAnoSugerido,
        estadisticas: {
          totalMaterias: notasConDef.length,
          materiasEvaluadas: cantDefinitivas,
          aprobadas,
          reprobadas,
          promedioGeneral
        },
        notas: notasConDef,
        notasHistoricas: notasHistoricas || []
      }
    });
  } catch (error) {
    console.error('[ERROR] obtenerDetalleEstudiante (Constancias):', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la información académica del estudiante'
    });
  }
};

// Registro de auditoría al emitir una constancia formal
exports.registrarEmision = async (req, res) => {
  try {
    const { estudianteId, tipoConstancia, motivo, periodoEscolar } = req.body || {};
    const id = parsearId(estudianteId);

    if (!id || !tipoConstancia) {
      return res.status(400).json({
        success: false,
        message: 'Faltan datos obligatorios para registrar la emisión'
      });
    }

    await registrarAuditoria(
      req,
      'EMITIR_CONSTANCIA',
      'estudiantes',
      id,
      null,
      {
        tipoConstancia: String(tipoConstancia).slice(0, 100),
        motivo: motivo ? String(motivo).slice(0, 200) : null,
        periodoEscolar: periodoEscolar ? String(periodoEscolar).slice(0, 50) : null,
        fechaEmision: new Date().toISOString()
      }
    );

    res.json({
      success: true,
      message: 'Emisión de constancia registrada en auditoría exitosamente'
    });
  } catch (error) {
    console.error('[ERROR] registrarEmision (Constancias):', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar la emisión de la constancia'
    });
  }
};
