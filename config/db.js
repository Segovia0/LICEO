const SQLiteTab = require('sqlite3-tab');
const TablaModel = require('tabla-model');
const path = require('path');

const dbConnection = new SQLiteTab({
  filename: path.join(__dirname, '../liceo.sqlite')
});

const EstudianteModel = new TablaModel({
  table: 'estudiantes',
  db: dbConnection
});

const NotaModel = new TablaModel({
  table: 'notas',
  db: dbConnection
});

module.exports = {
  EstudianteModel,
  NotaModel,
  dbConnection
};
