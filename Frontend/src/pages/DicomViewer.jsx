import React, { useRef, useState, useEffect } from 'react';
import * as cornerstone from 'cornerstone-core';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as cornerstoneMath from 'cornerstone-math';
import * as cornerstoneTools from 'cornerstone-tools';
import * as dicomParser from 'dicom-parser';
import Hammer from 'hammerjs';
import api from '../api/axiosConfig'; // Usar instancia configurada

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
                console.log('✅ Elemento habilitado');
            }
            setElementEnabled(true);
        } catch (error) {
            // Si hay error al verificar, intentar habilitar
            try {
                cornerstone.enable(element);
                console.log('✅ Elemento habilitado (segundo intento)');
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

    // Cargar las regiones sugeridas por la IA para este archivo del caso
    useEffect(() => {
        const casoId = searchParams.get('caso');
        const archivo = searchParams.get('archivo');
        if (!casoId || !archivo) return;

        let cancelado = false;
        api.get(`/casos/${casoId}`)
            .then(({ data }) => {
                if (cancelado) return;
                const entradas = Array.isArray(data.iaRegiones) ? data.iaRegiones : [];
                // Coincidencia exacta por ruta; por nombre solo si ninguna ruta coincide
                // (casos antiguos sin uploadPath). Si se analizó varias veces, gana la más reciente.
                const porRuta = entradas.filter((e) => e.archivo === archivo);
                const candidatas = porRuta.length > 0 ? porRuta : entradas.filter((e) => e.nombre === archivo);
                const entrada = candidatas.reduce(
                    (ultima, e) => (!ultima || (e.fecha || '') > (ultima.fecha || '') ? e : ultima),
                    null,
                );
                setIaResultado(entrada);
            })
            .catch((err) => console.error('No se pudieron cargar las regiones de IA:', err));

        return () => { cancelado = true; };
    }, [searchParams]);

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

            console.log('=== CARGANDO DICOM DESDE URL ===');
            console.log('URL:', url);
            console.log('Image ID:', imageId);

            // Cargar imagen
            const image = await cornerstone.loadImage(imageId);
            console.log('✅ Imagen cargada:', image.width, 'x', image.height);

            // Mostrar imagen
            cornerstone.displayImage(element, image);
            cornerstone.fitToWindow(element); // Ajustar imagen al contenedor
            // CORRECCIÓN: Forzar un redimensionamiento para que el visor se ajuste al layout flexible
            cornerstone.resize(element);
            console.log('✅ Imagen mostrada en pantalla');

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

            console.log('=== CARGA COMPLETADA ===');
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

            console.log('=== CARGANDO DICOM LOCAL ===');
            console.log('Archivo:', file.name);
            console.log('Tamaño:', (file.size / 1024).toFixed(2), 'KB');
            console.log('Image ID:', imageId);

            // Cargar imagen
            const image = await cornerstone.loadImage(imageId);
            console.log('✅ Imagen cargada:', image.width, 'x', image.height);

            // Mostrar imagen
            cornerstone.displayImage(element, image);
            console.log('✅ Imagen mostrada en pantalla');

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

            console.log('=== CARGA COMPLETADA ===');
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

    const toolButtons = [
        { name: 'Wwwc', icon: '🖱️', label: 'W/L' },
        { name: 'Zoom', icon: '🔍', label: 'Zoom' },
        { name: 'Pan', icon: '✋', label: 'Pan' },
        { name: 'Length', icon: '📏', label: 'Distancia' },
        { name: 'Angle', icon: '📐', label: 'Ángulo' },
        { name: 'RectangleRoi', icon: '▭', label: 'ROI Rect' },
        { name: 'EllipticalRoi', icon: '⬭', label: 'ROI Elipse' },
        { name: 'Magnify', icon: '🔬', label: 'Lupa' },
    ];

    return (
        <div className="w-full h-screen bg-gray-900 flex flex-col relative">
            {/* Header con botón de regreso */}
            <div className="p-3 bg-gray-800 text-white shadow-lg flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold mb-2">Visor DICOM Profesional</h1>
                    {dicomFile && (
                        <span className="text-sm text-gray-400">Archivo: {dicomFile.name}</span>
                    )}
                </div>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500 font-semibold flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Regresar al caso
                </button>
            </div>

            {/* Toolbar de herramientas */}
            {dicomFile && !loading && !error && (
                <div className="p-2 bg-gray-800 border-t border-gray-700 flex flex-wrap gap-2">
                    <div className="flex gap-1 border-r border-gray-600 pr-2">
                        {toolButtons.map((tool) => (
                            <button
                                key={tool.name}
                                onClick={() => changeTool(tool.name)}
                                className={`px-3 py-1 rounded text-sm ${activeTool === tool.name
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                title={tool.label}
                            >
                                {tool.icon}
                            </button>
                        ))}
                    </div>

                    <div className="flex gap-1 border-r border-gray-600 pr-2">
                        <button
                            onClick={resetView}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            🔄 Reset
                        </button>
                        <button
                            onClick={invertImage}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            🎨 Invertir
                        </button>
                        <button
                            onClick={() => adjustZoom(1.2)}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            🔍+
                        </button>
                        <button
                            onClick={() => adjustZoom(0.8)}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            🔍-
                        </button>
                    </div>

                    <div className="flex gap-1 border-r border-gray-600 pr-2">
                        <button
                            onClick={() => rotateImage(90)}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            ↻ 90°
                        </button>
                        <button
                            onClick={() => rotateImage(-90)}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            ↺ 90°
                        </button>
                        <button
                            onClick={() => flipImage('h')}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            ⇆ Flip H
                        </button>
                        <button
                            onClick={() => flipImage('v')}
                            className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            ⇅ Flip V
                        </button>
                    </div>

                    <div className="flex gap-1 border-r border-gray-600 pr-2">
                        <select
                            onChange={(e) => presetWindowLevel(e.target.value)}
                            className="px-2 py-1 bg-gray-700 text-white rounded text-sm"
                            defaultValue=""
                        >
                            <option value="">Presets W/L</option>
                            <option value="soft-tissue">Tejido Blando</option>
                            <option value="lung">Pulmón</option>
                            <option value="bone">Hueso</option>
                            <option value="brain">Cerebro</option>
                            <option value="liver">Hígado</option>
                            <option value="abdomen">Abdomen</option>
                        </select>
                    </div>

                    <button
                        onClick={clearMeasurements}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                        🗑️ Limpiar Mediciones
                    </button>

                    {iaResultado?.regiones?.length > 0 && (
                        <button
                            onClick={() => setShowIA((v) => !v)}
                            className={`px-3 py-1 rounded text-sm ${showIA
                                ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-400'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            title="Mostrar u ocultar las zonas sugeridas por la IA"
                        >
                            {showIA ? '🟨 Ocultar zonas IA' : '⬜ Mostrar zonas IA'}
                        </button>
                    )}

                    {viewport && (
                        <div className="ml-auto text-xs text-gray-300 flex items-center gap-3">
                            <span>W/L: {Math.round(viewport.voi.windowCenter)}/{Math.round(viewport.voi.windowWidth)}</span>
                            <span>Zoom: {(viewport.scale * 100).toFixed(0)}%</span>
                            <span>Rot: {viewport.rotation}°</span>
                        </div>
                    )}
                </div>
            )}

            {/* Viewer - Layout Flexible */}
            <div className="flex-1 flex flex-row overflow-hidden relative">
                {/* Contenedor del Visor - Ocupa todo el espacio flexible */}
                <div className="flex-1 relative bg-black">
                    <div
                        ref={imageElementRef}
                        className="w-full h-full"
                        style={{
                            cursor: activeTool === 'Pan' ? 'grab' : 'crosshair'
                        }}
                    >
                    </div>

                    {/* Indicadores superpuestos sobre el canvas */}
                    {dicomFile && !loading && !error && (
                        <div className="absolute top-4 left-4 flex flex-col gap-2">
                            <div className="bg-black bg-opacity-60 text-white px-3 py-1 rounded-md text-xs border border-gray-700 backdrop-blur-sm">
                                Herramienta: <span className="text-blue-400 font-bold">{toolButtons.find(t => t.name === activeTool)?.label}</span>
                            </div>
                            {viewport && (
                                <div className="bg-black bg-opacity-60 text-white px-3 py-1 rounded-md text-[10px] border border-gray-700 backdrop-blur-sm space-y-0.5">
                                    <p>Zoom: {(viewport.scale * 100).toFixed(0)}%</p>
                                    <p>W/L: {Math.round(viewport.voi.windowCenter)} / {Math.round(viewport.voi.windowWidth)}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Panel de información lateral - Estructuralmente persistente */}
                <div className="w-72 md:w-80 lg:w-96 bg-gray-900 text-white p-5 overflow-y-auto flex-shrink-0 border-l border-gray-700 shadow-2xl z-20">
                    {/* Mensaje de espera si no hay archivo aún */}
                    {!dicomFile && !paciente && (
                        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                            <p className="text-sm">Esperando datos del estudio...</p>
                        </div>
                    )}
                    {/* --- SECCIÓN DE INFORMACIÓN DEL PACIENTE (DESDE LA BD) --- */}
                    {paciente ? (
                        <>
                            <h2 className="text-lg font-bold mb-3 border-b border-gray-700 pb-2">
                                Información del Paciente
                            </h2>
                            <div className="space-y-2 text-sm mb-4">
                                <p><strong>Nombre:</strong> {`${paciente.nombre} ${paciente.apellidoP}`}</p>
                                <p><strong>NSS:</strong> {paciente.nss}</p>
                                <p><strong>Edad:</strong> {paciente.edad} años</p>
                                <p><strong>IMC:</strong> {paciente.imc}</p>
                                <p><strong>Diabetes:</strong> {paciente.diabetes ? 'Sí' : 'No'}</p>
                                <p><strong>Hipertensión:</strong> {paciente.hipertension ? 'Sí' : 'No'}</p>
                                <Link to={`/app/alta-paciente/${paciente.nss}`} className="text-blue-400 hover:underline text-xs">
                                    Ver expediente completo &rarr;
                                </Link>
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-yellow-400">Cargando información del paciente...</p>
                    )}

                    {/* --- SECCIÓN DE DETALLES TÉCNICOS (DEL ARCHIVO DICOM) --- */}
                    {dicomInfo && (
                        <>
                            <h2 className="text-lg font-bold mb-3 border-b border-gray-700 pb-2">
                                Detalles del Estudio
                            </h2>
                            <div className="space-y-3 text-sm">
                                <div>
                                    <p className="text-gray-400 text-xs uppercase">Archivo</p>
                                    <p className="font-semibold truncate text-sm" title={dicomInfo.fileName}>
                                        {dicomInfo.fileName}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                        {(dicomInfo.fileSize / 1024).toFixed(2)} KB
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase">Fecha de Estudio</p>
                                    <p className="font-semibold text-sm">{dicomInfo.studyDate}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs uppercase">Modalidad</p>
                                    <p className="font-semibold text-blue-400 text-sm">{dicomInfo.modality}</p>
                                </div>
                                {dicomInfo.manufacturer !== 'N/A' && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase">Fabricante</p>
                                        <p className="text-xs">{dicomInfo.manufacturer}</p>
                                    </div>
                                )}
                                <hr className="border-gray-700 my-2" />
                                <div>
                                    <p className="text-gray-400 text-xs uppercase">Dimensiones</p>
                                    <p className="font-semibold text-sm">{dicomInfo.width} × {dicomInfo.height}</p>
                                </div>
                                {dicomInfo.pixelSpacing !== 'N/A' && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase">Espaciado de Píxeles</p>
                                        <p className="text-xs">{dicomInfo.pixelSpacing}</p>
                                    </div>
                                )}
                                {dicomInfo.sliceThickness !== 'N/A' && (
                                    <div>
                                        <p className="text-gray-400 text-xs uppercase">Grosor de Corte</p>
                                        <p className="text-xs">{dicomInfo.sliceThickness} mm</p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* --- SECCIÓN DEL ASISTENTE IA --- */}
                    {iaResultado && (
                        <>
                            <hr className="border-gray-700 my-3" />
                            <h2 className="text-lg font-bold mb-2 border-b border-gray-700 pb-2">
                                Asistente IA
                            </h2>
                            <div className="space-y-1 text-sm">
                                <p><strong>Predicción:</strong> {iaResultado.prediction}</p>
                                <p><strong>Confianza de fractura:</strong> {iaResultado.confidence_fracture}%</p>
                                <p><strong>Zonas sugeridas:</strong> {iaResultado.regiones?.length || 0}</p>
                                <p className="text-xs text-gray-400">Modelo {iaResultado.modelo}</p>
                                <p className="text-xs text-yellow-300 mt-2">
                                    Los recuadros indican dónde mirar; no confirman una fractura, y su ausencia no la descarta.
                                </p>
                            </div>
                        </>
                    )}

                    {/* --- SECCIÓN DEL VIEWPORT (SE MANTIENE IGUAL) --- */}
                    {viewport && (
                        <>
                            <hr className="border-gray-700 my-3" />
                            <div>
                                <p className="text-gray-400 text-xs uppercase">Viewport Actual</p>
                                <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                                    <div><span className="text-gray-400">Center:</span><span className="ml-1 font-mono">{Math.round(viewport.voi.windowCenter)}</span></div>
                                    <div><span className="text-gray-400">Width:</span><span className="ml-1 font-mono">{Math.round(viewport.voi.windowWidth)}</span></div>
                                    <div><span className="text-gray-400">Zoom:</span><span className="ml-1 font-mono">{(viewport.scale * 100).toFixed(0)}%</span></div>
                                    <div><span className="text-gray-400">Rotación:</span><span className="ml-1 font-mono">{viewport.rotation}°</span></div>
                                    <div className="col-span-2"><span className="text-gray-400">Invertido:</span><span className="ml-1">{viewport.invert ? '✓ Sí' : '✗ No'}</span></div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Estado inicial - superpuesto sobre el viewer */}
            {!dicomFile && !loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-30">
                    <div className="text-center text-gray-400">
                        <div className="text-4xl mb-4">🖼️</div>
                        <h2 className="text-xl font-bold text-white">Visor de Estudios</h2>
                        <p>La imagen del estudio se cargará en este espacio.</p>
                    </div>
                </div>
            )}

            {/* Loading - superpuesto sobre el viewer */}
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 z-40">
                    <div className="text-center text-white">
                        <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                        <p className="text-lg">Cargando imagen DICOM...</p>
                    </div>
                </div>
            )}

            {/* Error - superpuesto sobre el viewer */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center p-4 bg-gray-900 bg-opacity-90 z-40">
                    <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded max-w-lg text-center">
                        <p className="font-bold mb-2">Error al cargar el archivo</p>
                        <p>{error}</p>
                        <button
                            onClick={() => {
                                setError(null);
                                setDicomFile(null);
                            }}
                            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
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