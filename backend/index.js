const express = require('express');
const { Client } = require("pg");
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const upload = multer();
const axios = require('axios');
const cors = require('cors');
const router = express.Router(); 

const PORT = 8080;
const app = express();

// Cargar variables de entorno
require('dotenv').config();
const API_TOKEN = process.env.API_TOKEN || 'FgPvQgdDh3aM';
const API_URL = 'https://itt363-hub.smar.com.do';

// Datos de la base de datos
const client = new Client({
    user: "postgres",
    host: "192.168.100.171",
    database: "estaciones_meteorologicas",
    password: "pi101314",
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

client.connect()
    .then(() => console.log("Conectado a la base de datos"))
    .catch(err => console.error("Error conectando a la BD:", err));

function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/');
    }
}

// Middleware para analizar el cuerpo de las solicitudes
app.use(cors({
    origin: 'https://itt363-6.eict.ce.pucmm.edu.do',
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'supersecret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Create a regular HTTP server
const server = http.createServer(app);

// Create WebSocket server (Aquí está la corrección)
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado al WebSocket');

    // Enviar mensaje de bienvenida al cliente
    ws.send(JSON.stringify({ message: "Bienvenido al servidor WebSocket" }));

    // Manejar mensajes recibidos desde el cliente
    ws.on('message', (message) => {
        console.log(`Mensaje recibido del cliente: ${message}`);

        const data = JSON.parse(message);

        if (data.accion === 'obtener_promedio') {
            // Si el cliente pide el promedio
            const tipo_sensor = data.tipo_sensor;

            // Verificar si el tipo de sensor está en los promedios
            if (promediosSensores[tipo_sensor]) {
                const promedio = promediosSensores[tipo_sensor].suma / promediosSensores[tipo_sensor].contador;
                // Enviar el promedio al cliente
                ws.send(JSON.stringify({
                    event: 'promedio',
                    tipo_sensor,
                    promedio
                }));
                console.log(`Enviando promedio de ${tipo_sensor}: ${promedio}`);
            } else {
                console.log(`Tipo de sensor no encontrado: ${tipo_sensor}`);
                ws.send(JSON.stringify({
                    event: 'error',
                    message: `Tipo de sensor no encontrado: ${tipo_sensor}`
                }));
            }
        } else if (data.tipo_sensor && data.valor) {
            // Si el mensaje contiene una lectura (tipo_sensor y valor)
            const { tipo_sensor, valor } = data;

            // Comprobar si el tipo de sensor existe
            if (promediosSensores[tipo_sensor]) {
                // Actualizar el promedio para el tipo de sensor correspondiente
                const sensorPromedio = promediosSensores[tipo_sensor];
                
                // Actualizar la suma y el contador
                sensorPromedio.suma += valor;
                sensorPromedio.contador += 1;

                // Calcular el nuevo promedio
                const nuevoPromedio = sensorPromedio.suma / sensorPromedio.contador;

                // Enviar el nuevo promedio a todos los clientes conectados
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            event: 'nuevo_promedio',
                            tipo_sensor,
                            nuevoPromedio,
                        }));
                    }
                });

                console.log(`Nuevo promedio de ${tipo_sensor}: ${nuevoPromedio}`);
            } else {
                console.log(`Tipo de sensor no encontrado: ${tipo_sensor}`);
            }
        }
    });

    // Manejar la desconexión del cliente
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});



