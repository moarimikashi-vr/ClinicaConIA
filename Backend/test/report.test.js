// Report PDF: content model (pure) and the endpoint end to end against the in-memory Firebase.
const http = require('node:http');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.IA_SERVICE_TOKEN = 'test-token';
process.env.IA_SERVICE_URL = 'http://127.0.0.1:9';

const fake = require('./helpers/fakeFirebase').install();
const app = require('../src/app');
const { buildReportModel, pickStudyForPreview } = require('../src/reports/reportModel');

const NOW = new Date('2026-11-17T18:00:00.000Z');

const baseCase = (over = {}) => ({
    pacienteNSS: '111',
    pacienteNombreCompleto: 'Ana Ruiz',
    motivoConsulta: 'Dolor en pierna derecha tras caída',
    medicoGeneralNombre: 'Dilan Araiza',
    medicoEspecialistaNombre: 'Arturo Cardenas',
    estado: 'abierto',
    fechaCreacion: '2026-11-14T18:19:00.000Z',
    archivos: [{ nombre: 'Ana_Ruiz-111.dcm', uploadPath: 'casos/a1/111/Ana_Ruiz-111.dcm' }],
    ...over,
});

const paciente = { nss: '111', nombre: 'Ana', apellidoP: 'Ruiz', apellidoM: 'Paz', edad: 55, antecedentes: 'Hipertensión' };

// ---------- model ----------

test('an open case is a preliminary report; a closed one is final', () => {
    assert.equal(buildReportModel('c1', baseCase(), paciente, NOW).estado, 'PRELIMINAR');
    const final = buildReportModel('c1', baseCase({ estado: 'cerrado', fechaCierre: '2026-11-16T10:00:00.000Z', diagnostico: 'Fractura' }), paciente, NOW);
    assert.equal(final.estado, 'DEFINITIVO');
    assert.equal(final.firma.fecha, '2026-11-16T10:00:00.000Z');
});

test('the model carries patient, study and clinical data from the case and the patient record', () => {
    const m = buildReportModel('dFiZyLCtUUHvMdbP5lxO', baseCase(), paciente, NOW);
    assert.equal(m.folio, 'RX-DFIZYLCT');
    assert.equal(m.paciente.nombre, 'Ana Ruiz Paz');
    assert.equal(m.paciente.edad, '55 años');
    assert.equal(m.estudio.modalidad, 'Radiografía digital (DICOM)');
    assert.equal(m.estudio.solicita, 'Dilan Araiza');
    assert.equal(m.estudio.interpreta, 'Arturo Cardenas');
    assert.equal(m.clinica.motivo, 'Dolor en pierna derecha tras caída');
    assert.equal(m.clinica.antecedentes, 'Hipertensión');
    assert.equal(m.hallazgos, null);
});

test('the AI block uses the newest analysis and is absent when there is none', () => {
    assert.equal(buildReportModel('c1', baseCase(), paciente, NOW).ia, null);
    const caso = baseCase({
        iaRegiones: [
            { archivo: 'casos/a1/111/Ana_Ruiz-111.dcm', fecha: '2026-11-14T18:19:00.000Z', prediction: 'SANO', confidence_fracture: 10, modelo: 'v3+yolo', regiones: [] },
            { archivo: 'casos/a1/111/Ana_Ruiz-111.dcm', fecha: '2026-11-15T09:00:00.000Z', prediction: 'FRACTURA DETECTADA', confidence_fracture: 92.5, modelo: 'v3+yolo', regiones: [{ x0: 1, y0: 1, x1: 5, y1: 5, confianza: 0.4 }] },
        ],
    });
    const ia = buildReportModel('c1', caso, paciente, NOW).ia;
    assert.equal(ia.prediction, 'FRACTURA DETECTADA');
    assert.equal(ia.probabilidad, 0.925);
    assert.equal(ia.zonas, 1);
    assert.deepEqual(ia.umbrales, { sano: 0.193, fractura: 0.8152 });
});

test('the preview uses the analysed study and its regions, only for image files', () => {
    const caso = baseCase({ iaRegiones: [{ archivo: 'casos/a1/111/Ana_Ruiz-111.dcm', fecha: 'x', regiones: [{ x0: 1, y0: 2, x1: 3, y1: 4, confianza: 0.5 }] }] });
    assert.deepEqual(pickStudyForPreview(caso), { path: 'casos/a1/111/Ana_Ruiz-111.dcm', regiones: [{ x0: 1, y0: 2, x1: 3, y1: 4, confianza: 0.5 }] });
    assert.equal(pickStudyForPreview(baseCase({ archivos: [{ nombre: 'notas.pdf', uploadPath: 'casos/a1/111/notas.pdf' }] })), null);
});

test('the preview only uses files uploaded to the case, never a path stored only in the analysis', () => {
    const caso = baseCase({ iaRegiones: [{ archivo: 'casos/otro/999/ajeno.dcm', fecha: 'x', regiones: [{ x0: 1, y0: 2, x1: 3, y1: 4, confianza: 0.5 }] }] });
    assert.deepEqual(pickStudyForPreview(caso), { path: 'casos/a1/111/Ana_Ruiz-111.dcm', regiones: [] });
});

