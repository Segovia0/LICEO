const { dbConnection } = require('../config/db');
const {
  ANOS,
  SECCIONES,
  CONDICIONES,
  ESTADOS,
  normalizarAno,
  siguienteAno,
  normalizarEstado
} = require('../config/constants');
const { notasConDefinitiva, redondear } = require('../utils/grades');
const { registrarAuditoria } = require('../utils/audit');

function parsearId(valor) {
  const id = Number.parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function calcularPromedio(notasConDef) {
  let suma = 0;
  let conteo = 0;
  for (const n of notasConDef) {
    if (n.definitiva !== null && n.definitiva !== undefined) {
      suma += Number(n.definitiva);
      conteo++;
    }
  }
  return conteo > 0 ? redondear(suma / conteo) : null;
}

/**
 * 1. Consulta bajo demanda de la nómina de estudiantes por Año y Sección
 * Incluye sus calificaciones cargadas y calcula la sugerencia de promoción
 * según la normativa académica oficial de Educación Media General.
 */
exports.obtenerNominaSeccion = async (req, res) => {
  try {
    const { ano, seccion, periodo } = req.query;

    if (!ano || !seccion) {
      return res.status(400).json({
        success: false,
        message: 'Debe especificar el Año y la Sección a consultar'
      });
    }

    const anoNormalizado = normalizarAno(ano);
    if (!ANOS.includes(anoNormalizado)) {
      return res.status(400).json({
        success: false,
        message: `El año debe ser uno de: ${ANOS.join(', ')}`
      });
    }

    const seccionNormalizada = String(seccion).trim().toUpperCase();
    if (!SECCIONES.includes(seccionNormalizada)) {
      return res.status(400).json({
        success: false,
        message: `La sección debe ser una de: ${SECCIONES.join(', ')}`
      });
    }

    // Consultamos únicamente los estudiantes de la sección solicitada
    const sqlEstudiantes = `
      SELECT id, nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion,
             condicion, codigo_expediente, foto_url, estado, fecha_retiro, motivo_retiro,
             periodo_escolar, created_at
      FROM estudiantes
      WHERE ano_cursar = ? AND seccion = ? AND estado = 'Activo'
      ORDER BY nombre_apellido COLLATE NOCASE ASC, id ASC
    `;

    const estudiantes = await dbConnection.query(sqlEstudiantes, [
      anoNormalizado,
      seccionNormalizada
    ]);

    if (!estudiantes || estudiantes.length === 0) {
      return res.json({
        success: true,
        count: 0,
        ano: anoNormalizado,
        seccion: seccionNormalizada,
        data: [],
        resumen: {
          total: 0,
          promovidos: 0,
          graduados: 0,
          pendientes: 0,
          repitientes: 0,
          notasCompletas: 0
        }
      });
    }

    const ids = estudiantes.map((e) => e.id);
    const placeholders = ids.map(() => '?').join(',');

    const notasFilas = await dbConnection.query(
      `SELECT estudiante_id, nombre_materia, lapso1, lapso2, lapso3
       FROM notas
       WHERE estudiante_id IN (${placeholders})
       ORDER BY nombre_materia COLLATE NOCASE ASC`,
      ids
    );

    const notasPorEstudiante = new Map();
    for (const n of notasFilas) {
      if (!notasPorEstudiante.has(n.estudiante_id)) {
        notasPorEstudiante.set(n.estudiante_id, []);
      }
      notasPorEstudiante.get(n.estudiante_id).push(n);
    }

    let contadorPromovidos = 0;
    let contadorGraduados = 0;
    let contadorPendientes = 0;
    let contadorRepitientes = 0;
    let contadorCompletas = 0;

    const data = estudiantes.map((st) => {
      const rawNotas = notasPorEstudiante.get(st.id) || [];
      const notasCalculadas = notasConDefinitiva(rawNotas);

      let materiasAprobadas = 0;
      let materiasReprobadas = 0;
      let materiasEvaluadas = 0;
      const nombresReprobadas = [];

      for (const item of notasCalculadas) {
        if (item.definitiva !== null && item.definitiva !== undefined) {
          materiasEvaluadas++;
          if (item.definitiva >= 10) {
            materiasAprobadas++;
          } else {
            materiasReprobadas++;
            nombresReprobadas.push({
              materia: item.nombre_materia,
              definitiva: item.definitiva
            });
          }
        }
      }

      const notasCompletas = rawNotas.length > 0 && materiasEvaluadas === rawNotas.length;
      if (notasCompletas) contadorCompletas++;

      const promedio = calcularPromedio(notasCalculadas);

      // Clasificación según normativa académica venezolana:
      let sugerencia = 'Promovido';
      let accionSugerida = 'promover_regular';
      let proximoAnoSugerido = siguienteAno(st.ano_cursar);
      let condicionSugerida = 'Regular';
      let estadoSugerido = 'Activo';
      let motivoSugerencia = '';

      if (st.ano_cursar === '5to Año') {
        if (materiasReprobadas === 0) {
          sugerencia = 'Graduado';
          accionSugerida = 'graduar';
          proximoAnoSugerido = '5to Año';
          condicionSugerida = st.condicion === 'Nuevo Ingreso' ? 'Regular' : st.condicion;
          estadoSugerido = 'Graduado';
          motivoSugerencia = 'Aprobó satisfactoriamente todas las asignaturas de 5to año (Bachiller)';
          contadorGraduados++;
        } else if (materiasReprobadas <= 2) {
          sugerencia = 'Materia Pendiente';
          accionSugerida = 'promover_pendiente';
          proximoAnoSugerido = '5to Año';
          condicionSugerida = 'Materia Pendiente';
          estadoSugerido = 'Activo';
          motivoSugerencia = `Tiene ${materiasReprobadas} materia(s) aplazada(s). Queda en revisión / materia pendiente de 5to año.`;
          contadorPendientes++;
        } else {
          sugerencia = 'Repitente';
          accionSugerida = 'repite';
          proximoAnoSugerido = '5to Año';
          condicionSugerida = 'Repitente';
          estadoSugerido = 'Activo';
          motivoSugerencia = `Reprueba ${materiasReprobadas} asignaturas. No aprueba 5to año; debe repetir el curso.`;
          contadorRepitientes++;
        }
      } else {
        // 1er a 4to Año
        if (materiasReprobadas === 0) {
          sugerencia = 'Promovido';
          accionSugerida = 'promover_regular';
          proximoAnoSugerido = siguienteAno(st.ano_cursar);
          condicionSugerida = 'Regular';
          estadoSugerido = 'Activo';
          motivoSugerencia = `Promovido al ${proximoAnoSugerido} en condición Regular`;
          contadorPromovidos++;
        } else if (materiasReprobadas <= 2) {
          sugerencia = 'Materia Pendiente';
          accionSugerida = 'promover_pendiente';
          proximoAnoSugerido = siguienteAno(st.ano_cursar);
          condicionSugerida = 'Materia Pendiente';
          estadoSugerido = 'Activo';
          motivoSugerencia = `Promovido al ${proximoAnoSugerido} con ${materiasReprobadas} materia(s) pendiente(s)`;
          contadorPendientes++;
        } else {
          sugerencia = 'Repitente';
          accionSugerida = 'repite';
          proximoAnoSugerido = st.ano_cursar;
          condicionSugerida = 'Repitente';
          estadoSugerido = 'Activo';
          motivoSugerencia = `Repite ${st.ano_cursar} por reprobar ${materiasReprobadas} asignaturas`;
          contadorRepitientes++;
        }
      }

      return {
        id: st.id,
        _id: st.id,
        nombreApellido: st.nombre_apellido,
        cedula: st.cedula,
        fechaNacimiento: st.fecha_nacimiento,
        anoCursar: st.ano_cursar,
        seccion: st.seccion,
        condicion: st.condicion,
        codigoExpediente: st.codigo_expediente,
        fotoUrl: st.foto_url,
        estado: st.estado || 'Activo',
        periodoEscolar: st.periodo_escolar || periodo || '2025-2026',
        estadisticas: {
          totalMaterias: rawNotas.length,
          materiasEvaluadas,
          materiasAprobadas,
          materiasReprobadas,
          nombresReprobadas,
          notasCompletas,
          promedioGeneral: promedio
        },
        sugerencia: {
          tipo: sugerencia,
          accion: accionSugerida,
          proximoAno: proximoAnoSugerido,
          proximaCondicion: condicionSugerida,
          proximoEstado: estadoSugerido,
          motivo: motivoSugerencia
        },
        notas: notasCalculadas
      };
    });

    res.json({
      success: true,
      count: data.length,
      ano: anoNormalizado,
      seccion: seccionNormalizada,
      resumen: {
        total: data.length,
        promovidos: contadorPromovidos,
        graduados: contadorGraduados,
        pendientes: contadorPendientes,
        repitientes: contadorRepitientes,
        notasCompletas: contadorCompletas
      },
      data
    });
  } catch (error) {
    console.error('[ERROR] obtenerNominaSeccion:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar la nómina de la sección para promoción'
    });
  }
};

