const crypto = require('crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const { hashPassword, verifyPassword } = require('./src/auth');
const { triagePatient, findAvailableAppointment, buildAppointmentSummary } = require('./src/triage');
const { isNoShowDue } = require('./src/no-shows');
const { loadStore, saveStore } = require('./src/store');

const app = express();
const PORT = process.env.PORT || 3000;
const departments = [
  'Emergency Department (Casualty)',
  'Cardiology',
  'Neurology',
  'Orthopedics',
  'Pediatrics',
  'OB/GYN',
  'Oncology',
  'General Surgery',
  'General Medicine',
];
const purposes = ['Regular checkup', 'Blood test', 'Treatment', 'Operation'];
const sessionLifetime = 8 * 60 * 60 * 1000;
const sessions = new Map();
const store = loadStore();
const appointments = store.appointments;
const doctors = store.doctors;
const doctorAccounts = store.doctorAccounts;
const hospitalAccounts = store.hospitalAccounts;
let noShows = store.noShows || [];

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function createRateLimiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message },
  });
}

const signInLimiter = createRateLimiter(15 * 60 * 1000, 10, 'Too many sign-in attempts. Please wait 15 minutes before trying again.');
const registrationLimiter = createRateLimiter(60 * 60 * 1000, 5, 'Too many account registration attempts. Please try again later.');
const doctorRegistrationLimiter = createRateLimiter(60 * 60 * 1000, 5, 'Too many doctor registration attempts. Please try again later.');
const bookingLimiter = createRateLimiter(15 * 60 * 1000, 30, 'Too many booking attempts. Please try again later.');
const adminActionLimiter = createRateLimiter(15 * 60 * 1000, 10, 'Too many administrator confirmation attempts. Please wait before trying again.');

app.get('/LOGO.MP4.mp4', (req, res) => {
  res.sendFile(path.join(__dirname, 'LOGO.MP4.mp4'));
});

app.get('/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'logo.png.png'));
});

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(cookie => {
    const separator = cookie.indexOf('=');
    if (separator < 0) return ['', ''];
    return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function getCurrentSession(req) {
  const token = parseCookies(req.headers.cookie).hospitalSession;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionLifetime;
  return session;
}

function requireRole(role) {
  return (req, res, next) => {
    const session = getCurrentSession(req);
    if (!session || (role && session.role !== role)) {
      return res.status(401).json({ message: 'Please sign in with an authorized account to continue.' });
    }
    req.session = session;
    next();
  };
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `hospitalSession=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`);
}

function createSession(res, role, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, user, expiresAt: Date.now() + sessionLifetime });
  setSessionCookie(res, token);
}

function cleanText(value, maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validPhone(value) {
  return typeof value === 'string' && /^\+?[\d\s().-]{7,20}$/.test(value.trim());
}

function publicDoctor(doctor) {
  return {
    name: doctor.name,
    department: doctor.department,
    specialty: doctor.specialty,
    onLeave: Boolean(doctor.onLeave),
  };
}

function accountSafeView(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    department: account.department,
    specialty: account.specialty,
    hospitalName: account.hospitalName,
  };
}

function getHospitalAppointments(hospitalName) {
  return appointments.filter(appointment => appointment.hospitalName === hospitalName);
}

function getBookableDoctors(hospitalName) {
  const registeredHospitalNames = new Set(hospitalAccounts.map(account => account.hospitalName));
  return doctors.filter(doctor =>
    doctor.hospitalName
    && registeredHospitalNames.has(doctor.hospitalName)
    && doctor.approved !== false
    && (!hospitalName || doctor.hospitalName === hospitalName)
  );
}

function appointmentQueue(items) {
  const priorityOrder = { Emergency: 0, Urgent: 1, Routine: 2 };
  return items.slice().sort((a, b) =>
    (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
    || String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.timeSlot || '').localeCompare(String(b.timeSlot || ''))
  );
}

app.get('/api/health', (req, res) => {
  res.json({ message: 'Hospital appointment API is running', departments });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/booking', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/doctor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctor.html')));
