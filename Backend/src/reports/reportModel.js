// Content of the radiology report, independent of how it is drawn.
// Section order follows the RSNA structured-report headings: identification, clinical
// information, technique/study, findings and impression, plus the AI support block.

// Thresholds of the v3 classifier (Backend/api-IAFraturas/main.py: UMBRAL_SANO / UMBRAL_FRACTURA)
const IA_THRESHOLDS = { sano: 0.193, fractura: 0.8152 };

const IMAGE_EXTENSIONS = ['dcm', 'jpg', 'jpeg', 'png'];

const extensionOf = (name = '') => String(name).split('.').pop().toLowerCase();

const studyModality = (archivos = []) => {
    const exts = new Set(archivos.map((a) => extensionOf(a.nombre)));
    if (exts.has('dcm')) return 'Radiografía digital (DICOM)';
    if ([...exts].some((e) => IMAGE_EXTENSIONS.includes(e))) return 'Radiografía digitalizada (imagen)';
    return 'Estudio de imagen';
};

// Newest IA analysis stored on the case (the backend appends one entry per analysed file)
const latestAnalysis = (caso) => {
    const entries = Array.isArray(caso.iaRegiones) ? caso.iaRegiones : [];
    return entries.reduce((latest, e) => (!latest || String(e.fecha || '') > String(latest.fecha || '') ? e : latest), null);
};

// Same limit the IA service enforces on /preview_firebase
const MAX_PREVIEW_REGIONS = 50;

// Keeps only well-formed boxes, so one bad stored entry does not make the IA service reject
// the whole preview
const previewRegions = (regiones) => (Array.isArray(regiones) ? regiones : [])
    .filter((r) => r && ['x0', 'y0', 'x1', 'y1'].every((k) => Number.isFinite(r[k])))
    .slice(0, MAX_PREVIEW_REGIONS)
    .map(({ x0, y0, x1, y1, confianza }) => ({ x0, y0, x1, y1, confianza: Number.isFinite(confianza) ? confianza : 0 }));

// Study and regions for the image shown in the report: the analysed file, or the first image file.
// Only files uploaded to this case qualify, so a path stored in the analysis entry can never
// point the preview at another case's study.
const pickStudyForPreview = (caso) => {
    const archivos = (caso.archivos || []).filter((a) => a && typeof a.uploadPath === 'string' && a.uploadPath);
    const uploaded = new Set(archivos.map((a) => a.uploadPath));
    const analysis = latestAnalysis(caso);
    if (analysis && uploaded.has(analysis.archivo) && IMAGE_EXTENSIONS.includes(extensionOf(analysis.archivo))) {
        return { path: analysis.archivo, regiones: previewRegions(analysis.regiones) };
    }
    const file = archivos.find((a) => IMAGE_EXTENSIONS.includes(extensionOf(a.nombre)));
    return file ? { path: file.uploadPath, regiones: [] } : null;
};

const text = (value) => {
    const s = typeof value === 'string' ? value.trim() : '';
    return s || null;
};

const buildReportModel = (casoId, caso, paciente, now = new Date()) => {
    const closed = caso.estado === 'cerrado';
    const analysis = latestAnalysis(caso);
    const nombrePaciente = paciente
        ? [paciente.nombre, paciente.apellidoP, paciente.apellidoM].filter(Boolean).join(' ')
        : caso.pacienteNombreCompleto;

    return {
        folio: `RX-${String(casoId).slice(0, 8).toUpperCase()}`,
        estado: closed ? 'DEFINITIVO' : 'PRELIMINAR',
        fechaEmision: now.toISOString(),
        paciente: {
            nombre: nombrePaciente || '—',
            nss: caso.pacienteNSS || '—',
            edad: paciente && paciente.edad ? `${paciente.edad} años` : '—',
            sangre: (paciente && paciente.tiposangre) || '—',
        },
        estudio: {
            modalidad: studyModality(caso.archivos),
            archivos: (caso.archivos || []).length,
            fechaSolicitud: caso.fechaCreacion || null,
            solicita: caso.medicoGeneralNombre || '—',
            interpreta: caso.medicoEspecialistaNombre || '—',
        },
        clinica: {
            motivo: text(caso.motivoConsulta),
            antecedentes: text(paciente && paciente.antecedentes),
            sintomas: text(paciente && paciente.sintomascla),
            medicamentos: text(paciente && paciente.medicamentos),
        },
        hallazgos: text(caso.diagnostico),
        ia: analysis ? {
            prediction: analysis.prediction || '—',
            probabilidad: typeof analysis.confidence_fracture === 'number' ? analysis.confidence_fracture / 100 : null,
            zonas: Array.isArray(analysis.regiones) ? analysis.regiones.length : 0,
            modelo: analysis.modelo || '—',
            fecha: analysis.fecha || null,
            umbrales: IA_THRESHOLDS,
        } : null,
        firma: {
            nombre: caso.medicoEspecialistaNombre || '—',
            fecha: closed ? (caso.fechaCierre || null) : null,
        },
    };
};

module.exports = { buildReportModel, pickStudyForPreview, IA_THRESHOLDS };
