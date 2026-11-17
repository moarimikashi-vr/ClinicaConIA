const { db } = require('../config/firebase');
const transporter = require('../config/mailer');

const admin = require('firebase-admin');
const axios = require('axios'); // Importar axios para llamadas al servicio de IA
const { z } = require('zod');
const {
    canAccessCase,
    canCloseCase,
    canDeleteCase,
    canEditDiagnosis,
    escapeHtml,
    fullName,
    isAdmin,
    isOwnUploadPath,
} = require('../security/policies');

const MAX_TEXT = 10000;

// Carga un caso y verifica que el usuario participe en él (o sea administrador)
const loadAccessibleCase = async (req, res) => {
    const casoRef = db.collection('casos').doc(req.params.id);
    const doc = await casoRef.get();
    if (!doc.exists) {
        res.status(404).json({ message: 'Caso no encontrado.' });
        return null;
    }
    const caso = doc.data();
    if (!canAccessCase(req.user, caso)) {
        res.status(403).json({ message: 'No tienes permiso para ver este caso.' });
        return null;
    }
    return { ref: casoRef, caso };
};

const iaServiceBaseUrl = () => {
    let url = process.env.IA_SERVICE_URL || 'http://localhost:8000';
    if (!url.startsWith('http')) url = `https://${url}`;
    return url;
};

const archivoSchema = z.object({
    nombre: z.string().trim().min(1).max(200),
    url: z.string().url().max(2000).refine((u) => u.startsWith('https://firebasestorage.googleapis.com/'), 'URL de archivo no válida'),
    size: z.number().nonnegative().optional(),
    type: z.string().max(100).optional(),
    uploadPath: z.string().max(500),
});

const nuevoCasoSchema = z.object({
    pacienteNSS: z.string().trim().min(1).max(30),
    motivoConsulta: z.string().trim().min(1).max(MAX_TEXT),
    medicoEspecialistaId: z.string().trim().min(1).max(128),
    archivos: z.array(archivoSchema).max(20).default([]),
});

// Análisis IA en segundo plano: un fallo aquí nunca afecta la respuesta al usuario
const analyzeFilesInBackground = (casoId, archivos) => {
    (async () => {
        for (const archivo of archivos) {
            try {
                const extension = archivo.nombre.split('.').pop().toLowerCase();
                if (!['dcm', 'jpg', 'jpeg', 'png'].includes(extension)) continue;
                console.log(`🤖 Solicitando análisis IA para: ${archivo.nombre}`);

                const iaResponse = await axios.post(
                    `${iaServiceBaseUrl()}/analyze_firebase`,
                    { path: archivo.uploadPath },
                    { headers: { 'X-IA-Token': process.env.IA_SERVICE_TOKEN || '' }, timeout: 120000 }
                );

                const resultado = iaResponse.data;
                const regiones = Array.isArray(resultado.regiones) ? resultado.regiones : [];
                const textoRegiones = regiones.length > 0
                    ? `${regiones.length} zona(s) sugerida(s) por IA; revíselas en el visor (indican dónde mirar, no confirman fractura).`
                    : 'Sin zonas sugeridas por IA (esto no descarta una fractura).';

                // Crear comentario automático con el diagnóstico
                const comentarioIA = {
                    texto: `🤖 -Análisis de Fracturas con IA (${resultado.status})-:\n` +
                        `- Predicción: ${resultado.prediction}\n` +
                        `- Confianza: ${resultado.confidence_fracture}%\n` +
                        `- Regiones: ${textoRegiones}\n` +
                        `- Nota: ${resultado.analysis_note}`,
                    autorId: 'sistema_ia',
                    autorNombre: 'Asistente IA',
                    autorRol: 'sistema',
                    fechaCreacion: new Date().toISOString()
                };

                const casoRef = db.collection('casos').doc(casoId);
                await casoRef.collection('comentarios').add(comentarioIA);

                // Actualizar el caso con el último comentario
                await casoRef.update({
                    lastCommentTimestamp: comentarioIA.fechaCreacion,
                    lastCommentAutor: comentarioIA.autorNombre,
                    lastCommentText: `[IA] ${resultado.prediction}`
                });

                // Guardar las regiones por archivo en una escritura aparte, para que un fallo aquí
                // no afecte al comentario. Es un arreglo porque las rutas de Storage tienen puntos
                // y diagonales. Firestore rechaza `undefined`, por eso cada campo tiene respaldo.
                try {
                    const entradaRegiones = {
                        archivo: archivo.uploadPath || archivo.nombre || null,
                        nombre: archivo.nombre || null,
                        modelo: resultado.model_version || 'desconocido',
                        fecha: comentarioIA.fechaCreacion,
                        prediction: resultado.prediction ?? null,
                        confidence_fracture: resultado.confidence_fracture ?? null,
                        regiones
                    };
                    await casoRef.update({
                        iaRegiones: admin.firestore.FieldValue.arrayUnion(entradaRegiones)
                    });
                } catch (regionesError) {
                    console.error(`⚠️ No se pudieron guardar las regiones IA de ${archivo.nombre}:`, regionesError.message);
                }

                console.log(`✅ Diagnóstico IA guardado para ${archivo.nombre}`);
            } catch (iaError) {
                console.error(`❌ Error al analizar archivo ${archivo.nombre} con IA:`, iaError.message);
            }
        }
    })();
};