// Permite la ejecución de la página login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login: Permite la comprobación de credenciales para iniciar sesión
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await client.query('SELECT * FROM Usuario WHERE correo = $1', [email]);

        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (password === user.contrasena) {
                req.session.userId = user.id_usuario;
                res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
            } else {
                res.status(401).send('Credenciales no válidas');
            }
        } else {
            res.status(401).send('Usuario no encontrado');
        }
    } catch (error) {
        console.error('Error de autenticación:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/session-check', (req, res) => {
    if (req.session.userId) {
        res.sendStatus(200); 
    } else {
        res.sendStatus(401);
    }
});

app.get('/data', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    try {
        const pageSize = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;

        const query = `
            SELECT l.*, s.id_estacion FROM lectura l
            JOIN sensor s ON l.id_sensor = s.id_sensor
            JOIN UsuarioEstacion ue ON s.id_estacion = ue.id_estacion
            WHERE ue.id_usuario = $1
            ORDER BY l.fecha_hora DESC
            LIMIT $2 OFFSET $3;
        `;

        const params = [req.session.userId, pageSize, offset];
        const { rows } = await client.query(query, params);

        console.log("Data fetched:", rows); // Debugging line

        const countQuery = `
            SELECT COUNT(*) AS total FROM lectura l
            JOIN sensor s ON l.id_sensor = s.id_sensor
            JOIN UsuarioEstacion ue ON s.id_estacion = ue.id_estacion
            WHERE ue.id_usuario = $1;
        `;
        const countResult = await client.query(countQuery, [req.session.userId]);
        const totalRecords = parseInt(countResult.rows[0].total);

        res.json({ total: totalRecords, records: rows });

    } catch (error) {
        console.error('Error al obtener datos:', error);
        res.status(500).send('Error al obtener los datos');
    }
});

app.post('/addLecture', async (req, res) => {
    try {
        const { id_sensor, valor } = req.body;
        console.log('Agregando nueva lectura:', { id_sensor, valor });

        // Insertar los datos y recuperar la fila insertada
        const result = await client.query(`
            INSERT INTO lectura (id_sensor, valor, fecha_hora)
            VALUES ($1, $2, NOW())
            RETURNING *;
        `, [id_sensor, valor]);

        const newLecture = result.rows[0];
        console.log('Nueva lectura insertada:', newLecture);

        // Notificar a todos los clientes WebSocket con los datos reales
        let clientCount = 0;
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                clientCount++;
                console.log("Enviando nueva lectura a cliente WebSocket");
                client.send(JSON.stringify({
                    event: 'new_lecture',
                    data: newLecture
                }));
            }
        });

        console.log(`Notificación enviada a ${clientCount} clientes WebSocket`);
        res.status(200).json({
            message: 'Lectura agregada y clientes WebSocket notificados',
            lecture: newLecture,
            clientsNotified: clientCount
        });
    } catch (error) {
        console.error('Error al agregar lectura y notificar a clientes:', error);
        res.status(500).send('Error al agregar la lectura');
    }
});

//acceso a lecturas por fecha
app.get('/data/averageByDate', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    try {
        const fechaInicio = req.query.fechaInicio ? new Date(req.query.fechaInicio) : null;
        const fechaFinal = req.query.fechaFinal ? new Date(req.query.fechaFinal) : null;

        if (!fechaInicio || !fechaFinal) {
            return res.status(400).send('Debe proporcionar ambas fechas de inicio y final');
        }

        const startDate = fechaInicio.toISOString().split('T')[0] + ' ' + fechaInicio.toLocaleTimeString('en-GB');
        const endDate = fechaFinal.toISOString().split('T')[0] + ' ' + fechaFinal.toLocaleTimeString('en-GB');

        const query = `
            SELECT COUNT(*) as total, AVG(l.valor) as promedio
            FROM lectura l
            JOIN sensor s ON l.id_sensor = s.id_sensor
            JOIN UsuarioEstacion ue ON s.id_estacion = ue.id_estacion
            WHERE ue.id_usuario = $1
            AND l.fecha_hora BETWEEN $2 AND $3;
        `;
        const { rows } = await client.query(query, [req.session.userId, startDate, endDate]);

        res.json({ total: rows[0].total, promedio: rows[0].promedio });
    } catch (error) {
        console.error('Error al obtener promedio:', error);
        res.status(500).send('Error al obtener el promedio de lecturas');
    }
});