app.get('/doctor-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctor-login.html')));
app.get('/doctor-register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctor-register.html')));
app.get('/hospital', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hospital.html')));
app.get('/hospital-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hospital-login.html')));
app.get('/hospital-register', (req, res) => {
  if (hospitalAccounts.length > 0) return res.redirect(302, '/hospital-login');
  res.sendFile(path.join(__dirname, 'public', 'hospital-register.html'));
});

app.get('/api/session', (req, res) => {
  const session = getCurrentSession(req);
  if (!session) return res.status(401).json({ message: 'Sign in required' });
  res.json({ role: session.role, user: session.user });
});

app.post('/api/session/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).hospitalSession;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'hospitalSession=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.status(204).end();
});

app.get('/api/appointments', requireRole(), (req, res) => {
  let visibleAppointments;
  if (req.session.role === 'hospital') {
    visibleAppointments = getHospitalAppointments(req.session.user.hospitalName);
  } else {
    visibleAppointments = appointments.filter(item =>
      (item.doctorId && item.doctorId === req.session.user.id)
      || (!item.doctorId && item.recommendedDoctor === req.session.user.name)
    );
  }
  res.json(appointmentQueue(visibleAppointments));
});

app.post('/api/appointments/:id/check-in', requireRole('hospital'), (req, res) => {
  const appointment = appointments.find(item =>
    item.id === req.params.id
    && item.hospitalName === req.session.user.hospitalName
  );
  if (!appointment) return res.status(404).json({ message: 'Appointment not found for this hospital.' });
  if (!appointment.checkedIn) {
    appointment.checkedIn = true;
    appointment.checkedInAt = new Date().toISOString();
    saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  }
  res.json({ message: `${appointment.patient} marked as arrived.` });
});

