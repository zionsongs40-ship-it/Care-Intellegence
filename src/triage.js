const departmentRules = [
  { keywords: ['chest pain', 'shortness of breath', 'heart', 'arrhythmia', 'hypertension', 'blood pressure'], department: 'Cardiology', priority: 'Routine' },
  { keywords: ['stroke', 'seizure', 'migraine', 'paralysis', 'numbness', 'brain', 'spine'], department: 'Neurology', priority: 'Urgent' },
  { keywords: ['fracture', 'joint pain', 'sprain', 'back pain', 'bone', 'knee pain'], department: 'Orthopedics', priority: 'Urgent' },
  { keywords: ['pregnancy', 'abortion', 'gyne', 'uterus', 'ovary', 'childbirth', 'menstrual', 'menopause'], department: 'OB/GYN', priority: 'Urgent' },
  { keywords: ['cancer', 'tumor', 'lump', 'chemotherapy', 'oncology'], department: 'Oncology', priority: 'Urgent' },
  { keywords: ['surgery', 'appendix', 'abdominal pain', 'operation', 'surgical'], department: 'General Surgery', priority: 'Urgent' },
  { keywords: ['child', 'infant', 'fever', 'vaccination', 'pediatric'], department: 'Pediatrics', priority: 'Routine' },
  { keywords: ['checkup', 'routine', 'consultation', 'wellness'], department: 'General Medicine', priority: 'Routine' },
];

const emergencyKeywords = [
  'chest pain',
  'shortness of breath',
  'difficulty breathing',
  'heart attack',
  'stroke',
  'seizure',
  'unconscious',
  'severe bleeding',
  'major bleeding',
  'accident',
  'trauma',
  'severe injury',
];

function normalizeText(value = '') {
  return String(value).toLowerCase();
}

function triagePatient(patient) {
  const text = normalizeText(patient.disease || '');
  const purpose = normalizeText(patient.purpose || '');
  let matched = { department: 'General Medicine', priority: 'Routine' };

  for (const rule of departmentRules) {
    const hit = rule.keywords.some(keyword => text.includes(keyword));
    if (hit) {
      matched = { department: rule.department, priority: rule.priority };
      break;
    }
  }

  const emergency = emergencyKeywords.some(keyword => text.includes(keyword))
    || /\b(severe|critical)\b/.test(text)
    || patient.emergency;

  if (emergency) {
    return {
      department: 'Emergency Department (Casualty)',
      priority: 'Emergency',
      referralDepartment: matched.department === 'General Medicine' ? null : matched.department,
    };
  }

  if (Number(patient.age) < 18 && matched.department === 'General Medicine') {
    matched.department = 'Pediatrics';
  }

  if (purpose.includes('operation') && matched.priority !== 'Emergency') {
    matched.priority = 'Urgent';
    if (matched.department === 'General Medicine') {
      matched.department = 'General Surgery';
    }
  }

  return matched;
}

function findBestDoctor(department, doctors = []) {
  if (!doctors.length) {
    return { name: 'No doctor available', department, availability: [] };
  }

  const filtered = doctors.filter(doctor => !doctor.onLeave && (doctor.department === department || doctor.specialty === department));
  return filtered[0] || { name: 'No doctor available', department, availability: [] };
}

function findAvailableAppointment(department, doctors = [], appointments = [], date, priority) {
  if (priority === 'Emergency') {
    const doctor = findBestDoctor('Emergency Department (Casualty)', doctors);
    if (doctor.name === 'No doctor available') return null;
    return { doctor, timeSlot: 'Immediate — Emergency Department (24/7)' };
  }

  const candidates = [];
  const weekday = date ? new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : null;
  const currentDate = new Date().toISOString().slice(0, 10);
  const currentTime = new Date().toISOString().slice(11, 16);
  for (const doctor of doctors) {
    if (doctor.onLeave || (doctor.department !== department && doctor.specialty !== department)) continue;

    const scheduledDays = Array.isArray(doctor.schedule)
      ? doctor.schedule.filter(day => day.day === weekday)
      : [];
    const availableSlots = doctor.schedule
      ? scheduledDays.flatMap(day => day.slots)
      : doctor.availability || [];
    for (const timeSlot of availableSlots) {
      if (timeSlot === '24/7') continue;
      if (date === currentDate && timeSlot <= currentTime) continue;
      const isBooked = appointments.some(appointment =>
        appointment.date === date
        && appointment.recommendedDoctor === doctor.name
        && appointment.timeSlot === timeSlot
      );
      if (!isBooked) candidates.push({ doctor, timeSlot });
    }
  }

  candidates.sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  return candidates[0] || null;
}

function rescheduleAppointments(appointments = [], doctorName, doctors = []) {
  if (!doctorName) return appointments;

  const availableDoctors = doctors.filter(doctor => doctor.name !== doctorName);
  const updatedAppointments = appointments.slice();
  for (let index = 0; index < updatedAppointments.length; index += 1) {
    const item = updatedAppointments[index];
    if (item.recommendedDoctor !== doctorName) continue;
    const replacement = findAvailableAppointment(
      item.department,
      availableDoctors,
      updatedAppointments.filter((_, appointmentIndex) => appointmentIndex !== index),
      item.date,
      item.priority,
    );
    if (!replacement) continue;
    updatedAppointments[index] = {
      ...item,
      recommendedDoctor: replacement.doctor.name,
      timeSlot: replacement.timeSlot,
      rescheduled: true,
      rescheduleNote: `Doctor ${doctorName} is on leave. Reassigned to ${replacement.doctor.name}.`,
    };
  }
  return updatedAppointments;
}

function buildAppointmentSummary(details) {
  return `Patient: ${details.name}\nDisease: ${details.disease}\nPurpose: ${details.purpose}\nDepartment: ${details.department}\nDoctor: ${details.doctor}\nTime Slot: ${details.time}`;
}

module.exports = {
  triagePatient,
  findBestDoctor,
  rescheduleAppointments,
  buildAppointmentSummary,
  findAvailableAppointment,
  departmentRules,
};
