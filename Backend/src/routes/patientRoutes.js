const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

router.use(verifyToken);

const staff = requireRole('atencion', 'administrador');

router.post('/', staff, patientController.createOrUpdatePatient);
router.get('/search', staff, patientController.searchPatients);
router.get('/:nss', patientController.getPatientByNss); // staff, or a medico with an assigned case (checked in controller)
router.delete('/:nss', staff, patientController.deletePatient);

module.exports = router;