app.get('/api/reports/appointments.xlsx', requireRole('hospital'), async (req, res, next) => {
  try {
    const hospitalName = req.session.user.hospitalName;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CI Care Intelligence';
    workbook.created = new Date();
    workbook.subject = 'Hospital appointment report';

    const appointmentSheet = workbook.addWorksheet('Appointments');
    appointmentSheet.columns = [
      { header: 'Patient', key: 'patient', width: 24 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Age', key: 'age', width: 10 },
      { header: 'Gender', key: 'gender', width: 20 },
      { header: 'Reason', key: 'disease', width: 36 },
      { header: 'Purpose', key: 'purpose', width: 20 },
      { header: 'Department', key: 'department', width: 32 },
      { header: 'Doctor', key: 'doctor', width: 24 },
      { header: 'Priority', key: 'priority', width: 14 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 32 },
      { header: 'Arrived', key: 'arrived', width: 12 },
      { header: 'Guardian', key: 'guardian', width: 24 },
      { header: 'Guardian phone', key: 'guardianPhone', width: 20 },
      { header: 'Notes', key: 'notes', width: 40 },
    ];
    appointmentSheet.getRow(1).font = { bold: true };
    for (const item of appointmentQueue(getHospitalAppointments(hospitalName))) {
      appointmentSheet.addRow({
        patient: item.patient,
        phone: item.patientContact?.phone || '',
        age: item.patientContact?.age ?? '',
        gender: item.patientContact?.gender || '',
        disease: item.disease,
        purpose: item.purpose,
        department: item.department,
        doctor: item.recommendedDoctor,
        priority: item.priority,
        date: item.date,
        time: item.timeSlot,
        arrived: item.checkedIn ? 'Yes' : 'No',
        guardian: item.guardianAccompanying ? item.guardian?.name || '' : '',
        guardianPhone: item.guardianAccompanying ? item.guardian?.phone || '' : '',
        notes: item.notes || '',
      });
    }
    appointmentSheet.views = [{ state: 'frozen', ySplit: 1 }];
    appointmentSheet.autoFilter = {
      from: 'A1',
      to: `O${Math.max(1, appointmentSheet.rowCount)}`,
    };

    const noShowSheet = workbook.addWorksheet('No-show follow-up');
    noShowSheet.columns = [
      { header: 'Patient', key: 'patient', width: 24 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Guardian phone', key: 'guardianPhone', width: 20 },
      { header: 'Department', key: 'department', width: 32 },
      { header: 'Doctor', key: 'doctor', width: 24 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Time', key: 'time', width: 32 },
      { header: 'Contact attempts', key: 'attempts', width: 18 },
      { header: 'Verified', key: 'verified', width: 12 },
      { header: 'Reported reason', key: 'outcome', width: 40 },
    ];
    noShowSheet.getRow(1).font = { bold: true };
    for (const item of noShows.filter(record => record.hospitalName === hospitalName)) {
      noShowSheet.addRow({
        patient: item.patient,
        phone: item.patientContact?.phone || '',
        guardianPhone: item.guardian?.phone || '',
        department: item.department,
        doctor: item.recommendedDoctor,
        date: item.date,
        time: item.timeSlot,
        attempts: item.attempts || 0,
        verified: item.verified ? 'Yes' : 'No',
        outcome: item.verificationOutcome || '',
      });
    }
    noShowSheet.views = [{ state: 'frozen', ySplit: 1 }];
    noShowSheet.autoFilter = {
      from: 'A1',
      to: `J${Math.max(1, noShowSheet.rowCount)}`,
    };

    const fileBuffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ci-care-hospital-report.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(fileBuffer));
  } catch (error) {
    next(error);
  }
});

app.get('/api/doctors', (req, res) => {
  const hospitalName = cleanText(req.query.hospitalName, 120);
  res.json(getBookableDoctors(hospitalName).map(publicDoctor));
});

app.get('/api/hospital/doctors', requireRole('hospital'), (req, res) => {
  const hospitalName = req.session.user.hospitalName;
  res.json(doctors
    .filter(doctor => doctor.hospitalName === hospitalName)
    .map(doctor => {
      const account = doctorAccounts.find(item => item.id === doctor.accountId);
      return {
        id: doctor.accountId,
        name: doctor.name,
        department: doctor.department,
        specialty: doctor.specialty,
        onLeave: Boolean(doctor.onLeave),
        approved: account ? account.approved !== false : doctor.approved !== false,
      };
    }));
});

app.get('/api/hospitals', (req, res) => {
  const registeredHospitalNames = new Set(hospitalAccounts.map(account => account.hospitalName));
  res.json([...registeredHospitalNames].sort((a, b) => a.localeCompare(b)).map(hospitalName => ({ hospitalName })));
});

app.get('/api/hospitals/nearest', (req, res) => {
  const latitudeValue = req.query.latitude;
  const longitudeValue = req.query.longitude;
  const latitude = typeof latitudeValue === 'string' && latitudeValue.trim() ? Number(latitudeValue) : NaN;
  const longitude = typeof longitudeValue === 'string' && longitudeValue.trim() ? Number(longitudeValue) : NaN;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ message: 'Provide a valid current latitude and longitude to find a nearby hospital.' });
  }

  const radians = degrees => degrees * Math.PI / 180;
  const distanceInKilometers = (hospitalLatitude, hospitalLongitude) => {
    const latitudeDifference = radians(hospitalLatitude - latitude);
    const longitudeDifference = radians(hospitalLongitude - longitude);
    const haversine = Math.sin(latitudeDifference / 2) ** 2
      + Math.cos(radians(latitude)) * Math.cos(radians(hospitalLatitude))
      * Math.sin(longitudeDifference / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  };

  const nearest = hospitalAccounts
    .filter(account => Number.isFinite(account.latitude) && Number.isFinite(account.longitude))
    .map(account => {
      const distance = distanceInKilometers(account.latitude, account.longitude);
      let mapLocation = '';
      try {
        const mapUrl = new URL(account.hospitalMapLocation);
        if (mapUrl.protocol === 'https:') mapLocation = mapUrl.href;
      } catch {}
      return {
        hospitalName: account.hospitalName,
        phoneNumber: validPhone(account.hospitalPhoneNumber) ? account.hospitalPhoneNumber : null,
        address: account.hospitalAddress,
        mapLocation,
        distanceKilometers: distance,
      };
    })
    .sort((a, b) => a.distanceKilometers - b.distanceKilometers)[0];

  if (!nearest) {
    return res.status(404).json({ message: 'No registered hospital has location details for emergency directions yet. Call your local emergency number or go to the nearest emergency department.' });
  }
  res.json({ ...nearest, distanceKilometers: Math.round(nearest.distanceKilometers * 10) / 10 });
});

