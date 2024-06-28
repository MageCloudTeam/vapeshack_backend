var express = require('express');
var router = express.Router();

const taxController = require('../controllers/taxController')

/* GET home page. */
router.post('/calculate',taxController.calculateTaxes );

router.post('/verify_order',taxController.verifyOrder );

module.exports = router;
