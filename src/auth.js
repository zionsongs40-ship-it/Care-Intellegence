const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, account) {
  if (typeof account.passwordHash === 'string') {
    const [, salt, storedKey] = account.passwordHash.split('$');
    if (!salt || !storedKey) return false;
    const derivedKey = await scrypt(password, salt, 64);
    const expected = Buffer.from(storedKey, 'hex');
    return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey);
  }

  return typeof account.password === 'string' && account.password === password;
}

module.exports = { hashPassword, verifyPassword };