app.post('/api/doctors/register', doctorRegistrationLimiter, async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const department = cleanText(body.department);
  const specialty = cleanText(body.specialty);
  const qualifications = cleanText(body.qualifications, 240);
  const phoneNumber = cleanText(body.phoneNumber, 20);
  const hospitalName = cleanText(body.hospitalName);
  const age = Number(body.age);
  const workExperience = Number(body.workExperience);
  const gender = body.gender;
  const profilePhoto = typeof body.profilePhoto === 'string' ? body.profilePhoto : '';
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  const imageMatch = profilePhoto.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  const imageBytes = imageMatch ? Buffer.from(imageMatch[2], 'base64') : Buffer.alloc(0);
  const validImageSignature = imageMatch?.[1] === 'png'
    ? imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : imageMatch?.[1] === 'jpeg'
      ? imageBytes[0] === 255 && imageBytes[1] === 216 && imageBytes[2] === 255
      : imageMatch?.[1] === 'webp'
        ? imageBytes.toString('ascii', 0, 4) === 'RIFF' && imageBytes.toString('ascii', 8, 12) === 'WEBP'
        : false;
  const validImage = Boolean(imageMatch && validImageSignature)
    && Buffer.byteLength(profilePhoto, 'utf8') <= 2 * 1024 * 1024;
  const validSchedule = schedule.length > 0 && schedule.every(day =>
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(day.day)
    && Array.isArray(day.slots)
    && day.slots.length > 0
    && day.slots.every(slot => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot))
  );

  if (!name || !validEmail(email) || password.length < 8 || password.length > 256 || !departments.includes(department)
      || !specialty || !qualifications || !validPhone(phoneNumber)
      || !Number.isInteger(age) || age < 21 || age > 100
      || !Number.isInteger(workExperience) || workExperience < 0 || workExperience > 80
      || !['Male', 'Female', 'Other', 'Prefer not to say'].includes(gender)
      || !validImage || !validSchedule || !hospitalName) {
    return res.status(400).json({ message: 'Check the required fields. Passwords need at least 8 characters and a valid schedule and profile image are required.' });
  }

  if (!hospitalAccounts.some(account => account.hospitalName === hospitalName)) {
    return res.status(400).json({ message: 'Selected hospital is not registered.' });
  }
  if (doctorAccounts.some(account => typeof account.email === 'string' && account.email.toLowerCase() === email)) {
    return res.status(409).json({ message: 'An account already exists for this email.' });
  }

  const passwordHash = await hashPassword(password);
  if (doctorAccounts.some(account => typeof account.email === 'string' && account.email.toLowerCase() === email)) {
    return res.status(409).json({ message: 'An account already exists for this email.' });
  }
  const account = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash,
    department,
    specialty,
    qualifications,
    phoneNumber,
    gender,
    age,
    workExperience,
    profilePhoto,
    schedule,
    hospitalName,
    onLeave: false,
    approved: false,
  };
  const doctor = {
    ...accountSafeView(account),
    accountId: account.id,
    qualifications,
    phoneNumber,
    gender,
    age,
    workExperience,
    profilePhoto,
    schedule,
    availability: schedule.flatMap(day => day.slots),
    onLeave: false,
    approved: false,
  };
  doctorAccounts.push(account);
  doctors.push(doctor);
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });

  res.status(201).json({ message: 'Registration submitted. You can sign in after the hospital administrator approves your account.' });
});

app.post('/api/doctors/signin', signInLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const account = doctorAccounts.find(item => typeof item.email === 'string' && item.email.toLowerCase() === email);
  if (!account || password.length > 256 || !(await verifyPassword(password, account))) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }
  if (account.approved === false) {
    return res.status(403).json({ message: 'Your account is awaiting approval from the hospital administrator.' });
  }

  if (!account.passwordHash) {
    account.passwordHash = await hashPassword(password);
    delete account.password;
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  }
  const doctor = doctors.find(item => item.accountId === account.id) || doctors.find(item => item.name === account.name);
  if (!doctor) return res.status(403).json({ message: 'Doctor profile is not active. Contact the hospital administrator.' });

  const user = { id: account.id, name: doctor.name, department: doctor.department, specialty: doctor.specialty };
  createSession(res, 'doctor', user);
  res.json({ message: 'Doctor signed in successfully.', user });
});

