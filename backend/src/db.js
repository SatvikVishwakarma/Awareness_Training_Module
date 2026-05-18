const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const sqlitePath = path.resolve(process.cwd(), process.env.SQLITE_PATH || './data/employee_details.db');
let dbPromise;

function getDb() {
  if (!dbPromise) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    dbPromise = open({
      filename: sqlitePath,
      driver: sqlite3.Database
    });
  }

  return dbPromise;
}

async function ensureSchema() {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS employee_submissions (
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      email TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      submitted_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_submissions_submitted_at
      ON employee_submissions (submitted_at DESC);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function getSetting(key, fallbackValue) {
  const db = await getDb();
  const row = await db.get(
    `
    SELECT value
    FROM app_settings
    WHERE key = ?
    `,
    [key]
  );

  if (!row) {
    return fallbackValue;
  }

  try {
    return JSON.parse(row.value);
  } catch (_error) {
    return fallbackValue;
  }
}

async function setSetting(key, value) {
  const db = await getDb();
  const updatedAt = new Date().toISOString();

  await db.run(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    `,
    [key, JSON.stringify(value), updatedAt]
  );

  return {
    key,
    value,
    updatedAt
  };
}

async function getModuleAvailability(defaultModules) {
  return getSetting('module_availability', defaultModules);
}

async function setModuleAvailability(moduleAvailability) {
  await setSetting('module_availability', moduleAvailability);
  return moduleAvailability;
}

async function getSiteLock(defaultLockState) {
  return getSetting('site_lock', defaultLockState);
}

async function setSiteLock(siteLockState) {
  await setSetting('site_lock', siteLockState);
  return siteLockState;
}

async function getModuleRegistry(defaultRegistry) {
  return getSetting('module_registry', defaultRegistry);
}

async function setModuleRegistry(moduleRegistry) {
  await setSetting('module_registry', moduleRegistry);
  return moduleRegistry;
}

async function saveEmployeeSubmission({ name, department, email, ipAddress }) {
  const db = await getDb();
  const submittedAt = new Date().toISOString();

  const result = await db.run(
    `
    INSERT INTO employee_submissions (name, department, email, ip_address, submitted_at)
    VALUES (?, ?, ?, ?, ?)
    `,
    [name, department, email, ipAddress, submittedAt]
  );

  const row = await db.get(
    `
    SELECT submitted_at AS timestamp
    FROM employee_submissions
    WHERE rowid = ?
    `,
    [result.lastID]
  );

  return {
    timestamp: row?.timestamp || submittedAt
  };
}

async function listEmployeeSubmissions({ page, pageSize }) {
  const db = await getDb();
  const offset = (page - 1) * pageSize;

  const [totalRow, items] = await Promise.all([
    db.get('SELECT COUNT(*) AS total FROM employee_submissions'),
    db.all(
      `
      SELECT name, department, email, ip_address, submitted_at AS timestamp
      FROM employee_submissions
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
      `,
      [pageSize, offset]
    )
  ]);

  return {
    total: totalRow?.total || 0,
    items
  };
}

async function clearEmployeeSubmissions() {
  const db = await getDb();
  const countRow = await db.get('SELECT COUNT(*) AS total FROM employee_submissions');
  await db.run('DELETE FROM employee_submissions');
  return {
    deletedCount: countRow?.total || 0
  };
}

module.exports = {
  ensureSchema,
  saveEmployeeSubmission,
  listEmployeeSubmissions,
  clearEmployeeSubmissions,
  getModuleRegistry,
  setModuleRegistry,
  getModuleAvailability,
  setModuleAvailability,
  getSiteLock,
  setSiteLock
};
