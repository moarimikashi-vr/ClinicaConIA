const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/:id/generate', reportController.generateReport); // case participants or administrador

module.exports = router;
