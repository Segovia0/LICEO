const express = require('express');
const router = express.Router();
const { login, verificarSesion, cambiarClave } = require('../controllers/authController');
const auth = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/rateLimit');

// Endpoint público de inicio de sesión, con límite de intentos
router.post('/login', loginRateLimit, login);

// Endpoint protegido para verificar estado del token actual
router.get('/verify', auth, verificarSesion);

// Cambio de contraseña: acepta tanto la sesión normal como el token temporal
// emitido cuando el usuario está obligado a cambiar su clave.
router.put('/password', auth.passwordChangeAuth, cambiarClave);

module.exports = router;
