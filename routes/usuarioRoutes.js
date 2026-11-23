const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = auth;
const {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  listarAsignaciones,
  misAsignaciones,
  crearAsignacion,
  eliminarAsignacion,
  reemplazarAsignaciones
} = require('../controllers/usuarioController');

// ── Gestión de usuarios (solo administrador) ────────────────────────────────
router.get('/', auth, requireRole('administrador', 'admin'), listarUsuarios);
router.post('/', auth, requireRole('administrador', 'admin'), crearUsuario);
router.put('/:id', auth, requireRole('administrador', 'admin'), actualizarUsuario);
router.delete('/:id', auth, requireRole('administrador', 'admin'), eliminarUsuario);

// ── Asignaciones docentes ───────────────────────────────────────────────────
// El profesor consulta sus propias asignaciones
router.get('/asignaciones/mis', auth, misAsignaciones);
// El administrador consulta/gestiona todas las asignaciones
router.get('/asignaciones', auth, requireRole('administrador', 'admin'), listarAsignaciones);
router.post('/asignaciones', auth, requireRole('administrador', 'admin'), crearAsignacion);
router.delete('/asignaciones/:id', auth, requireRole('administrador', 'admin'), eliminarAsignacion);
// Reemplazar todas las asignaciones de un profesor de una vez
router.put('/asignaciones/:usuario_id', auth, requireRole('administrador', 'admin'), reemplazarAsignaciones);

module.exports = router;
