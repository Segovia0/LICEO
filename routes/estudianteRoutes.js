const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const auth = require('../middleware/auth');
const { requireRole, normalizarRol } = auth;
const usuarios = require('../models/usuarioModel');
const { dbConnection } = require('../config/db');

const {
  obtenerEstudiantes,
  obtenerNotasEstudiante,
  crearEstudiante,
  actualizarEstudiante,
  actualizarNotas,
  cambiarEstadoEstudiante,
  eliminarEstudiante
} = require('../controllers/estudianteController');

// Consulta: cualquier usuario autenticado.
router.get('/', auth, obtenerEstudiantes);

// Escritura de matrícula: administrador únicamente (director solo lectura).
router.post(
  '/',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  upload.single('foto'),
  crearEstudiante
);

// Las rutas con subruta deben ir antes de /:id.
router.get(
  '/:id/notas',
  auth,
  obtenerNotasEstudiante
);

/**
 * Actualizar notas:
 * - administrador/admin/control_estudios: acceso total.
 * - profesor/docente: solo materias asignadas para el año/sección del estudiante.
 * - director: sin acceso (403).
 */
router.put(
  '/:id/notas',
  auth,
  async (req, res, next) => {
    const rol = normalizarRol(req.user?.rol || '');

    if (rol === 'administrador') return next();
    if (rol === 'director') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'El director no puede modificar calificaciones directamente.'
      });
    }
    if (rol !== 'profesor') {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'No tiene permisos.' });
    }

    // Para el rol profesor: verificar que las materias enviadas estén en sus asignaciones
    try {
      const estudianteId = Number.parseInt(req.params.id, 10);
      if (!estudianteId) return res.status(400).json({ success: false, message: 'ID inválido' });

      const filas = await dbConnection.query(
        'SELECT ano_cursar, seccion FROM estudiantes WHERE id = ?', [estudianteId]
      );
      if (!filas || filas.length === 0) {
        return res.status(404).json({ success: false, message: 'Estudiante no encontrado' });
      }
      const { ano_cursar, seccion } = filas[0];

      const { notas } = req.body || {};
      if (!Array.isArray(notas) || notas.length === 0) return next(); // lo validará el controlador

      // Verificar cada materia contra las asignaciones del profesor
      for (const nota of notas) {
        const nombreMateria = String(nota?.nombre || nota?.nombre_materia || '').trim();
        const tieneAsignacion = await usuarios.profesorTieneAsignacion(
          req.user.id, nombreMateria, ano_cursar, seccion
        );
        if (!tieneAsignacion) {
          return res.status(403).json({
            success: false,
            code: 'FORBIDDEN',
            message: `No tiene asignada la materia "${nombreMateria}" para ${ano_cursar} sección ${seccion}.`
          });
        }
      }
      next();
    } catch (err) {
      console.error('[AUTH] Error al verificar asignaciones del profesor:', err);
      return res.status(500).json({ success: false, message: 'Error al verificar permisos de asignación' });
    }
  },
  actualizarNotas
);

router.patch(
  '/:id/estado',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  cambiarEstadoEstudiante
);

router.put(
  '/:id',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  upload.single('foto'),
  actualizarEstudiante
);

// DELETE se mantiene por compatibilidad, pero archiva en lugar de borrar.
router.delete(
  '/:id',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  eliminarEstudiante
);

module.exports = router;