app.post('/api/doctors/:id/approval', requireRole('hospital'), (req, res) => {
  const approved = req.body?.approved;
  if (typeof approved !== 'boolean') {
    return res.status(400).json({ message: 'Choose whether to approve or reject this doctor account.' });
  }
  const doctor = doctors.find(item =>
    String(item.accountId || item.id) === String(req.params.id)
    && item.hospitalName === req.session.user.hospitalName
  );
  if (!doctor) return res.status(404).json({ message: 'Doctor account not found for this hospital.' });

  const account = doctorAccounts.find(item => item.id === doctor.accountId);
  if (!account) return res.status(404).json({ message: 'Doctor sign-in account not found.' });
  account.approved = approved;
  doctor.approved = approved;
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.json({ message: `${doctor.name} ${approved ? 'approved' : 'rejected'}.`, approved });
});

app.post('/api/hospital/register', registrationLimiter, async (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name);
  const hospitalName = cleanText(body.hospitalName);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const hospitalPhoneNumber = cleanText(body.hospitalPhoneNumber, 20);
  const hospitalAddress = cleanText(body.hospitalAddress, 300);
  const hospitalMapLocation = typeof body.hospitalMapLocation === 'string' ? body.hospitalMapLocation.trim() : '';
  const hasLatitude = typeof body.latitude === 'number'
    || (typeof body.latitude === 'string' && body.latitude.trim() !== '');
  const hasLongitude = typeof body.longitude === 'number'
    || (typeof body.longitude === 'string' && body.longitude.trim() !== '');
  const latitude = hasLatitude ? Number(body.latitude) : NaN;
  const longitude = hasLongitude ? Number(body.longitude) : NaN;
  let validMapLocation = false;
  try {
    const mapUrl = new URL(hospitalMapLocation);
    validMapLocation = mapUrl.protocol === 'https:';
  } catch {}

  if (!name || !hospitalName || !validEmail(email) || password.length < 8 || password.length > 256
      || !validPhone(hospitalPhoneNumber) || !hospitalAddress || !validMapLocation
      || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ message: 'Enter valid administrator, hospital, contact, address, HTTPS map link, latitude, longitude, and password details. Passwords need at least 8 characters.' });
  }
  if (hospitalAccounts.some(account => typeof account.email === 'string' && account.email.toLowerCase() === email)) {
    return res.status(409).json({ message: 'An account already exists for this email.' });
  }
  if (hospitalAccounts.some(account => account.hospitalName.toLowerCase() === hospitalName.toLowerCase())) {
    return res.status(409).json({ message: 'This hospital is already registered.' });
  }
  if (hospitalAccounts.length > 0) {
    return res.status(409).json({ message: `This project supports one hospital only: ${hospitalAccounts[0].hospitalName}.` });
  }

  const account = {
    id: crypto.randomUUID(),
    name,
    hospitalName,
    email,
    passwordHash: await hashPassword(password),
    hospitalPhoneNumber,
    hospitalAddress,
    hospitalMapLocation,
    latitude,
    longitude,
  };
  if (hospitalAccounts.some(item => typeof item.email === 'string' && item.email.toLowerCase() === email)) {
    return res.status(409).json({ message: 'An account already exists for this email.' });
  }
  if (hospitalAccounts.some(item => item.hospitalName.toLowerCase() === hospitalName.toLowerCase())) {
    return res.status(409).json({ message: 'This hospital is already registered.' });
  }
  hospitalAccounts.push(account);
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.status(201).json({ message: 'Hospital admin registered. Sign in to manage your hospital.' });
});

