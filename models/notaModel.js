const tablaModel = require("tabla-model");

const notas = new tablaModel("notas", {
    columns: [
        {
            name: "id",
            type: "integer",
            primary: true,
            autoincrement: true,
            defaultNull: false
        },
        {
            name: "estudiante_id",
            type: "integer",
            defaultNull: false
        },
        {
            name: "nombre_materia",
            type: "varchar(255)",
            defaultNull: false
        },
        {
            name: "lapso1",
            type: "real",
            defaultNull: true,
            default: "0.0"
        },
        {
            name: "lapso2",
            type: "real",
            defaultNull: true,
            default: "0.0"
        },
        {
            name: "lapso3",
            type: "real",
            defaultNull: true,
            default: "0.0"
        }
    ]
});

// Definición de Clave Foránea vinculada a la tabla estudiantes
notas.foreignKey({
    key: "estudiante_id",
    reference: "estudiantes",
    keyReference: "id",
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
});

module.exports = notas;
