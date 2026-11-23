const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = auth;
const constanciaController = require('../controllers/constanciaController');

// Búsqueda bajo demanda de estudiantes para la emisión de constancias
// director, administrador pueden emitir constancias; profesor solo lectura
router.get('/estudiantes', auth, constanciaController.buscarEstudiantes);

// Obtención del perfil completo y notas del estudiante
router.get('/estudiante/:id', auth, constanciaController.obtenerDetalleEstudiante);

// Registro de auditoría de la emisión del documento
// Solo administrador y director pueden emitir constancias oficiales
router.post(
  '/registro',
  auth,
  requireRole('admin', 'administrador', 'control_estudios', 'director'),
  constanciaController.registrarEmision
);

module.exports = router;
