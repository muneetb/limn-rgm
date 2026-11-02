// Named logins, compatible with users.sh and the Secret Manager secret "limn-rgm-users".
// Cloud Run mounts the secret as an htpasswd file (one "name:$apr1$..." line per person;
// lines starting with "#off " are switched-off logins). The file is re-read every 30 seconds,
// so turning access on or off needs no rebuild.
const fs = require('fs');
const crypto = require('crypto');

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function to64(v, n) { let s = ''; while (n-- > 0) { s += ITOA64[v & 0x3f]; v >>= 6; } return s; }
const md5 = buf => crypto.createHash('md5').update(buf).digest();

// Apache MD5 crypt ($apr1$), the format openssl passwd -apr1 writes.
function apr1(password, salt) {
  const magic = Buffer.from('$apr1$'), pw = Buffer.from(password, 'utf8'), sl = Buffer.from(salt.slice(0, 8), 'utf8');
  let fin = md5(Buffer.concat([pw, sl, pw]));
  const parts = [pw, magic, sl];
  for (let pl = pw.length; pl > 0; pl -= 16) parts.push(fin.subarray(0, Math.min(16, pl)));
  for (let i = pw.length; i; i >>= 1) parts.push((i & 1) ? Buffer.from([0]) : pw.subarray(0, 1));
  fin = md5(Buffer.concat(parts));
  for (let i = 0; i < 1000; i++) {
    const p = [(i & 1) ? pw : fin];
    if (i % 3) p.push(sl);
    if (i % 7) p.push(pw);
    p.push((i & 1) ? fin : pw);
    fin = md5(Buffer.concat(p));
  }
  const f = fin;
  const out = to64((f[0] << 16) | (f[6] << 8) | f[12], 4) + to64((f[1] << 16) | (f[7] << 8) | f[13], 4) +
    to64((f[2] << 16) | (f[8] << 8) | f[14], 4) + to64((f[3] << 16) | (f[9] << 8) | f[15], 4) +
    to64((f[4] << 16) | (f[10] << 8) | f[5], 4) + to64(f[11], 2);
  return '$apr1$' + salt.slice(0, 8) + '$' + out;
}

function verify(password, hash) {
  if (!hash.startsWith('$apr1$')) return false;
  const salt = hash.split('$')[2] || '';
  const a = Buffer.from(apr1(password, salt)), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parse(text) {
  const users = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) users[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return users;
}

function basicAuth(file, { open = ['/api/health'] } = {}) {
  let cache = { at: 0, users: {} };
  const users = () => {
    if (Date.now() - cache.at > 30000) {
      try { cache = { at: Date.now(), users: parse(fs.readFileSync(file, 'utf8')) }; }
      catch (e) { console.error('[auth] cannot read logins file:', e.message); cache = { at: Date.now(), users: {} }; }
    }
    return cache.users;
  };
  return (req, res, next) => {
    if (open.includes(req.path)) return next();
    const m = (req.get('authorization') || '').match(/^Basic (.+)$/i);
    if (m) {
      const raw = Buffer.from(m[1], 'base64').toString('utf8');
      const i = raw.indexOf(':');
      const name = raw.slice(0, i), pw = raw.slice(i + 1);
      const h = users()[name];
      if (h && verify(pw, h)) { req.user = name; return next(); }
    }
    res.set('WWW-Authenticate', 'Basic realm="Limn RGM", charset="UTF-8"').status(401).send('Sign in with the username and password you were given.');
  };
}

module.exports = { basicAuth, apr1, verify, parse };
