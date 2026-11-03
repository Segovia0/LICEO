const tablaModel = require("tabla-model");

const estudiantes = new tablaModel("estudiantes", {
    columns: [
        {
            name: "id",
            type: "integer",
            primary: true,
            autoincrement: true,
            defaultNull: false
        },
        {
            name: "nombre_apellido",
            type: "varchar(255)",
            defaultNull: false
        },
        {
            name: "cedula",
            type: "varchar(50)",
            defaultNull: false
        },
        {
            name: "fecha_nacimiento",
            type: "varchar(50)",
            defaultNull: false
        },
        {
            name: "ano_cursar",
            type: "varchar(50)",
            defaultNull: false
        },
        {
            name: "seccion",
            type: "varchar(10)",
            defaultNull: false
        },
        {
            name: "condicion",
            type: "varchar(50)",
            defaultNull: false
        },
        {
            name: "codigo_expediente",
            type: "varchar(50)",
            defaultNull: false
        },
        {
            name: "foto_url",
            type: "text",
            defaultNull: true,
            default: "''"
        }
    ]
});

module.exports = estudiantes;
