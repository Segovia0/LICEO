const mongoose = require('mongoose');

const MATERIAS_DEFECTO = [
  'Castellano',
  'Matemáticas',
  'Inglés y Otras Lenguas',
  'Educación Física',
  'Biología / Ciencias Naturales',
  'Física',
  'Química',
  'Historia de Venezuela y Ciudadanía',
  'Geografía / Arte y Cultura'
];

const notaMateriaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  lapso1: { type: Number, min: 0, max: 20, default: 0 },
  lapso2: { type: Number, min: 0, max: 20, default: 0 },
  lapso3: { type: Number, min: 0, max: 20, default: 0 }
});

const estudianteSchema = new mongoose.Schema({
  nombreApellido: { type: String, required: true, trim: true },
  cedula: { type: String, required: true, unique: true, trim: true },
  fechaNacimiento: { type: Date, required: true },
  anoCursar: {
    type: String,
    enum: ['1er Año', '2do Año', '3er Año', '4to Año', '5to Año'],
    required: true
  },
  seccion: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    required: true
  },
  condicion: {
    type: String,
    enum: ['Regular', 'Nuevo Ingreso', 'Repitente', 'Materia Pendiente'],
    required: true
  },
  codigoExpediente: { type: String, unique: true },
  fotoUrl: { type: String, default: '' },
  notas: [notaMateriaSchema]
}, { timestamps: true });

// Pre-save hook: Autogenera EXP-YYYY-XXXX y asigna las 9 materias por defecto
estudianteSchema.pre('save', async function (next) {
  if (!this.codigoExpediente) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('Estudiante').countDocuments();
    const correlativo = String(count + 1).padStart(4, '0');
    this.codigoExpediente = `EXP-${year}-${correlativo}`;
  }

  if (!this.notas || this.notas.length === 0) {
    this.notas = MATERIAS_DEFECTO.map(materia => ({
      nombre: materia,
      lapso1: 0,
      lapso2: 0,
      lapso3: 0
    }));
  }
  next();
});

module.exports = mongoose.model('Estudiante', estudianteSchema);
