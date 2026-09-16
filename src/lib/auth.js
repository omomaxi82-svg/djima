const crypto = require('crypto');
const config = require('./config');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuthMiddleware(req, res, next) {
  const cfg = config.get();
  if (!cfg.auth || !cfg.auth.enabled) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    const user = decoded.slice(0, sepIdx);
    const pass = decoded.slice(sepIdx + 1);
    if (safeEqual(user, cfg.auth.username) && safeEqual(pass, cfg.auth.password)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Djima"');
  return res.status(401).send('Authentification requise');
}

module.exports = { basicAuthMiddleware };
