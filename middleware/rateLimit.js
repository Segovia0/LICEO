/**
 * Limitador de intentos de inicio de sesión en memoria.
 * Para un plantel pequeño es suficiente y evita añadir dependencias.
 */

const intentos = new Map();

const VENTANA_MS = 15 * 60 * 1000;
const MAXIMO_INTENTOS = 10;

function obtenerClave(req) {
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  return `${req.ip || 'sin-ip'}|${usuario}`;
}

const limpieza = setInterval(() => {
  const ahora = Date.now();
  for (const [clave, registro] of intentos.entries()) {
    if (ahora > registro.reinicio) intentos.delete(clave);
  }
}, 10 * 60 * 1000);

if (typeof limpieza.unref === 'function') limpieza.unref();

function loginRateLimit(req, res, next) {
  const clave = obtenerClave(req);
  const ahora = Date.now();
  const registro = intentos.get(clave) || {
    cantidad: 0,
    reinicio: ahora + VENTANA_MS
  };

  if (ahora > registro.reinicio) {
    registro.cantidad = 0;
    registro.reinicio = ahora + VENTANA_MS;
  }

  registro.cantidad++;
  intentos.set(clave, registro);

  if (registro.cantidad > MAXIMO_INTENTOS) {
    const segundos = Math.max(1, Math.ceil((registro.reinicio - ahora) / 1000));
    res.set('Retry-After', String(segundos));
    return res.status(429).json({
      success: false,
      message: `Demasiados intentos fallidos. Intente de nuevo en ${Math.ceil(segundos / 60)} minuto(s).`
    });
  }

  res.on('finish', () => {
    if (res.statusCode === 200) intentos.delete(clave);
  });

  next();
}

module.exports = {
  loginRateLimit
};
