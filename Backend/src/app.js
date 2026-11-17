const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Importar Rutas
const userRoutes = require('./routes/userRoutes');
const patientRoutes = require('./routes/patientRoutes');
const caseRoutes = require('./routes/caseRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();

// --- MIDDLEWARE ---
app.use(helmet()); // Seguridad HTTP

// Configuración de CORS dinámica
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173', 'http://localhost:3001'];

console.log('✅ CORS Allowed Origins:', allowedOrigins);

app.use(cors({
    origin: (origin, callback) => {
        // Permitir peticiones sin origen (como apps móviles o curl)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`❌ CORS BLOCKED: Origin '${origin}' is not in the allowed list.`);
            callback(new Error('Bloqueado por CORS policy'));
        }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
    credentials: true
}));
app.use(express.json({ limit: '100kb' })); // Permite al servidor entender JSON (con tope de tamaño)

// --- RUTAS DE LA API ---
app.use('/api/users', userRoutes);
app.use('/api/pacientes', patientRoutes);
app.use('/api/casos', caseRoutes);
app.use('/api/reports', reportRoutes);

// Ruta base de prueba
app.get('/', (req, res) => {
    res.send('API de Radiodiagnóstico funcionando correctamente.');
});

// --- MIDDLEWARE DE MANEJO DE ERRORES GLOBAL ---
// Este middleware captura cualquier error que ocurra en las rutas
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${err.message}`);

    // JSON mal formado o demasiado grande: error del cliente con mensaje genérico
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'El cuerpo de la petición no es JSON válido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'La petición es demasiado grande.' });
    if (err.message === 'Bloqueado por CORS policy') return res.status(403).json({ message: 'Origen no permitido.' });

    // Nunca se devuelven mensajes internos ni trazas
    const statusCode = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    res.status(statusCode).json({
        message: statusCode === 500 ? 'Error interno del servidor.' : 'La petición no se pudo procesar.',
    });
});

module.exports = app;
