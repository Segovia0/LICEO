const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { login } = require('../controllers/authController');

// Configuración de Multer para las fotos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/estudiantes'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

const {
  obtenerEstudiantes,
  crearEstudiante,
  actualizarEstudiante,
  actualizarNotas,
  eliminarEstudiante
} = require('../controllers/estudianteController');

// Rutas principales
router.get('/', obtenerEstudiantes);
router.post('/', upload.single('foto'), crearEstudiante);

// ⚠️ IMPORTANTE: Esta línea de notas DEBE ir ANTES de router.put('/:id', ...)
router.put('/:id/notas', actualizarNotas);

// Rutas con ID genérico
router.put('/:id', upload.single('foto'), actualizarEstudiante);
router.delete('/:id', eliminarEstudiante);

// Ruta protegida para el endpoint de login
router.post('/login', login);

module.exports = router;