// UserData: Permite cargar los datos del usuario para la configuración de cuenta
app.get('/usuarios', async (req, res) => {
    // Verificar autenticación
    console.log('Solicitud recibida en /usuarios');
    if (!req.session || !req.session.userId) {
        return res.status(403).json({ error: "No autorizado" });
    }

    try {
        const { rows } = await client.query(`
            SELECT id_usuario, nombre, apellido, correo, telefono, ocupacion
            FROM Usuario
        `);

        console.log("Usuarios obtenidos:", rows);
        res.json({ usuarios: rows });
    } catch (error) {
        console.error("Error en /usuarios:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

// UpdateUser: Permite guardar los cambios realizados a la información del usuario
app.post('/updateUser', upload.none(), async (req, res) => {
    const { ocupacion, telefono, nueva_contrasena, confirmar_contrasena } = req.body;

    try {
        const updates = [];
        if (ocupacion) {
            updates.push(client.query('UPDATE Usuario SET ocupacion = $1 WHERE id_usuario = $2', [ocupacion, req.session.userId]));
        }
        if (telefono) {
            updates.push(client.query('UPDATE Usuario SET telefono = $1 WHERE id_usuario = $2', [telefono, req.session.userId]));
        }
        if (nueva_contrasena && nueva_contrasena === confirmar_contrasena) {
            updates.push(client.query('UPDATE Usuario SET contrasena = $1 WHERE id_usuario = $2', [nueva_contrasena, req.session.userId]));
        }

        await Promise.all(updates);
        res.json({ message: 'Datos actualizados correctamente' });
    } catch (error) {
        console.error('Error updating user data:', error);
        res.status(500).send('Error al actualizar los datos del usuario');
    }
});

// UserData: Permite cargar los datos del usuario para la configuración de cuenta
app.get('/userData', async (req, res) => {

    try {
        const result = await client.query('SELECT nombre, apellido, correo, telefono, ocupacion, fecha_nacimiento FROM Usuario WHERE id_usuario = $1', [req.session.userId]);
        if (result.rows.length > 0) {
            const userData = result.rows[0];
            userData.nombreCompleto = userData.nombre + ' ' + userData.apellido;
            res.json(userData);
        } else {
            res.status(404).send('Usuario no encontrado');
        }
    } catch (error) {
        console.error('Error al obtener información del usuario:', error);
        res.status(500).send('Error interno del servidor');
    }
});


// Endpoint para obtener las estaciones y sensores del usuario
app.get('/estaciones', async (req, res) => {
    try {
        const { rows } = await client.query(`
            SELECT e.id_estacion, e.nombre,
                   array_agg(
                           json_build_object(
                                   'id_sensor', s.id_sensor,
                                   'tipo', s.tipo,
                                   'ultima_lectura', (
                                       SELECT l.valor FROM lectura l
                                       WHERE l.id_sensor = s.id_sensor
                                       ORDER BY l.fecha_hora DESC
                                       LIMIT 1
                                   ),
                                   'ultima_fecha_hora', (
                                       SELECT l.fecha_hora FROM lectura l
                                       WHERE l.id_sensor = s.id_sensor
                                       ORDER BY l.fecha_hora DESC
                                       LIMIT 1
                                   )
                           )
                   ) as sensores
            FROM estacion e
                     JOIN sensor s ON s.id_estacion = e.id_estacion
                     JOIN usuarioestacion ue ON ue.id_estacion = e.id_estacion
            WHERE ue.id_usuario = $1
            GROUP BY e.id_estacion
        `, [req.session.userId]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener estaciones:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para obtener estaciones del usuario
app.get('/estacionesUsuario', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }
    try {
        const query = `
            SELECT e.id_estacion, e.nombre
            FROM Estacion e 
            JOIN UsuarioEstacion ue ON e.id_estacion = ue.id_estacion 
            WHERE ue.id_usuario = $1;
        `;
        const { rows } = await client.query(query, [req.session.userId]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener estaciones:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para eliminar una estación de la cuenta del usuario
app.post('/eliminarEstacion', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }
    const { idEstacion } = req.body;
    try {
        await client.query('DELETE FROM UsuarioEstacion WHERE id_usuario = $1 AND id_estacion = $2', [req.session.userId, idEstacion]);
        res.send('Estación eliminada correctamente');
    } catch (error) {
        console.error('Error al eliminar estación:', error);
        res.status(500).send('Error al eliminar estación');
    }
});

app.get('/estacionesDisponibles', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    try {
        const estacionesNoAsignadas = await client.query(`
            SELECT * FROM estacion
            WHERE id_estacion NOT IN (SELECT id_estacion FROM usuarioestacion WHERE id_usuario = $1)
        `, [req.session.userId]);
        res.json(estacionesNoAsignadas.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estaciones disponibles' });
    }
});

app.post('/agregarEstacion', async (req, res) => {
    if (!req.session.userId) {
      return res.status(403).send('No autorizado');
    }
  
    const { idEstacion } = req.body;
  
    try {
      await client.query(
        'INSERT INTO usuarioestacion (id_usuario, id_estacion) VALUES ($1, $2)',
        [req.session.userId, idEstacion]
      );
  
      res.status(200).json({ mensaje: 'Estación agregada exitosamente' });
    } catch (error) {
      console.error('Error al agregar estación:', error);
      res.status(500).json({ error: 'Error al agregar estación' });
    }
  });

app.get('/alertas', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    try {
        const query = `
            SELECT a.id_alerta, a.nombre, a.id_estacion, a.id_sensor, a.tipo_alerta,
                   a.valor_limite, a.activa, a.creada_en,
                   e.nombre AS nombre_estacion, s.tipo AS tipo_sensor
            FROM alerta a
            JOIN estacion e ON a.id_estacion = e.id_estacion
            JOIN sensor s ON a.id_sensor = s.id_sensor
            WHERE a.id_usuario = $1;
        `;
        const { rows } = await client.query(query, [req.session.userId]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener alertas:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/sensoresEstacion/:idEstacion', async (req, res) => {
    const { idEstacion } = req.params;

    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    try {
        const query =
            `SELECT s.id_sensor, s.tipo, 
                (SELECT l.valor FROM lectura l WHERE l.id_sensor = s.id_sensor ORDER BY l.fecha_hora DESC LIMIT 1) AS ultima_lectura,
                (SELECT l.fecha_hora FROM lectura l WHERE l.id_sensor = s.id_sensor ORDER BY l.fecha_hora DESC LIMIT 1) AS ultima_fecha_hora
            FROM sensor s 
            WHERE s.id_estacion = $1`;

        const { rows } = await client.query(query, [idEstacion]);

        if (rows.length > 0) {
            res.json(rows);
        } else {
            res.status(404).send('No se encontraron sensores para esta estación');
        }
    } catch (error) {
        console.error('Error al obtener sensores:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.get('/sensores', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    try {
        // Obtener todos los sensores para las estaciones accesibles a este usuario
        const query = `
            SELECT s.id_sensor, s.tipo, s.id_estacion,
                   (SELECT l.valor
                    FROM lectura l
                    WHERE l.id_sensor = s.id_sensor
                    ORDER BY l.fecha_hora DESC
                    LIMIT 1) as ultima_lectura,
                   (SELECT l.fecha_hora
                    FROM lectura l
                    WHERE l.id_sensor = s.id_sensor
                    ORDER BY l.fecha_hora DESC
                    LIMIT 1) as ultima_fecha_hora
            FROM sensor s 
            JOIN estacion e ON s.id_estacion = e.id_estacion
            JOIN usuarioestacion ue ON e.id_estacion = ue.id_estacion
            WHERE ue.id_usuario = $1
        `;

        const { rows } = await client.query(query, [req.session.userId]);

        if (rows.length > 0) {
            res.json(rows);
        } else {
            res.status(404).send('No se encontraron sensores');
        }
    } catch (error) {
        console.error('Error al obtener sensores:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta para guardar la alerta
app.post("/guardarAlerta", async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).json({ success: false, error: "Usuario no autenticado" });
    }

    try {
        const { id_estacion, id_sensor, tipo_alerta, descripcion, valor_limite, activa } = req.body;
        const creada_en = new Date().toISOString();

        const query = `
            INSERT INTO alerta (id_estacion, id_sensor, tipo_alerta, nombre, valor_limite, activa, creada_en, id_usuario)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id_alerta;
        `;
        const values = [id_estacion, id_sensor, tipo_alerta, descripcion, valor_limite, activa, creada_en, req.session.userId];

        const result = await client.query(query, values);
        res.json({ success: true, id_alerta: result.rows[0].id_alerta });
    } catch (error) {
        console.error("Error al guardar la alerta:", error);
        res.status(500).json({ success: false, error: "Error al guardar la alerta" });
    }
});

// Ruta para obtener alertas del usuario
app.get('/alertaUsuario', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }
    try {
        const result = await client.query("SELECT id_alerta, nombre FROM alerta");
        const alertas = result.rows;  // Aquí están las alertas en un array
        res.json(alertas);
    } catch (error) {
        console.error("Error al obtener alertas:", error);
        res.status(500).json({ error: "Error al obtener alertas" });
    }
});

// Ruta para eliminar una alerta de la cuenta del usuario
app.post('/eliminarAlerta', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }
    const { idAlerta } = req.body;
    try {
        await client.query('DELETE FROM alerta WHERE id_usuario = $1 AND id_alerta = $2', [req.session.userId, idAlerta]);
        res.send('Alerta eliminada correctamente');
    } catch (error) {
        console.error('Error al eliminar alerta:', error);
        res.status(500).send('Error al eliminar alerta');
    }
});

// Ruta para obtener la última lectura de una estación
app.get('/ultimasLecturas/:id_estacion', async (req, res) => {
    const { id_estacion } = req.params;

    try {
        // Consultar la última lectura de cualquier sensor en la estación indicada
        const result = await client.query(
            `SELECT s.id_sensor, l.valor, l.fecha_hora
      FROM lectura l
      JOIN sensor s ON l.id_sensor = s.id_sensor
      WHERE s.id_estacion = $1
      ORDER BY l.fecha_hora DESC
      LIMIT 1`,
            [id_estacion]
        );

        if (result.rows.length > 0) {
            // Devolver la última lectura
            const ultimaLectura = result.rows[0];
            res.json({
                id_sensor: ultimaLectura.id_sensor,
                valor: ultimaLectura.valor,
                fecha: ultimaLectura.fecha,
            });
        } else {
            res.status(404).json({ message: 'No se encontraron lecturas para esta estación.' });
        }
    } catch (error) {
        console.error('Error al obtener la última lectura:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
});

app.get('/promedioHumedadAire', async (req, res) => {
    if (!req.session.userId) {
      return res.status(403).send('No autorizado');
    }

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'humedad_aire' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener humedad del aire:', error);
      res.status(500).send('Error en humedad del aire');
    }
  });

app.get('/promedioHumedadSuelo', async (req, res) => {
  if (!req.session.userId) {
    return res.status(403).send('No autorizado');
  }

  const estacionId = req.query.estacionId;
  if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

  try {
    const query = `
      SELECT AVG(l.valor) as promedio
      FROM lectura l
      JOIN sensor s ON l.id_sensor = s.id_sensor
      JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
      WHERE ue.id_usuario = $1 AND s.tipo = 'humedad_suelo' AND ue.id_estacion = $2
    `;
    const { rows } = await client.query(query, [req.session.userId, estacionId]);
    res.json({ promedio: rows[0]?.promedio ?? 0 });
  } catch (error) {
    console.error('Error al obtener humedad del suelo:', error);
    res.status(500).send('Error en humedad del suelo');
  }
});

app.get('/promedioPrecipitacion', async (req, res) => {
    if (!req.session.userId) {
      return res.status(403).send('No autorizado');
    }

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT DATE(l.fecha_hora) AS dia, AVG(l.valor) AS promedio_precipitacion
        FROM lectura l
                 JOIN sensor s ON l.id_sensor = s.id_sensor
                 JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1
          AND s.tipo = 'precipitacion'
          AND l.fecha_hora >= NOW() - INTERVAL '5 days'
          AND ue.id_estacion = $2
        GROUP BY dia
        ORDER BY dia DESC
        LIMIT 1; 
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);

      if (rows.length > 0) {
        res.json({ promedio: rows[0].promedio_precipitacion });
      } else {
        res.status(404).send('No se encontraron lecturas de precipitación recientes.');
      }
    } catch (error) {
      console.error('Error al obtener el promedio de precipitación:', error);
      res.status(500).send('Error al calcular el promedio de precipitación.');
    }
  });

app.get('/promedioTemperatura', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    const estacionId = req.query.estacionId;  // Obtener estacionId de los parámetros de la URL
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'temperatura' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener temperatura:', error);
      res.status(500).send('Error en temperatura');
    }
  });

app.get('/promedioPresion', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'presion' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener presión:', error);
      res.status(500).send('Error en presión');
    }
  });

app.get('/promedioAltitud', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'altitud' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener altitud:', error);
      res.status(500).send('Error en altitud');
    }
  });

