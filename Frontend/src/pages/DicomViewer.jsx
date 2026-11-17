import React, { useRef, useState, useEffect } from 'react';
import * as cornerstone from 'cornerstone-core';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as cornerstoneMath from 'cornerstone-math';
import * as cornerstoneTools from 'cornerstone-tools';
import * as dicomParser from 'dicom-parser';
import Hammer from 'hammerjs';
import api from '../api/axiosConfig'; // Usar instancia configurada
import { db } from '../firebaseConfig';
import { doc, onSnapshot } from 'firebase/firestore';
import {
    ArrowLeftIcon, ArrowPathIcon, ExclamationTriangleIcon, EyeIcon, EyeSlashIcon, HandRaisedIcon,
    MagnifyingGlassIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, PhotoIcon, SparklesIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import {
    AngleIcon, EllipseRoiIcon, FlipHorizontalIcon, FlipVerticalIcon, InvertIcon, MagnifyIcon,
    RectRoiIcon, RotateLeftIcon, RotateRightIcon, RulerIcon, WindowLevelIcon,
} from '../components/viewer/ViewerIcons';

// Configurar cornerstone
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// Configurar Web Workers
const config = {
    maxWebWorkers: 1,
    startWebWorkersOnDemand: true,
    taskConfiguration: {
        decodeTask: {
            initializeCodecsOnStartup: false,
        },
    },
};
cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

cornerstoneTools.external.cornerstone = cornerstone;
cornerstoneTools.external.Hammer = Hammer;
cornerstoneTools.external.cornerstoneMath = cornerstoneMath;

// Inicializar cornerstone tools
cornerstoneTools.init();

const IA_COLOR = '#facc15';

// Dibuja las regiones sugeridas por la IA sobre el canvas ya renderizado.
// Las coordenadas vienen en píxeles de la imagen original; pixelToCanvas aplica zoom, pan, rotación y espejo.
const drawIARegions = (element, ctx, regiones) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 2;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'bottom';

    regiones.forEach((r) => {
        const corners = [
            { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 },
            { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
        ].map((p) => cornerstone.pixelToCanvas(element, p));

        ctx.strokeStyle = IA_COLOR;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach((c) => ctx.lineTo(c.x, c.y));
        ctx.closePath();
        ctx.stroke();

        const label = `Zona sugerida por IA (${Math.round(r.confianza * 100)} %)`;
        const lx = Math.min(...corners.map((c) => c.x));
        const ly = Math.max(Math.min(...corners.map((c) => c.y)) - 2, 14);
        const width = ctx.measureText(label).width + 8;
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(lx, ly - 16, width, 16);
        ctx.fillStyle = IA_COLOR;
        ctx.fillText(label, lx + 4, ly - 2);
    });

    ctx.restore();
};

const DicomViewer = () => {
    const navigate = useNavigate();
    const imageElementRef = useRef(null);
    const fileInputRef = useRef(null);
    const [dicomFile, setDicomFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [dicomInfo, setDicomInfo] = useState(null);
    const [paciente, setPaciente] = useState(null); // Estado para la info del paciente desde la API
    const [viewport, setViewport] = useState(null);
    const [activeTool, setActiveTool] = useState('Wwwc');
    const [measurements, setMeasurements] = useState([]);
    const [elementEnabled, setElementEnabled] = useState(false);
    const [iaResultado, setIaResultado] = useState(null); // Entrada de caso.iaRegiones para este archivo
    const [showIA, setShowIA] = useState(true);
    const iaOverlayRef = useRef({ regiones: [], visible: true });

    const [searchParams] = useSearchParams();

    useEffect(() => {
        const element = imageElementRef.current;
        if (!element) return;

        try {
            // Verificar si ya está habilitado antes de habilitar
            if (!cornerstone.getEnabledElement(element)) {
                cornerstone.enable(element);
            }
            setElementEnabled(true);
        } catch (error) {
            // Si hay error al verificar, intentar habilitar
            try {
                cornerstone.enable(element);
                setElementEnabled(true);
            } catch (e) {
                console.error('Error al habilitar elemento:', e);
                setElementEnabled(false);
            }
        }

        // Configurar herramientas
        const WwwcTool = cornerstoneTools.WwwcTool;
        const ZoomTool = cornerstoneTools.ZoomTool;
        const PanTool = cornerstoneTools.PanTool;
        const LengthTool = cornerstoneTools.LengthTool;
        const AngleTool = cornerstoneTools.AngleTool;
        const RectangleRoiTool = cornerstoneTools.RectangleRoiTool;
        const EllipticalRoiTool = cornerstoneTools.EllipticalRoiTool;
        const MagnifyTool = cornerstoneTools.MagnifyTool;

        // Agregar herramientas
        cornerstoneTools.addTool(WwwcTool);
        cornerstoneTools.addTool(ZoomTool);
        cornerstoneTools.addTool(PanTool);
        cornerstoneTools.addTool(LengthTool);
        cornerstoneTools.addTool(AngleTool);
        cornerstoneTools.addTool(RectangleRoiTool);
        cornerstoneTools.addTool(EllipticalRoiTool);
        cornerstoneTools.addTool(MagnifyTool);

        // Activar herramienta por defecto
        cornerstoneTools.setToolActive('Wwwc', { mouseButtonMask: 1 });

        // --- RESIZE OBSERVER PARA RESPONSIVIDAD ---
        const resizeObserver = new ResizeObserver(() => {
            if (element) {
                try {
                    // Verificar si el elemento está habilitado y tiene imagen antes de redimensionar
                    const enabledElement = cornerstone.getEnabledElement(element);
                    if (enabledElement && enabledElement.image) {
                        cornerstone.resize(element);
                        cornerstone.fitToWindow(element);
                    }
                } catch (e) {
                    console.log('Ignorando resize - elemento no listo:', e);
                }
            }
        });
        resizeObserver.observe(element);

        // Listener para actualizar viewport
        const handleImageRendered = (event) => {
            const vp = cornerstone.getViewport(element);
            setViewport(vp);

            const { regiones, visible } = iaOverlayRef.current;
            if (visible && regiones.length > 0 && event.detail?.canvasContext) {
                drawIARegions(element, event.detail.canvasContext, regiones);
            }
        };

        element.addEventListener('cornerstoneimagerendered', handleImageRendered);

        return () => {
            resizeObserver.disconnect();
            element.removeEventListener('cornerstoneimagerendered', handleImageRendered);
            try {
                cornerstone.disable(element);
            } catch (e) {
                console.log('Elemento ya deshabilitado');
            }
        };
    }, []);

    // Efecto para cargar la imagen desde la URL
    useEffect(() => {
        const dicomUrl = searchParams.get('url');
        const pacienteNSS = searchParams.get('nss');

        if (dicomUrl && elementEnabled) {
            loadDicomFromUrl(dicomUrl);
        }

        if (pacienteNSS) {
            fetchPaciente(pacienteNSS);
        } else {
            setError("No se proporcionó el NSS del paciente para cargar su información.");
        }

    }, [elementEnabled, searchParams]);

    // Escuchar el caso en vivo: el análisis de IA es asíncrono, así que si el visor se abre
    // antes de que termine, los recuadros aparecen solos cuando el backend guarda iaRegiones.
    const casoId = searchParams.get('caso');
    const archivoIA = searchParams.get('archivo');
    useEffect(() => {
        if (!casoId || !archivoIA) return undefined;

        const unsubscribe = onSnapshot(
            doc(db, 'casos', casoId),
            (snap) => {
                const data = snap.exists() ? snap.data() : {};
                const entradas = Array.isArray(data.iaRegiones) ? data.iaRegiones : [];
                // Coincidencia exacta por ruta; por nombre solo si ninguna ruta coincide
                // (casos antiguos sin uploadPath). Si se analizó varias veces, gana la más reciente
                // (fecha es una cadena ISO 8601, que se ordena correctamente como texto).
                const porRuta = entradas.filter((e) => e.archivo === archivoIA);
                const candidatas = porRuta.length > 0 ? porRuta : entradas.filter((e) => e.nombre === archivoIA);
                const entrada = candidatas.reduce(
                    (ultima, e) => (!ultima || (e.fecha || '') > (ultima.fecha || '') ? e : ultima),
                    null,
                );
                setIaResultado(entrada);
            },
            (err) => console.error('No se pudieron cargar las regiones de IA:', err),
        );

        return unsubscribe;
    }, [casoId, archivoIA]);

    // Sincronizar el overlay con el estado y volver a pintar la imagen
    useEffect(() => {
        iaOverlayRef.current = { regiones: iaResultado?.regiones || [], visible: showIA };
        const element = imageElementRef.current;
        if (!element) return;
        try {
            if (cornerstone.getEnabledElement(element)?.image) {
                cornerstone.updateImage(element);
            }
        } catch {
            // El elemento aún no tiene imagen; se dibujará al renderizar
        }
    }, [iaResultado, showIA]);

    const fetchPaciente = async (nss) => {
        try {
            const response = await api.get(`/pacientes/${nss}`);
            setPaciente(response.data);
        } catch (err) {
            setError(`No se pudo cargar la información del paciente con NSS: ${nss}`);
            console.error(err);
        }
    };

    const loadDicomFromUrl = async (url) => {
        if (!imageElementRef.current) {
            setError('El visor aún no está listo. Por favor espera un momento e intenta de nuevo.');
            return;
        }

        setLoading(true);
        setError(null);
        // Extraer un nombre de archivo de la URL para mostrarlo
        let fileName = 'archivo.dcm';
        try {
            const urlFileName = new URL(url).pathname.split('/').pop();
            fileName = decodeURIComponent(urlFileName);
            setDicomFile({ name: fileName });
        } catch (e) {
            setDicomFile({ name: fileName });
        }

        try {
            const element = imageElementRef.current;
            const imageId = `wadouri:${url}`;


            // Cargar imagen
            const image = await cornerstone.loadImage(imageId);

            // Mostrar imagen
            cornerstone.displayImage(element, image);
            cornerstone.fitToWindow(element); // Ajustar imagen al contenedor
            // CORRECCIÓN: Forzar un redimensionamiento para que el visor se ajuste al layout flexible
            cornerstone.resize(element);

            // Obtener metadatos (opcional, pero útil para el panel de info)
            const arrayBuffer = await (await fetch(url)).arrayBuffer();
            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = dicomParser.parseDicom(byteArray);

            const info = {
                fileName: fileName,
                width: image.width,
                height: image.height,
                patientName: dataSet.string('x00100010') || 'N/A', // Se reemplazará por la info de la BD
                patientID: dataSet.string('x00100020') || 'N/A', // Se reemplazará por la info de la BD
                studyDate: dataSet.string('x00080020') || 'N/A', // Se mantiene
                studyDescription: dataSet.string('x00081030') || 'N/A', // Se mantiene
                modality: dataSet.string('x00080060') || 'N/A',
                manufacturer: dataSet.string('x00080070') || 'N/A',
                bitsAllocated: dataSet.uint16('x00280100') || 'N/A',
                bitsStored: dataSet.uint16('x00280101') || 'N/A',
                photometricInterpretation: dataSet.string('x00280004') || 'N/A',
                pixelSpacing: dataSet.string('x00280030') || 'N/A',
                sliceThickness: dataSet.string('x00180050') || 'N/A',
                kvp: dataSet.string('x00180060') || 'N/A',
                exposureTime: dataSet.string('x00181150') || 'N/A',
                fileSize: arrayBuffer.byteLength,
            };

            setDicomInfo(info);
            const vp = cornerstone.getViewport(element);
            setViewport(vp);

        } catch (err) {
            console.error('Error al cargar DICOM desde URL:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelect = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Verificar que el elemento existe y está listo
        if (!imageElementRef.current) {
            setError('El visor aún no está listo. Por favor espera un momento e intenta de nuevo.');
            return;
        }

        if (!elementEnabled) {
            setError('El elemento de visualización no está habilitado. Recarga la página e intenta de nuevo.');
            return;
        }

        setLoading(true);
        setError(null);
        setDicomFile(file);

        try {
            const element = imageElementRef.current;

            // Asegurarse de que está habilitado
            try {
                cornerstone.getEnabledElement(element);
            } catch (e) {
                console.log('Habilitando elemento...');
                cornerstone.enable(element);
                // Dar tiempo para que se habilite completamente
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Crear URL del archivo
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(file);


            // Cargar imagen
            const image = await cornerstone.loadImage(imageId);

            // Mostrar imagen
            cornerstone.displayImage(element, image);

            // CORRECCIÓN: Ajustar la imagen al tamaño del contenedor
            cornerstone.fitToWindow(element);

            // Obtener metadatos
            const arrayBuffer = await file.arrayBuffer();
            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = dicomParser.parseDicom(byteArray);

            const info = {
                fileName: file.name,
                width: image.width,
                height: image.height,
                patientName: dataSet.string('x00100010') || 'N/A',
                patientID: dataSet.string('x00100020') || 'N/A',
                studyDate: dataSet.string('x00080020') || 'N/A',
                studyDescription: dataSet.string('x00081030') || 'N/A',
                modality: dataSet.string('x00080060') || 'N/A',
                manufacturer: dataSet.string('x00080070') || 'N/A',
                bitsAllocated: dataSet.uint16('x00280100') || 'N/A',
                bitsStored: dataSet.uint16('x00280101') || 'N/A',
                photometricInterpretation: dataSet.string('x00280004') || 'N/A',
                pixelSpacing: dataSet.string('x00280030') || 'N/A',
                sliceThickness: dataSet.string('x00180050') || 'N/A',
                kvp: dataSet.string('x00180060') || 'N/A',
                exposureTime: dataSet.string('x00181150') || 'N/A',
                fileSize: file.size,
            };

            setDicomInfo(info);
            const vp = cornerstone.getViewport(element);
            setViewport(vp);

        } catch (err) {
            console.error('Error al cargar DICOM:', err);
            setError(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const changeTool = (toolName) => {
        // Desactivar todas las herramientas
        cornerstoneTools.setToolPassive('Wwwc');
        cornerstoneTools.setToolPassive('Zoom');
        cornerstoneTools.setToolPassive('Pan');
        cornerstoneTools.setToolPassive('Length');
        cornerstoneTools.setToolPassive('Angle');
        cornerstoneTools.setToolPassive('RectangleRoi');
        cornerstoneTools.setToolPassive('EllipticalRoi');
        cornerstoneTools.setToolPassive('Magnify');

        // Activar herramienta seleccionada
        cornerstoneTools.setToolActive(toolName, { mouseButtonMask: 1 });
        setActiveTool(toolName);
    };

    const resetView = () => {
        if (imageElementRef.current) {
            cornerstone.reset(imageElementRef.current);
            const vp = cornerstone.getViewport(imageElementRef.current);
            setViewport(vp);
        }
    };

    const invertImage = () => {
        if (imageElementRef.current && viewport) {
            const element = imageElementRef.current;
            const vp = cornerstone.getViewport(element);
            vp.invert = !vp.invert;
            cornerstone.setViewport(element, vp);
        }
    };

    const adjustZoom = (factor) => {
        if (imageElementRef.current && viewport) {
            const element = imageElementRef.current;
            const vp = cornerstone.getViewport(element);
            vp.scale *= factor;
            cornerstone.setViewport(element, vp);
        }
    };

    const rotateImage = (degrees) => {
        if (imageElementRef.current && viewport) {
            const element = imageElementRef.current;
            const vp = cornerstone.getViewport(element);
            vp.rotation = (vp.rotation + degrees) % 360;
            cornerstone.setViewport(element, vp);
        }
    };

    const flipImage = (axis) => {
        if (imageElementRef.current && viewport) {
            const element = imageElementRef.current;
            const vp = cornerstone.getViewport(element);
            if (axis === 'h') {
                vp.hflip = !vp.hflip;
            } else {
                vp.vflip = !vp.vflip;
            }
            cornerstone.setViewport(element, vp);
        }
    };

    const clearMeasurements = () => {
        const element = imageElementRef.current;
        if (element) {
            const toolStateManager = cornerstoneTools.globalImageIdSpecificToolStateManager;
            toolStateManager.clear(element);
            cornerstone.updateImage(element);
            setMeasurements([]);
        }
    };

    const presetWindowLevel = (preset) => {
        if (!imageElementRef.current || !viewport) return;

        const element = imageElementRef.current;
        const vp = cornerstone.getViewport(element);

        // Presets comunes en radiología
        const presets = {
            'soft-tissue': { center: 40, width: 400 },
            'lung': { center: -600, width: 1500 },
            'bone': { center: 300, width: 1500 },
            'brain': { center: 40, width: 80 },
            'liver': { center: 80, width: 150 },
            'abdomen': { center: 60, width: 400 },
        };

        if (presets[preset]) {
            vp.voi.windowCenter = presets[preset].center;
            vp.voi.windowWidth = presets[preset].width;
            cornerstone.setViewport(element, vp);
        }
    };

    const toolGroups = [
        {
            label: 'Navegación',
            tools: [
                { name: 'Wwwc', Icon: WindowLevelIcon, label: 'Ventana / nivel' },
                { name: 'Zoom', Icon: MagnifyingGlassIcon, label: 'Zoom' },
                { name: 'Pan', Icon: HandRaisedIcon, label: 'Desplazar' },
                { name: 'Magnify', Icon: MagnifyIcon, label: 'Lupa' },
            ],
        },
        {
            label: 'Medición',
            tools: [
                { name: 'Length', Icon: RulerIcon, label: 'Distancia' },
                { name: 'Angle', Icon: AngleIcon, label: 'Ángulo' },
                { name: 'RectangleRoi', Icon: RectRoiIcon, label: 'ROI rectangular' },
                { name: 'EllipticalRoi', Icon: EllipseRoiIcon, label: 'ROI elíptica' },
            ],
        },
    ];
    const activeToolLabel = toolGroups.flatMap((g) => g.tools).find((t) => t.name === activeTool)?.label;

    const imageActions = [
        { key: 'zoom-in', Icon: MagnifyingGlassPlusIcon, label: 'Acercar', onClick: () => adjustZoom(1.2) },
        { key: 'zoom-out', Icon: MagnifyingGlassMinusIcon, label: 'Alejar', onClick: () => adjustZoom(0.8) },
        { key: 'rot-r', Icon: RotateRightIcon, label: 'Rotar 90° a la derecha', onClick: () => rotateImage(90) },
        { key: 'rot-l', Icon: RotateLeftIcon, label: 'Rotar 90° a la izquierda', onClick: () => rotateImage(-90) },
        { key: 'flip-h', Icon: FlipHorizontalIcon, label: 'Espejo horizontal', onClick: () => flipImage('h') },
        { key: 'flip-v', Icon: FlipVerticalIcon, label: 'Espejo vertical', onClick: () => flipImage('v') },
        { key: 'invert', Icon: InvertIcon, label: 'Invertir escala de grises', onClick: invertImage },
        { key: 'reset', Icon: ArrowPathIcon, label: 'Restablecer vista', onClick: resetView },
    ];

    const iconButton = 'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors '
        + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
    const idleButton = `${iconButton} border-transparent text-slate-300 hover:bg-slate-800 hover:text-white`;
    const activeButton = `${iconButton} border-sky-500 bg-sky-600/20 text-sky-400`;
    const divider = <span className="mx-1 h-6 w-px bg-slate-700" aria-hidden="true" />;
    const sectionTitle = 'mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400';

    const iaChip = {
        'SANO': 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
        'FRACTURA DETECTADA': 'border-red-500/40 bg-red-500/10 text-red-300',
    }[iaResultado?.prediction] || 'border-amber-500/40 bg-amber-500/10 text-amber-300';

    const Row = ({ label, children }) => (
        <div className="flex justify-between gap-3 py-1">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-right font-medium text-slate-100 truncate">{children}</dd>
        </div>
    );

    const showToolbar = dicomFile && !loading && !error;

    return (
        <div className="w-full h-screen bg-slate-950 text-slate-100 flex flex-col relative">
            {/* Encabezado */}
            <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-3">
                <button
                    onClick={() => navigate(-1)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                    <ArrowLeftIcon className="h-4 w-4" />
                    Regresar al caso
                </button>
                <span className="h-5 w-px bg-slate-700" aria-hidden="true" />
                <h1 className="text-sm font-semibold tracking-wide">Visor DICOM</h1>
                {dicomFile && (
                    <span className="min-w-0 truncate text-xs text-slate-400" title={dicomFile.name}>
                        {dicomFile.name}
                    </span>
                )}
            </header>

            {/* Barra de herramientas */}
            {showToolbar && (
                <div
                    role="toolbar"
                    aria-label="Herramientas del visor"
                    className="flex flex-shrink-0 flex-wrap items-center gap-y-1 border-b border-slate-800 bg-slate-900 px-2 py-1"
                >
                    {toolGroups.map((group) => (
                        <React.Fragment key={group.label}>
                            <div className="flex items-center gap-0.5" role="group" aria-label={group.label}>
                                {group.tools.map((tool) => (
                                    <button
                                        key={tool.name}
                                        onClick={() => changeTool(tool.name)}
                                        className={activeTool === tool.name ? activeButton : idleButton}
                                        title={tool.label}
                                        aria-label={tool.label}
                                        aria-pressed={activeTool === tool.name}
                                    >
                                        <tool.Icon className="h-5 w-5" />
                                    </button>
                                ))}
                            </div>
                            {divider}
                        </React.Fragment>
                    ))}

                    <div className="flex items-center gap-0.5" role="group" aria-label="Imagen">
                        {imageActions.map((action) => (
                            <button
                                key={action.key}
                                onClick={action.onClick}
                                className={idleButton}
                                title={action.label}
                                aria-label={action.label}
                            >
                                <action.Icon className="h-5 w-5" />
                            </button>
                        ))}
                    </div>
                    {divider}

                    <select
                        onChange={(e) => presetWindowLevel(e.target.value)}
                        className="h-9 rounded-md border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        defaultValue=""
                        aria-label="Presets de ventana / nivel"
                    >
                        <option value="">Presets W/L</option>
                        <option value="soft-tissue">Tejido blando</option>
                        <option value="lung">Pulmón</option>
                        <option value="bone">Hueso</option>
                        <option value="brain">Cerebro</option>
                        <option value="liver">Hígado</option>
                        <option value="abdomen">Abdomen</option>
                    </select>
                    {divider}

                    <button
                        onClick={clearMeasurements}
                        className={idleButton}
                        title="Limpiar mediciones"
                        aria-label="Limpiar mediciones"
                    >
                        <TrashIcon className="h-5 w-5" />
                    </button>

                    {iaResultado?.regiones?.length > 0 && (
                        <>
                            {divider}
                            <button
                                onClick={() => setShowIA((v) => !v)}
                                className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${showIA
                                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
                                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                                    }`}
                                title="Mostrar u ocultar las zonas sugeridas por la IA"
                                aria-pressed={showIA}
                            >
                                {showIA ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                                Zonas IA
                            </button>
                        </>
                    )}

                    {viewport && (
                        <div className="ml-auto flex items-center gap-4 pl-3 font-mono text-[11px] tabular-nums text-slate-400">
                            <span>W/L {Math.round(viewport.voi.windowCenter)} / {Math.round(viewport.voi.windowWidth)}</span>
                            <span>Zoom {(viewport.scale * 100).toFixed(0)}%</span>
                            <span>Rot {viewport.rotation}°</span>
                        </div>
                    )}
                </div>
            )}

            {/* Área de trabajo */}
            <div className="flex-1 flex flex-row overflow-hidden relative">
                <div className="flex-1 relative bg-black min-w-0">
                    <div
                        ref={imageElementRef}
                        className="w-full h-full"
                        style={{ cursor: activeTool === 'Pan' ? 'grab' : 'crosshair' }}
                    >
                    </div>

                    {/* Leyendas sobre la imagen */}
                    {showToolbar && (
                        <>
                            <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-slate-300/90 [text-shadow:0_1px_2px_rgb(0_0_0)]">
                                {activeToolLabel}
                            </div>
                            {dicomInfo && (
                                <div className="pointer-events-none absolute bottom-3 right-3 text-right font-mono text-[11px] tabular-nums text-slate-300/90 [text-shadow:0_1px_2px_rgb(0_0_0)]">
                                    {dicomInfo.width} × {dicomInfo.height} px
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Panel lateral */}
                <aside className="w-72 lg:w-80 flex-shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 p-4 text-sm z-20 space-y-5">
                    {!dicomFile && !paciente && (
                        <p className="py-10 text-center text-slate-500">Esperando datos del estudio…</p>
                    )}

                    <section>
                        <h2 className={sectionTitle}>Paciente</h2>
                        {paciente ? (
                            <>
                                <dl>
                                    <Row label="Nombre">{`${paciente.nombre} ${paciente.apellidoP}`}</Row>
                                    <Row label="NSS">{paciente.nss}</Row>
                                    <Row label="Edad">{paciente.edad} años</Row>
                                    <Row label="IMC">{paciente.imc}</Row>
                                    <Row label="Diabetes">{paciente.diabetes ? 'Sí' : 'No'}</Row>
                                    <Row label="Hipertensión">{paciente.hipertension ? 'Sí' : 'No'}</Row>
                                </dl>
                                <Link to={`/app/alta-paciente/${paciente.nss}`} className="mt-1 inline-block text-xs text-sky-400 hover:underline">
                                    Ver expediente completo →
                                </Link>
                            </>
                        ) : (
                            <p className="text-slate-500">Cargando información del paciente…</p>
                        )}
                    </section>

                    {iaResultado && (
                        <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                            <h2 className={`${sectionTitle} flex items-center gap-1.5`}>
                                <SparklesIcon className="h-4 w-4 text-amber-300" />
                                Asistente IA
                            </h2>
                            <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${iaChip}`}>
                                {iaResultado.prediction}
                            </span>
                            <dl className="mt-2">
                                <Row label="Confianza de fractura">{iaResultado.confidence_fracture}%</Row>
                                <Row label="Zonas sugeridas">{iaResultado.regiones?.length || 0}</Row>
                                <Row label="Modelo">{iaResultado.modelo}</Row>
                            </dl>
                            <p className="mt-2 text-xs leading-snug text-slate-400">
                                Los recuadros indican dónde mirar; no confirman una fractura, y su ausencia no la descarta.
                            </p>
                        </section>
                    )}

                    {dicomInfo && (
                        <section>
                            <h2 className={sectionTitle}>Estudio</h2>
                            <dl>
                                <Row label="Archivo"><span title={dicomInfo.fileName}>{dicomInfo.fileName}</span></Row>
                                <Row label="Tamaño">{(dicomInfo.fileSize / 1024).toFixed(2)} KB</Row>
                                <Row label="Fecha de estudio">{dicomInfo.studyDate}</Row>
                                <Row label="Modalidad">{dicomInfo.modality}</Row>
                                {dicomInfo.manufacturer !== 'N/A' && <Row label="Fabricante">{dicomInfo.manufacturer}</Row>}
                                <Row label="Dimensiones">{dicomInfo.width} × {dicomInfo.height}</Row>
                                {dicomInfo.pixelSpacing !== 'N/A' && <Row label="Espaciado de píxeles">{dicomInfo.pixelSpacing}</Row>}
                                {dicomInfo.sliceThickness !== 'N/A' && <Row label="Grosor de corte">{dicomInfo.sliceThickness} mm</Row>}
                            </dl>
                        </section>
                    )}

                    {viewport && (
                        <section>
                            <h2 className={sectionTitle}>Viewport</h2>
                            <dl className="font-mono text-xs tabular-nums">
                                <Row label="Centro">{Math.round(viewport.voi.windowCenter)}</Row>
                                <Row label="Ancho">{Math.round(viewport.voi.windowWidth)}</Row>
                                <Row label="Zoom">{(viewport.scale * 100).toFixed(0)}%</Row>
                                <Row label="Rotación">{viewport.rotation}°</Row>
                                <Row label="Invertido">{viewport.invert ? 'Sí' : 'No'}</Row>
                            </dl>
                        </section>
                    )}
                </aside>
            </div>

            {/* Estado inicial */}
            {!dicomFile && !loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950 z-30">
                    <div className="text-center text-slate-400">
                        <PhotoIcon className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                        <h2 className="text-base font-semibold text-slate-200">Visor de estudios</h2>
                        <p className="text-sm">La imagen del estudio se cargará en este espacio.</p>
                    </div>
                </div>
            )}

            {/* Cargando */}
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-40">
                    <div className="text-center text-slate-300">
                        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-500"></div>
                        <p className="text-sm">Cargando imagen DICOM…</p>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-950/90 z-40">
                    <div className="max-w-md rounded-lg border border-red-500/40 bg-slate-900 px-6 py-5 text-center">
                        <ExclamationTriangleIcon className="mx-auto mb-2 h-8 w-8 text-red-400" />
                        <p className="mb-1 font-semibold text-slate-100">Error al cargar el archivo</p>
                        <p className="text-sm text-slate-300">{error}</p>
                        <button
                            onClick={() => {
                                setError(null);
                                setDicomFile(null);
                            }}
                            className="mt-4 rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                        >
                            Intentar de nuevo
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DicomViewer;