// 5. CREAR UN NUEVO CASO (atención/administrador; la ruta aplica requireRole)
// El dueño, los nombres y el estado se derivan en el servidor; el cuerpo solo aporta lo que el usuario elige.
const createCase = async (req, res) => {
    try {
        const parsed = nuevoCasoSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ message: 'Datos del caso inválidos.', errors: parsed.error.issues.map(e => e.message) });
        }
        const { pacienteNSS, motivoConsulta, medicoEspecialistaId, archivos } = parsed.data;

        const [pacienteDoc, especialistaDoc] = await Promise.all([
            db.collection('pacientes').doc(pacienteNSS).get(),
            db.collection('users').doc(medicoEspecialistaId).get(),
        ]);
        if (!pacienteDoc.exists) {
            return res.status(400).json({ message: 'El paciente no existe.' });
        }
        if (!especialistaDoc.exists || especialistaDoc.data().rol !== 'medico') {
            return res.status(400).json({ message: 'El especialista seleccionado no es válido.' });
        }
        if (!archivos.every((a) => isOwnUploadPath(a.uploadPath, req.user.uid, pacienteNSS))) {
            return res.status(400).json({ message: 'Los archivos deben pertenecer a tu carpeta de estudios de este paciente.' });
        }

        const paciente = pacienteDoc.data();
        const especialista = especialistaDoc.data();
        const nuevoCaso = {
            pacienteNSS,
            pacienteNombreCompleto: `${paciente.nombre || ''} ${paciente.apellidoP || ''}`.trim(),
            motivoConsulta,
            archivos,
            medicoEspecialistaId,
            medicoEspecialistaNombre: fullName(especialista),
            medicoGeneralId: req.user.uid,
            medicoGeneralNombre: fullName(req.user),
            fechaCreacion: new Date().toISOString(),
            estado: 'abierto'
        };

        const docRef = await db.collection('casos').add(nuevoCaso);

        // --- INTEGRACIÓN IA: Análisis Automático ---
        if (archivos.length > 0) analyzeFilesInBackground(docRef.id, archivos);

        // --- LÓGICA DE ENVÍO DE CORREO ---
        try {
            const emailDestino = especialista.email;
            if (emailDestino) {
                const mailOptions = {
                    from: `"Plataforma Clínica" <${process.env.EMAIL_USER}>`, // El correo se envía desde la cuenta del sistema.
                    to: emailDestino,
                    replyTo: req.user.email, // Las respuestas irán al médico general.
                    subject: `Nuevo caso clínico asignado: ${nuevoCaso.pacienteNombreCompleto}`,
                    html: `
                        <p>Hola Dr. ${escapeHtml(nuevoCaso.medicoEspecialistaNombre)},</p>
                        <p>Se le ha asignado un nuevo caso clínico para el paciente <strong>${escapeHtml(nuevoCaso.pacienteNombreCompleto)}</strong>.</p>
                        <p>Motivo de la consulta: ${escapeHtml(motivoConsulta)}</p>
                        <p>Por favor, inicie sesión en la plataforma para revisar los detalles y los archivos adjuntos.</p>
                        <br>
                        <p>Atentamente,</p>
                        <p>Dr. ${escapeHtml(nuevoCaso.medicoGeneralNombre)}</p>
                    `
                };
                await transporter.sendMail(mailOptions);
                console.log(`Correo de notificación enviado a ${emailDestino}`);
            }
        } catch (emailError) {
            // Si el correo falla, no detenemos la respuesta exitosa al usuario.
            console.error('Error al enviar el correo de notificación:', emailError);
        }

        // --- CREAR NOTIFICACIÓN EN FIRESTORE ---
        try {
            await db.collection('notifications').add({
                usuarioId: medicoEspecialistaId, // El destinatario es el especialista
                tipo: 'nuevo_caso',
                mensaje: `Nuevo caso asignado: ${nuevoCaso.pacienteNombreCompleto}`,
                leido: false,
                fechaCreacion: new Date().toISOString(),
                casoId: docRef.id,
                link: `/app/casos/${docRef.id}`
            });
        } catch (notifError) {
            console.error('Error al crear notificación de nuevo caso:', notifError);
        }

        res.status(201).json({ message: 'Caso enviado con éxito (IA procesando...)', id: docRef.id });
    } catch (error) {
        console.error('Error al crear caso:', error);
        res.status(500).json({ message: 'Error en el servidor al crear el caso.' });
    }
};

