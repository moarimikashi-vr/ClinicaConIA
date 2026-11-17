const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

// Aplicar middleware de autenticación a todas las rutas de casos
router.use(verifyToken);

// Per-case permissions (participants, specialist, administrador) are checked in the controller
router.post('/', requireRole('atencion', 'administrador'), caseController.createCase);
router.get('/', caseController.getCases); // Lista filtrada por rol
router.get('/:id', caseController.getCaseById);
router.delete('/:id', caseController.deleteCase);
router.get('/:id/comentarios', caseController.getCaseComments);
router.post('/:id/comentarios', caseController.addComment);
router.patch('/:id/cerrar', caseController.closeCase);
router.patch('/:id', caseController.updateCase); // Solo el diagnóstico, por el especialista asignado

module.exports = router;
