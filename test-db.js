const Database = require('better-sqlite3');
const path = require('path');

try {
  const db = new Database('test.db');
  db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
  console.log('Database working!');
  db.close();
} catch (err) {
  console.error('Database failed:', err);
}
