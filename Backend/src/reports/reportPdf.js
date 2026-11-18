// Draws the report model (src/reports/reportModel.js) as a Letter-size PDF with pdfkit.
// Palette matches the web platform: institutional blue, slate neutrals, amber for AI content.
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(path.dirname(require.resolve('@fontsource/ibm-plex-sans/package.json')), 'files');
const LOGO = path.join(__dirname, '..', '..', 'assets', 'logo-tecnm.png');

const C = {
    blue: '#1e3a8a',
    ink: '#0f172a',
    text: '#334155',
    muted: '#64748b',
    line: '#e2e8f0',
    soft: '#f8fafc',
    amberSoft: '#fffbeb',
    amberLine: '#fde68a',
    amberText: '#92400e',
    green: '#059669',
    amber: '#f59e0b',
    red: '#dc2626',
};

const STATUS_STYLE = {
    DEFINITIVO: { bg: '#d1fae5', fg: '#065f46', label: 'Informe definitivo' },
    PRELIMINAR: { bg: '#fef3c7', fg: '#92400e', label: 'Informe preliminar' },
};

const PREDICTION_STYLE = {
    SANO: { bg: '#d1fae5', fg: '#065f46' },
    'FRACTURA DETECTADA': { bg: '#fee2e2', fg: '#991b1b' },
};
const PREDICTION_REVIEW = { bg: '#fef3c7', fg: '#92400e' };

const MARGIN = 54;
const FOOTER_H = 40;

const formatDate = (iso, withTime = false) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        ...(withTime ? { timeStyle: 'short' } : {}),
    });
};

const pct = (p) => `${(Math.round(p * 1000) / 10).toLocaleString('es-MX')} %`;

// Vertical room (pt) of the study image + AI block: its section title, the full-size block,
// the smallest useful image, the two-line note under the block, and the signature, which is
// kept on the same page. Title and note include a couple of points of slack for line heights.
const STUDY_BLOCK = { title: 30, maxH: 230, minImageH: 140, note: 36, signature: 50 };

// Fits the block in the room left on the page, shrinking the image down to minImageH; when even
// that does not fit, the block starts a new page at full size. The AI panel is never cut.
const planStudyBlock = ({ y, pageBottom, panelH, hasImage }) => {
    const full = Math.max(STUDY_BLOCK.maxH, panelH);
    const min = Math.max(panelH, hasImage ? STUDY_BLOCK.minImageH : 0);
    const room = pageBottom - y - STUDY_BLOCK.title - STUDY_BLOCK.note - STUDY_BLOCK.signature;
    if (room >= min) return { newPage: false, blockH: Math.min(room, full) };
    return { newPage: true, blockH: full };
};