/**
 * 2. Ejecutar Cierre y Promoción Masiva en Transacción SQLite Atómica
 * Cero Borrado Físico (NO DELETE).
 * Resguarda cada calificación en notas_historico vinculada al año cursado y período escolar.
 * Actualiza el expediente de los estudiantes de manera atómica (BEGIN/COMMIT/ROLLBACK).
 */
exports.ejecutarCierreYPromocion = async (req, res) => {
  try {
    const {
      periodoEscolar,
      nuevoPeriodoEscolar,
      anoCursar,
      seccion,
      observaciones,
      estudiantes
    } = req.body || {};

    if (!periodoEscolar || String(periodoEscolar).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Debe indicar el período escolar que finaliza (ejemplo: 2025-2026)'
      });
    }

    if (!nuevoPeriodoEscolar || String(nuevoPeriodoEscolar).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Debe indicar el nuevo período escolar para la prosecución (ejemplo: 2026-2027)'
      });
    }

    const anoNorm = normalizarAno(anoCursar);
    if (!ANOS.includes(anoNorm)) {
      return res.status(400).json({
        success: false,
        message: `El año a cerrar debe ser uno de: ${ANOS.join(', ')}`
      });
    }

    const seccionNorm = String(seccion).trim().toUpperCase();
    if (!SECCIONES.includes(seccionNorm)) {
      return res.status(400).json({
        success: false,
        message: `La sección a cerrar debe ser una de: ${SECCIONES.join(', ')}`
      });
    }

    if (!Array.isArray(estudiantes) || estudiantes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'La lista de estudiantes a procesar no puede estar vacía'
      });
    }

    const accionesValidas = new Set([
      'promover_regular',
      'promover_pendiente',
      'repite',
      'graduar',
      'trasladar',
      'retirar',
      'no_procesar'
    ]);

    for (const item of estudiantes) {
      const id = parsearId(item.id);
      if (!id) {
        return res.status(400).json({
          success: false,
          message: `Identificador de estudiante inválido: ${item.id}`
        });
      }
      if (!accionesValidas.has(item.accion)) {
        return res.status(400).json({
          success: false,
          message: `Acción desconocida "${item.accion}" para el estudiante ${id}`
        });
      }
    }

    let cierreId = null;
    const contadores = {
      promovidos: 0,
      graduados: 0,
      pendientes: 0,
      repitientes: 0,
      retirados: 0,
      trasladados: 0,
      sinCambio: 0
    };

    const usuarioActual = req.user?.usuario || 'sistema';
    const usuarioId = req.user?.id || null;

    // Ejecución dentro de Transacción SQLite garantizada
    await dbConnection.transaction(async (tx) => {
      // 1. Crear cabecera del Cierre
      const resCierre = await tx.query(
        `INSERT INTO cierres_periodo (
          periodo_escolar, nuevo_periodo_escolar, ano_cursar, seccion,
          total_estudiantes, promovidos, graduados, pendientes, repitientes,
          retirados, trasladados, sin_cambio, usuario_id, usuario, observaciones
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)`,
        [
          String(periodoEscolar).trim(),
          String(nuevoPeriodoEscolar).trim(),
          anoNorm,
          seccionNorm,
          estudiantes.length,
          usuarioId,
          usuarioActual,
          observaciones ? String(observaciones).trim() : null
        ]
      );

      cierreId = Number(resCierre.insertId || resCierre.lastID || 0);
      if (!cierreId) {
        throw new Error('No se pudo generar el registro del acta de cierre de período');
      }

      // 2. Procesar cada estudiante de manera atómica
      for (const item of estudiantes) {
        const estudianteId = parsearId(item.id);
        const accion = item.accion;
        const seccionNueva = item.seccionNueva && SECCIONES.includes(String(item.seccionNueva).toUpperCase())
          ? String(item.seccionNueva).toUpperCase()
          : seccionNorm;
        const obsIndividual = item.observacion ? String(item.observacion).trim() : null;
        const fechaEvento = item.fecha ? String(item.fecha).trim() : new Date().toISOString().split('T')[0];

        const estFilas = await tx.query(
          'SELECT * FROM estudiantes WHERE id = ?',
          [estudianteId]
        );

        if (!estFilas || estFilas.length === 0) {
          throw new Error(`Estudiante ID ${estudianteId} no encontrado en la base de datos`);
        }

        const estActual = estFilas[0];

        // Obtener calificaciones actuales del estudiante
        const notasEst = await tx.query(
          `SELECT id, nombre_materia, lapso1, lapso2, lapso3
           FROM notas
           WHERE estudiante_id = ?
           ORDER BY nombre_materia COLLATE NOCASE ASC`,
          [estudianteId]
        );

        const notasConDef = notasConDefinitiva(notasEst);

        // A) Resguardo histórico intacto de cada materia (CERO BORRADO)
        for (const n of notasConDef) {
          await tx.query(
            `INSERT INTO notas_historico (
              cierre_id, estudiante_id, periodo_escolar, ano_cursado, seccion,
              nombre_materia, lapso1, lapso2, lapso3, definitiva, aprobada
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cierreId,
              estudianteId,
              String(periodoEscolar).trim(),
              estActual.ano_cursar,
              estActual.seccion,
              n.nombre_materia,
              n.lapso1,
              n.lapso2,
              n.lapso3,
              n.definitiva,
              n.aprobada === true ? 1 : (n.aprobada === false ? 0 : null)
            ]
          );
        }

        // B) Transición de estado y expediente del estudiante
        let anoDestino = estActual.ano_cursar;
        let condicionDestino = estActual.condicion;
        let estadoDestino = estActual.estado || 'Activo';
        let fechaRetiroDestino = estActual.fecha_retiro || null;
        let motivoRetiroDestino = estActual.motivo_retiro || null;
        let debeReiniciarNotas = false;

        switch (accion) {
          case 'promover_regular': {
            const sig = siguienteAno(estActual.ano_cursar);
            anoDestino = sig || estActual.ano_cursar;
            condicionDestino = 'Regular';
            estadoDestino = 'Activo';
            fechaRetiroDestino = null;
            motivoRetiroDestino = null;
            debeReiniciarNotas = true;
            contadores.promovidos++;
            break;
          }

          case 'promover_pendiente': {
            const sig = estActual.ano_cursar === '5to Año' ? '5to Año' : siguienteAno(estActual.ano_cursar);
            anoDestino = sig || estActual.ano_cursar;
            condicionDestino = 'Materia Pendiente';
            estadoDestino = 'Activo';
            fechaRetiroDestino = null;
            motivoRetiroDestino = null;
            debeReiniciarNotas = true;
            contadores.pendientes++;
            break;
          }

          case 'repite': {
            anoDestino = estActual.ano_cursar;
            condicionDestino = 'Repitente';
            estadoDestino = 'Activo';
            fechaRetiroDestino = null;
            motivoRetiroDestino = null;
            debeReiniciarNotas = true;
            contadores.repitientes++;
            break;
          }

          case 'graduar': {
            anoDestino = '5to Año';
            condicionDestino = estActual.condicion;
            estadoDestino = 'Graduado';
            fechaRetiroDestino = fechaEvento;
            motivoRetiroDestino = obsIndividual || 'Graduado de Educación Media General - Bachiller de la República';
            debeReiniciarNotas = false; // Sus calificaciones de 5to año se conservan
            contadores.graduados++;
            break;
          }

          case 'trasladar': {
            anoDestino = estActual.ano_cursar;
            condicionDestino = estActual.condicion;
            estadoDestino = 'Trasladado';
            fechaRetiroDestino = fechaEvento;
            motivoRetiroDestino = obsIndividual || 'Traslado formal a otra institución educativa';
            debeReiniciarNotas = false;
            contadores.trasladados++;
            break;
          }

          case 'retirar': {
            anoDestino = estActual.ano_cursar;
            condicionDestino = estActual.condicion;
            estadoDestino = 'Retirado';
            fechaRetiroDestino = fechaEvento;
            motivoRetiroDestino = obsIndividual || 'Retiro escolar del plantel';
            debeReiniciarNotas = false;
            contadores.retirados++;
            break;
          }

          case 'no_procesar':
          default: {
            anoDestino = estActual.ano_cursar;
            condicionDestino = estActual.condicion;
            estadoDestino = estActual.estado || 'Activo';
            debeReiniciarNotas = false;
            contadores.sinCambio++;
            break;
          }
        }

        // Actualizar datos del estudiante
        const periodoDestino = ['promover_regular', 'promover_pendiente', 'repite'].includes(accion)
          ? String(nuevoPeriodoEscolar).trim()
          : (estActual.periodo_escolar || String(periodoEscolar).trim());

        await tx.query(
          `UPDATE estudiantes
           SET ano_cursar = ?, seccion = ?, condicion = ?, estado = ?,
               fecha_retiro = ?, motivo_retiro = ?, periodo_escolar = ?
           WHERE id = ?`,
          [
            anoDestino,
            seccionNueva,
            condicionDestino,
            estadoDestino,
            fechaRetiroDestino,
            motivoRetiroDestino,
            periodoDestino,
            estudianteId
          ]
        );

        // C) Si avanza de curso o repite en el nuevo año escolar, se preparan las calificaciones
        // activas en blanco para el nuevo período, ya que el histórico quedó 100% resguardado.
        if (debeReiniciarNotas) {
          await tx.query(
            `UPDATE notas
             SET lapso1 = NULL, lapso2 = NULL, lapso3 = NULL
             WHERE estudiante_id = ?`,
            [estudianteId]
          );
        }

        // D) Registrar en promociones_historial
        const matAprobadas = notasConDef.filter((n) => n.aprobada === true).length;
        const matReprobadas = notasConDef.filter((n) => n.aprobada === false).length;
        const promFinal = calcularPromedio(notasConDef);

        await tx.query(
          `INSERT INTO promociones_historial (
            cierre_id, estudiante_id, periodo_escolar, ano_anterior, seccion_anterior,
            estado_anterior, condicion_anterior, accion, ano_nuevo, seccion_nueva,
            estado_nuevo, condicion_nueva, materias_aprobadas, materias_reprobadas,
            promedio, observacion
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cierreId,
            estudianteId,
            String(periodoEscolar).trim(),
            estActual.ano_cursar,
            estActual.seccion,
            estActual.estado || 'Activo',
            estActual.condicion,
            accion,
            anoDestino,
            seccionNueva,
            estadoDestino,
            condicionDestino,
            matAprobadas,
            matReprobadas,
            promFinal,
            obsIndividual
          ]
        );
      }

      // 3. Actualizar conteos consolidados en el cierre
      await tx.query(
        `UPDATE cierres_periodo
         SET promovidos = ?, graduados = ?, pendientes = ?, repitientes = ?,
             retirados = ?, trasladados = ?, sin_cambio = ?
         WHERE id = ?`,
        [
          contadores.promovidos,
          contadores.graduados,
          contadores.pendientes,
          contadores.repitientes,
          contadores.retirados,
          contadores.trasladados,
          contadores.sinCambio,
          cierreId
        ]
      );
    });

    // Auditoría del proceso masivo
    await registrarAuditoria(
      req,
      'CIERRE_Y_PROMOCION_MASIVA',
      'cierres_periodo',
      cierreId,
      null,
      {
        cierreId,
        periodoEscolar,
        nuevoPeriodoEscolar,
        anoCursar: anoNorm,
        seccion: seccionNorm,
        totalEstudiantes: estudiantes.length,
        resumen: contadores
      }
    );

    res.json({
      success: true,
      message: `Cierre del año escolar y promoción masiva procesada exitosamente para ${anoNorm} "${seccionNorm}".`,
      cierreId,
      resumen: {
        total: estudiantes.length,
        ...contadores
      }
    });
  } catch (error) {
    console.error('[ERROR] ejecutarCierreYPromocion:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error interno al procesar el cierre y promoción escolar'
    });
  }
};