app.get('/promedioVelocidadAire', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'velocidad_viento' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener velocidad del aire:', error);
      res.status(500).send('Error en velocidad del aire');
    }
  });

app.get('/promedioDireccionViento', async (req, res) => {
    if (!req.session.userId) return res.status(403).send('No autorizado');

    const estacionId = req.query.estacionId;
    if (!estacionId) return res.status(400).send('Falta el parametro estacionId');

    try {
      const query = `
        SELECT AVG(l.valor) as promedio
        FROM lectura l
        JOIN sensor s ON l.id_sensor = s.id_sensor
        JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1 AND s.tipo = 'direccion_viento' AND ue.id_estacion = $2
      `;
      const { rows } = await client.query(query, [req.session.userId, estacionId]);
      res.json({ promedio: rows[0]?.promedio ?? 0 });
    } catch (error) {
      console.error('Error al obtener dirección del viento:', error);
      res.status(500).send('Error en dirección del viento');
    }
  });



app.post('/eliminarUsuario', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    const { idUsuario } = req.body;

    try {
        // Primero, eliminar las referencias en otras tablas (por ejemplo, UsuarioEstacion)
        await client.query('DELETE FROM UsuarioEstacion WHERE id_usuario = $1', [idUsuario]);
        await client.query('DELETE FROM alerta WHERE id_usuario = $1', [idUsuario]);

        // Luego eliminar el usuario
        await client.query('DELETE FROM Usuario WHERE id_usuario = $1', [idUsuario]);

        res.send('Usuario eliminado correctamente');
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).send('Error al eliminar usuario');
    }
});

