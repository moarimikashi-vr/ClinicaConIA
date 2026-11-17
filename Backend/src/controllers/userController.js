const { admin, db } = require('../config/firebase');
const { z } = require('zod');
const { isAdmin, ROLES } = require('../security/policies');

// Esquema de validación para registro
const registerSchema = z.object({
    nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(80),
    apellido: z.string().trim().min(2, 'El apellido debe tener al menos 2 caracteres').max(80),
    email: z.string().trim().email('Formato de email inválido').max(254),
    contrasena: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').max(128),
    rol: z.enum(ROLES, 'Rol no válido')
});

// 1. REGISTRAR UN NUEVO USUARIO (solo administrador; la ruta aplica requireRole)
const registerUser = async (req, res) => {
    try {
        const validationResult = registerSchema.safeParse(req.body);

        if (!validationResult.success) {
            return res.status(400).json({
                message: 'Datos inválidos',
                errors: validationResult.error.issues.map(e => e.message)
            });
        }

        const { nombre, apellido, email, contrasena, rol } = validationResult.data;

        // Crea el usuario en Firebase Authentication
        const userRecord = await admin.auth().createUser({
            email: email,
            password: contrasena,
            displayName: `${nombre} ${apellido}`,
        });

        // Guarda datos adicionales (como el rol) en Firestore
        await db.collection('users').doc(userRecord.uid).set({
            nombre,
            apellido,
            rol,
            email,
        });

        console.log(`[AUDIT] Usuario ${userRecord.uid} (${rol}) creado por ${req.user.uid}`);
        res.status(201).json({ uid: userRecord.uid, message: 'Usuario registrado con éxito' });
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        if (error.code === 'auth/email-already-exists') {
            return res.status(409).json({ message: 'El correo electrónico ya está en uso.' });
        }
        res.status(500).json({ message: 'Error en el servidor al registrar el usuario.' });
    }
};

// 2.1 OBTENER LOS MÉDICOS ESPECIALISTAS (solo lo necesario para asignar un caso)
const getDoctors = async (req, res) => {
    try {
        const snapshot = await db.collection('users').where('rol', '==', 'medico').get();
        const doctors = snapshot.docs.map(doc => {
            const { nombre, apellido } = doc.data();
            return { id: doc.id, nombre, apellido };
        });
        res.status(200).json(doctors);
    } catch (error) {
        console.error('Error al obtener médicos:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener médicos.' });
    }
};

// 2. OBTENER DATOS DE UN USUARIO (el propio perfil, o cualquiera si es administrador)
const getUserById = async (req, res) => {
    try {
        const { uid } = req.params;

        if (uid !== req.user.uid && !isAdmin(req.user)) {
            return res.status(403).json({ message: 'No tienes permiso para ver este usuario.' });
        }

        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'Datos de usuario no encontrados.' });
        }

        res.status(200).json({ id: userDoc.id, ...userDoc.data() });
    } catch (error) {
        console.error('Error al obtener datos de usuario:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener datos de usuario.' });
    }
};

module.exports = {
    registerUser,
    getDoctors,
    getUserById
};
