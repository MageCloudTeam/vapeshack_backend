const corsWhitelist = [
  'http://localhost:3000',
  'https://vapeshackcom.myshopify.com',
];
const customCorsOptions = function (req, callback) {
  let corsOptions;
  if (corsWhitelist.indexOf(req.header('Origin')) !== -1) {
    corsOptions = { origin: true };
  } else {
    corsOptions = { origin: false }; // disable CORS for this request
  }
  callback(null, corsOptions);
};

module.exports = customCorsOptions;