const renderReport = (model, output, { preview = null } = {}) => {
    const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: MARGIN, bottom: MARGIN + FOOTER_H, left: MARGIN, right: MARGIN },
        bufferPages: true,
        info: {
            Title: `Informe de radiodiagnóstico ${model.folio}`,
            Author: 'Sistema de Teleradiodiagnóstico',
            // No patient data in the file metadata: it shows up in file listings and indexers
            Subject: 'Informe de radiodiagnóstico',
        },
    });
    doc.registerFont('Regular', path.join(FONT_DIR, 'ibm-plex-sans-latin-400-normal.woff'));
    doc.registerFont('Italic', path.join(FONT_DIR, 'ibm-plex-sans-latin-400-italic.woff'));
    doc.registerFont('Medium', path.join(FONT_DIR, 'ibm-plex-sans-latin-500-normal.woff'));
    doc.registerFont('Semibold', path.join(FONT_DIR, 'ibm-plex-sans-latin-600-normal.woff'));
    doc.pipe(output);

    const left = MARGIN;
    const width = doc.page.width - MARGIN * 2;
    const bottomLimit = () => doc.page.height - MARGIN - FOOTER_H;
    const ensureSpace = (needed) => {
        if (doc.y + needed > bottomLimit()) doc.addPage();
    };

    const pill = (x, y, label, { bg, fg }, size = 8) => {
        doc.font('Semibold').fontSize(size);
        const w = doc.widthOfString(label) + 14;
        const h = size + 8;
        doc.roundedRect(x, y, w, h, h / 2).fill(bg);
        doc.fillColor(fg).text(label, x + 7, y + 4, { lineBreak: false });
        return { w, h };
    };

    // ---------- header ----------
    try {
        doc.image(LOGO, left, MARGIN - 8, { fit: [118, 40] });
    } catch {
        // Logo optional: the report is valid without it
    }
    doc.font('Regular').fontSize(8).fillColor(C.muted)
        .text('Sistema de Teleradiodiagnóstico', left, MARGIN + 36, { lineBreak: false });

    doc.font('Semibold').fontSize(17).fillColor(C.ink)
        .text('Informe de radiodiagnóstico', left, MARGIN - 6, { width, align: 'right' });
    doc.font('Regular').fontSize(8.5).fillColor(C.muted)
        .text(`Folio ${model.folio}  ·  Emitido ${formatDate(model.fechaEmision, true)}`, left, MARGIN + 17, { width, align: 'right' });
    const status = STATUS_STYLE[model.estado];
    doc.font('Semibold').fontSize(8);
    const statusW = doc.widthOfString(status.label) + 14;
    pill(left + width - statusW, MARGIN + 32, status.label, status);

    const ruleY = MARGIN + 56;
    doc.rect(left, ruleY, width, 2).fill(C.blue);
    doc.y = ruleY + 16;

    // ---------- identification ----------
    const kv = (x, y, w, label, value) => {
        doc.font('Regular').fontSize(7.5).fillColor(C.muted).text(label, x, y, { width: w, lineBreak: false });
        doc.font('Medium').fontSize(9.5).fillColor(C.ink).text(value, x, y + 10, { width: w, height: 13, ellipsis: true });
    };
    const boxY = doc.y;
    const boxH = 98;
    doc.roundedRect(left, boxY, width, boxH, 8).fillAndStroke(C.soft, C.line);
    const pad = 14;
    const colW = (width - pad * 2 - 20) / 2;
    const colA = left + pad;
    const colB = colA + colW + 20;
    doc.font('Semibold').fontSize(8.5).fillColor(C.blue).text('Paciente', colA, boxY + 10, { lineBreak: false });
    doc.text('Estudio', colB, boxY + 10, { lineBreak: false });
    kv(colA, boxY + 26, colW, 'Nombre', model.paciente.nombre);
    kv(colA, boxY + 50, colW / 2 - 6, 'NSS', model.paciente.nss);
    kv(colA + colW / 2, boxY + 50, colW / 2, 'Edad', model.paciente.edad);
    kv(colA, boxY + 74, colW, 'Tipo de sangre', model.paciente.sangre);
    kv(colB, boxY + 26, colW, 'Modalidad', `${model.estudio.modalidad} · ${model.estudio.archivos} archivo(s)`);
    kv(colB, boxY + 50, colW / 2 - 6, 'Fecha de solicitud', formatDate(model.estudio.fechaSolicitud));
    kv(colB + colW / 2, boxY + 50, colW / 2, 'Médico que solicita', model.estudio.solicita);
    kv(colB, boxY + 74, colW, 'Médico especialista que interpreta', model.estudio.interpreta);
    doc.y = boxY + boxH + 16;

    // ---------- sections ----------
    const sectionTitle = (title) => {
        ensureSpace(48);
        doc.font('Semibold').fontSize(10.5).fillColor(C.blue).text(title, left, doc.y, { width });
        const y = doc.y + 3;
        doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.75).strokeColor(C.line).stroke();
        doc.y = y + 7;
    };
    const paragraph = (value, { italic = false, size = 10 } = {}) => {
        doc.font(italic ? 'Italic' : 'Regular').fontSize(size).fillColor(italic ? C.muted : C.text)
            .text(value, left, doc.y, { width, lineGap: 2.5, align: 'left' });
        doc.moveDown(0.6);
    };
    const labelled = (label, value) => {
        if (!value) return;
        ensureSpace(30);
        doc.font('Medium').fontSize(8.5).fillColor(C.muted).text(label, left, doc.y, { width });
        paragraph(value);
    };

    sectionTitle('Información clínica');
    if (model.clinica.motivo || model.clinica.antecedentes || model.clinica.sintomas || model.clinica.medicamentos) {
        labelled('Motivo de la consulta', model.clinica.motivo);
        labelled('Antecedentes', model.clinica.antecedentes);
        labelled('Síntomas clave', model.clinica.sintomas);
        labelled('Medicamentos actuales', model.clinica.medicamentos);
    } else {
        paragraph('Sin información clínica registrada.', { italic: true });
    }
    doc.moveDown(0.4);

    sectionTitle('Hallazgos e impresión diagnóstica');
    if (model.hallazgos) {
        paragraph(model.hallazgos, { size: 10.5 });
    } else {
        paragraph('Pendiente: el médico especialista todavía no registra el diagnóstico.', { italic: true });
    }
    doc.moveDown(0.4);

    // ---------- study image and AI support ----------
    let img = null;
    if (preview) {
        try {
            img = doc.openImage(preview);
        } catch {
            img = null; // Imagen dañada: el reporte sigue sin ella
        }
    }

    // AI panel inside a column. With draw=false nothing is painted and only the height is
    // computed, so the amber background can be sized to the content before the text goes on top.
    const layoutIaPanel = (x, y, w, draw) => {
        const ia = model.ia;
        const inner = x + 14;
        const innerW = w - 28;
        // Writes (or measures) a text block and returns its bottom edge
        const put = (font, size, color, str, tx, ty, opts) => {
            doc.font(font).fontSize(size);
            if (!draw) return ty + doc.heightOfString(str, opts);
            doc.fillColor(color).text(str, tx, ty, opts);
            return doc.y;
        };
        // The section title already names the panel, so it opens with the result:
        // probability on the left and the prediction chip on the right of the same line.
        let cy = y + 14;
        const chipStyle = PREDICTION_STYLE[ia.prediction] || PREDICTION_REVIEW;
        const chipH = 8.5 + 8;
        doc.font('Semibold').fontSize(8.5);
        const chipW = doc.widthOfString(ia.prediction) + 14;

        if (ia.probabilidad === null) {
            if (draw) pill(inner, cy, ia.prediction, chipStyle, 8.5);
            cy += chipH + 10;
        } else {
            cy = put('Regular', 8, C.muted, 'Probabilidad de fractura', inner, cy, { width: innerW });
            const numberTop = cy + 1;
            cy = put('Semibold', 16, C.ink, pct(ia.probabilidad), inner, numberTop, { width: innerW - chipW - 8 }) + 9;
            if (draw) pill(inner + innerW - chipW, numberTop + 3, ia.prediction, chipStyle, 8.5);

            // Probability bar with the classifier's decision zones
            const barW = innerW;
            const barH = 8;
            const { sano, fractura } = ia.umbrales;
            if (draw) {
                doc.save();
                doc.roundedRect(inner, cy, barW, barH, 4).clip();
                doc.rect(inner, cy, barW * sano, barH).fill('#a7f3d0');
                doc.rect(inner + barW * sano, cy, barW * (fractura - sano), barH).fill('#fde68a');
                doc.rect(inner + barW * fractura, cy, barW * (1 - fractura), barH).fill('#fecaca');
                doc.restore();
                const mx = inner + barW * Math.min(1, Math.max(0, ia.probabilidad));
                doc.moveTo(mx, cy - 4).lineTo(mx, cy + barH + 4).lineWidth(2).strokeColor(C.ink).stroke();
                doc.polygon([mx - 4, cy - 8], [mx + 4, cy - 8], [mx, cy - 3]).fill(C.ink);
                // Zone labels carry the thresholds
                doc.font('Regular').fontSize(7).fillColor(C.muted);
                doc.text(`Sano < ${pct(sano)}`, inner, cy + 12, { lineBreak: false });
                doc.text('Revisión', inner + barW * ((sano + fractura) / 2) - 14, cy + 12, { lineBreak: false });
                doc.text(`Fractura > ${pct(fractura)}`, inner, cy + 12, { width: barW, align: 'right', lineBreak: false });
            }
            cy += 12 + 9 + 10;
        }

        const row = (label, value) => {
            if (draw) doc.font('Regular').fontSize(8).fillColor(C.muted).text(label, inner, cy, { width: innerW / 2, lineBreak: false });
            cy = put('Medium', 8.5, C.ink, value, inner + innerW / 2, cy, { width: innerW / 2, align: 'right' }) + 4;
        };
        row('Zonas sugeridas', String(ia.zonas));
        row('Modelo', `${ia.modelo}`);
        row('Análisis', formatDate(ia.fecha, true));
        return cy + 10 - y;
    };

    const studyNote = [
        img ? 'Recuadros ámbar: zonas sugeridas por la IA; no confirman ni descartan una fractura.' : null,
        model.ia ? 'El resultado de la IA es apoyo generado automáticamente y no constituye un diagnóstico: la interpretación y la responsabilidad corresponden al médico especialista.' : null,
    ].filter(Boolean).join(' ');

    if (img || model.ia) {
        const gap = 16;
        const iaW = img && model.ia ? 220 : width;
        const imgAreaW = img && model.ia ? width - iaW - gap : width;
        const panelH = model.ia ? layoutIaPanel(left, 0, iaW, false) : 0;
        const plan = planStudyBlock({ y: doc.y, pageBottom: bottomLimit(), panelH, hasImage: Boolean(img) });
        if (plan.newPage) doc.addPage();
        const blockH = plan.blockH;
        sectionTitle(img && model.ia ? 'Imagen del estudio y apoyo de IA' : img ? 'Imagen del estudio' : 'Apoyo de inteligencia artificial');
        const top = doc.y + 4;
        let bottom = top;

        if (img) {
            // 4 pt dark frame around the image
            const scale = Math.min((imgAreaW - 8) / img.width, (blockH - 8) / img.height, 2);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = left + (imgAreaW - w) / 2;
            doc.rect(x - 4, top, w + 8, h + 8).fill('#0b1220');
            doc.image(img, x, top + 4, { width: w, height: h });
            bottom = Math.max(bottom, top + h + 8);
        }

        if (model.ia) {
            const x = img ? left + imgAreaW + gap : left;
            // Background sized to the measured content, then the content on top
            doc.roundedRect(x, top, iaW, panelH, 8).fillAndStroke(C.amberSoft, C.amberLine);
            layoutIaPanel(x, top, iaW, true);
            bottom = Math.max(bottom, top + panelH);
        }
        doc.font('Italic').fontSize(7.5).fillColor(C.amberText)
            .text(studyNote, left, bottom + 8, { width, lineGap: 1.5 });
        doc.y += 4;
    }

    // ---------- signature ----------
    // Name only: the stored name carries no title, and a fixed "Dr." would be wrong for a woman.
    ensureSpace(STUDY_BLOCK.signature);
    const sigW = 220;
    const sigX = left + (width - sigW) / 2;
    const sigY = doc.y + 18;
    doc.moveTo(sigX, sigY).lineTo(sigX + sigW, sigY).lineWidth(0.75).strokeColor(C.muted).stroke();
    doc.font('Semibold').fontSize(10).fillColor(C.ink).text(model.firma.nombre, sigX - 40, sigY + 6, { width: sigW + 80, align: 'center' });
    const firmaEstado = model.firma.fecha ? `Caso cerrado el ${formatDate(model.firma.fecha, true)}` : 'Informe preliminar: el caso sigue abierto';
    doc.font('Regular').fontSize(8.5).fillColor(C.muted)
        .text(`Médico especialista que interpreta  ·  ${firmaEstado}`, left, doc.y + 1, { width, align: 'center' });

    // ---------- watermark and footer on every page ----------
    // The footer sits inside the bottom margin: margins are lifted while drawing it, otherwise
    // pdfkit treats the text as overflow and appends blank pages.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        if (model.estado === 'PRELIMINAR') {
            doc.save();
            doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.font('Semibold').fontSize(96).fillColor(C.amber).fillOpacity(0.07)
                .text('PRELIMINAR', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
            doc.restore();
            doc.fillOpacity(1);
        }
        const fy = doc.page.height - MARGIN - 6;
        doc.moveTo(left, fy - 8).lineTo(left + width, fy - 8).lineWidth(0.5).strokeColor(C.line).stroke();
        doc.font('Regular').fontSize(7).fillColor(C.muted);
        doc.text('Contiene datos personales sensibles de salud. Uso exclusivo del personal médico autorizado.', left, fy, { width: width - 130, lineBreak: false });
        doc.text(`${model.folio}  ·  Página ${i - range.start + 1} de ${range.count}`, left, fy, { width, align: 'right', lineBreak: false });
        doc.page.margins.bottom = savedBottom;
    }

    doc.end();
};

module.exports = { renderReport, planStudyBlock, STUDY_BLOCK };
