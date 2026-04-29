// Usage: node changePassword.js <username> <newpassword>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db/database');

const [,, username, newPassword] = process.argv;
if (!username || !newPassword) {
  console.error('Usage: node changePassword.js <username> <newpassword>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}
const hash = bcrypt.hashSync(newPassword, 10);
const result = db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(hash, username);
if (result.changes === 0) {
  console.error(`User "${username}" not found`);
} else {
  console.log(`Password updated for "${username}"`);
}
