// Iconos de trazo para las herramientas del visor que Heroicons no incluye.
// Mismo estilo que Heroicons outline: 24x24, trazo 1.5, color heredado.
import React from 'react';

const Icon = ({ children, className = 'h-5 w-5' }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        {children}
    </svg>
);

// Ventana / nivel: círculo mitad claro, mitad oscuro
export const WindowLevelIcon = (props) => (
    <Icon {...props}>
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 3.75a8.25 8.25 0 0 1 0 16.5Z" fill="currentColor" stroke="none" />
    </Icon>
);

// Distancia: regla en diagonal
export const RulerIcon = (props) => (
    <Icon {...props}>
        <path d="M3.75 16.5 16.5 3.75l3.75 3.75L7.5 20.25Z" />
        <path d="m7.5 12.75 1.5 1.5M10.5 9.75l2.25 2.25M13.5 6.75l1.5 1.5" />
    </Icon>
);

// Ángulo: dos semirrectas y un arco
export const AngleIcon = (props) => (
    <Icon {...props}>
        <path d="M19.5 19.5h-15L15 4.5" />
        <path d="M10.5 19.5a6 6 0 0 0-1.9-4.4" />
    </Icon>
);

export const RectRoiIcon = (props) => (
    <Icon {...props}>
        <rect x="4.5" y="6.75" width="15" height="10.5" rx="0.75" strokeDasharray="3 2" />
    </Icon>
);

export const EllipseRoiIcon = (props) => (
    <Icon {...props}>
        <ellipse cx="12" cy="12" rx="8.25" ry="5.25" strokeDasharray="3 2" />
    </Icon>
);

// Lupa de aumento local: lente con cruz de enfoque
export const MagnifyIcon = (props) => (
    <Icon {...props}>
        <circle cx="10.5" cy="10.5" r="6.75" />
        <path d="m15.5 15.5 4.75 4.75" />
        <circle cx="10.5" cy="10.5" r="2.25" />
    </Icon>
);

// Invertir escala de grises: cuadrado partido en diagonal
export const InvertIcon = (props) => (
    <Icon {...props}>
        <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
        <path d="M19.5 4.5v15h-15Z" fill="currentColor" stroke="none" />
    </Icon>
);

export const RotateRightIcon = (props) => (
    <Icon {...props}>
        <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.68" />
        <path d="M19.5 3.75v4.5H15" />
    </Icon>
);

export const RotateLeftIcon = (props) => (
    <Icon {...props}>
        <path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.68" />
        <path d="M4.5 3.75v4.5H9" />
    </Icon>
);

// Espejo horizontal: dos triángulos enfrentados a un eje vertical
export const FlipHorizontalIcon = (props) => (
    <Icon {...props}>
        <path d="M12 3.75v16.5" strokeDasharray="2 2" />
        <path d="M9 7.5v9L3.75 12Z" />
        <path d="M15 7.5v9l5.25-4.5Z" fill="currentColor" />
    </Icon>
);

export const FlipVerticalIcon = (props) => (
    <Icon {...props}>
        <path d="M3.75 12h16.5" strokeDasharray="2 2" />
        <path d="M7.5 9h9L12 3.75Z" />
        <path d="M7.5 15h9L12 20.25Z" fill="currentColor" />
    </Icon>
);