/**
 * 3. Listado de cierres y promociones históricas ejecutadas
 */
exports.obtenerHistorialCierres = async (req, res) => {
  try {
    const cierres = await dbConnection.query(
      `SELECT id, periodo_escolar, nuevo_periodo_escolar, ano_cursar, seccion,
              total_estudiantes, promovidos, graduados, pendientes, repitientes,
              retirados, trasladados, sin_cambio, usuario, observaciones, fecha_cierre
       FROM cierres_periodo
       ORDER BY id DESC
       LIMIT 100`
    );

    res.json({
      success: true,
      count: (cierres || []).length,
      data: cierres || []
    });
  } catch (error) {
    console.error('[ERROR] obtenerHistorialCierres:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar el historial de cierres escolares'
    });
  }
};

/**
 * 4. Obtener detalle de un cierre específico con su lista de estudiantes
 */
exports.obtenerDetalleCierre = async (req, res) => {
  try {
    const id = parsearId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de cierre inválido' });
    }

    const cierres = await dbConnection.query(
      'SELECT * FROM cierres_periodo WHERE id = ?',
      [id]
    );

    if (!cierres || cierres.length === 0) {
      return res.status(404).json({ success: false, message: 'Cierre no encontrado' });
    }

    const cierre = cierres[0];

    const estudiantesPromocion = await dbConnection.query(
      `SELECT ph.*, e.nombre_apellido, e.cedula, e.codigo_expediente, e.foto_url
       FROM promociones_historial ph
       JOIN estudiantes e ON e.id = ph.estudiante_id
       WHERE ph.cierre_id = ?
       ORDER BY e.nombre_apellido COLLATE NOCASE ASC`,
      [id]
    );

    const notasHistoricas = await dbConnection.query(
      `SELECT estudiante_id, nombre_materia, lapso1, lapso2, lapso3, definitiva, aprobada
       FROM notas_historico
       WHERE cierre_id = ?
       ORDER BY estudiante_id, nombre_materia COLLATE NOCASE ASC`,
      [id]
    );

    const notasPorEstudiante = new Map();
    for (const nh of notasHistoricas) {
      if (!notasPorEstudiante.has(nh.estudiante_id)) {
        notasPorEstudiante.set(nh.estudiante_id, []);
      }
      notasPorEstudiante.get(nh.estudiante_id).push(nh);
    }

    const estudiantesConNotas = estudiantesPromocion.map((st) => ({
      ...st,
      notasHistoricas: notasPorEstudiante.get(st.estudiante_id) || []
    }));

    res.json({
      success: true,
      data: {
        cierre,
        estudiantes: estudiantesConNotas
      }
    });
  } catch (error) {
    console.error('[ERROR] obtenerDetalleCierre:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar el detalle del cierre escolar'
    });
  }
};