// 7. OBTENER DETALLES DE UN CASO ESPECÍFICO (participantes o administrador)
const getCaseById = async (req, res) => {
    try {
        const loaded = await loadAccessibleCase(req, res);
        if (!loaded) return;
        res.status(200).json({ id: req.params.id, ...loaded.caso });
    } catch (error) {
        console.error('Error al obtener detalle del caso:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener el caso.' });
    }
};

// 8. OBTENER COMENTARIOS DE UN CASO (participantes o administrador)
const getCaseComments = async (req, res) => {
    try {
        const loaded = await loadAccessibleCase(req, res);
        if (!loaded) return;
        const snapshot = await loaded.ref.collection('comentarios').orderBy('fechaCreacion', 'asc').get();
        const comentarios = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(comentarios);
    } catch (error) {
        console.error('Error al obtener comentarios:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener comentarios.' });
    }
};

// 10. CERRAR UN CASO (especialista asignado o administrador)
const closeCase = async (req, res) => {
    try {
        const casoRef = db.collection('casos').doc(req.params.id);
        const caseDoc = await casoRef.get();
        if (!caseDoc.exists) {
            return res.status(404).json({ message: 'Caso no encontrado.' });
        }
        if (!canCloseCase(req.user, caseDoc.data())) {
            return res.status(403).json({ message: 'No tienes permiso para cerrar este caso.' });
        }

        await casoRef.update({
            estado: 'cerrado',
            fechaCierre: new Date().toISOString()
        });

        res.status(200).json({ message: 'El caso ha sido cerrado con éxito.' });
    } catch (error) {
        console.error('Error al cerrar el caso:', error);
        res.status(500).json({ message: 'Error en el servidor al cerrar el caso.' });
    }
};

// 9. AÑADIR UN NUEVO COMENTARIO A UN CASO (participantes o administrador)
// El autor sale del token verificado; lo que venga en el cuerpo se ignora.
const addComment = async (req, res) => {
    try {
        const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
        if (!texto) {
            return res.status(400).json({ message: 'Escribe el comentario.' });
        }
        if (texto.length > MAX_TEXT) {
            return res.status(400).json({ message: 'El comentario es demasiado largo.' });
        }

        const loaded = await loadAccessibleCase(req, res);
        if (!loaded) return;
        const { ref: casoRef, caso } = loaded;

        // No permitir comentarios en casos cerrados
        if (caso.estado === 'cerrado') {
            return res.status(403).json({ message: 'No se pueden añadir comentarios a un caso cerrado.' });
        }

        const comentario = {
            texto,
            autorId: req.user.uid,
            autorNombre: fullName(req.user),
            autorRol: req.user.rol,
            fechaCreacion: new Date().toISOString(),
        };

        const docRef = await casoRef.collection('comentarios').add(comentario);

        // --- ACTUALIZAR CASO PRINCIPAL CON INFO DEL ÚLTIMO COMENTARIO ---
        await casoRef.update({
            lastCommentTimestamp: comentario.fechaCreacion,
            lastCommentAutor: comentario.autorNombre,
            lastCommentText: comentario.texto.substring(0, 50) + (comentario.texto.length > 50 ? '...' : '')
        });

        // Destinatario: el otro participante del caso
        let idDestinatario;
        if (comentario.autorId === caso.medicoGeneralId) idDestinatario = caso.medicoEspecialistaId;
        else if (comentario.autorId === caso.medicoEspecialistaId) idDestinatario = caso.medicoGeneralId;

        // --- LÓGICA DE ENVÍO DE CORREO POR NUEVO COMENTARIO ---
        try {
            if (idDestinatario) {
                const docDestinatario = await db.collection('users').doc(idDestinatario).get();
                if (docDestinatario.exists && docDestinatario.data().email) {
                    const emailDestino = docDestinatario.data().email;
                    await transporter.sendMail({
                        from: `"Plataforma Clínica" <${process.env.EMAIL_USER}>`,
                        to: emailDestino,
                        replyTo: req.user.email,
                        subject: `Nuevo comentario en el caso de: ${caso.pacienteNombreCompleto}`,
                        html: `
                            <p>Hola,</p>
                            <p>El <strong>Dr. ${escapeHtml(comentario.autorNombre)}</strong> ha añadido un nuevo comentario en el caso del paciente <strong>${escapeHtml(caso.pacienteNombreCompleto)}</strong>.</p>
                            <p><strong>Comentario:</strong> "${escapeHtml(comentario.texto)}"</p>
                            <p>Por favor, inicie sesión en la plataforma para ver el historial completo y responder.</p>
                        `
                    });
                    console.log(`Correo de nuevo comentario enviado a ${emailDestino}`);
                }
            }
        } catch (emailError) {
            console.error('Error al enviar correo de notificación por comentario:', emailError);
        }

        // --- CREAR NOTIFICACIÓN EN FIRESTORE (COMENTARIO) ---
        try {
            if (idDestinatario) {
                await db.collection('notifications').add({
                    usuarioId: idDestinatario,
                    tipo: 'nuevo_comentario',
                    mensaje: `Nuevo comentario en caso de ${caso.pacienteNombreCompleto}: "${comentario.texto.substring(0, 30)}..."`,
                    leido: false,
                    fechaCreacion: new Date().toISOString(),
                    casoId: req.params.id,
                    link: `/app/casos/${req.params.id}`
                });
            }
        } catch (notifError) {
            console.error('Error al crear notificación de comentario:', notifError);
        }

        res.status(201).json({ id: docRef.id, ...comentario });
    } catch (error) {
        console.error('Error al añadir comentario:', error);
        res.status(500).json({ message: 'Error en el servidor al añadir comentario.' });
    }
};

