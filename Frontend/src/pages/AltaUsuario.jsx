import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
    ClipboardDocumentListIcon,
    EyeIcon,
    EyeSlashIcon,
    ShieldCheckIcon,
    UserIcon,
} from '@heroicons/react/24/outline';
import apiClient from '../api/axiosConfig';
import {
    errorClass,
    helpClass,
    inputClass,
    labelClass,
    primaryButton,
    secondaryButton,
} from '../components/ui/formStyles';

const initialUserState = {
    nombre: '',
    apellido: '',
    email: '',
    contrasena: '',
    rol: '',
};

// Qué puede hacer cada rol en la plataforma (App.jsx, MainLayout.jsx y CasoDetalle.jsx)
const userRoles = [
    {
        value: 'medico',
        label: 'Médico especialista',
        description: 'Revisa los casos que le asignan, comenta y emite el diagnóstico final.',
        Icon: UserIcon,
    },
    {
        value: 'atencion',
        label: 'Personal de atención',
        description: 'Registra pacientes y envía sus estudios a un especialista.',
        Icon: ClipboardDocumentListIcon,
    },
    {
        value: 'administrador',
        label: 'Administrador del sistema',
        description: 'Da de alta usuarios y consulta todos los casos.',
        Icon: ShieldCheckIcon,
    },
];

// Mismas reglas que registerSchema en Backend/src/controllers/userController.js
const validate = (data) => {
    const errors = {};
    if (data.nombre.trim().length < 2) errors.nombre = 'Escribe al menos 2 caracteres.';
    if (data.apellido.trim().length < 2) errors.apellido = 'Escribe al menos 2 caracteres.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) errors.email = 'Escribe un correo válido, por ejemplo nombre@dominio.com.';
    if (data.contrasena.length < 6) errors.contrasena = 'La contraseña necesita al menos 6 caracteres.';
    if (!data.rol) errors.rol = 'Elige el rol de la persona.';
    return errors;
};

const Field = ({ id, label, help, error, children }) => (
    <div>
        <label htmlFor={id} className={labelClass}>{label}</label>
        {children}
        {error
            ? <p id={`${id}-error`} className={errorClass}>{error}</p>
            : help && <p id={`${id}-help`} className={helpClass}>{help}</p>}
    </div>
);

