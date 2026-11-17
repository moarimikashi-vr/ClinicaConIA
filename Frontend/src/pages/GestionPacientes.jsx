import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import apiClient from '../api/axiosConfig';
import useDebounce from '../hooks/useDebounce';
import {
    cardClass,
    dangerButton,
    inputClass,
    labelClass,
    pageTitleClass,
    primaryButton,
    secondaryButton,
} from '../components/ui/formStyles';

const ConfirmationModal = ({ paciente, onConfirm, onCancel, isDeleting }) => {
    const [confirmNSS, setConfirmNSS] = useState('');
    const isMatch = confirmNSS.trim() === String(paciente.nss);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eliminar-paciente-titulo"
        >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                <h2 id="eliminar-paciente-titulo" className="text-lg font-semibold text-slate-900">
                    ¿Eliminar a {paciente.nombre} {paciente.apellidoP}?
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                    Se borrarán sus datos, sus casos clínicos y todas las imágenes asociadas. Esta acción no se puede deshacer.
                </p>
                <div className="mt-4">
                    <label htmlFor="confirmNSS" className={labelClass}>
                        Escribe el NSS <span className="font-mono">{paciente.nss}</span> para confirmar
                    </label>
                    <input
                        id="confirmNSS"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus
                        value={confirmNSS}
                        onChange={(e) => setConfirmNSS(e.target.value)}
                        className={inputClass(false)}
                    />
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onCancel} disabled={isDeleting} className={secondaryButton}>
                        Cancelar
                    </button>
                    <button onClick={onConfirm} disabled={!isMatch || isDeleting} className={dangerButton}>
                        {isDeleting ? 'Eliminando…' : 'Eliminar paciente'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const GestionPacientes = () => {
    const [pacientes, setPacientes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [pacienteToDelete, setPacienteToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const fetchPacientes = async (searchQuery = '') => {
        setLoading(true);
        try {
            const response = await apiClient.get('/pacientes/search', { params: { q: searchQuery } });
            setPacientes(response.data);
            setError('');
        } catch {
            setError('No se pudieron cargar los pacientes. Revisa tu conexión e inténtalo de nuevo.');
            setPacientes([]); // En caso de error, vaciamos la lista para evitar mostrar datos viejos
        } finally {
            setLoading(false);
        }
    };

    // Se ejecuta en la carga inicial y cada vez que cambia la búsqueda (con debounce)
    useEffect(() => {
        fetchPacientes(debouncedSearchTerm);
    }, [debouncedSearchTerm]);

    const handleDelete = async () => {
        if (!pacienteToDelete) return;
        setIsDeleting(true);
        try {
            await apiClient.delete(`/pacientes/${pacienteToDelete.nss}`);
            toast.success(`Paciente eliminado: ${pacienteToDelete.nombre} ${pacienteToDelete.apellidoP}`);
            setPacienteToDelete(null);
            fetchPacientes(searchTerm); // Recargar la lista manteniendo el filtro actual
        } catch (err) {
            console.error(err);
            toast.error(err.response?.data?.message || 'No se pudo eliminar al paciente.');
            setPacienteToDelete(null);
        } finally {
            setIsDeleting(false);
        }
    };

    const thClass = 'px-5 py-3 text-left text-xs font-medium text-slate-500';

    return (
        <div className="mx-auto w-full max-w-6xl px-2 py-4 sm:px-4">
            {pacienteToDelete && (
                <ConfirmationModal
                    paciente={pacienteToDelete}
                    onConfirm={handleDelete}
                    onCancel={() => setPacienteToDelete(null)}
                    isDeleting={isDeleting}
                />
            )}

            <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className={pageTitleClass}>Pacientes</h1>
                    <p className="mt-1 text-sm text-slate-600">Busca, edita o registra pacientes.</p>
                </div>
                <Link to="/app/alta-paciente" className={primaryButton}>
                    <PlusIcon className="h-4 w-4" />
                    Registrar paciente
                </Link>
            </header>

            {/* La búsqueda permanece montada mientras carga para no perder el foco */}
            <div className="relative mb-4">
                <label htmlFor="buscar-paciente" className="sr-only">Buscar pacientes</label>
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 mt-0.5 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                    id="buscar-paciente"
                    type="search"
                    placeholder="Buscar por nombre, apellido o NSS"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={`${inputClass(false)} pl-10`}
                />
            </div>

            <div className={`${cardClass} overflow-hidden`}>
                {error ? (
                    <p className="px-5 py-8 text-center text-sm text-red-700">{error}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200" aria-busy={loading}>
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className={thClass}>Nombre</th>
                                    <th scope="col" className={thClass}>NSS</th>
                                    <th scope="col" className={thClass}>Edad</th>
                                    <th scope="col" className={`${thClass} text-right`}><span className="sr-only">Acciones</span></th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y divide-slate-100 transition-opacity duration-150 ${loading ? 'opacity-50' : ''}`}>
                                {pacientes.map((paciente) => (
                                    <tr key={paciente.nss} className="hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-5 py-3 text-sm font-medium text-slate-900">
                                            {paciente.nombre} {paciente.apellidoP} {paciente.apellidoM}
                                        </td>
                                        <td className="whitespace-nowrap px-5 py-3 font-mono text-sm tabular-nums text-slate-600">{paciente.nss}</td>
                                        <td className="whitespace-nowrap px-5 py-3 text-sm tabular-nums text-slate-600">{paciente.edad}</td>
                                        <td className="whitespace-nowrap px-5 py-3 text-right text-sm font-medium">
                                            <Link
                                                to={`/app/alta-paciente/${paciente.nss}`}
                                                className="rounded-md px-2 py-1 text-blue-900 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/40"
                                            >
                                                Editar
                                            </Link>
                                            <button
                                                onClick={() => setPacienteToDelete(paciente)}
                                                className="ml-1 rounded-md px-2 py-1 text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
                                            >
                                                Eliminar
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!loading && pacientes.length === 0 && (
                            <div className="px-5 py-10 text-center">
                                <p className="text-sm font-medium text-slate-900">
                                    {searchTerm ? `Ningún paciente coincide con “${searchTerm}”.` : 'Todavía no hay pacientes registrados.'}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                    {searchTerm ? 'Revisa el nombre o el NSS.' : 'Registra el primero para poder enviar sus estudios.'}
                                </p>
                            </div>
                        )}
                        {loading && pacientes.length === 0 && (
                            <p className="px-5 py-10 text-center text-sm text-slate-500">Cargando pacientes…</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default GestionPacientes;
