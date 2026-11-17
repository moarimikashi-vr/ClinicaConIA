import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
    ArrowDownTrayIcon,
    DocumentIcon,
    LockClosedIcon,
    PencilSquareIcon,
    SparklesIcon,
    ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import apiClient from '../api/axiosConfig';
import { db } from '../firebaseConfig'; // Importamos la instancia de la DB
import { doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore';
import { usePersistentToggle } from '../hooks/usePersistentToggle';
import {
    cardClass,
    cardTitleClass,
    dangerButton,
    inputClass,
    pageTitleClass,
    primaryButton,
    secondaryButton,
} from '../components/ui/formStyles';

// fechaCreacion llega como cadena ISO (backend) o como Timestamp de Firestore
const formatFecha = (fecha) => {
    if (!fecha) return '';
    const date = typeof fecha === 'string' ? new Date(fecha) : fecha.seconds ? new Date(fecha.seconds * 1000) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};

const ROL_LABELS = {
    medico: 'Médico especialista',
    atencion: 'Personal de atención',
    administrador: 'Administrador',
    sistema: 'Sistema',
};

const InfoRow = ({ label, children }) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
        <dt className="text-slate-500">{label}</dt>
        <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
);

const CasoDetalle = ({ loggedInUser }) => {
    const { id } = useParams(); // Obtiene el ID del caso desde la URL
    const [caso, setCaso] = useState(null);
    const [paciente, setPaciente] = useState(null); // Nuevo estado para los detalles del paciente
    const [comentarios, setComentarios] = useState([]);
    const [nuevoComentario, setNuevoComentario] = useState('');
    const [diagnostico, setDiagnostico] = useState('');
    const [isSavingDiagnosis, setIsSavingDiagnosis] = useState(false);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [error, setError] = useState('');
    const [isEditingDiagnosis, setIsEditingDiagnosis] = useState(false);
    const [showDetails, toggleDetails] = usePersistentToggle('ui.caseDetailsPanel', true);

    useEffect(() => {
        if (!id) return;

        setLoading(true);

        // --- Listener para el documento del CASO ---
        const unsubCaso = onSnapshot(doc(db, 'casos', id), async (docSnap) => {
            if (docSnap.exists()) {
                const casoData = { id: docSnap.id, ...docSnap.data() };
                setCaso(casoData);
                if (casoData.diagnostico) setDiagnostico(casoData.diagnostico);

                // Una vez que tenemos el caso, obtenemos los detalles del paciente
                if (casoData.pacienteNSS) {
                    // Para el paciente no necesitamos un listener, una sola petición es suficiente.
                    const pacienteRes = await apiClient.get(`/pacientes/${casoData.pacienteNSS}`);
                    setPaciente(pacienteRes.data);
                }
                setError('');
            } else {
                setError('El caso no fue encontrado.');
            }
            setLoading(false);
        }, (err) => {
            setError('No se pudo cargar la información del caso.');
            console.error(err);
            setLoading(false);
        });

        // --- Listener para la subcolección de COMENTARIOS ---
        const q = query(collection(db, 'casos', id, 'comentarios'), orderBy('fechaCreacion', 'asc'));
        const unsubComentarios = onSnapshot(q, (querySnapshot) => {
            const comentariosData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setComentarios(comentariosData);
        }, (err) => {
            console.error("Error al obtener comentarios en tiempo real:", err);
        });

        // --- Función de limpieza ---
        // Se ejecuta cuando el componente se desmonta para detener los listeners
        return () => {
            unsubCaso();
            unsubComentarios();
        };
    }, [id]);

    const handleAddComentario = async (e) => {
        e.preventDefault();
        if (!nuevoComentario.trim()) return;

        try {
            await apiClient.post(`/casos/${id}/comentarios`, {
                texto: nuevoComentario,
                autorId: loggedInUser.uid,
                autorNombre: `${loggedInUser.nombre} ${loggedInUser.apellido}`,
                autorRol: loggedInUser.rol,
            });
            // El listener onSnapshot agrega el comentario a la lista
            setNuevoComentario('');
        } catch (error) {
            console.error("Error al añadir comentario:", error);
            toast.error('No se pudo enviar el comentario. Inténtalo de nuevo.');
        }
    };

    const handleSaveDiagnosis = async () => {
        setIsSavingDiagnosis(true);
        try {
            await apiClient.patch(`/casos/${id}`, { diagnostico });
            toast.success('Diagnóstico guardado.');
            setIsEditingDiagnosis(false);
        } catch (error) {
            console.error('Error al guardar diagnóstico:', error);
            toast.error('No se pudo guardar el diagnóstico.');
        } finally {
            setIsSavingDiagnosis(false);
        }
    };

    const handleGenerateReport = async () => {
        setIsGeneratingReport(true);
        try {
            // Primero guardamos el diagnóstico actual para asegurar que salga en el PDF
            await apiClient.patch(`/casos/${id}`, { diagnostico });

            const response = await apiClient.post(`/reports/${id}/generate`, {}, {
                responseType: 'blob' // Importante para descargar archivos
            });

            // Crear URL del blob y descargar
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Reporte_${caso.pacienteNSS}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (error) {
            console.error('Error al generar el reporte:', error);
            toast.error('No se pudo generar el reporte PDF.');
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const handleCerrarCaso = async () => {
        setShowConfirmModal(false); // Cerramos el modal
        try {
            await apiClient.patch(`/casos/${id}/cerrar`);
            // El listener onSnapshot se encargará de actualizar el estado del caso.
            toast.success('Caso cerrado.');
        } catch (error) {
            console.error("Error al cerrar el caso:", error);
            toast.error('No se pudo cerrar el caso.');
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-slate-500">Cargando detalles del caso…</div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-700">{error}</div>;
    }

    if (!caso) {
        return <div className="p-8 text-center text-slate-500">Caso no encontrado.</div>;
    }

    const isCasoAbierto = caso.estado === 'abierto';
    const puedeCerrarCaso = loggedInUser && loggedInUser.rol === 'medico' && loggedInUser.uid === caso.medicoEspecialistaId;
    const esMedicoAsignado = loggedInUser && loggedInUser.uid === caso.medicoEspecialistaId;
    const textareaClass = `${inputClass(false)} resize-none`;

    return (
        <div className="mx-auto w-full max-w-7xl px-2 py-4 sm:px-4">
            {/* Modal de Confirmación */}
            {showConfirmModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cerrar-caso-titulo"
                >
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
                        <h2 id="cerrar-caso-titulo" className="text-lg font-semibold text-slate-900">¿Cerrar este caso?</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            Ya no se podrán agregar comentarios ni cambiar el diagnóstico. Esta acción no se puede deshacer.
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button onClick={() => setShowConfirmModal(false)} className={secondaryButton} autoFocus>
                                Cancelar
                            </button>
                            <button onClick={handleCerrarCaso} className={dangerButton}>
                                Cerrar caso
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Encabezado */}
            <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-3">
                        <h1 className={pageTitleClass}>{caso.pacienteNombreCompleto}</h1>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isCasoAbierto ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                            {isCasoAbierto ? 'Abierto' : 'Cerrado'}
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                        Caso clínico · NSS {caso.pacienteNSS}
                        {caso.fechaCreacion && <> · Creado el {formatFecha(caso.fechaCreacion)}</>}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={toggleDetails}
                        aria-pressed={showDetails}
                        aria-controls="caso-detalles"
                        className={`${secondaryButton} hidden lg:inline-flex`}
                    >
                        <ViewColumnsIcon className="h-4 w-4" />
                        {showDetails ? 'Ocultar detalles' : 'Mostrar detalles'}
                    </button>
                    <button onClick={handleGenerateReport} disabled={isGeneratingReport} className={secondaryButton}>
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        {isGeneratingReport ? 'Generando…' : 'Descargar reporte PDF'}
                    </button>
                    {isCasoAbierto && puedeCerrarCaso && (
                        <button onClick={() => setShowConfirmModal(true)} className={dangerButton}>
                            <LockClosedIcon className="h-4 w-4" />
                            Cerrar caso
                        </button>
                    )}
                </div>
            </header>

            <div className={`grid grid-cols-1 gap-6 ${showDetails ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
                {/* Columna principal: estudios, diagnóstico y conversación */}
                <div className="min-w-0 space-y-6">
                    <section className={`${cardClass} p-5`}>
                        <h2 className={cardTitleClass}>Estudios</h2>
                        {caso.archivos && caso.archivos.length > 0 ? (
                            <ul className="mt-3 divide-y divide-slate-100">
                                {caso.archivos.map((archivo, index) => (
                                    <li key={index}>
                                        <Link
                                            to={`/app/viewer?url=${encodeURIComponent(archivo.url)}&nss=${caso.pacienteNSS}&caso=${caso.id}&archivo=${encodeURIComponent(archivo.uploadPath || archivo.nombre)}`}
                                            className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/40"
                                        >
                                            <DocumentIcon className="h-5 w-5 flex-shrink-0 text-slate-400" />
                                            <span className="min-w-0 flex-1 truncate">{archivo.nombre}</span>
                                            <span className="text-xs font-medium text-blue-900">Abrir en el visor</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-3 text-sm text-slate-500">Este caso no tiene estudios adjuntos.</p>
                        )}
                    </section>

                    <section className={`${cardClass} p-5`}>
                        <div className="flex items-center justify-between gap-3">
                            <h2 className={cardTitleClass}>Diagnóstico final</h2>
                            {isCasoAbierto && esMedicoAsignado && !isEditingDiagnosis && (
                                <button
                                    onClick={() => setIsEditingDiagnosis(true)}
                                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-blue-900 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/40"
                                >
                                    <PencilSquareIcon className="h-4 w-4" />
                                    {diagnostico ? 'Editar' : 'Escribir diagnóstico'}
                                </button>
                            )}
                        </div>
                        {isCasoAbierto && esMedicoAsignado && isEditingDiagnosis ? (
                            <div className="mt-3 space-y-3">
                                <label htmlFor="diagnostico" className="sr-only">Diagnóstico final</label>
                                <textarea
                                    id="diagnostico"
                                    className={textareaClass}
                                    rows="6"
                                    placeholder="Hallazgos, impresión diagnóstica y recomendaciones."
                                    value={diagnostico}
                                    onChange={(e) => setDiagnostico(e.target.value)}
                                ></textarea>
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => {
                                            setIsEditingDiagnosis(false);
                                            setDiagnostico(caso.diagnostico || '');
                                        }}
                                        className={secondaryButton}
                                    >
                                        Cancelar
                                    </button>
                                    <button onClick={handleSaveDiagnosis} disabled={isSavingDiagnosis} className={primaryButton}>
                                        {isSavingDiagnosis ? 'Guardando…' : 'Guardar diagnóstico'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className={`mt-3 whitespace-pre-wrap text-sm ${diagnostico ? 'text-slate-800' : 'text-slate-500'}`}>
                                {diagnostico || 'El especialista todavía no emite el diagnóstico final.'}
                            </p>
                        )}
                    </section>

                    <section className={`${cardClass} p-5`}>
                        <h2 className={cardTitleClass}>Conversación</h2>
                        <ol className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                            {comentarios.length > 0 ? (
                                comentarios.map((com, index) => {
                                    const esIA = com.autorId === 'sistema_ia';
                                    const esPropio = com.autorId === loggedInUser.uid;
                                    return (
                                        <li
                                            key={com.id || index}
                                            className={`rounded-xl border p-3 ${esIA
                                                ? 'border-amber-200 bg-amber-50'
                                                : esPropio ? 'ml-8 border-blue-100 bg-blue-50' : 'mr-8 border-slate-200 bg-slate-50'
                                                }`}
                                        >
                                            <div className="mb-1 flex items-start justify-between gap-3">
                                                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                                    {esIA && <SparklesIcon className="h-4 w-4 text-amber-600" />}
                                                    {com.autorNombre}
                                                    <span className="font-normal text-slate-500">· {ROL_LABELS[com.autorRol] || com.autorRol}</span>
                                                </span>
                                                <time className="flex-shrink-0 text-[11px] text-slate-500">
                                                    {formatFecha(com.fechaCreacion) || 'Recién enviado'}
                                                </time>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-slate-800">{com.texto}</p>
                                        </li>
                                    );
                                })
                            ) : (
                                <li className="py-4 text-center text-sm text-slate-500">Todavía no hay comentarios en este caso.</li>
                            )}
                        </ol>

                        {isCasoAbierto && (
                            <form onSubmit={handleAddComentario} className="mt-4 space-y-2">
                                <label htmlFor="nuevo-comentario" className="sr-only">Nuevo comentario</label>
                                <textarea
                                    id="nuevo-comentario"
                                    className={textareaClass}
                                    rows="3"
                                    placeholder="Escribe un comentario o nota médica…"
                                    value={nuevoComentario}
                                    onChange={(e) => setNuevoComentario(e.target.value)}
                                ></textarea>
                                <div className="flex justify-end">
                                    <button type="submit" disabled={!nuevoComentario.trim()} className={primaryButton}>
                                        Enviar comentario
                                    </button>
                                </div>
                            </form>
                        )}
                    </section>
                </div>

                {/* Panel lateral ocultable: médicos y paciente */}
                <aside id="caso-detalles" className={`${showDetails ? '' : 'lg:hidden'} space-y-6`}>
                    <section className={`${cardClass} p-5`}>
                        <h2 className={cardTitleClass}>Médicos</h2>
                        <dl className="mt-2">
                            <InfoRow label="General">{caso.medicoGeneralNombre}</InfoRow>
                            <InfoRow label="Especialista">{caso.medicoEspecialistaNombre}</InfoRow>
                        </dl>
                    </section>

                    {paciente && (
                        <section className={`${cardClass} p-5`}>
                            <h2 className={cardTitleClass}>Paciente</h2>
                            <dl className="mt-2 divide-y divide-slate-100">
                                <InfoRow label="Edad">{paciente.edad || '—'} años</InfoRow>
                                <InfoRow label="Tipo de sangre">{paciente.tiposangre || '—'}</InfoRow>
                                <InfoRow label="Estatura">{paciente.estatura || '—'} m</InfoRow>
                                <InfoRow label="Peso">{paciente.peso || '—'} kg</InfoRow>
                                <InfoRow label="IMC">{paciente.imc || '—'}</InfoRow>
                                <InfoRow label="Diabetes">{paciente.diabetes ? 'Sí' : 'No'}</InfoRow>
                                <InfoRow label="Hipertensión">{paciente.hipertension ? 'Sí' : 'No'}</InfoRow>
                            </dl>
                            <div className="mt-3 border-t border-slate-100 pt-3">
                                <p className="text-xs font-medium text-slate-500">Antecedentes</p>
                                <p className="mt-1 text-sm text-slate-700">{paciente.antecedentes || 'Sin antecedentes registrados.'}</p>
                            </div>
                            <Link
                                to={`/app/alta-paciente/${paciente.nss}`}
                                className="mt-3 inline-block text-sm font-medium text-blue-900 hover:underline"
                            >
                                Ver expediente completo
                            </Link>
                        </section>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default CasoDetalle;
