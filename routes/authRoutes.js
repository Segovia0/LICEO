const express = require('express');
const router = express.Router();
const { login } = require('../controllers/authController');

// Ruta protegida para el endpoint de login
router.post('/login', login);

module.exports = router;