// Ruta para agregar un nuevo usuario
app.post('/agregarUsuario', async (req, res) => {
    if (!req.session.userId) {
        return res.status(403).send('No autorizado');
    }

    const { nombre, apellido, correo, telefono, ocupacion, fecha_nacimiento, contrasena } = req.body;

    try {
        // Verificar si el correo ya existe
        const checkEmailQuery = 'SELECT id_usuario FROM Usuario WHERE correo = $1';
        const emailResult = await client.query(checkEmailQuery, [correo]);

        if (emailResult.rows.length > 0) {
            return res.status(409).json({ error: 'El correo electrónico ya está registrado' });
        }

        // Insertar el nuevo usuario
        const insertQuery = `
            INSERT INTO Usuario (nombre, apellido, correo, telefono, ocupacion, fecha_nacimiento, contrasena)
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            RETURNING id_usuario
        `;

        const values = [nombre, apellido, correo, telefono, ocupacion, fecha_nacimiento, contrasena];
        const result = await client.query(insertQuery, values);

        res.status(201).json({
            id_usuario: result.rows[0].id_usuario,
            mensaje: 'Usuario agregado correctamente'
        });
    } catch (error) {
        console.error('Error al agregar usuario:', error);
        res.status(500).json({ error: 'Error al agregar usuario' });
    }
});

