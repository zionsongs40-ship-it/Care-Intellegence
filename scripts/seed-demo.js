const { hashPassword } = require('../src/auth');
const { insertDemoData, closeStore } = require('../src/store');

const hospitalName = 'CI Demo Hospital (Fictional)';
const demoPassword = 'DemoProject123!';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const profiles = [
  ['Aarav Mehta', 'Emergency Department (Casualty)', 'Casualty care'],
  ['Priya Nair', 'Cardiology', 'Cardiology'],
  ['Arjun Rao', 'Neurology', 'Neurology'],
  ['Kavya Iyer', 'Orthopedics', 'Orthopedics'],
  ['Ananya Patel', 'Pediatrics', 'Pediatrics'],
  ['Rohan Kulkarni', 'OB/GYN', 'Obstetrics and gynecology'],
  ['Meera Deshmukh', 'Oncology', 'Oncology'],
  ['Vikram Reddy', 'General Surgery', 'General surgery'],
  ['Sneha Banerjee', 'General Medicine', 'General medicine'],
];

function clinicSlots() {
  const slots = [];
  for (let hour = 9; hour < 12; hour += 1) {
    slots.push(`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`);
  }
  for (let hour = 13; hour < 16; hour += 1) {
    slots.push(`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`);
  }
  return slots;
}

async function main() {
  const hospitalId = 'ci-demo-hospital';
  const hospitalEmail = 'hospital.admin@demo.invalid';
  const hospital = {
    id: hospitalId,
    role: 'hospital',
    name: 'Demo Hospital Administrator',
    hospitalName,
    email: hospitalEmail,
    passwordHash: await hashPassword(demoPassword),
    hospitalAddress: 'Fictional school-project location; not a real facility.',
    demoData: true,
  };

  const doctorAccounts = [];
  const doctors = [];
  for (const [index, [name, department, specialty]] of profiles.entries()) {
    const id = `ci-demo-doctor-${index + 1}`;
    const email = `doctor.${index + 1}@demo.invalid`;
    const schedule = weekdays.map(day => ({ day, slots: clinicSlots() }));
    const account = {
      id,
      role: 'doctor',
      name: `Dr. ${name}`,
      email,
      passwordHash: await hashPassword(demoPassword),
      department,
      specialty,
      qualifications: 'Fictional profile for a school project; not a real clinician.',
      phoneNumber: '+91 00000 00000',
      gender: 'Prefer not to say',
      age: 40,
      workExperience: 10,
      profilePhoto: '',
      schedule,
      hospitalName,
      onLeave: false,
      demoData: true,
    };
    doctorAccounts.push(account);
    doctors.push({
      id,
      accountId: id,
      name: account.name,
      email,
      department,
      specialty,
      qualifications: account.qualifications,
      phoneNumber: account.phoneNumber,
      gender: account.gender,
      age: account.age,
      workExperience: account.workExperience,
      profilePhoto: '',
      schedule,
      availability: schedule.flatMap(day => day.slots),
      hospitalName,
      onLeave: false,
      demoData: true,
    });
  }

  const inserted = insertDemoData({ doctors, doctorAccounts, hospitalAccounts: [hospital] });
  if (!inserted) {
    console.log('Demo data is already installed; profile names were refreshed without adding accounts.');
    return;
  }

  console.log(`Added ${doctors.length} fictional doctors at ${hospitalName}.`);
  console.log(`Hospital sign-in: ${hospitalEmail} / ${demoPassword}`);
  console.log(`Doctor sign-in: ${doctorAccounts[0].email} through ${doctorAccounts.at(-1).email} / ${demoPassword}`);
  console.log('These accounts and profiles are for local demos only. Do not deploy them or enter real patient data.');
}

main()
  .catch(error => {
    console.error(`Could not seed demo data: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closeStore();
  });
