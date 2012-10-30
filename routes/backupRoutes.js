const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const multer = require('multer');

const auth = require('../middleware/auth');
const { requireRole } = auth;
const { registrarAuditoria } = require('../utils/audit');
const {
  TEMP_DIR,
  nombreRespaldo,
  crearSnapshotDb,
  crearBackupCompleto,
  restaurarDesdeArchivo,
  eliminarArchivo
} = require('../utils/backup');

// Restauración: se aceptan bases sueltas y respaldos completos comprimidos.
const backupUpload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const nombre = String(file.originalname || '').toLowerCase();
    const valido = nombre.endsWith('.sqlite') ||
      nombre.endsWith('.db') ||
      nombre.endsWith('.tar.gz') ||
      nombre.endsWith('.tgz');

    if (!valido) {
      const error = new Error('El archivo debe ser .sqlite, .db, .tar.gz o .tgz');
      error.status = 400;
      return callback(error);
    }

    callback(null, true);
  }
});

function getDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

function descargarYLimpiar(res, archivo, nombreDescarga) {
  return new Promise((resolve) => {
    res.download(archivo, nombreDescarga, async (error) => {
      await eliminarArchivo(archivo);

      if (error && !res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'No se pudo preparar la descarga del respaldo'
        });
      }

      resolve();
    });
  });
}

// 1. Respaldo a Google Drive
router.post(
  '/cloud-backup',
  auth,
  requireRole('admin', 'control_estudios'),
  async (req, res) => {
    const snapshot = path.join(TEMP_DIR, nombreRespaldo('.sqlite'));

    try {
      const drive = getDriveClient();
      if (!drive) {
        return res.status(500).json({
          success: false,
          message: 'Las credenciales de Google Drive no están configuradas en las variables de entorno (.env).'
        });
      }

      await crearSnapshotDb(snapshot);
      const fileName = path.basename(snapshot);

      const response = await drive.files.create({
        requestBody: { name: fileName },
        media: {
          mimeType: 'application/x-sqlite3',
          body: fs.createReadStream(snapshot)
        },
        fields: 'id, name'
      });

      await registrarAuditoria(
        req,
        'RESPALDO_DRIVE',
        'sistema',
        response.data.id,
        null,
        { fileName: response.data.name }
      );

      res.json({
        success: true,
        message: '¡Respaldo subido a Google Drive con éxito!',
        fileId: response.data.id,
        fileName: response.data.name
      });
    } catch (error) {
      console.error('[ERROR] Al sincronizar con Google Drive:', error);
      res.status(500).json({
        success: false,
        message: 'No se pudo completar el respaldo en la nube'
      });
    } finally {
      await eliminarArchivo(snapshot);
    }
  }
);

// 2. Descargar copia consistente de la base de datos
router.get(
  '/descargar',
  auth,
  requireRole('admin', 'control_estudios'),
  async (req, res) => {
    const snapshot = path.join(TEMP_DIR, nombreRespaldo('.sqlite'));

    try {
      await crearSnapshotDb(snapshot);

      await registrarAuditoria(
        req,
        'DESCARGAR_RESPALDO',
        'sistema',
        null,
        null,
        { archivo: path.basename(snapshot) }
      );

      await descargarYLimpiar(res, snapshot, path.basename(snapshot));
    } catch (error) {
      await eliminarArchivo(snapshot);
      console.error('[ERROR] Al descargar respaldo:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'No se pudo generar el respaldo de la base de datos'
        });
      }
    }
  }
);

// 3. Descargar respaldo completo: base de datos + fotografías
router.get(
  '/descargar-completo',
  auth,
  requireRole('admin', 'control_estudios'),
  async (req, res) => {
    const archivo = path.join(TEMP_DIR, nombreRespaldo('.tar.gz'));

    try {
      await crearBackupCompleto(archivo);

      await registrarAuditoria(
        req,
        'DESCARGAR_RESPALDO_COMPLETO',
        'sistema',
        null,
        null,
        { archivo: path.basename(archivo) }
      );

      await descargarYLimpiar(res, archivo, path.basename(archivo));
    } catch (error) {
      await eliminarArchivo(archivo);
      console.error('[ERROR] Al generar respaldo completo:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'No se pudo generar el respaldo completo'
        });
      }
    }
  }
);

// 4. Restaurar base de datos desde archivo .sqlite/.db o respaldo completo .tar.gz
router.post(
  '/restaurar',
  auth,
  requireRole('admin'),
  backupUpload.single('backupFile'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Debe adjuntar un archivo de respaldo válido'
      });
    }

    const tempPath = req.file.path;

    try {
      const resultado = await restaurarDesdeArchivo(tempPath, req.file.originalname);

      await registrarAuditoria(
        req,
        'RESTAURAR_RESPALDO',
        'sistema',
        null,
        null,
        {
          archivo: req.file.originalname,
          restauroFotos: resultado.restauroFotos
        }
      );

      res.json({
        success: true,
        message: resultado.restauroFotos
          ? 'Base de datos y fotografías restauradas correctamente.'
          : 'Base de datos restaurada correctamente. Las fotografías existentes se conservaron.',
        restauroFotos: resultado.restauroFotos
      });
    } catch (error) {
      console.error('[ERROR] Al restaurar base de datos:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'No se pudo restaurar el respaldo'
      });
    } finally {
      await eliminarArchivo(tempPath);
    }
  }
);

module.exports = router;
