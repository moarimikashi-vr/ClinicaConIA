const { admin, db } = require('../config/firebase');
const { ROLES } = require('../security/policies');

// Verifies the Firebase ID token and loads the user's profile. An account without a profile
// or with an unknown role is rejected: role-based filters must never fall through to "see all".
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    }

    const idToken = authHeader.slice('Bearer '.length).trim();

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch {
        return res.status(401).json({ message: 'La sesión no es válida o expiró. Inicia sesión de nuevo.' });
    }

    try {
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        const profile = userDoc.exists ? userDoc.data() : null;
        if (!profile || !ROLES.includes(profile.rol)) {
            return res.status(403).json({ message: 'Tu cuenta no tiene un perfil autorizado en la plataforma.' });
        }
        req.user = {
            uid: decodedToken.uid,
            rol: profile.rol,
            nombre: profile.nombre,
            apellido: profile.apellido,
            email: profile.email,
        };
        return next();
    } catch (error) {
        console.error('Error loading user profile:', error);
        return res.status(500).json({ message: 'No se pudo verificar la sesión.' });
    }
};

// Allows the request only for the listed roles (use after verifyToken)
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
        return res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });
    }
    return next();
};

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.requireRole = requireRole;
