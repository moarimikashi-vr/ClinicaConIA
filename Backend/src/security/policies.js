// Authorization rules in one place. Every function receives the user resolved by verifyToken
// ({ uid, rol, nombre, apellido }) and the stored resource, never data taken from the request body.

const ROLES = ['medico', 'atencion', 'administrador'];

const isAdmin = (user) => user?.rol === 'administrador';

const hasRole = (user, ...roles) => Boolean(user && roles.includes(user.rol));

// Participants of a case: the general doctor who created it and the assigned specialist
const isCaseParticipant = (user, caso) =>
    Boolean(user && caso && (caso.medicoGeneralId === user.uid || caso.medicoEspecialistaId === user.uid));

const canAccessCase = (user, caso) => isAdmin(user) || isCaseParticipant(user, caso);

// The diagnosis is a medical act: only the assigned specialist writes it
const canEditDiagnosis = (user, caso) => Boolean(user && caso && caso.medicoEspecialistaId === user.uid);

const canCloseCase = (user, caso) => isAdmin(user) || Boolean(user && caso && caso.medicoEspecialistaId === user.uid);

const canDeleteCase = (user, caso) => canAccessCase(user, caso);

// Uploaded files must live under the uploader's own folder for that patient: casos/<uid>/<nss>/<file>
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const isOwnUploadPath = (uploadPath, uid, nss) => {
    if (typeof uploadPath !== 'string') return false;
    const parts = uploadPath.split('/');
    return parts.length === 4
        && parts[0] === 'casos'
        && parts[1] === uid
        && parts[2] === String(nss)
        && SAFE_SEGMENT.test(parts[3])
        && parts[3] !== '.' && parts[3] !== '..';
};

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const fullName = (profile) => `${profile?.nombre || ''} ${profile?.apellido || ''}`.trim();

module.exports = {
    ROLES,
    isAdmin,
    hasRole,
    isCaseParticipant,
    canAccessCase,
    canEditDiagnosis,
    canCloseCase,
    canDeleteCase,
    isOwnUploadPath,
    escapeHtml,
    fullName,
};
