const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const auth = require('../middleware/auth');
const { requireRole } = auth;

const {
  obtenerEstudiantes,
  crearEstudiante,
  actualizarEstudiante,
  actualizarNotas,
  cambiarEstadoEstudiante,
  eliminarEstudiante
} = require('../controllers/estudianteController');

// Consulta: cualquier usuario autenticado.
router.get('/', auth, obtenerEstudiantes);

// Escritura: administración y control de estudios.
router.post(
  '/',
  auth,
  requireRole('admin', 'control_estudios'),
  upload.single('foto'),
  crearEstudiante
);

// Las rutas con subruta deben ir antes de /:id.
router.put(
  '/:id/notas',
  auth,
  requireRole('admin', 'control_estudios', 'docente'),
  actualizarNotas
);

router.patch(
  '/:id/estado',
  auth,
  requireRole('admin', 'control_estudios'),
  cambiarEstadoEstudiante
);

router.put(
  '/:id',
  auth,
  requireRole('admin', 'control_estudios'),
  upload.single('foto'),
  actualizarEstudiante
);

// DELETE se mantiene por compatibilidad, pero archiva en lugar de borrar.
router.delete(
  '/:id',
  auth,
  requireRole('admin', 'control_estudios'),
  eliminarEstudiante
);

module.exports = router;
