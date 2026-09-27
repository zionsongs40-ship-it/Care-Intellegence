const crypto = require('crypto');
const { hashPassword } = require('../src/auth');
const { loadStore, saveStore, closeStore } = require('../src/store');

async function main() {
  const store = loadStore();
  const demoHospitals = store.hospitalAccounts.filter(account =>
    account.demoData && account.hospitalName === 'CI Demo Hospital (Fictional)'
  );
  if (demoHospitals.length !== 1) {
    throw new Error('Expected exactly one CI demo hospital account; no credentials were changed.');
  }

  const hospital = demoHospitals[0];
  const demoDoctors = store.doctorAccounts.filter(account =>
    account.demoData && account.hospitalName === hospital.hospitalName
  );
  const doctorIds = new Set(demoDoctors.map(account => account.id));
  const linkedDemoDoctors = store.doctors.filter(doctor =>
    doctor.demoData && doctor.hospitalName === hospital.hospitalName && doctorIds.has(doctor.accountId)
  );
  if (demoDoctors.length !== 9 || linkedDemoDoctors.length !== 9) {
    throw new Error('Expected nine linked demo doctor accounts; no credentials were changed.');
  }

  const newPassword = crypto.randomBytes(18).toString('base64url');
  for (const account of [hospital, ...demoDoctors]) {
    account.passwordHash = await hashPassword(newPassword);
    delete account.password;
  }
  saveStore(store);

  console.log(`Rotated the password for ${hospital.email} and ${demoDoctors.length} demo doctor accounts.`);
  console.log(`New shared demo password: ${newPassword}`);
  console.log('Store this password safely. It will not be shown again.');
}

main()
  .catch(error => {
    console.error(`Could not reset demo credentials: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => closeStore());