/**
 * 5. Consultar historial académico completo de un estudiante a través de todos los períodos
 */
exports.obtenerHistorialAcademicoEstudiante = async (req, res) => {
  try {
    const estudianteId = parsearId(req.params.id);
    if (!estudianteId) {
      return res.status(400).json({ success: false, message: 'ID de estudiante inválido' });
    }

    const estudiantes = await dbConnection.query(
      'SELECT * FROM estudiantes WHERE id = ?',
      [estudianteId]
    );

    if (!estudiantes || estudiantes.length === 0) {
      return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
    }

    const estudiante = estudiantes[0];

    const notasHistorico = await dbConnection.query(
      `SELECT nh.*, cp.fecha_cierre
       FROM notas_historico nh
       LEFT JOIN cierres_periodo cp ON cp.id = nh.cierre_id
       WHERE nh.estudiante_id = ?
       ORDER BY nh.periodo_escolar DESC, nh.ano_cursado ASC, nh.nombre_materia COLLATE NOCASE ASC`,
      [estudianteId]
    );

    const promociones = await dbConnection.query(
      `SELECT ph.*, cp.fecha_cierre
       FROM promociones_historial ph
       LEFT JOIN cierres_periodo cp ON cp.id = ph.cierre_id
       WHERE ph.estudiante_id = ?
       ORDER BY ph.id DESC`,
      [estudianteId]
    );

    // Agrupar calificaciones por período escolar y año cursado
    const periodosAgrupados = new Map();
    for (const nh of notasHistorico) {
      const clave = `${nh.periodo_escolar}::${nh.ano_cursado}`;
      if (!periodosAgrupados.has(clave)) {
        periodosAgrupados.set(clave, {
          periodoEscolar: nh.periodo_escolar,
          anoCursado: nh.ano_cursado,
          seccion: nh.seccion,
          fechaCierre: nh.fecha_cierre || nh.fecha_registro,
          notas: []
        });
      }
      periodosAgrupados.get(clave).notas.push(nh);
    }

    res.json({
      success: true,
      data: {
        estudiante: {
          id: estudiante.id,
          nombreApellido: estudiante.nombre_apellido,
          cedula: estudiante.cedula,
          anoCursar: estudiante.ano_cursar,
          seccion: estudiante.seccion,
          condicion: estudiante.condicion,
          estado: estudiante.estado || 'Activo',
          codigoExpediente: estudiante.codigo_expediente,
          periodoEscolar: estudiante.periodo_escolar || '2025-2026'
        },
        periodosCerrados: Array.from(periodosAgrupados.values()),
        eventosPromocion: promociones
      }
    });
  } catch (error) {
    console.error('[ERROR] obtenerHistorialAcademicoEstudiante:', error);
    res.status(500).json({
      success: false,
      message: 'Error al consultar el historial académico del estudiante'
    });
  }
};
