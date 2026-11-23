const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = auth;

const { obtenerSabanaSeccion } = require('../controllers/sabanaController');

// Consulta de solo lectura de la sábana de calificaciones por sección
// director, administrador, profesor y control_estudios/admin pueden consultar
router.get(
  '/seccion',
  auth,
  requireRole('admin', 'administrador', 'control_estudios', 'docente', 'profesor', 'director'),
  obtenerSabanaSeccion
);

module.exports = router;