router.get('/promedioFecha', async (req, res) => {
    const { idEstacion, fechaInicio, fechaFinal } = req.query;

    if (!idEstacion || !fechaInicio || !fechaFinal) {
      return res.status(400).json({ error: 'Parámetros incompletos.' });
    }

    try {
      const query = `
        SELECT s.tipo AS tipo_sensor, ROUND(AVG(r.valor)::numeric, 2) AS promedio
        FROM lectura r
        INNER JOIN sensor s ON r.id_sensor = s.id_sensor
        INNER JOIN usuarioestacion ue ON s.id_estacion = ue.id_estacion
        WHERE ue.id_usuario = $1
          AND s.id_estacion = $2
          AND r.fecha_hora BETWEEN $3 AND $4
        GROUP BY s.tipo
      `;

      const { rows } = await client.query(query, [req.session.userId, idEstacion, fechaInicio, fechaFinal]);

      const promedios = {};
      rows.forEach(row => {
        promedios[row.tipo_sensor] = row.promedio;
      });

      // Obtener el nombre de la estación
      const estacionQuery = 'SELECT nombre FROM estacion WHERE id_estacion = $1';
      const estacionResult = await client.query(estacionQuery, [idEstacion]);

      const nombreEstacion = estacionResult.rows.length > 0 ? estacionResult.rows[0].nombre : 'Desconocida';

      res.json({
        estacion: nombreEstacion,
        promedios
      });
    } catch (error) {
      console.error('Error obteniendo promedios por estación:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });



server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('WebSocket Server listening for connections...');
});