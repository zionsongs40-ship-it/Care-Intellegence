const test = require('node:test');
const assert = require('node:assert/strict');
const { triagePatient, findBestDoctor, findAvailableAppointment, buildAppointmentSummary, rescheduleAppointments } = require('../src/triage');

test('routes chest pain to casualty first and flags cardiology follow-up', () => {
  const result = triagePatient({
    disease: 'Chest pain and shortness of breath',
    purpose: 'Treatment',
    age: 52,
    emergency: false,
  });

  assert.equal(result.department, 'Emergency Department (Casualty)');
  assert.equal(result.priority, 'Emergency');
  assert.equal(result.referralDepartment, 'Cardiology');
});

test('routes a fracture after an accident to casualty first', () => {
  const result = triagePatient({
    disease: 'Fractured leg after accident',
    purpose: 'Operation',
    age: 28,
    emergency: true,
  });

  assert.equal(result.department, 'Emergency Department (Casualty)');
  assert.equal(result.priority, 'Emergency');
  assert.equal(result.referralDepartment, 'Orthopedics');
});

test('routes a non-emergency fracture to orthopedics', () => {
  const result = triagePatient({ disease: 'Knee fracture', age: 28 });

  assert.equal(result.department, 'Orthopedics');
  assert.equal(result.priority, 'Urgent');
});

test('routes hypertension to cardiology without automatically marking it an emergency', () => {
  const result = triagePatient({ disease: 'Hypertension', age: 52 });

  assert.equal(result.department, 'Cardiology');
  assert.equal(result.priority, 'Routine');
});

test('routes general symptoms for a child to pediatrics', () => {
  const result = triagePatient({ disease: 'Rash', age: 9 });

  assert.equal(result.department, 'Pediatrics');
});

test('findBestDoctor chooses the best specialist for the patient', () => {
  const doctors = [
    { name: 'Dr. Smith', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00', '09:30', '10:00'] },
    { name: 'Dr. Jones', department: 'Cardiology', specialty: 'Cardiology', availability: ['11:00', '11:30'] },
    { name: 'Dr. Green', department: 'Neurology', specialty: 'Neurology', availability: ['10:00'] },
  ];

  const result = findBestDoctor('Cardiology', doctors);
  assert.equal(result.name, 'Dr. Smith');
});

test('buildAppointmentSummary includes patient, department and time slot', () => {
  const summary = buildAppointmentSummary({
    name: 'Alice',
    disease: 'High blood pressure',
    purpose: 'Regular checkup',
    department: 'Cardiology',
    doctor: 'Dr. Smith',
    time: '09:00',
  });

  assert.match(summary, /Alice/);
  assert.match(summary, /Cardiology/);
  assert.match(summary, /09:00/);
});

test('findBestDoctor skips doctors on leave', () => {
  const doctors = [
    { name: 'Dr. Smith', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00'], onLeave: true },
    { name: 'Dr. Jones', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:30'] },
  ];

  const result = findBestDoctor('Cardiology', doctors);
  assert.equal(result.name, 'Dr. Jones');
});

test('findBestDoctor does not send a patient to an unrelated department', () => {
  const doctors = [
    { name: 'Dr. Green', department: 'Neurology', specialty: 'Neurology', availability: ['10:00'] },
  ];

  const result = findBestDoctor('Cardiology', doctors);
  assert.equal(result.name, 'No doctor available');
});

test('findAvailableAppointment reserves an unbooked slot with the matching doctor', () => {
  const doctors = [
    { name: 'Dr. Smith', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00', '09:30'] },
    { name: 'Dr. Jones', department: 'Cardiology', specialty: 'Cardiology', availability: ['10:00'] },
  ];
  const appointments = [{
    date: '2026-10-01',
    recommendedDoctor: 'Dr. Smith',
    timeSlot: '09:00',
  }];

  const result = findAvailableAppointment('Cardiology', doctors, appointments, '2026-10-01', 'Routine');
  assert.equal(result.doctor.name, 'Dr. Smith');
  assert.equal(result.timeSlot, '09:30');
});

test('findAvailableAppointment respects a doctor weekly schedule', () => {
  const doctors = [{
    name: 'Dr. Smith',
    department: 'Cardiology',
    specialty: 'Cardiology',
    schedule: [
      { day: 'Monday', slots: ['09:00'] },
      { day: 'Monday', slots: ['09:30'] },
    ],
  }];

  assert.equal(findAvailableAppointment('Cardiology', doctors, [], '2026-09-28', 'Routine').timeSlot, '09:00');
  assert.equal(findAvailableAppointment('Cardiology', doctors, [{
    date: '2026-09-28',
    recommendedDoctor: 'Dr. Smith',
    timeSlot: '09:00',
  }], '2026-09-28', 'Routine').timeSlot, '09:30');
  assert.equal(findAvailableAppointment('Cardiology', doctors, [], '2026-09-29', 'Routine'), null);
});

test('emergency bookings are routed to an available casualty doctor immediately', () => {
  const doctors = [
    { name: 'Dr. Cardio', department: 'Cardiology', availability: ['09:00'] },
    { name: 'Dr. Casualty', department: 'Emergency Department (Casualty)', availability: ['24/7'] },
  ];

  const result = findAvailableAppointment('Emergency Department (Casualty)', doctors, [], '2026-10-01', 'Emergency');
  assert.equal(result.doctor.name, 'Dr. Casualty');
  assert.match(result.timeSlot, /Immediate/);
});

test('rescheduleAppointments moves patients to another doctor when the assigned doctor is on leave', () => {
  const doctors = [
    { name: 'Dr. Smith', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00'], onLeave: true },
    { name: 'Dr. Jones', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:30'] },
  ];

  const appointments = [{
    patient: 'Alice',
    department: 'Cardiology',
    recommendedDoctor: 'Dr. Smith',
    priority: 'Urgent',
    timeSlot: '09:00',
  }];

  const updated = rescheduleAppointments(appointments, 'Dr. Smith', doctors);
  assert.equal(updated[0].recommendedDoctor, 'Dr. Jones');
  assert.equal(updated[0].priority, 'Urgent');
});

test('rescheduleAppointments preserves departments and avoids double-booking a replacement', () => {
  const doctors = [
    { name: 'Dr. Smith', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00'], onLeave: true },
    { name: 'Dr. Jones', department: 'Cardiology', specialty: 'Cardiology', availability: ['09:00', '09:30'] },
    { name: 'Dr. Green', department: 'Neurology', specialty: 'Neurology', availability: ['09:00'] },
  ];
  const appointments = [
    { patient: 'Alice', department: 'Cardiology', recommendedDoctor: 'Dr. Smith', timeSlot: '09:00' },
    { patient: 'Bob', department: 'Cardiology', recommendedDoctor: 'Dr. Smith', timeSlot: '09:00' },
  ];

  const updated = rescheduleAppointments(appointments, 'Dr. Smith', doctors);
  assert.equal(updated[0].recommendedDoctor, 'Dr. Jones');
  assert.equal(updated[1].recommendedDoctor, 'Dr. Jones');
  assert.notEqual(updated[0].timeSlot, updated[1].timeSlot);
});