app.post('/api/hospital/signin', signInLimiter, async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (hospitalAccounts.length !== 1) {
    return res.status(503).json({ message: 'Hospital admin sign-in is unavailable until exactly one hospital is configured.' });
  }
  const [account] = hospitalAccounts;
  if (!password || password.length > 256 || !(await verifyPassword(password, account))) {
    return res.status(401).json({ message: 'Invalid hospital admin password.' });
  }
  if (!account.passwordHash) {
    account.passwordHash = await hashPassword(password);
    delete account.password;
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  }

  const user = { name: account.name, hospitalName: account.hospitalName, email: account.email };
  createSession(res, 'hospital', user);
  res.json({ message: 'Hospital admin signed in successfully.', user });
});

app.post('/api/doctors/leave', requireRole('hospital'), (req, res) => {
  const doctorName = cleanText(req.body?.doctorName);
  const doctor = doctors.find(item => item.name === doctorName
    && item.hospitalName === req.session.user.hospitalName);
  if (!doctor) return res.status(404).json({ message: 'Doctor not found for this hospital.' });

  const onLeave = req.body.onLeave === true;
  const today = new Date().toISOString().slice(0, 10);
  let updatedAppointments = appointments.slice();
  let reassignedCount = 0;
  if (onLeave) {
    doctor.onLeave = true;
    const hospitalDoctors = doctors.filter(item => item.hospitalName === doctor.hospitalName);
    for (let index = 0; index < appointments.length; index += 1) {
      const appointment = appointments[index];
      const assigned = appointment.doctorId
        ? appointment.doctorId === doctor.accountId
        : appointment.recommendedDoctor === doctor.name;
      if (!assigned || appointment.date < today) continue;

      const otherAppointments = updatedAppointments.filter((item, itemIndex) => itemIndex !== index);
      const replacement = findAvailableAppointment(
        appointment.department,
        hospitalDoctors,
        otherAppointments,
        appointment.date,
        appointment.priority,
      );
      if (!replacement) {
        doctor.onLeave = false;
        return res.status(409).json({
          message: `No matching doctor has an open slot for ${appointment.patient}'s ${appointment.date} appointment. Availability was not changed.`,
        });
      }
      updatedAppointments[index] = {
        ...appointment,
        doctorId: replacement.doctor.accountId || null,
        recommendedDoctor: replacement.doctor.name,
        timeSlot: replacement.timeSlot,
        rescheduled: true,
        rescheduleNote: `Reassigned from ${doctor.name} because the doctor is on leave.`,
      };
      reassignedCount += 1;
    }
  }

  doctor.onLeave = onLeave;
  const account = doctorAccounts.find(item => item.id === doctor.accountId);
  if (account) account.onLeave = doctor.onLeave;
  appointments.splice(0, appointments.length, ...updatedAppointments);
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.json({
    message: `${doctor.name} marked ${doctor.onLeave ? 'on leave' : 'available'}. ${reassignedCount} appointment(s) reassigned.`,
  });
});

app.post('/api/doctors/remove', requireRole('hospital'), adminActionLimiter, async (req, res) => {
  const adminPassword = typeof req.body?.adminPassword === 'string' ? req.body.adminPassword : '';
  const adminAccount = hospitalAccounts.find(account =>
    account.email === req.session.user.email
    && account.hospitalName === req.session.user.hospitalName
  );
  if (!adminAccount || !adminPassword || adminPassword.length > 256
      || !(await verifyPassword(adminPassword, adminAccount))) {
    return res.status(401).json({ message: 'Administrator password is incorrect. The doctor was not removed.' });
  }

  const doctorName = cleanText(req.body?.doctorName);
  const doctor = doctors.find(item => item.name === doctorName
    && item.hospitalName === req.session.user.hospitalName);
  if (!doctor) return res.status(404).json({ message: 'Doctor not found for this hospital.' });
  if (appointments.some(item => (item.doctorId === doctor.accountId
      || (!item.doctorId && item.recommendedDoctor === doctor.name))
      && item.date >= new Date().toISOString().slice(0, 10))) {
    return res.status(409).json({ message: 'This doctor still has future appointments. Reassign them before removing the doctor.' });
  }

  const updatedDoctors = doctors.filter(item => item !== doctor);
  const updatedAccounts = doctorAccounts.filter(account =>
    doctor.accountId ? account.id !== doctor.accountId
      : account.name !== doctor.name || account.hospitalName !== doctor.hospitalName
  );
  doctors.splice(0, doctors.length, ...updatedDoctors);
  doctorAccounts.splice(0, doctorAccounts.length, ...updatedAccounts);
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.json({ message: `${doctorName} removed from the hospital roster.` });
});

