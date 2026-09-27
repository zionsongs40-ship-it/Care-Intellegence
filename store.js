const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDirectory = path.join(__dirname, '..', 'data');
const databaseFile = process.env.HOSPITAL_DATABASE_FILE
  ? path.resolve(process.env.HOSPITAL_DATABASE_FILE)
  : path.join(dataDirectory, 'hospital-data.sqlite');
const legacyDataFile = process.env.HOSPITAL_LEGACY_DATA_FILE
  ? path.resolve(process.env.HOSPITAL_LEGACY_DATA_FILE)
  : path.join(dataDirectory, 'hospital-data.json');

const defaultDoctors = [];
let database;

function encode(value) {
  return JSON.stringify(value);
}

function decode(value) {
  return JSON.parse(value);
}

function hashLegacyPassword(account) {
  if (typeof account.password !== 'string' || account.passwordHash) return account;
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(account.password, salt, 64).toString('hex');
  const { password, ...safeAccount } = account;
  return { ...safeAccount, passwordHash: `scrypt$${salt}$${passwordHash}` };
}

function openDatabase() {
  if (database) return database;

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  database = new DatabaseSync(databaseFile);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      specialty TEXT NOT NULL,
      hospital_name TEXT,
      on_leave INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS doctors_hospital_department
      ON doctors(hospital_name, department, specialty);
    CREATE TABLE IF NOT EXISTS accounts (
      role TEXT NOT NULL CHECK(role IN ('doctor', 'hospital')),
      id TEXT NOT NULL,
      email TEXT NOT NULL,
      hospital_name TEXT,
      data TEXT NOT NULL,
      PRIMARY KEY(role, id),
      UNIQUE(role, email)
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      doctor_id TEXT,
      hospital_name TEXT,
      department TEXT NOT NULL,
      priority TEXT NOT NULL,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS appointments_hospital_priority_date
      ON appointments(hospital_name, priority, date, time_slot);
    CREATE INDEX IF NOT EXISTS appointments_doctor_date
      ON appointments(doctor_id, date, time_slot);
    CREATE UNIQUE INDEX IF NOT EXISTS appointments_unique_booked_slot
      ON appointments(doctor_id, date, time_slot)
      WHERE doctor_id IS NOT NULL AND time_slot NOT LIKE 'Immediate%';

    -- Persistent no-show records for released slots and verification workflow
    CREATE TABLE IF NOT EXISTS no_shows (
      id TEXT PRIMARY KEY,
      appointment_id TEXT,
      hospital_name TEXT,
      removed_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS no_shows_hospital_removed_at
      ON no_shows(hospital_name, removed_at);
  `);

  migrateLegacyJson(database);
  return database;
}

function migrateLegacyJson(db) {
  const migrated = db.prepare('SELECT value FROM store_meta WHERE key = ?').get('legacy_json_migrated');
  if (migrated) return;

  let source = {
    doctors: defaultDoctors,
    doctorAccounts: [],
    hospitalAccounts: [],
    appointments: [],
  };
  if (fs.existsSync(legacyDataFile)) {
    source = JSON.parse(fs.readFileSync(legacyDataFile, 'utf8'));
    source = {
      doctors: Array.isArray(source.doctors) ? source.doctors : defaultDoctors,
      doctorAccounts: Array.isArray(source.doctorAccounts) ? source.doctorAccounts : [],
      hospitalAccounts: Array.isArray(source.hospitalAccounts) ? source.hospitalAccounts : [],
      appointments: Array.isArray(source.appointments) ? source.appointments : [],
    };
  }

  source.doctorAccounts = source.doctorAccounts.map(hashLegacyPassword);
  source.hospitalAccounts = source.hospitalAccounts.map(hashLegacyPassword);
  const doctors = source.doctors.map(doctor => {
    const account = source.doctorAccounts.find(item =>
      item.name === doctor.name && item.hospitalName === doctor.hospitalName
    );
    return account && !doctor.accountId ? { ...doctor, accountId: account.id } : doctor;
  });
  const doctorsByName = new Map(doctors.map(doctor => [doctor.name, doctor]));
  const appointments = source.appointments.map(appointment => {
    const doctor = doctorsByName.get(appointment.recommendedDoctor);
    return {
      ...appointment,
      id: appointment.id == null ? crypto.randomUUID() : String(appointment.id),
      doctorId: appointment.doctorId || doctor?.accountId || null,
      hospitalName: appointment.hospitalName || doctor?.hospitalName || null,
    };
  });

  db.exec('BEGIN IMMEDIATE');
  try {
    insertStore(db, { doctors, doctorAccounts: source.doctorAccounts, hospitalAccounts: source.hospitalAccounts, appointments });
    db.prepare('INSERT INTO store_meta (key, value) VALUES (?, ?)').run('legacy_json_migrated', new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertStore(db, store) {
  const insertDoctor = db.prepare(`
    INSERT INTO doctors (id, name, department, specialty, hospital_name, on_leave, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAccount = db.prepare(`
    INSERT INTO accounts (role, id, email, hospital_name, data)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAppointment = db.prepare(`
    INSERT INTO appointments (id, doctor_id, hospital_name, department, priority, date, time_slot, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNoShow = db.prepare(`
    INSERT INTO no_shows (id, appointment_id, hospital_name, removed_at, attempts, verified, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const doctor of store.doctors) {
    const id = String(doctor.accountId || doctor.id || crypto.randomUUID());
    insertDoctor.run(
      id,
      doctor.name || 'Unnamed doctor',
      doctor.department || 'Unassigned',
      doctor.specialty || doctor.department || 'Unassigned',
      doctor.hospitalName || null,
      doctor.onLeave ? 1 : 0,
      encode(doctor),
    );
  }
  for (const account of store.doctorAccounts) {
    insertAccount.run('doctor', String(account.id || crypto.randomUUID()), String(account.email || '').toLowerCase(), account.hospitalName || null, encode(account));
  }
  for (const account of store.hospitalAccounts) {
    insertAccount.run('hospital', String(account.id || crypto.randomUUID()), String(account.email || '').toLowerCase(), account.hospitalName || null, encode(account));
  }
  for (const appointment of store.appointments) {
    insertAppointment.run(
      String(appointment.id || crypto.randomUUID()),
      appointment.doctorId == null ? null : String(appointment.doctorId),
      appointment.hospitalName || null,
      appointment.department || 'General Medicine',
      appointment.priority || 'Routine',
      appointment.date || '1970-01-01',
      appointment.timeSlot || 'Unscheduled',
      encode(appointment),
    );
  }

  // persist no-show records when present (optional)
  if (Array.isArray(store.noShows)) {
    for (const ns of store.noShows) {
      insertNoShow.run(
        String(ns.id || crypto.randomUUID()),
        ns.appointmentId || null,
        ns.hospitalName || null,
        ns.removedAt || new Date().toISOString(),
        Number(ns.attempts || 0),
        ns.verified ? 1 : 0,
        encode(ns),
      );
    }
  }
}

function loadStore() {
  const db = openDatabase();
  const doctors = db.prepare('SELECT data FROM doctors ORDER BY rowid').all().map(row => decode(row.data));
  const accounts = db.prepare('SELECT role, data FROM accounts ORDER BY rowid').all();
  const appointments = db.prepare('SELECT data FROM appointments ORDER BY rowid').all().map(row => decode(row.data));
  const noShowRows = db.prepare('SELECT id, appointment_id, hospital_name, removed_at, attempts, verified, data FROM no_shows ORDER BY rowid').all();
  const noShows = noShowRows.map(row => {
    const data = decode(row.data);
    return {
      id: row.id,
      appointmentId: row.appointment_id,
      hospitalName: row.hospital_name,
      removedAt: row.removed_at,
      attempts: Number(row.attempts || 0),
      verified: Boolean(row.verified),
      ...data,
    };
  });

  return {
    doctors,
    doctorAccounts: accounts.filter(account => account.role === 'doctor').map(account => decode(account.data)),
    hospitalAccounts: accounts.filter(account => account.role === 'hospital').map(account => decode(account.data)),
    appointments,
    noShows,
  };
}

function saveStore(store) {
  const db = openDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM doctors; DELETE FROM accounts; DELETE FROM appointments; DELETE FROM no_shows;');
    insertStore(db, store);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertDemoData({ doctors, doctorAccounts, hospitalAccounts }) {
  if (hospitalAccounts.length !== 1 || !hospitalAccounts[0].demoData) {
    throw new Error('Demo seed must contain exactly one demo hospital account.');
  }

  const db = openDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const hospital = hospitalAccounts[0];
    const existingHospital = db.prepare(
      'SELECT data FROM accounts WHERE role = ? AND hospital_name = ?'
    ).get('hospital', hospital.hospitalName);
    if (existingHospital) {
      if (decode(existingHospital.data).demoData) {
        const profileById = new Map(doctors.map(doctor => [String(doctor.accountId || doctor.id), doctor]));
        const updateDoctor = db.prepare(`
          UPDATE doctors
          SET name = ?, data = ?
          WHERE id = ? AND hospital_name = ?
        `);
        const updateAccount = db.prepare(`
          UPDATE accounts SET data = ?
          WHERE role = 'doctor' AND id = ? AND hospital_name = ?
        `);
        const updateAppointment = db.prepare(`
          UPDATE appointments SET data = ?
          WHERE doctor_id = ? AND hospital_name = ?
        `);
        const storedDoctors = db.prepare(
          'SELECT id, data FROM doctors WHERE hospital_name = ?'
        ).all(hospital.hospitalName);
        for (const row of storedDoctors) {
          const current = decode(row.data);
          const seeded = profileById.get(row.id);
          if (!seeded || !current.demoData) continue;
          updateDoctor.run(seeded.name, encode({ ...current, name: seeded.name }), row.id, hospital.hospitalName);

          const accountRow = db.prepare(
            "SELECT data FROM accounts WHERE role = 'doctor' AND id = ? AND hospital_name = ?"
          ).get(row.id, hospital.hospitalName);
          if (accountRow) {
            const account = decode(accountRow.data);
            if (account.demoData) {
              updateAccount.run(encode({ ...account, name: seeded.name }), row.id, hospital.hospitalName);
            }
          }

          const appointmentRows = db.prepare(
            'SELECT id, data FROM appointments WHERE doctor_id = ? AND hospital_name = ?'
          ).all(row.id, hospital.hospitalName);
          for (const appointmentRow of appointmentRows) {
            const appointment = decode(appointmentRow.data);
            if (appointment.recommendedDoctor) {
              updateAppointment.run(
                encode({ ...appointment, recommendedDoctor: seeded.name }),
                row.id,
                hospital.hospitalName,
              );
            }
          }
        }
        db.exec('COMMIT');
        return false;
      }
      throw new Error(`A non-demo hospital named "${hospital.hospitalName}" already exists.`);
    }

    const accountExists = db.prepare('SELECT 1 FROM accounts WHERE role = ? AND email = ?');
    const demoAccounts = [
      ...hospitalAccounts.map(account => ({ role: 'hospital', account })),
      ...doctorAccounts.map(account => ({ role: 'doctor', account })),
    ];
    for (const { role, account } of demoAccounts) {
      if (accountExists.get(role, account.email.toLowerCase())) {
        throw new Error(`Demo account email "${account.email}" is already in use.`);
      }
    }

    insertStore(db, { doctors, doctorAccounts, hospitalAccounts, appointments: [] });
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function closeStore() {
  if (!database) return;
  database.close();
  database = undefined;
}

function removeDoctorByName(doctors, doctorName) {
  return doctors.filter(doctor => doctor.name !== doctorName);
}

function getDoctorsByHospitalName(doctors, hospitalName) {
  if (!hospitalName) return doctors;
  return doctors.filter(doctor => doctor.hospitalName === hospitalName);
}

module.exports = { loadStore, saveStore, insertDemoData, closeStore, removeDoctorByName, getDoctorsByHospitalName, defaultDoctors };
