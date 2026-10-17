const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const ctrl = require('../controllers/estudianteController');

router.route('/')
  .get(ctrl.obtenerEstudiantes)
  .post(upload.single('foto'), ctrl.crearEstudiante);

router.route('/:id')
  .put(upload.single('foto'), ctrl.actualizarEstudiante)
  .delete(ctrl.eliminarEstudiante);

// Reemplazar la ruta PUT existente por esta:
router.put('/:id', upload.single('foto'), ctrl.actualizarEstudiante);

module.exports = router;