app.get('/api/hospital-summary', requireRole('hospital'), (req, res) => {
  const hospitalAppointments = getHospitalAppointments(req.session.user.hospitalName);
  const summary = {
    totalPatients: hospitalAppointments.length,
    emergencyCases: hospitalAppointments.filter(item => item.priority === 'Emergency').length,
    urgentCases: hospitalAppointments.filter(item => item.priority === 'Urgent').length,
    routineCases: hospitalAppointments.filter(item => item.priority === 'Routine').length,
    departments: {},
    doctors: {},
  };
  for (const item of hospitalAppointments) {
    summary.departments[item.department] = (summary.departments[item.department] || 0) + 1;
    summary.doctors[item.recommendedDoctor] = (summary.doctors[item.recommendedDoctor] || 0) + 1;
  }
  res.json(summary);
});

app.post('/api/triage', bookingLimiter, (req, res) => {
  const patient = req.body || {};
  const name = cleanText(patient.name);
  const disease = cleanText(patient.disease, 500);
  const phone = cleanText(patient.phone, 20);
  const hospitalName = cleanText(patient.hospitalName);
  const purpose = cleanText(patient.purpose);
  const hasAgeValue = typeof patient.age === 'number'
    || (typeof patient.age === 'string' && patient.age.trim().length > 0);
  const age = Number(patient.age);
  const date = typeof patient.date === 'string' ? patient.date : '';
  const guardianAccompanying = patient.guardianAccompanying === true;
  const guardianName = cleanText(patient.guardianName);
  const guardianPhone = cleanText(patient.guardianPhone, 20);
  const guardianAge = Number(patient.guardianAge);
  const gender = patient.gender;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  const today = new Date().toISOString().slice(0, 10);

  if (!name || !hospitalName || !hospitalAccounts.some(account => account.hospitalName === hospitalName)
      || !hasAgeValue || !Number.isInteger(age) || age < 0 || age > 130
      || !['Male', 'Female', 'Other', 'Prefer not to say'].includes(gender)
      || !validPhone(phone) || !disease || !purposes.includes(purpose)
      || !parsedDate || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== date || date < today) {
    return res.status(400).json({ message: 'Enter valid patient details, select a registered hospital, provide contact number and symptoms, and choose a current or future appointment date.' });
  }
  if (guardianAccompanying && (!guardianName || !validPhone(guardianPhone)
      || !Number.isInteger(guardianAge) || guardianAge < 1 || guardianAge > 130)) {
    return res.status(400).json({ message: 'Enter valid name, phone number, and age for the accompanying guardian.' });
  }

  const triage = triagePatient({ disease, purpose, age, emergency: patient.emergency === true });
  const scheduled = findAvailableAppointment(
    triage.department,
    getBookableDoctors(hospitalName),
    appointments,
    date,
    triage.priority,
  );
  if (!scheduled) {
    return res.status(409).json({ message: `No available ${triage.department} doctor or appointment slot for ${date}. Please choose another date or contact the hospital.` });
  }
  const { doctor, timeSlot } = scheduled;
  const summary = buildAppointmentSummary({
    name,
    disease,
    purpose,
    department: triage.department,
    doctor: doctor.name,
    time: `${date} ${timeSlot}`,
  });
  const appointment = {
    id: crypto.randomUUID(),
    patient: name,
    doctorId: doctor.accountId || null,
    hospitalName,
    disease,
    purpose,
    department: triage.department,
    priority: triage.priority,
    recommendedDoctor: doctor.name,
    timeSlot,
    summary,
    date,
    referralDepartment: triage.referralDepartment || null,
    patientContact: { phone, age, gender },
    guardianAccompanying,
    guardian: guardianAccompanying ? { name: guardianName, phone: guardianPhone, age: guardianAge } : null,
    notes: cleanText(patient.notes, 2000),
  };
  appointments.push(appointment);
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });

  res.status(201).json({
    appointmentId: appointment.id,
    patient: name,
    hospitalName,
    department: triage.department,
    priority: triage.priority,
    recommendedDoctor: doctor.name,
    timeSlot,
    date,
    referralDepartment: appointment.referralDepartment,
    emergencyAdvice: triage.priority === 'Emergency'
      ? 'Seek emergency care now. Call your local emergency number or go directly to the Emergency Department (Casualty); do not wait for an online appointment.'
      : null,
    summary,
  });
});

