const axios = require('axios');
const { db } = require('../config/firebase');
const { canAccessCase } = require('../security/policies');
const { buildReportModel, pickStudyForPreview } = require('../reports/reportModel');
const { renderReport } = require('../reports/reportPdf');

const iaServiceBaseUrl = () => {
    let url = process.env.IA_SERVICE_URL || 'http://localhost:8000';
    if (!url.startsWith('http')) url = `https://${url}`;
    return url;
};

// Radiografía con las zonas de la IA, generada por el microservicio. Si no responde a tiempo,
// el reporte se emite sin imagen en lugar de fallar.
const fetchStudyPreview = async (caso) => {
    const study = pickStudyForPreview(caso);
    if (!study) return null;
    try {
        const response = await axios.post(
            `${iaServiceBaseUrl()}/preview_firebase`,
            { path: study.path, regiones: study.regiones },
            {
                headers: { 'X-IA-Token': process.env.IA_SERVICE_TOKEN || '' },
                responseType: 'arraybuffer',
                timeout: 20000,
                maxContentLength: 5 * 1024 * 1024,
            }
        );
        return Buffer.from(response.data);
    } catch (error) {
        console.error('Vista previa del estudio no disponible:', error.message);
        return null;
    }
};

const generateReport = async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await db.collection('casos').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Caso no encontrado' });
        }

        const caso = doc.data();
        if (!canAccessCase(req.user, caso)) {
            return res.status(403).json({ message: 'No tienes permiso para ver este caso.' });
        }

        const [pacienteDoc, preview] = await Promise.all([
            caso.pacienteNSS ? db.collection('pacientes').doc(String(caso.pacienteNSS)).get() : null,
            fetchStudyPreview(caso),
        ]);
        const paciente = pacienteDoc && pacienteDoc.exists ? pacienteDoc.data() : null;
        const model = buildReportModel(id, caso, paciente);

        // El NSS va en un encabezado HTTP: solo caracteres seguros
        const safeNss = String(caso.pacienteNSS || 'caso').replace(/[^A-Za-z0-9_-]/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Reporte_${safeNss}.pdf`);

        renderReport(model, res, { preview });
    } catch (error) {
        console.error('Error al generar PDF:', error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error al generar el reporte PDF' });
        }
    }
};

module.exports = { generateReport };
