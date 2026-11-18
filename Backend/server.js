require('dotenv').config();
const app = require('./src/app');

const port = process.env.PORT || 3001;

// --- INICIAR SERVIDOR ---
app.listen(port, async () => {
    console.log(`[BACKEND] Servidor iniciado y escuchando en http://localhost:${port}`);
    console.log(`[ENV] Entorno: ${process.env.NODE_ENV}`);
    console.log(`[FIREBASE] Project ID Configurado: ${process.env.FIREBASE_PROJECT_ID || 'NO DETECTADO'}`);

    // --- DIAGNÓSTICO DE CONEXIÓN A FIRESTORE ---
    try {
        const { db } = require('./src/config/firebase'); // Asegúrate que la ruta sea correcta
        const collections = await db.listCollections();
        console.log('✅ [FIRESTORE] Conexión EXITOSA. Colecciones encontradas:', collections.map(c => c.id).join(', '));

        // Prueba de lectura rápida de usuarios
        const usersSnapshot = await db.collection('users').limit(1).get();
        console.log(`✅ [FIRESTORE] Usuarios encontrados: ${usersSnapshot.size} (Muestra)`);
    } catch (error) {
        console.error('❌ [FIRESTORE] ERROR CRÍTICO DE CONEXIÓN:', error.message);
        console.error('Detalles:', error);
    }
});
