const db = require('../config/db');
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

// 🔍 SELECT con Filtros dinámicos SQL
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

    const estudiantes = db.query(sql, params);

    // Obtener las notas relacionales de cada estudiante mediante SQL SELECT
    for (let st of estudiantes) {
      const notas = db.query(
        'SELECT nombre_materia AS nombre, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ?',
    [st.id]
  );
}
// Agregar justo después de hacer la consulta SELECT de notas:
// Obtener las notas relacionales de cada estudiante mediante SQL SELECT
    for (let st of estudiantes) {
      let notas = db.query(
        'SELECT nombre_materia AS nombre, lapso1, lapso2, lapso3 FROM notas WHERE estudiante_id = ?',
        [st.id]
      );

      // Si el estudiante no tiene notas cargadas, se crean e insertan las 9 por defecto
      if (!notas || notas.length === 0) {
        for (const materia of MATERIAS_DEFECTO) {
          db.run(
            'INSERT INTO notas (estudiante_id, nombre_materia, lapso1, lapso2, lapso3) VALUES (?, ?, 0, 0, 0)',
            [st.id, materia]
          );
        }
        notas = db.query(
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

// 📝 INSERT INTO Estudiante + Registro de Notas
exports.crearEstudiante = async (req, res) => {
  try {
    const { nombreApellido, cedula, fechaNacimiento, anoCursar, seccion, condicion } = req.body;

    // Consulta SQL para verificar duplicados
    const existente = db.query('SELECT id FROM estudiantes WHERE cedula = ?', [cedula.trim()]);
    if (existente.length > 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'La cédula ya se encuentra registrada' });
    }

    // Consulta SQL para contar total de registros
    const countResult = db.query('SELECT COUNT(*) AS total FROM estudiantes');
    const totalCount = countResult[0] ? countResult[0].total : 0;
    const year = new Date().getFullYear();
    const correlativo = String(totalCount + 1).padStart(4, '0');
    const codigoExpediente = `EXP-${year}-${correlativo}`;
    const fotoUrl = req.file ? `/uploads/estudiantes/${req.file.filename}` : '';

    // Sentencia SQL INSERT INTO
    db.run(
      `INSERT INTO estudiantes (nombre_apellido, cedula, fecha_nacimiento, ano_cursar, seccion, condicion, codigo_expediente, foto_url) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombreApellido.trim(), cedula.trim(), fechaNacimiento, anoCursar, seccion, condicion, codigoExpediente, fotoUrl]
    );

    // Obtener ID del estudiante insertado
    const nuevoEstudiante = db.query('SELECT id FROM estudiantes WHERE cedula = ?', [cedula.trim()]);
    const estudianteId = nuevoEstudiante[0].id;

    // Insertar las 9 materias en la tabla relacional de notas
    for (const materia of MATERIAS_DEFECTO) {
      db.run(
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

// 🔄 UPDATE Estudiante
exports.actualizarEstudiante = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { nombreApellido, cedula, fechaNacimiento, anoCursar, seccion, condicion } = req.body;

    const estudiantes = db.query('SELECT foto_url FROM estudiantes WHERE id = ?', [id]);
    if (estudiantes.length === 0) {
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

    // Sentencia SQL UPDATE
    db.run(
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

// 📊 UPDATE Calificaciones
exports.actualizarNotas = async (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const { notas } = req.body;

    for (const item of notas) {
      db.run(
        `UPDATE notas SET lapso1 = ?, lapso2 = ?, lapso3 = ? WHERE estudiante_id = ? AND nombre_materia = ?`,
        [item.lapso1, item.lapso2, item.lapso3, id, item.nombre]
      );
    }

    res.json({ success: true, message: 'Calificaciones actualizadas correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 🗑️ DELETE Estudiante
exports.eliminarEstudiante = async (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const estudiantes = db.query('SELECT foto_url FROM estudiantes WHERE id = ?', [id]);
    if (estudiantes.length === 0) return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });

    const fotoUrl = estudiantes[0].foto_url;
    if (fotoUrl) {
      const oldPath = path.join(__dirname, '..', fotoUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Sentencias SQL DELETE
    db.run('DELETE FROM notas WHERE estudiante_id = ?', [id]);
    db.run('DELETE FROM estudiantes WHERE id = ?', [id]);

    res.json({ success: true, message: 'Estudiante eliminado' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
