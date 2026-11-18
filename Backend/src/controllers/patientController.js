const { db, storageBucket } = require('../config/firebase');
const { hasRole } = require('../security/policies');

// Campos que el formulario de pacientes puede guardar; cualquier otro se descarta
const PATIENT_FIELDS = {
    nombre: 'string', apellidoP: 'string', apellidoM: 'string', nss: 'string', tiposangre: 'string',
    estatura: 'number', peso: 'number', imc: 'number', edad: 'number',
    diabetes: 'boolean', hipertension: 'boolean', enfcronica: 'boolean',
    antecedentes: 'string', sintomascla: 'string', medicamentos: 'string',
};
const MAX_TEXT = 5000;
const NSS_PATTERN = /^[A-Za-z0-9-]{1,30}$/;

const sanitizePatient = (body) => {
    const out = {};
    for (const [field, type] of Object.entries(PATIENT_FIELDS)) {
        const value = body?.[field];
        if (value === undefined || value === null) continue;
        if (type === 'string') out[field] = String(value).trim().slice(0, MAX_TEXT);
        else if (type === 'number') {
            // Un campo numérico vacío no se guarda como 0
            if (value === '') continue;
            const n = Number(value);
            if (Number.isFinite(n)) out[field] = n;
        } else out[field] = value === true || value === 'true';
    }
    return out;
};

// 3. CREAR O ACTUALIZAR UN PACIENTE (atención/administrador; la ruta aplica requireRole)
const createOrUpdatePatient = async (req, res) => {
    try {
        const pacienteData = sanitizePatient(req.body);
        if (!pacienteData.nss || !NSS_PATTERN.test(pacienteData.nss)) {
            return res.status(400).json({ message: 'El NSS es requerido y solo admite letras, números y guiones.' });
        }
        // Usamos el NSS como ID del documento para evitar duplicados.
        const pacienteRef = db.collection('pacientes').doc(pacienteData.nss);
        await pacienteRef.set(pacienteData, { merge: true }); // merge: true actualiza sin sobrescribir todo

        res.status(200).json({ message: 'Paciente guardado con éxito', data: pacienteData });
    } catch (error) {
        console.error('Error al guardar paciente:', error);
        res.status(500).json({ message: 'Error en el servidor al guardar el paciente.' });
    }
};

// BUSCAR PACIENTES (atención/administrador)
const searchPatients = async (req, res) => {
    try {
        const { q } = req.query;

        // NOTA: Esto no es escalable para miles de pacientes. Se recomienda un índice de búsqueda en producción.
        const snapshot = await db.collection('pacientes').get();
        let pacientes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (q && typeof q === 'string' && q.trim() !== '') {
            const searchTerm = q.trim().toLowerCase().slice(0, 100);
            pacientes = pacientes.filter(p =>
                (p.nombre && p.nombre.toLowerCase().includes(searchTerm)) ||
                (p.apellidoP && p.apellidoP.toLowerCase().includes(searchTerm)) ||
                (p.apellidoM && p.apellidoM.toLowerCase().includes(searchTerm)) ||
                (p.nss && String(p.nss).includes(searchTerm))
            );
        }

        res.status(200).json(pacientes);
    } catch (error) {
        console.error('Error al buscar pacientes:', error);
        res.status(500).json({ message: 'Error en el servidor al buscar pacientes.' });
    }
};

// 4. OBTENER UN PACIENTE POR NSS
// Atención y administrador ven cualquier paciente; un médico solo los de sus casos asignados.
const getPatientByNss = async (req, res) => {
    try {
        const { nss } = req.params;

        if (!hasRole(req.user, 'atencion', 'administrador')) {
            const assigned = await db.collection('casos')
                .where('pacienteNSS', '==', nss)
                .where('medicoEspecialistaId', '==', req.user.uid)
                .limit(1)
                .get();
            if (assigned.empty) {
                return res.status(403).json({ message: 'No tienes permiso para ver este paciente.' });
            }
        }

        const doc = await db.collection('pacientes').doc(nss).get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Paciente no encontrado.' });
        }
        res.status(200).json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error('Error al obtener paciente:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener el paciente.' });
    }
};

// ELIMINAR UN PACIENTE Y TODOS SUS DATOS ASOCIADOS (atención/administrador)
const deletePatient = async (req, res) => {
    const { nss } = req.params;

    if (!nss) {
        return res.status(400).json({ message: 'El NSS es requerido.' });
    }

    const batch = db.batch();

    try {
        // Paso 1: Encontrar todos los casos asociados al paciente
        const casosSnapshot = await db.collection('casos').where('pacienteNSS', '==', nss).get();

        for (const casoDoc of casosSnapshot.docs) {
            const casoData = casoDoc.data();

            // Paso 2: Eliminar archivos de Firebase Storage para cada caso
            if (Array.isArray(casoData.archivos) && casoData.archivos.length > 0) {
                await Promise.all(casoData.archivos.map(archivo => {
                    // Solo rutas de estudios de este paciente: nunca se borra fuera de casos/<uid>/<nss>/
                    if (typeof archivo.uploadPath === 'string' && archivo.uploadPath.startsWith('casos/')
                        && archivo.uploadPath.split('/')[2] === nss && !archivo.uploadPath.includes('..')) {
                        return storageBucket.file(archivo.uploadPath).delete().catch(err => {
                            // No detener el proceso si un archivo no se encuentra, solo registrarlo.
                            console.error(`Error al eliminar ${archivo.uploadPath}, puede que ya no exista:`, err.message);
                        });
                    }
                    return Promise.resolve();
                }));
            }

            // Paso 3: Añadir el caso al batch de eliminación
            batch.delete(casoDoc.ref);
        }

        // Paso 4: Añadir el documento del paciente al batch de eliminación
        const pacienteRef = db.collection('pacientes').doc(nss);
        const pacienteDoc = await pacienteRef.get();
        if (pacienteDoc.exists) {
            batch.delete(pacienteRef);
        }

        // Paso 5: Ejecutar todas las eliminaciones en una sola operación atómica
        await batch.commit();

        console.log(`[AUDIT] Paciente ${nss} y ${casosSnapshot.size} caso(s) eliminados por ${req.user.uid}`);
        res.status(200).json({ message: `Paciente con NSS ${nss} y todos sus datos asociados han sido eliminados con éxito.` });
    } catch (error) {
        console.error(`Error en la eliminación en cascada para el paciente ${nss}:`, error);
        res.status(500).json({ message: 'Error en el servidor durante la eliminación en cascada.' });
    }
};

module.exports = {
    createOrUpdatePatient,
    searchPatients,
    getPatientByNss,
    deletePatient
};
