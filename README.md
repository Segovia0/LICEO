# 🏫 Sistema de Control de Estudio para Liceo (Full-Stack SPA)

Sistema web integral de gestión académica orientado a instituciones de educación media general en Venezuela. Diseñado bajo una arquitectura **SPA (Single Page Application)** moderna, liviana y responsiva, optimizada para ejecutarse de forma fluida en entornos con recursos reducidos (como distribuciones Linux livianas).

---

## 🚀 Guía de Instalación y Configuración Inicial

### 1. Requisitos Previos

Asegúrate de tener instalado en tu sistema:

* **Node.js** (Versión v18 o superior)
* **npm** (Gestor de paquetes de Node)

> **Nota para Linux (antiX / Debian / Ubuntu):** No se requiere la instalación de servicios externos de base de datos como MySQL, MariaDB o MongoDB. Tampoco requiere librerías nativas de compilación en C++, ya que utiliza SQLite compilado en WebAssembly.

---

### 2. Clonación e Instalación de Dependencias

Abre la terminal en el directorio raíz de tu proyecto y ejecuta los siguientes comandos:

```bash
# 1. Instalar las dependencias del proyecto
npm install express cors multer sql.js

```

#### Explicación de Dependencias Instaladas:

* **`express`**: Framework web para construir la API RESTful (rutas y controladores backend).
* **`cors`**: Middleware para habilitar el intercambio de recursos de origen cruzado (CORS).
* **`multer`**: Middleware para la gestión y carga de archivos multimedia (fotografías de perfil) al servidor.
* **`sql.js`**: Motor relacional de **SQLite en WebAssembly (JavaScript puro)**. Garantiza portabilidad total en cualquier distribución de Linux evitando errores de compilación `GLIBC`.

---

### 3. Estructura de Directorios del Proyecto

Asegúrate de mantener la siguiente estructura en tu proyecto:

```text
LICEO/
├── config/
│   └── db.js                 # Inicialización y utilidades de la BD SQLite (sql.js)
├── controllers/
│   └── estudianteController.js # Lógica de negocio y consultas SQL CRUD
├── middleware/
│   └── upload.js             # Configuración de almacenamiento de fotos con Multer
├── public/
│   └── index.html            # Interfaz SPA (HTML5, CSS3, JavaScript Vanilla)
├── routes/
│   └── estudianteRoutes.js   # Definición de rutas API REST
├── uploads/
│   └── estudiantes/          # Carpeta donde se almacenan las fotos subidas
├── liceo.sqlite              # Archivo de base de datos relacional (se crea automáticamente)
├── package.json              # Configuración y dependencias del proyecto
└── server.js                 # Punto de entrada y servidor principal Express

```

---

### 4. Cómo Iniciar la Aplicación

Para poner en marcha el servidor y la interfaz web:

```bash
# Iniciar el servidor
node server.js

```

Salida esperada en la consola:

```text
✅ Base de datos SQLite (SQL Relacional) inicializada correctamente
🚀 Servidor ejecutándose en http://localhost:3000
📁 Base de datos relacional SQLite activa en liceo.sqlite

```

Abre cualquier navegador web y accede a:
👉 **`http://localhost:3000`**

---

## 🛠️ Explicación Detallada de Funciones e Implementación Técnica

### 1. 📊 Panel General (Dashboard Métrico)

* **Descripción:** Presenta un resumen estadístico en tiempo real del estado de la matrícula escolar.
* **Métricas que calcula:**
* **Total Matriculados:** Conteo global de expedientes activos.
* **Nuevos Ingresos:** Alumnos inscritos bajo la condición "Nuevo Ingreso".
* **Materias Pendientes:** Estudiantes en condición de arrastre/reparación.
* **Promedio General:** Cálculo acumulado del rendimiento académico de todo el plantel sobre la escala de 0 a 20 puntos.


* **Implementación:** Se calcula en tiempo real dentro del cliente (`public/index.html`) iterando sobre la colección de estudiantes recibida desde la API REST mediante funciones reductoras de JavaScript.

---

### 2. 👥 Gestión de Estudiantes (CRUD Completo y Carga de Foto)

* **Inscripción y Edición:** Permite registrar y modificar datos personales del alumno: Nombre, Cédula, Fecha de Nacimiento, Año a Cursar (1ro a 5to), Sección (A a D) y Condición Académica.
* **Asignación de Expediente Automático:** Genera un código correlativo único en formato `EXP-YYYY-XXXX` mediante consultas SQL al momento del registro.
* **Carga de Fotografía:** Integración con `multer` para procesar imágenes adjuntas. La foto se guarda físicamente en `/uploads/estudiantes/` y su ruta relativa se almacena en la columna `foto_url`.
* **Barra de Filtros Multicriterio:** Permite filtrar instantáneamente por coincidencia de texto en Cédula/Nombre/Expediente y por desplegables de Año Escolar y Sección.
* **Eliminación:** Borra de forma en cascada el expediente y las calificaciones asociadas en la base de datos, eliminando también la imagen del servidor mediante el módulo `fs`.

---

### 3. 📝 Carga y Gestión de Calificaciones (9 Materias / 3 Lapsos)

* **Estructura Académica:** Basada en el pensum de Educación Media General en Venezuela con 9 asignaturas oficiales (*Castellano, Matemáticas, Inglés, Educación Física, Biología, Física, Química, Historia y Geografía*).
* **Asignación Automática:** Cada estudiante creado inicializa automáticamente 9 registros en la tabla relacional `notas` vinculados a su `estudiante_id`.
* **Matriz de Notas:** Permite cargar y editar las notas de los Lapsos 1, 2 y 3 (escala 0-20). Calcula automáticamente la nota definitiva por asignatura en tiempo real con alertas de color (Verde $\ge 10$, Rojo $< 10$).

---

### 4. 📜 Generación de Boletín Informativo Oficial (A4 Imprimible)

* **Plantilla Formateada:** Genera una vista de hoja oficial A4 con membrete institucional, datos del estudiante, tabla de notas completas por lapso, promedio general y líneas para firmas del Director(a) y Control de Estudio.
* **Estilos CSS para Impresión (`@media print`):** Oculta automáticamente la barra lateral (`.sidebar`), botones y filtros durante la impresión, permitiendo guardar el boletín directamente como un archivo PDF limpio y profesional desde el navegador (`Ctrl + P`).

---

## 🗄️ Modelo Relacional de Base de Datos (SQLite)

El sistema utiliza un esquema relacional con clave foránea (`FOREIGN KEY`) e integridad referencial:

```sql
-- Tabla: estudiantes
CREATE TABLE IF NOT EXISTS estudiantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_apellido TEXT NOT NULL,
    cedula TEXT NOT NULL UNIQUE,
    fecha_nacimiento TEXT NOT NULL,
    ano_cursar TEXT NOT NULL,
    seccion TEXT NOT NULL,
    condicion TEXT NOT NULL,
    codigo_expediente TEXT NOT NULL UNIQUE,
    foto_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla: notas (Relación 1 a Muchos)
CREATE TABLE IF NOT EXISTS notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    nombre_materia TEXT NOT NULL,
    lapso1 REAL DEFAULT 0.0,
    lapso2 REAL DEFAULT 0.0,
    lapso3 REAL DEFAULT 0.0,
    FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id) ON DELETE CASCADE
);

```
## 👥 Créditos y Desarrolladores del Proyecto

* **Giovanny Segovia** — C.I: 31.588.187
* **Wilfredo Alvarez** — C.I: 30.654.549
* **Carlos Colmenarez** — C.I: 30.494.549

```