// 6. OBTENER CASOS (FILTRADOS POR ROL)
const getCases = async (req, res) => {
    const { estado } = req.query;
    const { rol, uid: userId } = req.user; // Rol y uid del token verificado (verifyToken garantiza un rol válido)

    try {
        let query = db.collection('casos');

        if (rol === 'medico') {
            query = query.where('medicoEspecialistaId', '==', userId);
        } else if (rol === 'atencion') {
            query = query.where('medicoGeneralId', '==', userId);
        } else if (!isAdmin(req.user)) {
            return res.status(403).json({ message: 'No tienes permiso para ver casos.' });
        }

        if (estado && estado !== 'todos') {
            query = query.where('estado', '==', String(estado));
        }

        const snapshot = await query.orderBy('fechaCreacion', 'desc').get();
        const casos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(casos);
    } catch (error) {
        console.error('Error detallado al obtener casos:', error);
        res.status(500).json({ message: 'Error en el servidor al obtener los casos.' });
    }
};

// 11. ACTUALIZAR EL DIAGNÓSTICO DE UN CASO
// Solo el campo `diagnostico`, solo el especialista asignado y solo con el caso abierto.
const updateCase = async (req, res) => {
    try {
        const body = req.body || {};
        const keys = Object.keys(body);
        if (keys.length !== 1 || keys[0] !== 'diagnostico' || typeof body.diagnostico !== 'string') {
            return res.status(400).json({ message: 'Solo se puede actualizar el diagnóstico.' });
        }
        if (body.diagnostico.length > MAX_TEXT) {
            return res.status(400).json({ message: 'El diagnóstico es demasiado largo.' });
        }

        const casoRef = db.collection('casos').doc(req.params.id);
        const doc = await casoRef.get();
        if (!doc.exists) {
            return res.status(404).json({ message: 'Caso no encontrado.' });
        }
        const caso = doc.data();
        if (!canEditDiagnosis(req.user, caso)) {
            return res.status(403).json({ message: 'Solo el especialista asignado puede escribir el diagnóstico.' });
        }
        if (caso.estado === 'cerrado') {
            return res.status(409).json({ message: 'El caso está cerrado; el diagnóstico ya no se puede cambiar.' });
        }

        await casoRef.update({ diagnostico: body.diagnostico, fechaDiagnostico: new Date().toISOString() });
        res.status(200).json({ message: 'Caso actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar caso:', error);
        res.status(500).json({ message: 'Error al actualizar el caso' });
    }
};

// 12. ELIMINAR UN CASO (participantes o administrador)
const deleteCase = async (req, res) => {
    try {
        const casoRef = db.collection('casos').doc(req.params.id);
        const caseDoc = await casoRef.get();
        if (!caseDoc.exists) {
            return res.status(404).json({ message: 'Caso no encontrado.' });
        }
        if (!canDeleteCase(req.user, caseDoc.data())) {
            return res.status(403).json({ message: 'No tienes permiso para eliminar este caso.' });
        }

        await casoRef.delete();
        console.log(`[AUDIT] Caso ${req.params.id} eliminado por ${req.user.uid}`);
        res.status(200).json({ message: 'Caso eliminado con éxito.' });
    } catch (error) {
        console.error('Error al eliminar caso:', error);
        res.status(500).json({ message: 'Error en el servidor al eliminar el caso.' });
    }
};


module.exports = {
    createCase,
    getCaseById,
    getCaseComments,
    closeCase,
    addComment,
    getCases,
    updateCase,
    deleteCase
};
