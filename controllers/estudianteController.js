const { dbConnection, EstudianteModel, NotaModel } = require('../config/db');
const fs = require('fs');
const path = require('path');

const MATERIAS_DEFECTO = [
  'Castellano',
  'Matemáticas',
  'Inglés y Otras Lenguas',
  'Educación Física',
  'Biología / Ciencias Naturales',
  'Física',
  'Química',
  'Historia de Venezuela y Ciudadanía',
  'Geografía / Arte y Cultura'
];

// Obtener Estudiantes con Filtros e inclusión de sus 9 Materias
exports.obtenerEstudiantes = async (req, res) => {
  try {
    const { ano, seccion, busqueda } = req.query;

    let sql = 'SELECT * FROM estudiantes WHERE 1=1';
    let params = [];

    if (ano && ano !== 'TODOS') {
      sql += ' AND ano_cursar = ?';
      params.push(ano);
    }
    if (seccion && seccion !== 'TODAS') {
      sql += ' AND seccion = ?';
      params.push(seccion);
    }
    if (busqueda && busqueda.trim() !== '') {
      sql += ' AND (cedula LIKE ? OR nombre_apellido LIKE ? OR codigo_expediente LIKE ?)';
      const term = `%${busqueda.trim()}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY id DESC';

    const estudiantes = await dbConnection.query(sql, params);

    for (let st of estudiantes) {
      let notas = await dbConnection.query(
        'SELECT nombre_materia AS nombre, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ?', 
        [st.id]
      );
      
      if (!notas || notas.length === 0) {
        for (const materia of MATERIAS_DEFECTO) {
          await dbConnection.query(
            'INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3) VALUES (?, ?, 0, 0, 0)',
            [st.id, materia]
          );
        }
        notas = await dbConnection.query(
          'SELECT nombre_materia AS nombre, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ?', 
          [st.id]
        );
      }

      st._id = st.id;
      st.nombreApellido = st.nombre_apellido;
      st.fechaNacimiento = st.fecha_nacimiento;
      st.anoCursar = st.ano_cursar;
      st.codigoExpediente = st.codigo_expediente;
      st.fotoUrl = st.foto_url;
      st.notas = notas;
    }

    res.json({ success: true, count: estudiantes.length, data: estudiantes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Crear Estudiante
exports.crearEstudiante = async (req, res) => {
  try {
    const { nombreApellido, cedula, fechaNacimiento, anoCursar, seccion, condicion } = req.body;

    const existente = await dbConnection.query('SELECT id FROM estudiantes WHERE cedula = ?', [cedula.trim()]);
    if (existente && existente.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'La cédula ya se encuentra registrada' });
    }

    const countResult = await dbConnection.query('SELECT COUNT(*) AS total FROM estudiantes');
    const totalCount = countResult[0] && countResult[0].total ? countResult[0].total : 0;
    const year = new Date().getFullYear();
    const correlativo = String(totalCount + 1).padStart(4, '0');
    const codigoExpediente = `EXP-${year}-${correlativo}`;
    const fotoUrl = req.file ? `/uploads/estudiantes/${req.file.filename}` : '';

    await dbConnection.query(
      `INSERT INTO estudiantes (nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion, condicion, codigo_expediente, foto_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombreApellido.trim(), cedula.trim(), fechaNacimiento, anoCursar, seccion, condicion, codigoExpediente, fotoUrl]
    );

    const nuevoEstudiante = await dbConnection.query('SELECT id FROM estudiantes WHERE cedula = ?', [cedula.trim()]);
    const estudianteId = nuevoEstudiante[0].id;

    for (const materia of MATERIAS_DEFECTO) {
      await dbConnection.query(
        'INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3) VALUES (?, ?, 0, 0, 0)',
        [estudianteId, materia]
      );
    }

    res.status(201).json({ success: true, message: 'Estudiante inscrito exitosamente' });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Actualizar Estudiante
exports.actualizarEstudiante = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { nombreApellido, cedula, fechaNacimiento, anoCursar, seccion, condicion } = req.body;

    const estudiantes = await dbConnection.query('SELECT foto_url FROM estudiantes WHERE id = ?', [id]);
    if (!estudiantes || estudiantes.length === 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
    }

    let fotoUrl = estudiantes[0].foto_url;
    if (req.file) {
      if (fotoUrl) {
        const oldPath = path.join(__dirname, '..', fotoUrl);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      fotoUrl = `/uploads/estudiantes/${req.file.filename}`;
    }

    await dbConnection.query(
      `UPDATE estudiantes 
       SET nombre_apellido = ?, cedula = ?, fecha_nacimiento = ?, ano_cursar = ?, seccion = ?, condicion = ?, foto_url = ? 
       WHERE id = ?`,
      [nombreApellido.trim(), cedula.trim(), fechaNacimiento, anoCursar, seccion, condicion, fotoUrl, id]
    );

    res.json({ success: true, message: 'Estudiante actualizado exitosamente' });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Guardar / Actualizar Notas de forma segura
exports.actualizarNotas = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { notas } = req.body;

    console.log(`[DEBUG] Guardando notas para Estudiante ID: ${id}`);

    if (!notas || !Array.isArray(notas)) {
      return res.status(400).json({ success: false, message: 'El formato de las notas es inválido' });
    }

    for (const item of notas) {
      const lapso1 = item.lapso1 !== '' && !isNaN(item.lapso1) ? parseFloat(item.lapso1) : 0.0;
      const lapso2 = item.lapso2 !== '' && !isNaN(item.lapso2) ? parseFloat(item.lapso2) : 0.0;
      const lapso3 = item.lapso3 !== '' && !isNaN(item.lapso3) ? parseFloat(item.lapso3) : 0.0;
      
      const nombreMateria = item.nombre || item.nombre_materia;
      if (!nombreMateria) continue;

      // Verificamos si ya existe la nota para esta materia y este estudiante específico
      const existeNota = await dbConnection.query(
        'SELECT id FROM notas WHERE estudiante_id = ? AND nombre_materia = ?',
        [id, nombreMateria]
      );

      if (existeNota && existeNota.length > 0) {
        // Si existe, actualizamos
        await dbConnection.query(
          `UPDATE notas SET lapso1 = ?, lapso2 = ?, lapso3 = ? WHERE estudiante_id = ? AND nombre_materia = ?`,
          [lapso1, lapso2, lapso3, id, nombreMateria]
        );
      } else {
        // Si por alguna razón no existía, la insertamos amarrada a este ID
        await dbConnection.query(
          `INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3) VALUES (?, ?, ?, ?, ?)`,
          [id, nombreMateria, lapso1, lapso2, lapso3]
        );
      }
    }

    res.json({ success: true, message: 'Calificaciones guardadas correctamente' });
  } catch (error) {
    console.error('[ERROR] Al actualizar notas:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Eliminar Estudiante
exports.eliminarEstudiante = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const estudiantes = await dbConnection.query('SELECT foto_url FROM estudiantes WHERE id = ?', [id]);
    if (!estudiantes || estudiantes.length === 0) return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });

    const fotoUrl = estudiantes[0].foto_url;
    if (fotoUrl) {
      const oldPath = path.join(__dirname, '..', fotoUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await dbConnection.query('DELETE FROM notas WHERE estudiante_id = ?', [id]);
    await dbConnection.query('DELETE FROM estudiantes WHERE id = ?', [id]);

    res.json({ success: true, message: 'Estudiante eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};