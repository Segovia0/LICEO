# 🏫 StudioCT — Sistema de Control de Estudio para Liceo

Sistema web integral de gestión académica para instituciones de educación media general en Venezuela. Está construido como una **SPA (Single Page Application)** liviana y responsiva, pensada para funcionar en equipos con recursos limitados (por ejemplo, distribuciones Linux ligeras como antiX, Debian o Ubuntu).

---

## 🚀 Instalación y puesta en marcha

### 1. Requisitos

* **Node.js 22 o superior** (recomendado). El sistema usa el módulo integrado `node:sqlite`, por lo que no necesita compilar SQLite ni instalar un servidor de base de datos externo.
* **npm**.
* Navegador web moderno (Chrome, Firefox, Edge).

> En Node.js 18/20 se utiliza la dependencia opcional `sqlite3`. Si el binario nativo no está disponible, actualice a Node.js 22+ para usar `node:sqlite` sin compilación.

### 2. Dependencias

Desde la carpeta del proyecto:

```bash
npm install
```

No es necesario instalar Express, CORS, Multer ni SQLite por separado: ya están declarados en `package.json`.

### 3. Variables de entorno

Copie el archivo de ejemplo y edítelo:

```bash
cp .env.example .env
```

Variables principales:

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP (por defecto `3000`). |
| `JWT_SECRET` | Secreto para firmar sesiones. **Obligatorio**, mínimo 32 caracteres. Genérelo con `openssl rand -hex 32`. |
| `ADMIN_DEFAULT_USER` | Usuario administrador a crear si la tabla `usuarios` está vacía. |
| `ADMIN_DEFAULT_PASS` | Clave inicial para ese administrador. Si es débil, se exigirá cambiarla al primer inicio de sesión. |
| `DB_PATH` | Ruta alternativa de la base SQLite. Útil para pruebas o restauraciones controladas. |
| `CORS_ORIGIN` | Orígenes permitidos separados por coma. Si se omite, solo se permite el mismo origen. |
| `TRUST_PROXY` | Poner `true` si está detrás de Nginx/Caddy para registrar la IP real. |
| `JWT_EXPIRES_IN` | Duración de la sesión (por defecto `8h`). |
| `JWT_PASSWORD_CHANGE_EXPIRES_IN` | Duración del token temporal para cambio de clave (por defecto `15m`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN` | Opcionales, solo para respaldos en Google Drive. |

La aplicación **no arranca** si `JWT_SECRET` falta o es demasiado débil.

### 4. Iniciar el sistema

```bash
npm start
# o en desarrollo:
npm run dev
```

Acceda a `http://localhost:3000`.

En el primer arranque se ejecutan automáticamente las migraciones y se crea el administrador si no existe ningún usuario.

---

## 🔐 Seguridad y usuarios

* Las contraseñas se almacenan con **bcrypt**. Las claves antiguas en texto plano se migran al iniciar sesión.
* Si el administrador conserva una contraseña débil conocida (por ejemplo, la clave histórica `1234`), el sistema entrega un **token temporal** que solo permite cambiar la contraseña. Hasta hacerlo no se puede acceder a estudiantes, notas ni respaldos.
* El cambio de contraseña está disponible en la barra lateral con el botón **🔑 Cambiar contraseña**.
* Los intentos de inicio de sesión están limitados a **10 por cada 15 minutos** por usuario/IP.
* Las rutas de escritura están restringidas por rol:
  * `admin`: todo el sistema.
  * `control_estudios`: estudiantes, notas y respaldos.
  * `docente`: carga de calificaciones.
* Las acciones sensibles (login, cambios de estudiantes, notas, estados, respaldos y restauraciones) se registran en la tabla `auditoria`.

> **Instalaciones anteriores:** conserve la clave actual del administrador. Si es la clave histórica por defecto (`1234`) o una clave débil conocida, el sistema solicitará cambiarla al iniciar sesión. `ADMIN_DEFAULT_PASS` solo se usa cuando la tabla de usuarios está vacía; no restablece una clave existente.

---

## 🗂️ Estructura del proyecto

```text
LICEO/
├── config/
│   ├── constants.js          # Catálogos y normalización académica
│   ├── db.js                 # Conexión SQLite y PRAGMAs
│   ├── migrations.js         # Migraciones idempotentes al arrancar (incluye tabla migraciones)
│   └── security.js           # Validación de JWT y expiraciones
├── controllers/              # Lógica de autenticación y estudiantes
├── middleware/               # Auth, roles, uploads, rate limit, cabeceras
├── models/                   # Modelo de usuarios
├── routes/                   # Rutas de la API
├── utils/                    # Notas, auditoría y respaldos
├── public/                   # SPA (index.html) y login
├── uploads/estudiantes/      # Fotografías de estudiantes
├── uploads/temp/             # Respaldos temporales y copias previas a restaurar
├── liceo.sqlite              # Base de datos SQLite
├── seed_estudiantes.js       # Seed opcional de datos de prueba
├── fix_anos.js               # Mantenimiento manual de datos académicos
└── server.js                 # Punto de entrada Express
```

---

## 🛠️ Funcionalidades

### 📊 Panel general

* **Total Matriculados:** expedientes en estado `Activo`.
* **Nuevos Ingresos:** estudiantes con condición `Nuevo Ingreso`.
* **Materias Reprobadas:** asignaturas con definitiva menor a 10.
* **Promedio General:** promedio de las materias que tienen los **tres lapsos cargados**.
* Gráficos de distribución por condición, matrícula por año, promedio por asignatura y evolución por lapso.

Los promedios ignoran las materias sin calificaciones completas. Una nota vacía ya no se trata como cero.

### 👥 Gestión de estudiantes

* Inscripción y edición con validación de nombre, cédula, fecha de nacimiento, año, sección y condición.
* Código de expediente automático `EXP-YYYY-XXXX`.
* Fotografía con validación de tipo y tamaño (máximo 5 MB).
* Filtros por texto, año, sección y estado.
* **Archivado sin borrado físico:** los estados disponibles son `Activo`, `Retirado`, `Graduado` y `Trasladado`. Al archivar se conservan datos, fotografías y calificaciones, y el expediente puede reactivarse.
* La ruta `DELETE` se mantiene por compatibilidad, pero archiva en lugar de eliminar.

### 📝 Calificaciones

* 9 asignaturas oficiales y 3 lapsos (escala 0–20).
* Los campos vacíos se guardan como `NULL`, no como `0`.
* La **definitiva** solo existe cuando los tres lapsos están cargados.
* Validación estricta de rango (0–20), asignaturas permitidas, duplicados y transacciones.
* Los promedios y el boletín muestran `—` cuando falta un lapso.

### 📜 Boletín

* Vista A4 imprimible con datos del estudiante, estado, calificaciones por lapso, definitivas y líneas de firma.
* Oculta filtros y botones al imprimir o guardar como PDF.

---

## 💾 Respaldos y restauración

Desde **Mantenimiento y Respaldos**:

1. **Copia local `.sqlite`:** genera una instantánea consistente con `VACUUM INTO`, incluso con el sistema en uso.
2. **Respaldo completo `.tar.gz`:** incluye la base de datos y todas las fotografías.
3. **Google Drive (opcional):** sube una instantánea de la base si las credenciales OAuth están configuradas.
4. **Restaurar:** acepta `.sqlite`, `.db`, `.tar.gz` o `.tgz`.

La restauración:

* Verifica la integridad del archivo SQLite y la presencia de las tablas y columnas mínimas.
* Exige rol `admin`.
* Conserva una copia de seguridad previa en `uploads/temp/` antes de reemplazar la base.
* Ejecuta las migraciones automáticamente después de restaurar.
* Si el respaldo es completo, restaura también las fotografías.

> Los respaldos completos son la opción recomendada para trasladar el sistema a otro equipo. Una copia `.sqlite` no incluye las fotografías.

---

## 🔧 Mantenimiento

* Las migraciones de `config/migrations.js` son **idempotentes**: se pueden ejecutar en cada arranque sin duplicar datos.
* Normalizan años (`1ro` → `1er Año`), condiciones (`Repitiente` → `Repitente`), estados y asignaturas faltantes.
* Las cédulas se guardan solo con dígitos: `V-12345678`, `12345678` y `12.345.678` se consideran la misma cédula.
* Convierten a `NULL` las notas históricas que solo tenían ceros de relleno. Esta corrección se ejecuta **una sola vez**, registrada en la tabla `migraciones`, para no borrar ceros legítimos cargados después.
* Crean índices únicos para evitar notas duplicadas por estudiante/asignatura y usuarios duplicados.

Para ejecutar la normalización sin iniciar la API:

```bash
node fix_anos.js
```

El archivo `seed_estudiantes.js` es solo para datos de prueba. **No lo ejecute sobre la base real** salvo que desee agregar estudiantes ficticios.

---

## 📋 Notas de migración de datos

Al actualizar desde la versión anterior:

* Se agregaron las columnas `estado`, `fecha_retiro`, `motivo_retiro` y `debe_cambiar_clave`.
* Se creó la tabla `auditoria`.
* Los años y condiciones inconsistentes se normalizaron.
* Las 33 filas de notas con solo ceros se convirtieron a `NULL`.
* Las 3 filas con un solo lapso cargado y ceros de relleno se convirtieron a `NULL` en los lapsos faltantes.
* Se conservaron los 106 estudiantes y las 954 filas de notas.

---

## 👥 Créditos

* **Giovanny Segovia** — C.I: 31.588.187
* **Wilfredo Alvarez** — C.I: 30.654.549
* **Carlos Colmenarez** — C.I: 30.494.549
