const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/register', requireRole('administrador'), userController.registerUser);
router.get('/doctors', requireRole('atencion', 'administrador'), userController.getDoctors);
router.get('/:uid', userController.getUserById); // own profile or administrador (checked in controller)

module.exports = router;
