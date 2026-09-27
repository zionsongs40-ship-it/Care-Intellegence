const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-care-store-'));
const databaseFile = path.join(testDirectory, 'hospital.sqlite');
const legacyFile = path.join(testDirectory, 'hospital-data.json');
process.env.HOSPITAL_DATABASE_FILE = databaseFile;
process.env.HOSPITAL_LEGACY_DATA_FILE = legacyFile;

const { loadStore, saveStore, insertDemoData, closeStore, removeDoctorByName, getDoctorsByHospitalName } = require('../src/store');
const { verifyPassword } = require('../src/auth');

test.after(() => {
  closeStore();
  delete process.env.HOSPITAL_DATABASE_FILE;
  delete process.env.HOSPITAL_LEGACY_DATA_FILE;
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('imports legacy JSON records into SQLite and hashes legacy account passwords', async () => {
  const legacyData = {
    doctors: [{
      name: 'Dr Test',
      department: 'Cardiology',
      specialty: 'Cardiology',
      hospitalName: 'City Care Hospital',
      availability: ['09:00'],
    }],
    doctorAccounts: [{
      id: 1,
      name: 'Dr Test',
      email: 'doctor@example.test',
      password: 'legacy-password',
      hospitalName: 'City Care Hospital',
    }],
    hospitalAccounts: [{
      id: 2,
      name: 'Admin',
      hospitalName: 'City Care Hospital',
      email: 'admin@example.test',
      password: 'legacy-admin-password',
    }],
    appointments: [{
      id: 5,
      patient: 'Patient Test',
      department: 'Cardiology',
      recommendedDoctor: 'Dr Test',
      priority: 'Routine',
      date: '2027-01-04',
      timeSlot: '09:00',
    }],
    noShows: [],
  };
  fs.writeFileSync(legacyFile, JSON.stringify(legacyData));

  const store = loadStore();
  assert.equal(store.doctors.length, 1);
  assert.equal(store.doctors[0].accountId, 1);
  assert.equal(store.doctorAccounts[0].password, undefined);
  assert.equal(await verifyPassword('legacy-password', store.doctorAccounts[0]), true);
  assert.equal(store.hospitalAccounts[0].password, undefined);
  assert.equal(await verifyPassword('legacy-admin-password', store.hospitalAccounts[0]), true);
  assert.equal(store.appointments[0].hospitalName, 'City Care Hospital');
  assert.equal(fs.existsSync(databaseFile), true);

  const originalLegacyFile = fs.readFileSync(legacyFile, 'utf8');
  saveStore(store);
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), originalLegacyFile);
  assert.equal(loadStore().appointments[0].patient, 'Patient Test');
  assert.deepEqual(loadStore().noShows, []);
});

test('store helpers continue to filter and remove doctors', () => {
  const doctors = [
    { name: 'Dr. Smith', hospitalName: 'City Care Hospital' },
    { name: 'Dr. Jones', hospitalName: 'St. Mary Hospital' },
  ];
  assert.equal(removeDoctorByName(doctors, 'Dr. Smith').length, 1);
  assert.equal(getDoctorsByHospitalName(doctors, 'City Care Hospital')[0].name, 'Dr. Smith');
});

test('demo data seeding appends fictional accounts once without replacing existing data', () => {
  const demoHospital = {
    id: 'demo-hospital-id',
    name: 'Demo Admin',
    hospitalName: 'Fictional Demo Hospital',
    email: 'admin@demo.invalid',
    passwordHash: 'demo-hash',
    demoData: true,
  };
  const demoDoctorAccount = {
    id: 'demo-doctor-id',
    name: 'Dr. Sample',
    email: 'doctor@demo.invalid',
    passwordHash: 'demo-hash',
    hospitalName: demoHospital.hospitalName,
    demoData: true,
  };
  const demoDoctor = {
    id: demoDoctorAccount.id,
    accountId: demoDoctorAccount.id,
    name: demoDoctorAccount.name,
    department: 'Cardiology',
    specialty: 'Cardiology',
    hospitalName: demoHospital.hospitalName,
    demoData: true,
  };

  assert.equal(insertDemoData({
    doctors: [{ ...demoDoctor, name: 'Dr. Old Demo' }],
    doctorAccounts: [{ ...demoDoctorAccount, name: 'Dr. Old Demo' }],
    hospitalAccounts: [demoHospital],
  }), true);
  assert.equal(insertDemoData({
    doctors: [demoDoctor],
    doctorAccounts: [demoDoctorAccount],
    hospitalAccounts: [demoHospital],
  }), false);

  const store = loadStore();
  assert.ok(store.hospitalAccounts.some(account => account.hospitalName === 'City Care Hospital'));
  assert.ok(store.hospitalAccounts.some(account => account.hospitalName === demoHospital.hospitalName));
  assert.ok(store.doctors.some(doctor => doctor.name === demoDoctor.name && doctor.demoData));
  assert.ok(store.doctorAccounts.some(account => account.name === demoDoctorAccount.name && account.demoData));
});
