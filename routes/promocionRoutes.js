const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireRole } = auth;

const {
  obtenerNominaSeccion,
  ejecutarCierreYPromocion,
  obtenerHistorialCierres,
  obtenerDetalleCierre,
  obtenerHistorialAcademicoEstudiante
} = require('../controllers/promocionController');

// 1. Consulta bajo demanda de la nómina por año y sección para evaluación y promoción
router.get(
  '/seccion',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  obtenerNominaSeccion
);

// 2. Ejecutar Cierre de Año y Promoción Masiva (transaccional y atómico) — solo administrador
router.post(
  '/ejecutar-cierre',
  auth,
  requireRole('admin', 'administrador', 'control_estudios'),
  ejecutarCierreYPromocion
);

// 3. Listado histórico de cierres escolares realizados
router.get(
  '/historial',
  auth,
  requireRole('admin', 'administrador', 'control_estudios', 'docente', 'profesor', 'director'),
  obtenerHistorialCierres
);

// 4. Detalle y acta de un cierre específico
router.get(
  '/historial/:id',
  auth,
  requireRole('admin', 'administrador', 'control_estudios', 'docente', 'profesor', 'director'),
  obtenerDetalleCierre
);

// 5. Historial académico completo de un estudiante a través de los años
router.get(
  '/estudiante/:id/historial',
  auth,
  obtenerHistorialAcademicoEstudiante
);

module.exports = router;