const AltaUsuario = () => {
    const [userData, setUserData] = useState(initialUserState);
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setUserData((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
    };

    const handleReset = () => {
        setUserData(initialUserState);
        setErrors({});
        setShowPassword(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const found = validate(userData);
        setErrors(found);
        if (Object.keys(found).length > 0) {
            const first = Object.keys(found)[0];
            document.getElementById(first === 'rol' ? `rol-${userRoles[0].value}` : first)?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            await apiClient.post('/users/register', {
                ...userData,
                nombre: userData.nombre.trim(),
                apellido: userData.apellido.trim(),
                email: userData.email.trim(),
            });
            toast.success(`Usuario creado: ${userData.nombre.trim()} ${userData.apellido.trim()}`);
            handleReset();
        } catch (error) {
            const status = error.response?.status;
            const message = error.response?.data?.message || 'No se pudo crear el usuario. Inténtalo de nuevo.';
            if (status === 409) {
                setErrors({ email: 'Ya existe una cuenta con este correo.' });
                document.getElementById('email')?.focus();
            } else {
                toast.error(message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const describedBy = (name, hasHelp = false) =>
        errors[name] ? `${name}-error` : hasHelp ? `${name}-help` : undefined;

    const legendClass = 'text-sm font-semibold text-slate-900';

    return (
        <div className="mx-auto w-full max-w-2xl px-2 py-6 sm:px-4">
            <header className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900">Alta de usuario</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Crea la cuenta y asigna su rol. Comparte la contraseña temporal por un canal seguro.
                </p>
            </header>

            <form
                onSubmit={handleSubmit}
                noValidate
                className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white"
            >
                <fieldset className="space-y-4 p-6" disabled={isSubmitting}>
                    <legend className={`${legendClass} float-left mb-4 w-full`}>Datos personales</legend>
                    <div className="clear-both grid gap-4 sm:grid-cols-2">
                        <Field id="nombre" label="Nombre" error={errors.nombre}>
                            <input
                                id="nombre"
                                name="nombre"
                                type="text"
                                autoComplete="given-name"
                                value={userData.nombre}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.nombre)}
                                aria-describedby={describedBy('nombre')}
                                className={inputClass(Boolean(errors.nombre))}
                            />
                        </Field>
                        <Field id="apellido" label="Apellido" error={errors.apellido}>
                            <input
                                id="apellido"
                                name="apellido"
                                type="text"
                                autoComplete="family-name"
                                value={userData.apellido}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.apellido)}
                                aria-describedby={describedBy('apellido')}
                                className={inputClass(Boolean(errors.apellido))}
                            />
                        </Field>
                    </div>
                </fieldset>

                <fieldset className="space-y-4 p-6" disabled={isSubmitting}>
                    <legend className={`${legendClass} float-left mb-4 w-full`}>Acceso</legend>
                    <div className="clear-both space-y-4">
                        <Field id="email" label="Correo electrónico" help="Será su usuario para iniciar sesión." error={errors.email}>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="off"
                                placeholder="nombre@dominio.com"
                                value={userData.email}
                                onChange={handleChange}
                                aria-invalid={Boolean(errors.email)}
                                aria-describedby={describedBy('email', true)}
                                className={inputClass(Boolean(errors.email))}
                            />
                        </Field>
                        <Field id="contrasena" label="Contraseña temporal" help="Mínimo 6 caracteres." error={errors.contrasena}>
                            <div className="relative">
                                <input
                                    id="contrasena"
                                    name="contrasena"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    value={userData.contrasena}
                                    onChange={handleChange}
                                    aria-invalid={Boolean(errors.contrasena)}
                                    aria-describedby={describedBy('contrasena', true)}
                                    className={`${inputClass(Boolean(errors.contrasena))} pr-11`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    aria-pressed={showPassword}
                                    className="absolute inset-y-0 right-0 mt-1 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/40"
                                >
                                    {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                                </button>
                            </div>
                        </Field>
                    </div>
                </fieldset>

                <fieldset
                    className="p-6"
                    disabled={isSubmitting}
                    aria-describedby={errors.rol ? 'rol-error' : undefined}
                >
                    <legend className={`${legendClass} float-left mb-4 w-full`}>Rol</legend>
                    <div className="clear-both grid gap-3">
                        {userRoles.map((role) => {
                            const selected = userData.rol === role.value;
                            return (
                                <label
                                    key={role.value}
                                    htmlFor={`rol-${role.value}`}
                                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-blue-900/20 ${selected
                                        ? 'border-blue-900 bg-blue-50'
                                        : errors.rol ? 'border-red-300 hover:bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
                                        }`}
                                >
                                    <input
                                        id={`rol-${role.value}`}
                                        type="radio"
                                        name="rol"
                                        value={role.value}
                                        checked={selected}
                                        onChange={handleChange}
                                        className="sr-only"
                                    />
                                    <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                        <role.Icon className="h-5 w-5" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-slate-900">{role.label}</span>
                                        <span className="mt-0.5 block text-sm text-slate-600">{role.description}</span>
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={`ml-auto mt-1 h-4 w-4 flex-shrink-0 rounded-full border-2 ${selected ? 'border-blue-900 bg-blue-900 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300'}`}
                                    />
                                </label>
                            );
                        })}
                    </div>
                    {errors.rol && <p id="rol-error" className={errorClass}>{errors.rol}</p>}
                </fieldset>

                <div className="flex flex-col-reverse gap-3 p-6 sm:flex-row sm:justify-end">
                    <button type="button" onClick={handleReset} disabled={isSubmitting} className={secondaryButton}>
                        Limpiar
                    </button>
                    <button type="submit" disabled={isSubmitting} className={primaryButton}>
                        {isSubmitting && (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                        )}
                        {isSubmitting ? 'Creando usuario…' : 'Crear usuario'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default AltaUsuario;