test('the preview drops malformed regions and caps them at 50', () => {
    const good = { x0: 1, y0: 2, x1: 3, y1: 4, confianza: 0.5 };
    const regiones = [null, { x0: 'a', y0: 2, x1: 3, y1: 4 }, { x0: 1, y0: 2, x1: 3 }, { x0: 5, y0: 6, x1: 7, y1: 8 }, ...Array(60).fill(good)];
    const caso = baseCase({ iaRegiones: [{ archivo: 'casos/a1/111/Ana_Ruiz-111.dcm', fecha: 'x', regiones }] });
    const picked = pickStudyForPreview(caso).regiones;
    assert.equal(picked.length, 50);
    assert.deepEqual(picked[0], { x0: 5, y0: 6, x1: 7, y1: 8, confianza: 0 });
    assert.deepEqual(picked[1], good);
});

// ---------- layout of the study image + AI block ----------

const { planStudyBlock, STUDY_BLOCK } = require('../src/reports/reportPdf');
const reserved = STUDY_BLOCK.title + STUDY_BLOCK.note + STUDY_BLOCK.signature;

test('the study block stays on the page at full size when there is room', () => {
    assert.deepEqual(planStudyBlock({ y: 100, pageBottom: 698, panelH: 200, hasImage: true }), { newPage: false, blockH: 230 });
});

test('the study block shrinks the image to the room left instead of leaving the page half empty', () => {
    const y = 698 - reserved - 190;
    assert.deepEqual(planStudyBlock({ y, pageBottom: 698, panelH: 180, hasImage: true }), { newPage: false, blockH: 190 });
});

test('the study block moves to a new page when the AI panel or a useful image no longer fits', () => {
    const y = 698 - reserved - 130;
    assert.deepEqual(planStudyBlock({ y, pageBottom: 698, panelH: 200, hasImage: true }), { newPage: true, blockH: 230 });
    assert.deepEqual(planStudyBlock({ y, pageBottom: 698, panelH: 0, hasImage: true }), { newPage: true, blockH: 230 });
    assert.deepEqual(planStudyBlock({ y, pageBottom: 698, panelH: 120, hasImage: false }), { newPage: false, blockH: 130 });
});

test('the study block grows to an AI panel taller than the default height', () => {
    assert.deepEqual(planStudyBlock({ y: 100, pageBottom: 698, panelH: 260, hasImage: true }), { newPage: false, blockH: 260 });
});

// ---------- endpoint ----------

let server;
let base;
before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

let T;
beforeEach(() => {
    fake.reset();
    T = { medico: fake.user('med1', 'medico'), otro: fake.user('med2', 'medico') };
    fake.db.put('pacientes/111', paciente);
    fake.db.put('casos/c1', {
        ...baseCase(), medicoGeneralId: 'a1', medicoEspecialistaId: 'med1',
        iaRegiones: [{ archivo: 'casos/a1/111/Ana_Ruiz-111.dcm', fecha: '2026-11-15T09:00:00.000Z', prediction: 'FRACTURA DETECTADA', confidence_fracture: 92.5, modelo: 'v3+yolo', regiones: [{ x0: 1, y0: 1, x1: 5, y1: 5, confianza: 0.4 }] }],
    });
});

const download = async (token) => {
    const res = await fetch(`${base}/reports/c1/generate`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};

// 1x1 white JPEG
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test('the report is a PDF for participants and is still produced when the IA service is down', async () => {
    const r = await download(T.medico);
    assert.equal(r.status, 200);
    assert.equal(r.type, 'application/pdf');
    assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await download(T.otro)).status, 403);
});

test('the report is still produced when the patient record cannot be read', async () => {
    fake.db.failReads('pacientes');
    const r = await download(T.medico);
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
});

test('the report asks the IA service for the study preview with the token and embeds it', async () => {
    const received = [];
    const ia = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            received.push({ url: req.url, token: req.headers['x-ia-token'], body: JSON.parse(raw) });
            res.setHeader('Content-Type', 'image/jpeg');
            res.end(TINY_JPEG);
        });
    });
    await new Promise((r) => ia.listen(0, '127.0.0.1', r));
    const previous = process.env.IA_SERVICE_URL;
    process.env.IA_SERVICE_URL = `http://127.0.0.1:${ia.address().port}`;
    try {
        const withPreview = await download(T.medico);
        assert.equal(withPreview.status, 200);
        assert.deepEqual(received.map((x) => [x.url, x.token, x.body.path, x.body.regiones.length]),
            [['/preview_firebase', 'test-token', 'casos/a1/111/Ana_Ruiz-111.dcm', 1]]);
        assert.ok(withPreview.body.includes(Buffer.from('/Subtype /Image')), 'PDF embeds an image XObject');
    } finally {
        process.env.IA_SERVICE_URL = previous;
        ia.close();
    }
});
