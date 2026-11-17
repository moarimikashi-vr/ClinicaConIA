import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { ArrowUpTrayIcon, DocumentIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import apiClient from '../api/axiosConfig';
import {
    cardClass,
    cardTitleClass,
    inputClass,
    labelClass,
    pageTitleClass,
    primaryButton,
    secondaryButton,
} from '../components/ui/formStyles';
import { storage } from '../firebaseConfig';
import useDebounce from '../hooks/useDebounce.js';
import InfoRow from '../components/ui/InfoRow';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const initialEnvioState = {
    pacienteSeleccionado: null, // Estado unificado para el paciente
    motivoConsulta: '',
    archivosDICOM: [],
    medicoDestinoId: '',
    medicoDestinoNombre: '',
};



// Paso numerado: el envío es una secuencia real (paciente → motivo → estudios → especialista).
// Definido a nivel de módulo: si se declarara dentro del render, React lo remontaría en cada
// render y los campos de su interior perderían el foco.
// `showHint` solo muestra el aviso; cada control del paso se deshabilita por su cuenta.
const Step = ({ number, title, children, disabledHint, showHint }) => (
    <section className={`${cardClass} p-6`}>
        <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-900 text-xs font-semibold text-white">
                {number}
            </span>
            <h2 className={cardTitleClass}>{title}</h2>
        </div>
        {disabledHint && showHint && <p className="mt-2 text-sm text-slate-500">{disabledHint}</p>}
        <div className="mt-4">{children}</div>
    </section>
);

const EnvioArchivos = ({ loggedInUser }) => {
    const [envioData, setEnvioData] = useState({ ...initialEnvioState, nssBusqueda: '' });
    const [doctors, setDoctors] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isSearchFocused, setIsSearchFocused] = useState(false); // Nuevo estado para el foco
    const fileInputRef = useRef(null); // 1. Creamos una referencia para el input de archivos

    // Usamos el hook useDebounce para el término de búsqueda
    const debouncedSearchTerm = useDebounce(envioData.nssBusqueda, 300);

    useEffect(() => {
        const fetchDoctors = async () => {
            try {
                const response = await apiClient.get('/users/doctors');
                setDoctors(response.data);
            } catch {
                toast.error('No se pudo cargar la lista de especialistas.');
            }
        };
        fetchDoctors();
    }, []);

    // useEffect que reacciona al valor "debounced"
    useEffect(() => {
        // CORRECCIÓN: Simplificamos la lógica. Si no hay término de búsqueda, simplemente limpiamos los resultados.
        if (!debouncedSearchTerm) {
            setSearchResults([]);
            return;
        }

        const searchPaciente = async () => {
            setIsSearching(true);
            try {
                const response = await apiClient.get('/pacientes/search', { params: { q: debouncedSearchTerm } });
                setSearchResults(response.data);
            } catch (error) {
                console.error("Error en la búsqueda de pacientes:", error);
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        };

        searchPaciente();
    }, [debouncedSearchTerm]); // Se ejecuta solo cuando el valor "debounced" cambia

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'medicoDestinoId') {
            const selectedDoctor = doctors.find(doc => doc.id === value); // Encuentra el médico seleccionado
            setEnvioData(prev => ({
                ...prev,
                medicoDestinoId: value,
                medicoDestinoNombre: selectedDoctor ? `${selectedDoctor.nombre} ${selectedDoctor.apellido}` : '', // Guarda nombre y apellido
            }));
        } else if (name === 'nssBusqueda') {
            setEnvioData(prev => ({ ...prev, nssBusqueda: value, pacienteSeleccionado: null })); // Solo actualiza el estado, el useEffect hará la búsqueda
        } else {
            setEnvioData(prev => ({ ...prev, [name]: value }));
        }
    };

    // Al seleccionar un paciente de la lista, se cargan sus datos completos.
    const handleSelectPaciente = async (paciente) => {
        // CORRECCIÓN: Limpiamos el término de búsqueda para que el `useEffect` oculte la lista.
        // El NSS del paciente seleccionado ya se cargará con `handleSearchClick`.
        setEnvioData(prev => ({ ...prev, nssBusqueda: '' }));
        setSearchResults([]); // Oculta la lista de resultados
        await handleSearchClick(paciente.nss); // Llama a la función que busca y carga los datos
    };

    // El botón "Buscar" es el que carga los datos del paciente.
    const handleSearchClick = async (nssToSearch) => {
        const nss = nssToSearch || envioData.nssBusqueda;
        if (!nss) {
            toast.error('Escribe un NSS para buscar.');
            return;
        }

        try {
            const response = await apiClient.get(`/pacientes/${nss}`);
            // CORRECCIÓN: Al cargar el paciente, también actualizamos el input `nssBusqueda` para que muestre el NSS completo.
            setEnvioData(prev => ({ ...prev, pacienteSeleccionado: response.data, nssBusqueda: response.data.nss }));
        } catch {
            setEnvioData(prev => ({ ...prev, pacienteSeleccionado: null }));
            toast.error(`No existe un paciente con NSS ${nss}.`);
        }
    };

    const handleSearchBlur = () => {
        // Añadimos un pequeño retardo para permitir que el evento de clic en un resultado se registre
        // antes de que la lista de resultados desaparezca.
        setTimeout(() => {
            setIsSearchFocused(false);
        }, 200);
    };

    const handleFileChange = (e) => {
        const files = e.target.files;

        const filesArray = Array.from(files).map(file => ({
            fileObject: file,
            name: file.name,
            size: file.size,
            type: file.type,
            // Solo crear URL de previsualización para imágenes no-DICOM
            url: file.name.toLowerCase().endsWith('.dcm') ? null : URL.createObjectURL(file)
        }));

        setEnvioData(prev => ({
            ...prev,
            archivosDICOM: filesArray
        }));

    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!envioData.pacienteSeleccionado || !envioData.medicoDestinoId || !envioData.motivoConsulta) {
            toast.error('Completa el paciente, el motivo de consulta y el especialista.');
            return;
        }

        if (envioData.archivosDICOM.length === 0) {
            toast.error('Agrega al menos un estudio.');
            return;
        }

        setIsUploading(true);
        const toastId = toast.loading('Subiendo estudios…');

        try {
            // Subir archivos a Firebase Storage
            // Nombres con caracteres seguros: el backend y el servicio de IA solo aceptan [A-Za-z0-9._-]
            const safeName = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
            const totalArchivos = envioData.archivosDICOM.length;

            const uploadPromises = envioData.archivosDICOM.map(async (fileWrapper, index) => {
                const file = fileWrapper.fileObject;

                const originalExtension = safeName(file.name.slice(file.name.lastIndexOf('.')).toLowerCase());
                const patientName = safeName(`${envioData.pacienteSeleccionado.nombre} ${envioData.pacienteSeleccionado.apellidoP}`);
                const uploadDate = new Date().toISOString().slice(0, 10).split('-').reverse().join('-');
                // Con varios archivos, un sufijo evita que se sobrescriban entre sí en Storage
                const suffix = totalArchivos > 1 ? `-${index + 1}` : '';
                const newFileName = `${patientName}-${safeName(String(envioData.pacienteSeleccionado.nss))}-${uploadDate}${suffix}${originalExtension}`;

                const filePath = `casos/${loggedInUser.uid}/${String(envioData.pacienteSeleccionado.nss).trim()}/${newFileName}`;
                const fileRef = ref(storage, filePath);

                const metadata = {
                    contentType: file.type || 'application/octet-stream',
                    customMetadata: {
                        originalName: file.name,
                        uploadedBy: loggedInUser.uid,
                        pacienteNSS: envioData.pacienteSeleccionado.nss
                    }
                };

                await uploadBytes(fileRef, file, metadata);
                const downloadURL = await getDownloadURL(fileRef);

                return {
                    nombre: newFileName,
                    url: downloadURL,
                    size: file.size,
                    type: file.type || 'application/octet-stream',
                    uploadPath: filePath
                };
            });

            const archivosParaGuardar = await Promise.all(uploadPromises);

            toast.loading('Creando el caso…', { id: toastId });

            const nuevoCaso = {
                pacienteNSS: envioData.pacienteSeleccionado.nss,
                pacienteNombreCompleto: `${envioData.pacienteSeleccionado.nombre} ${envioData.pacienteSeleccionado.apellidoP}`,
                motivoConsulta: envioData.motivoConsulta,
                archivos: archivosParaGuardar,
                medicoEspecialistaId: envioData.medicoDestinoId,
                medicoEspecialistaNombre: envioData.medicoDestinoNombre,
                medicoGeneralId: loggedInUser.uid,
                medicoGeneralNombre: `${loggedInUser.nombre} ${loggedInUser.apellido}`,
            };

            await apiClient.post('/casos', nuevoCaso);

            envioData.archivosDICOM.forEach(file => {
                if (file.url) {
                    URL.revokeObjectURL(file.url);
                }
            });

            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }

            setEnvioData({ ...initialEnvioState, nssBusqueda: '' });
            setIsUploading(false);
            toast.success(`Caso enviado a ${nuevoCaso.medicoEspecialistaNombre}.`, { id: toastId });
        } catch (error) {
            setIsUploading(false);
            console.error('Error completo:', error);
            toast.error(`No se pudo enviar el caso: ${error.response?.data?.message || error.message}`, { id: toastId });
        }
    };

    const paciente = envioData.pacienteSeleccionado;
    const totalMB = (envioData.archivosDICOM.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2);

    return (
        <div className="mx-auto w-full max-w-6xl px-2 py-4 sm:px-4">
            <header className="mb-6">
                <h1 className={pageTitleClass}>Enviar estudios</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Crea un caso clínico con los estudios del paciente y asígnalo a un especialista.
                </p>
            </header>

            <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6">
                    <Step number="1" title="Paciente">
                        <label htmlFor="nssBusqueda" className={labelClass}>NSS o nombre del paciente</label>
                        <div className="flex items-start gap-2">
                            <div className="relative flex-grow">
                                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 mt-0.5 h-5 w-5 -translate-y-1/2 text-slate-400" />
                                <input
                                    id="nssBusqueda"
                                    type="text"
                                    name="nssBusqueda"
                                    value={envioData.nssBusqueda}
                                    onChange={handleChange}
                                    onFocus={() => setIsSearchFocused(true)}
                                    onBlur={handleSearchBlur}
                                    className={`${inputClass(false)} pl-10`}
                                    autoComplete="off"
                                    role="combobox"
                                    aria-expanded={isSearchFocused && debouncedSearchTerm.length > 0}
                                    aria-controls="resultados-paciente"
                                />

                                {/* Resultados: solo con foco y texto */}
                                {isSearchFocused && debouncedSearchTerm.length > 0 && (
                                    <ul
                                        id="resultados-paciente"
                                        className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                                        role="listbox"
                                    >
                                        {isSearching ? (
                                            <li className="px-4 py-3 text-sm text-slate-500">Buscando…</li>
                                        ) : searchResults.length === 0 ? (
                                            <li className="px-4 py-3 text-sm text-slate-500">Ningún paciente coincide.</li>
                                        ) : (
                                            searchResults.map(p => (
                                                <li
                                                    key={p.id || p.nss}
                                                    onClick={() => handleSelectPaciente(p)}
                                                    className="cursor-pointer px-4 py-2.5 hover:bg-slate-50"
                                                    role="option"
                                                    aria-selected="false"
                                                >
                                                    <p className="text-sm font-medium text-slate-900">{p.nombre} {p.apellidoP}</p>
                                                    <p className="font-mono text-xs tabular-nums text-slate-500">NSS {p.nss}</p>
                                                </li>
                                            )))}
                                    </ul>
                                )}
                            </div>
                            <button type="button" onClick={() => handleSearchClick()} className={`${secondaryButton} mt-1`}>
                                Buscar
                            </button>
                        </div>
                        {paciente && (
                            <p className="mt-2 text-sm text-emerald-800">
                                Paciente seleccionado: <strong>{paciente.nombre} {paciente.apellidoP}</strong>
                            </p>
                        )}
                    </Step>

                    <Step showHint={!paciente} number="2" title="Motivo de la consulta" disabledHint="Selecciona primero al paciente.">
                        <label htmlFor="motivoConsulta" className="sr-only">Motivo de la consulta</label>
                        <textarea
                            id="motivoConsulta"
                            name="motivoConsulta"
                            placeholder="Ej.: dolor en la pierna derecha tras una caída hace dos días."
                            value={envioData.motivoConsulta}
                            onChange={handleChange}
                            disabled={!paciente}
                            rows="4"
                            className={`${inputClass(false)} resize-y`}
                        />
                    </Step>

                    <Step showHint={!paciente} number="3" title="Estudios" disabledHint="Selecciona primero al paciente.">
                        <label
                            htmlFor="archivosDICOM"
                            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-blue-900/20 ${paciente
                                ? 'cursor-pointer border-slate-300 hover:border-blue-900 hover:bg-blue-50/40'
                                : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                                }`}
                        >
                            <ArrowUpTrayIcon className="h-7 w-7 text-slate-400" />
                            <span className="text-sm font-medium text-slate-900">Elige los archivos del estudio</span>
                            <span className="text-xs text-slate-500">DICOM (.dcm), JPG o PNG. Puedes elegir varios.</span>
                            <input
                                id="archivosDICOM"
                                ref={fileInputRef}
                                type="file"
                                name="archivosDICOM"
                                onChange={handleFileChange}
                                multiple
                                accept=".dcm,image/*"
                                disabled={!paciente}
                                className="sr-only"
                            />
                        </label>

                        {envioData.archivosDICOM.length > 0 && (
                            <>
                                <p className="mt-4 text-sm text-slate-600">
                                    {envioData.archivosDICOM.length} {envioData.archivosDICOM.length === 1 ? 'archivo' : 'archivos'} · {totalMB} MB
                                </p>
                                <ul className="mt-2 flex gap-3 overflow-x-auto pb-2">
                                    {envioData.archivosDICOM.slice(0, 6).map((file, index) => (
                                        <li key={index} className="w-24 flex-shrink-0">
                                            {file.url ? (
                                                <img
                                                    src={file.url}
                                                    alt={`Vista previa de ${file.name}`}
                                                    className="h-24 w-24 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-black/10"
                                                    onLoad={() => URL.revokeObjectURL(file.url)}
                                                />
                                            ) : (
                                                <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                                                    <DocumentIcon className="h-7 w-7" />
                                                    <span className="text-xs font-medium">DICOM</span>
                                                </div>
                                            )}
                                            <p className="mt-1 truncate text-center text-xs text-slate-600" title={file.name}>{file.name}</p>
                                        </li>
                                    ))}
                                    {envioData.archivosDICOM.length > 6 && (
                                        <li className="flex items-center text-sm font-medium text-slate-600">
                                            +{envioData.archivosDICOM.length - 6} más
                                        </li>
                                    )}
                                </ul>
                            </>
                        )}
                    </Step>

                    <Step showHint={!paciente} number="4" title="Especialista" disabledHint="Selecciona primero al paciente.">
                        <label htmlFor="medicoDestinoId" className="sr-only">Especialista que recibe el caso</label>
                        <select
                            id="medicoDestinoId"
                            name="medicoDestinoId"
                            value={envioData.medicoDestinoId}
                            onChange={handleChange}
                            disabled={!paciente}
                            className={inputClass(false)}
                        >
                            <option value="">Elige un especialista</option>
                            {doctors.map(doc => (
                                <option key={doc.id} value={doc.id}>
                                    Dr. {doc.nombre} {doc.apellido}
                                </option>
                            ))}
                        </select>
                    </Step>

                    <div className="flex justify-end">
                        <button type="submit" className={primaryButton} disabled={!paciente || isUploading}>
                            {isUploading && (
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                            )}
                            {isUploading ? 'Enviando…' : 'Enviar caso'}
                        </button>
                    </div>
                </div>

                {/* Resumen del paciente seleccionado */}
                <aside className="space-y-6 lg:sticky lg:top-0 lg:self-start">
                    {paciente ? (
                        <>
                            <section className={`${cardClass} p-5`}>
                                <h2 className={cardTitleClass}>{paciente.nombre} {paciente.apellidoP} {paciente.apellidoM}</h2>
                                <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">NSS {paciente.nss}</p>
                                <dl className="mt-3 divide-y divide-slate-100">
                                    <InfoRow label="Edad">{paciente.edad || '—'} años</InfoRow>
                                    <InfoRow label="Tipo de sangre">{paciente.tiposangre || '—'}</InfoRow>
                                    <InfoRow label="Estatura">{paciente.estatura || '—'} m</InfoRow>
                                    <InfoRow label="Peso">{paciente.peso || '—'} kg</InfoRow>
                                    <InfoRow label="Diabetes">{paciente.diabetes ? 'Sí' : 'No'}</InfoRow>
                                    <InfoRow label="Hipertensión">{paciente.hipertension ? 'Sí' : 'No'}</InfoRow>
                                </dl>
                            </section>
                            <section className={`${cardClass} space-y-3 p-5 text-sm`}>
                                <h2 className={cardTitleClass}>Historia clínica</h2>
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Antecedentes</p>
                                    <p className="text-slate-800">{paciente.antecedentes || 'Sin registro.'}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Síntomas</p>
                                    <p className="text-slate-800">{paciente.sintomascla || 'Sin registro.'}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-slate-500">Medicamentos</p>
                                    <p className="text-slate-800">{paciente.medicamentos || 'Sin registro.'}</p>
                                </div>
                            </section>
                        </>
                    ) : (
                        <div className={`${cardClass} p-5 text-sm text-slate-500`}>
                            Busca al paciente por NSS o nombre para ver aquí su información.
                        </div>
                    )}
                </aside>
            </form>
        </div>
    );
};

export default EnvioArchivos;
