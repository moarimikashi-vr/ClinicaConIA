import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
    ArrowRightStartOnRectangleIcon,
    ArrowUpTrayIcon,
    ChevronDoubleLeftIcon,
    ChevronDoubleRightIcon,
    HomeIcon,
    UserPlusIcon,
    UsersIcon,
} from '@heroicons/react/24/outline';
import logo from '../assets/logo-tecnm.png';
import NotificationBox from './NotificationBox';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY = 'ui.sidebarCollapsed';

// Preferencia guardada; sin preferencia, colapsada en pantallas angostas.
const readCollapsedPreference = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) return stored === 'true';
    } catch {
        // Almacenamiento no disponible: se usa el valor por defecto
    }
    return typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches;
};

const ROLE_LABELS = {
    administrador: 'Administrador',
    medico: 'Médico especialista',
    atencion: 'Personal de atención',
};

const MainLayout = ({ userRole, onLogout }) => {
    const { user } = useAuth();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [collapsedPreference, setCollapsedPreference] = useState(readCollapsedPreference);
    // En el visor la barra arranca colapsada sin tocar la preferencia del resto de vistas
    const [expandedInViewer, setExpandedInViewer] = useState(false);
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const isViewer = pathname.startsWith('/app/viewer');
    const collapsed = isViewer ? !expandedInViewer : collapsedPreference;

    useEffect(() => {
        if (!isViewer) setExpandedInViewer(false);
    }, [isViewer]);

    const toggleSidebar = useCallback(() => {
        if (isViewer) {
            setExpandedInViewer((v) => !v);
            return;
        }
        setCollapsedPreference((v) => {
            try {
                localStorage.setItem(STORAGE_KEY, String(!v));
            } catch {
                // Sin almacenamiento la preferencia dura solo esta sesión
            }
            return !v;
        });
    }, [isViewer]);

    // Atajo Ctrl/Cmd + B
    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                toggleSidebar();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleSidebar]);

    const handleLogout = () => {
        setIsLoggingOut(true);
        setTimeout(async () => {
            await onLogout();
            navigate('/', { replace: true });
        }, 2000); // Esperar 2 segundos antes de cerrar sesión real
    };

    const navItems = [
        { to: '/app/historial', label: 'Historial', Icon: HomeIcon, show: true },
        { to: '/app/alta-usuario', label: 'Alta de usuario', Icon: UserPlusIcon, show: userRole === 'administrador' },
        { to: '/app/gestion-pacientes', label: 'Gestión de pacientes', Icon: UsersIcon, show: userRole === 'atencion' },
        { to: '/app/envio-archivos', label: 'Envío de archivos', Icon: ArrowUpTrayIcon, show: userRole === 'atencion' },
    ].filter((item) => item.show);

    const itemBase = 'flex items-center rounded-lg text-sm font-medium transition-colors duration-150 '
        + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/40 '
        + (collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5');
    const itemIdle = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';
    const itemActive = 'bg-blue-900 text-white';

    return (
        <div className="flex h-screen bg-slate-50 relative">
            {/* Overlay de Cierre de Sesión */}
            {isLoggingOut && (
                <div className="absolute inset-0 bg-slate-900/80 flex flex-col justify-center items-center z-50">
                    <div className="w-12 h-12 rounded-full animate-spin border-4 border-solid border-white border-t-transparent"></div>
                    <p className="text-white text-xl font-semibold mt-4">Cerrando sesión…</p>
                </div>
            )}

            {/* Barra Lateral */}
            <aside
                id="app-sidebar"
                className={`${collapsed ? 'w-16' : 'w-64'} flex-shrink-0 border-r border-slate-200 bg-white flex flex-col transition-[width] duration-150 ease-out motion-reduce:transition-none`}
            >
                <div className={`flex flex-col items-center border-b border-slate-200 ${collapsed ? 'px-2 py-3' : 'p-4'}`}>
                    {collapsed ? (
                        // Solo el escudo: ocupa ~78 de los 238 px de ancho del logotipo (proporción 28:40)
                        <div className="h-10 w-7 overflow-hidden" title="Tecnológico Nacional de México">
                            <img src={logo} alt="TecNM" className="h-10 w-auto max-w-none" />
                        </div>
                    ) : (
                        <>
                            <img src={logo} alt="Tecnológico Nacional de México" className="w-32 mx-auto" />
                            <p className="mt-2 text-center text-xs text-slate-500">
                                {ROLE_LABELS[userRole] || userRole}
                            </p>
                        </>
                    )}
                    <div className={`${collapsed ? 'mt-2' : 'mt-3'} w-full flex justify-center`}>
                        <NotificationBox userId={user?.uid} />
                    </div>
                </div>

                <nav className={`flex-grow space-y-1 ${collapsed ? 'px-2 py-3' : 'p-3'}`} aria-label="Navegación principal">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            title={collapsed ? item.label : undefined}
                            aria-label={collapsed ? item.label : undefined}
                            className={({ isActive }) => `${itemBase} ${isActive ? itemActive : itemIdle}`}
                        >
                            <item.Icon className="h-5 w-5 flex-shrink-0" />
                            {!collapsed && <span>{item.label}</span>}
                        </NavLink>
                    ))}
                </nav>

                <div className={`space-y-1 border-t border-slate-200 ${collapsed ? 'px-2 py-3' : 'p-3'}`}>
                    <button
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        title={collapsed ? 'Cerrar sesión' : undefined}
                        aria-label={collapsed ? 'Cerrar sesión' : undefined}
                        className={`${itemBase} w-full text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        <ArrowRightStartOnRectangleIcon className="h-5 w-5 flex-shrink-0" />
                        {!collapsed && <span>Cerrar sesión</span>}
                    </button>
                    <button
                        onClick={toggleSidebar}
                        aria-controls="app-sidebar"
                        aria-expanded={!collapsed}
                        title={`${collapsed ? 'Expandir' : 'Colapsar'} barra lateral (Ctrl+B)`}
                        className={`${itemBase} w-full text-slate-500 hover:bg-slate-100 hover:text-slate-900`}
                    >
                        {collapsed
                            ? <ChevronDoubleRightIcon className="h-5 w-5 flex-shrink-0" />
                            : <ChevronDoubleLeftIcon className="h-5 w-5 flex-shrink-0" />}
                        {!collapsed && <span>Colapsar</span>}
                    </button>
                </div>
            </aside>

            {/* Contenido Principal: el visor ocupa todo el alto, sin margen */}
            <main className={`flex-1 min-w-0 ${isViewer ? 'p-0 overflow-hidden' : 'p-4 overflow-y-auto'}`}>
                <Outlet />
            </main>
        </div>
    );
};

export default MainLayout;