// API for no-show records: hospital staff can review and verify released slots
app.get('/api/no-shows', requireRole('hospital'), (req, res) => {
  const hospitalName = req.session.user.hospitalName;
  res.json((noShows || []).filter(ns => !hospitalName || ns.hospitalName === hospitalName));
});

app.post('/api/no-shows/:id/verify', requireRole('hospital'), (req, res) => {
  const id = String(req.params.id || '');
  const hospitalName = req.session.user.hospitalName;
  const idx = noShows.findIndex(ns => ns.id === id && ns.hospitalName === hospitalName);
  if (idx === -1) return res.status(404).json({ message: 'No-show record not found.' });
  const outcome = cleanText(req.body?.outcome, 500);
  if (!outcome) return res.status(400).json({ message: 'Record what the patient or guardian said before verifying this no-show.' });
  noShows[idx].verified = true;
  noShows[idx].verifiedAt = new Date().toISOString();
  noShows[idx].verificationOutcome = outcome;
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.json({ message: 'No-show verified and recorded.', record: noShows[idx] });
});

app.post('/api/no-shows/:id/contact-attempt', requireRole('hospital'), (req, res) => {
  const id = String(req.params.id || '');
  const hospitalName = req.session.user.hospitalName;
  const idx = noShows.findIndex(ns => ns.id === id && ns.hospitalName === hospitalName);
  if (idx === -1) return res.status(404).json({ message: 'No-show record not found.' });
  noShows[idx].attempts = Number((noShows[idx].attempts || 0) + 1);
  noShows[idx].lastContactAttemptAt = new Date().toISOString();
  saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
  res.json({ message: 'Contact attempt recorded.', attempts: noShows[idx].attempts });
});

// Background job: release no-show appointments after a grace period and record them for verification
const NO_SHOW_GRACE_MINUTES = Number(process.env.NOSHOW_GRACE_MINUTES || 15);

function processNoShows() {
  try {
    const now = new Date();
    let changed = false;

    for (let i = appointments.length - 1; i >= 0; i -= 1) {
      const appt = appointments[i];
      if (!isNoShowDue(appt, now, NO_SHOW_GRACE_MINUTES)) continue;

      const noShowRecord = {
        id: crypto.randomUUID(),
        appointmentId: appt.id,
        hospitalName: appt.hospitalName || null,
        removedAt: new Date().toISOString(),
        attempts: 0,
        verified: false,
        patient: appt.patient,
        patientContact: appt.patientContact || null,
        guardian: appt.guardian || null,
        date: appt.date,
        timeSlot: appt.timeSlot,
        department: appt.department,
        recommendedDoctor: appt.recommendedDoctor,
        original: appt,
      };

      noShows.push(noShowRecord);
      appointments.splice(i, 1);
      changed = true;
      console.log(`Released no-show appointment ${noShowRecord.appointmentId} for ${noShowRecord.patient} at ${noShowRecord.date} ${noShowRecord.timeSlot}`);
    }

    if (changed) {
      saveStore({ doctors, doctorAccounts, hospitalAccounts, appointments, noShows });
    }
  } catch (error) {
    console.error('Failed to process no-show appointments:', error);
  }
}

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ message: 'Request body must contain valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request is too large. Please reduce the uploaded image or request size.' });
  }
  console.error(error);
  res.status(500).json({ message: 'An unexpected server error occurred. Please try again.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Hospital appointment app running on http://localhost:${PORT}`);
  });
  processNoShows();
  const noShowTimer = setInterval(processNoShows, 60 * 1000);
  server.on('close', () => clearInterval(noShowTimer));
}

module.exports = app;
