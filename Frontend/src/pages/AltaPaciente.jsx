// src/pages/AltaPaciente.jsx

import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import apiClient from '../api/axiosConfig';
import {
    cardClass,
    cardTitleClass,
    errorClass,
    inputClass,
    labelClass,
    pageTitleClass,
    primaryButton,
} from '../components/ui/formStyles';

// Estructura inicial del paciente
const initialPacienteState = {
    nombre: '',
    apellidoP: '',
    apellidoM: '',
    nss: '',
    tiposangre: '',
    estatura: 0.0,
    peso: 0.0,
    imc: 0.0, // Se calcula después
    edad: 0,
    diabetes: false,
    hipertension: false,
    enfcronica: false,
    antecedentes: '',
    sintomascla: '',
    medicamentos: '',
};

const TIPOS_SANGRE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Clasificación de la OMS para adultos
const clasificarIMC = (imc) => {
    const v = parseFloat(imc);
    if (!v) return null;
    if (v < 18.5) return { label: 'Bajo peso', tone: 'bg-amber-50 text-amber-800 border-amber-200' };
    if (v < 25) return { label: 'Normal', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    if (v < 30) return { label: 'Sobrepeso', tone: 'bg-amber-50 text-amber-800 border-amber-200' };
    return { label: 'Obesidad', tone: 'bg-red-50 text-red-800 border-red-200' };
};

// Componentes a nivel de módulo: dentro del render se recrearían en cada tecla y los
// campos perderían el foco si alguien los usara como JSX.
const FieldError = ({ name, error }) => (error ? <p id={`${name}-error`} className={errorClass}>{error}</p> : null);

// Campo numérico con la unidad dentro del input
const NumberWithUnit = ({ name, label, unit, step, placeholder, value, error, onChange, disabled }) => (
    <div>
        <label htmlFor={name} className={labelClass}>{label}</label>
        <div className="relative">
            <input
                id={name}
                name={name}
                type="number"
                inputMode="decimal"
                step={step}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${name}-error` : undefined}
                className={`${inputClass(Boolean(error))} pr-12 tabular-nums`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-0 mt-1 flex items-center pr-3 text-sm text-slate-500">{unit}</span>
        </div>
        <FieldError name={name} error={error} />
    </div>
);

const AltaPaciente = ({ loggedInUser }) => {
    const { nss } = useParams(); // Obtenemos el NSS de la URL si existe
    const isEditMode = !!nss; // Si hay NSS, estamos editando

    const [pacienteData, setPacienteData] = useState(initialPacienteState);
    const [errors, setErrors] = useState({});
    const [loadError, setLoadError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Lógica de solo lectura: si es médico especialista y está en modo edición.
    const isReadOnly = loggedInUser?.rol === 'medico' && isEditMode;

    // Cargar datos si estamos en modo edición
    useEffect(() => {
        const fetchPaciente = async () => {
            if (isEditMode) {
                try {
                    const response = await apiClient.get(`/pacientes/${nss}`);
                    setPacienteData(response.data);
                    setLoadError('');
                } catch (error) {
                    console.error("Error al cargar paciente:", error);
                    setLoadError('No se pudieron cargar los datos del paciente.');
                }
            } else {
                // Si no hay nss, asegura que el formulario esté vacío para un nuevo registro
                setPacienteData(initialPacienteState);
                setLoadError('');
                setErrors({});
            }
        };
        fetchPaciente();
    }, [nss, isEditMode, isReadOnly]);

    // Función para validar campos individuales
    const validateField = (name, value) => {
        let error = null;
        if (name === 'estatura') {
            const val = parseFloat(value);
            if (isNaN(val) || val < 0.4 || val > 2.5) error = 'La estatura debe estar entre 0.40 y 2.50 metros.';
        } else if (name === 'peso') {
            const val = parseFloat(value);
            if (isNaN(val) || val < 1 || val > 400) error = 'El peso debe estar entre 1 y 400 kg.';
        } else if (name === 'edad') {
            const val = parseInt(value);
            if (isNaN(val) || val < 0 || val > 120) error = 'La edad debe estar entre 0 y 120 años.';
        } else if ((name === 'nombre' || name === 'nss') && !String(value).trim()) {
            error = name === 'nombre' ? 'Escribe el nombre del paciente.' : 'Escribe el NSS del paciente.';
        }

        setErrors(prev => ({ ...prev, [name]: error }));
        return error;
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        const val = type === 'checkbox' ? checked : value;

        setPacienteData(prev => {
            const updated = { ...prev, [name]: val };

            // Recalcular IMC si cambia peso o estatura
            if ((name === 'peso' || name === 'estatura') && updated.estatura > 0) {
                const p = parseFloat(name === 'peso' ? val : prev.peso);
                const e = parseFloat(name === 'estatura' ? val : prev.estatura);
                if (p > 0 && e > 0) {
                    updated.imc = (p / (e * e)).toFixed(1);
                } else {
                    updated.imc = 0.0;
                }
            }
            return updated;
        });

        // Validar el campo que acaba de cambiar
        if (type === 'number' || errors[name]) {
            validateField(name, value);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validación final antes de enviar
        const finalErrors = {};
        Object.keys(pacienteData).forEach(key => {
            const error = validateField(key, pacienteData[key]);
            if (error) finalErrors[key] = error;
        });

        if (Object.keys(finalErrors).length > 0) {
            toast.error('Revisa los campos marcados.');
            document.getElementById(Object.keys(finalErrors)[0])?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            // Llamada a la API para guardar o actualizar usando apiClient
            await apiClient.post('/pacientes', pacienteData);

            toast.success(isEditMode
                ? `Paciente actualizado: ${pacienteData.nombre} ${pacienteData.apellidoP}`
                : `Paciente registrado: ${pacienteData.nombre} ${pacienteData.apellidoP}`);
            if (!isEditMode) {
                setPacienteData(initialPacienteState); // Limpiar formulario solo en modo creación
                setErrors({});
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'No se pudo guardar el paciente.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const disabled = isReadOnly || isSubmitting;
    const fieldProps = (name) => ({
        id: name,
        name,
        onChange: handleChange,
        disabled,
        'aria-invalid': Boolean(errors[name]),
        'aria-describedby': errors[name] ? `${name}-error` : undefined,
    });
    const imcInfo = clasificarIMC(pacienteData.imc);
    const title = isReadOnly ? 'Expediente del paciente' : isEditMode ? 'Editar paciente' : 'Registrar paciente';
    const checkboxes = [
        { name: 'diabetes', label: 'Diabetes' },
        { name: 'hipertension', label: 'Hipertensión' },
        { name: 'enfcronica', label: 'Enfermedad crónica conocida' },
    ];

    return (
        <div className="mx-auto w-full max-w-6xl px-2 py-4 sm:px-4">
            <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className={pageTitleClass}>{title}</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        {isReadOnly
                            ? 'Consulta los datos del paciente. Solo el personal de atención puede modificarlos.'
                            : isEditMode
                                ? `Actualiza el registro de ${pacienteData.nombre || 'este paciente'}.`
                                : 'Captura los datos generales y el historial clínico del paciente.'}
                    </p>
                </div>
                {isReadOnly && (
                    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                        <LockClosedIcon className="h-4 w-4" /> Solo lectura
                    </span>
                )}
            </header>

            {loadError && (
                <p className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>
            )}

            <form onSubmit={handleSubmit} noValidate className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-6">
                    <section className={`${cardClass} p-6`}>
                        <h2 className={cardTitleClass}>Datos personales</h2>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <label htmlFor="nombre" className={labelClass}>Nombre</label>
                                <input {...fieldProps('nombre')} type="text" autoComplete="off" value={pacienteData.nombre} className={inputClass(Boolean(errors.nombre))} />
                                <FieldError name="nombre" error={errors.nombre} />
                            </div>
                            <div>
                                <label htmlFor="apellidoP" className={labelClass}>Apellido paterno</label>
                                <input {...fieldProps('apellidoP')} type="text" autoComplete="off" value={pacienteData.apellidoP} className={inputClass(false)} />
                            </div>
                            <div>
                                <label htmlFor="apellidoM" className={labelClass}>Apellido materno</label>
                                <input {...fieldProps('apellidoM')} type="text" autoComplete="off" value={pacienteData.apellidoM} className={inputClass(false)} />
                            </div>
                            <div className="sm:col-span-2">
                                <label htmlFor="nss" className={labelClass}>NSS (Número de Seguridad Social)</label>
                                <input {...fieldProps('nss')} type="text" inputMode="numeric" autoComplete="off" value={pacienteData.nss} className={`${inputClass(Boolean(errors.nss))} font-mono tabular-nums`} />
                                <FieldError name="nss" error={errors.nss} />
                            </div>
                        </div>
                    </section>

                    <section className={`${cardClass} p-6`}>
                        <h2 className={cardTitleClass}>Datos médicos básicos</h2>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="tiposangre" className={labelClass}>Tipo de sangre</label>
                                <select {...fieldProps('tiposangre')} value={pacienteData.tiposangre} className={inputClass(false)}>
                                    <option value="">Sin especificar</option>
                                    {TIPOS_SANGRE.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <NumberWithUnit name="edad" label="Edad" unit="años" step="1" placeholder="0" value={pacienteData.edad} error={errors.edad} onChange={handleChange} disabled={disabled} />
                            <NumberWithUnit name="estatura" label="Estatura" unit="m" step="0.01" placeholder="0.00" value={pacienteData.estatura} error={errors.estatura} onChange={handleChange} disabled={disabled} />
                            <NumberWithUnit name="peso" label="Peso" unit="kg" step="0.1" placeholder="0.0" value={pacienteData.peso} error={errors.peso} onChange={handleChange} disabled={disabled} />
                        </div>
                        <div
                            className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${imcInfo ? imcInfo.tone : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                            aria-live="polite"
                        >
                            <span>Índice de masa corporal</span>
                            <span className="font-semibold tabular-nums">
                                {imcInfo ? `${pacienteData.imc} · ${imcInfo.label}` : 'Captura peso y estatura'}
                            </span>
                        </div>
                    </section>
                </div>

                <div className="space-y-6">
                    <section className={`${cardClass} p-6`}>
                        <h2 className={cardTitleClass}>Enfermedades y condiciones</h2>
                        <div className="mt-4 grid gap-2">
                            {checkboxes.map(({ name, label }) => (
                                <label key={name} htmlFor={name} className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 text-sm text-slate-700">
                                    <input
                                        id={name}
                                        type="checkbox"
                                        name={name}
                                        checked={Boolean(pacienteData[name])}
                                        onChange={handleChange}
                                        disabled={disabled}
                                        className="h-4 w-4 rounded border-slate-300 accent-blue-900 disabled:opacity-60"
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className={`${cardClass} p-6`}>
                        <h2 className={cardTitleClass}>Historial clínico</h2>
                        <div className="mt-4 space-y-4">
                            <div>
                                <label htmlFor="antecedentes" className={labelClass}>Antecedentes familiares y personales</label>
                                <textarea {...fieldProps('antecedentes')} rows="3" placeholder="Ej.: padre con hipertensión" value={pacienteData.antecedentes} className={`${inputClass(false)} resize-y`} />
                            </div>
                            <div>
                                <label htmlFor="sintomascla" className={labelClass}>Síntomas clave</label>
                                <textarea {...fieldProps('sintomascla')} rows="3" placeholder="Ej.: dolor torácico persistente" value={pacienteData.sintomascla} className={`${inputClass(false)} resize-y`} />
                            </div>
                            <div>
                                <label htmlFor="medicamentos" className={labelClass}>Medicamentos actuales</label>
                                <textarea {...fieldProps('medicamentos')} rows="3" placeholder="Ej.: metformina 500 mg/día" value={pacienteData.medicamentos} className={`${inputClass(false)} resize-y`} />
                            </div>
                        </div>
                    </section>
                </div>

                {!isReadOnly && (
                    <div className="flex justify-end lg:col-span-2">
                        <button type="submit" disabled={isSubmitting} className={primaryButton}>
                            {isSubmitting ? 'Guardando…' : isEditMode ? 'Guardar cambios' : 'Registrar paciente'}
                        </button>
                    </div>
                )}
            </form>
        </div>
    );
};

export default AltaPaciente;
