const { dbConnection } = require('../config/db');
const {
  ANOS,
  SECCIONES,
  ESTADOS,
  MATERIAS_DEFECTO,
  normalizarAno,
  normalizarEstado,
  normalizarCedula
} = require('../config/constants');
const { notasConDefinitiva, redondear, calcularDefinitiva } = require('../utils/grades');

function parsearNota(valor) {
  if (valor === null || valor === undefined || valor === '' || isNaN(Number(valor))) {
    return null;
  }
  return Number(valor);
}

/**
 * Endpoint de solo lectura para consolidar las calificaciones de una sección completa.
 * Genera la sábana matricial de evaluación con notas por asignatura, promedios individuales,
 * promedios por materia y estadísticas consolidadas.
 */
exports.obtenerSabanaSeccion = async (req, res) => {
  try {
    const {
      ano,
      seccion,
      periodo,
      lapso = 'definitiva',
      orden = 'apellido',
      estado = 'Activo'
    } = req.query;

    if (!ano || !seccion) {
      return res.status(400).json({
        success: false,
        message: 'Debe especificar el Año y la Sección para generar la sábana'
      });
    }

    const anoNorm = normalizarAno(ano);
    if (!ANOS.includes(anoNorm)) {
      return res.status(400).json({
        success: false,
        message: `El año debe ser uno de: ${ANOS.join(', ')}`
      });
    }

    const seccionNorm = String(seccion).trim().toUpperCase();
    if (!SECCIONES.includes(seccionNorm)) {
      return res.status(400).json({
        success: false,
        message: `La sección debe ser una de: ${SECCIONES.join(', ')}`
      });
    }

    const lapsoValido = ['1', '2', '3', 'definitiva', 'todos'].includes(String(lapso).toLowerCase())
      ? String(lapso).toLowerCase()
      : 'definitiva';

    const ordenValido = orden === 'cedula' ? 'cedula' : 'apellido';
    const periodoConsulta = periodo ? String(periodo).trim() : null;

    // Verificar si se consulta un período histórico cerrado en notas_historico
    let esHistorico = false;
    if (periodoConsulta) {
      const histCount = await dbConnection.query(
        `SELECT COUNT(*) AS total
         FROM notas_historico
         WHERE periodo_escolar = ? AND ano_cursado = ? AND seccion = ?`,
        [periodoConsulta, anoNorm, seccionNorm]
      );
      if (histCount && histCount[0] && Number(histCount[0].total) > 0) {
        esHistorico = true;
      }
    }

    let estudiantes = [];
    let notasRaw = [];

    if (esHistorico) {
      // 1. Consulta histórica
      const histEst = await dbConnection.query(
        `SELECT DISTINCT e.id, e.nombre_apellido, e.cedula, e.fecha_nacimiento,
                         nh.ano_cursado AS ano_cursar, nh.seccion, e.condicion,
                         e.codigo_expediente, e.foto_url, e.estado, nh.periodo_escolar
         FROM notas_historico nh
         JOIN estudiantes e ON e.id = nh.estudiante_id
         WHERE nh.periodo_escolar = ? AND nh.ano_cursado = ? AND nh.seccion = ?`,
        [periodoConsulta, anoNorm, seccionNorm]
      );

      estudiantes = histEst || [];

      if (estudiantes.length > 0) {
        const ids = estudiantes.map((e) => e.id);
        const placeholders = ids.map(() => '?').join(',');
        notasRaw = await dbConnection.query(
          `SELECT estudiante_id, nombre_materia, lapso1, lapso2, lapso3, definitiva, aprobada
           FROM notas_historico
           WHERE periodo_escolar = ? AND ano_cursado = ? AND seccion = ? AND estudiante_id IN (${placeholders})`,
          [periodoConsulta, anoNorm, seccionNorm, ...ids]
        );
      }
    } else {
      // 2. Consulta activa en notas y estudiantes
      let sqlEst = `
        SELECT id, nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion,
               condicion, codigo_expediente, foto_url, estado, fecha_retiro, motivo_retiro,
               periodo_escolar
        FROM estudiantes
        WHERE ano_cursar = ? AND seccion = ?
      `;
      const paramsEst = [anoNorm, seccionNorm];

      if (estado && estado !== 'TODOS') {
        const estadoNorm = normalizarEstado(estado);
        if (ESTADOS.includes(estadoNorm)) {
          sqlEst += ' AND estado = ?';
          paramsEst.push(estadoNorm);
        }
      }

      estudiantes = await dbConnection.query(sqlEst, paramsEst);

      if (estudiantes && estudiantes.length > 0) {
        const ids = estudiantes.map((e) => e.id);
        const placeholders = ids.map(() => '?').join(',');
        notasRaw = await dbConnection.query(
          `SELECT estudiante_id, nombre_materia, lapso1, lapso2, lapso3
           FROM notas
           WHERE estudiante_id IN (${placeholders})`,
          ids
        );
      }
    }

    // Ordenamiento de estudiantes
    if (ordenValido === 'cedula') {
      estudiantes.sort((a, b) => {
        const cleanA = parseInt(String(a.cedula || '').replace(/\D/g, ''), 10) || 0;
        const cleanB = parseInt(String(b.cedula || '').replace(/\D/g, ''), 10) || 0;
        return cleanA - cleanB;
      });
    } else {
      estudiantes.sort((a, b) =>
        String(a.nombre_apellido || '').localeCompare(String(b.nombre_apellido || ''), 'es', { sensitivity: 'base' })
      );
    }

    // Agrupar calificaciones por estudiante
    const notasPorEstudiante = new Map();
    for (const fila of notasRaw || []) {
      if (!notasPorEstudiante.has(fila.estudiante_id)) {
        notasPorEstudiante.set(fila.estudiante_id, new Map());
      }
      notasPorEstudiante.get(fila.estudiante_id).set(fila.nombre_materia, fila);
    }

    // Estructurar la matriz de notas para cada estudiante
    let sumaPromediosSeccion = 0;
    let cantPromediosSeccion = 0;
    let totalEstudiantesAprobadosPleno = 0;
    let totalEstudiantesPendientes = 0;
    let totalEstudiantesReprobados = 0;
    let totalEstudiantesEvaluados = 0;

    // Acumuladores por Asignatura
    const statsMaterias = {};
    for (const materia of MATERIAS_DEFECTO) {
      statsMaterias[materia] = {
        materia,
        sumaNotas: 0,
        conteoNotas: 0,
        aprobados: 0,
        reprobados: 0
      };
    }

    const estudiantesMatriz = estudiantes.map((st, idx) => {
      const mapaNotas = notasPorEstudiante.get(st.id) || new Map();
      const notasMaterias = {};
      let sumaNotasEst = 0;
      let cantNotasEst = 0;
      let matAprobadasEst = 0;
      let matReprobadasEst = 0;

      for (const materia of MATERIAS_DEFECTO) {
        const itemNota = mapaNotas.get(materia) || {};
        const l1 = parsearNota(itemNota.lapso1);
        const l2 = parsearNota(itemNota.lapso2);
        const l3 = parsearNota(itemNota.lapso3);
        const def = itemNota.definitiva !== undefined && itemNota.definitiva !== null
          ? parsearNota(itemNota.definitiva)
          : calcularDefinitiva({ lapso1: l1, lapso2: l2, lapso3: l3 });

        let notaVisual = null;
        if (lapsoValido === '1') notaVisual = l1;
        else if (lapsoValido === '2') notaVisual = l2;
        else if (lapsoValido === '3') notaVisual = l3;
        else notaVisual = def;

        const completa = l1 !== null && l2 !== null && l3 !== null;
        const aprobada = notaVisual !== null ? notaVisual >= 10 : null;

        notasMaterias[materia] = {
          materia,
          lapso1: l1,
          lapso2: l2,
          lapso3: l3,
          definitiva: def,
          notaVisual,
          aprobada,
          completa
        };

        // Acumular para estadísticas del estudiante
        if (notaVisual !== null) {
          sumaNotasEst += notaVisual;
          cantNotasEst++;
          if (notaVisual >= 10) {
            matAprobadasEst++;
          } else {
            matReprobadasEst++;
          }

          // Acumular para estadísticas de la Asignatura
          statsMaterias[materia].sumaNotas += notaVisual;
          statsMaterias[materia].conteoNotas++;
          if (notaVisual >= 10) {
            statsMaterias[materia].aprobados++;
          } else {
            statsMaterias[materia].reprobados++;
          }
        }
      }

      const promedioIndividual = cantNotasEst > 0 ? redondear(sumaNotasEst / cantNotasEst) : null;

      if (promedioIndividual !== null) {
        sumaPromediosSeccion += promedioIndividual;
        cantPromediosSeccion++;
      }

      if (cantNotasEst > 0) {
        totalEstudiantesEvaluados++;
        if (matReprobadasEst === 0) {
          totalEstudiantesAprobadosPleno++;
        } else if (matReprobadasEst <= 2) {
          totalEstudiantesPendientes++;
        } else {
          totalEstudiantesReprobados++;
        }
      }

      let condicionRendimiento = 'Sin Calificar';
      if (cantNotasEst > 0) {
        if (matReprobadasEst === 0) condicionRendimiento = 'Aprobado';
        else if (matReprobadasEst <= 2) condicionRendimiento = 'Materia Pendiente';
        else condicionRendimiento = 'Aplazado';
      }

      return {
        numeroLista: idx + 1,
        id: st.id,
        nombreApellido: st.nombre_apellido,
        cedula: st.cedula,
        codigoExpediente: st.codigo_expediente,
        fotoUrl: st.foto_url,
        estado: st.estado || 'Activo',
        condicion: st.condicion || 'Regular',
        notas: notasMaterias,
        estadisticas: {
          materiasEvaluadas: cantNotasEst,
          materiasAprobadas: matAprobadasEst,
          materiasReprobadas: matReprobadasEst,
          promedio: promedioIndividual,
          condicionRendimiento
        }
      };
    });

    // Consolidar estadísticas de cada asignatura
    const resumenMaterias = MATERIAS_DEFECTO.map((materia) => {
      const sm = statsMaterias[materia];
      const promedio = sm.conteoNotas > 0 ? redondear(sm.sumaNotas / sm.conteoNotas) : null;
      const porcentajeAprobacion = sm.conteoNotas > 0
        ? redondear((sm.aprobados / sm.conteoNotas) * 100)
        : 0;

      return {
        materia,
        evaluados: sm.conteoNotas,
        aprobados: sm.aprobados,
        reprobados: sm.reprobados,
        promedio,
        porcentajeAprobacion
      };
    });

    // Consolidar estadísticas globales de la sección
    const promedioGeneralSeccion = cantPromediosSeccion > 0
      ? redondear(sumaPromediosSeccion / cantPromediosSeccion)
      : null;

    const porcentajeAprobacionGeneral = totalEstudiantesEvaluados > 0
      ? redondear((totalEstudiantesAprobadosPleno / totalEstudiantesEvaluados) * 100)
      : 0;

    const periodofinal = periodoConsulta || (estudiantes[0]?.periodo_escolar || '2025-2026');

    res.json({
      success: true,
      esHistorico,
      metadatos: {
        institucion: 'Liceo Bolivariano "Elisa Pulgar de Ramírez"',
        codigoDEA: 'S3437D2014',
        ubicacion: 'Agua Santa, Municipio Miranda, Estado Trujillo',
        ano: anoNorm,
        seccion: seccionNorm,
        periodo: periodofinal,
        lapso: lapsoValido,
        orden: ordenValido,
        estado: estado || 'Activo',
        materias: MATERIAS_DEFECTO,
        fechaGeneracion: new Date().toISOString()
      },
      resumenGeneral: {
        matriculaTotal: estudiantes.length,
        matriculaEvaluada: totalEstudiantesEvaluados,
        aprobadosPlenos: totalEstudiantesAprobadosPleno,
        conMateriasPendientes: totalEstudiantesPendientes,
        reprobados: totalEstudiantesReprobados,
        promedioGeneral: promedioGeneralSeccion,
        porcentajeAprobacion: porcentajeAprobacionGeneral
      },
      resumenMaterias,
      estudiantes: estudiantesMatriz
    });
  } catch (error) {
    console.error('[ERROR] obtenerSabanaSeccion:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno al generar la sábana de calificaciones de la sección'
    });
  }
};
