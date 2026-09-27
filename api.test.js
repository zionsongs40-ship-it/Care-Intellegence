const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

let app;
let server;
let baseUrl;
let testDirectory;
let closeStore;

test.before(async () => {
  testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'carepath-api-'));
  process.env.HOSPITAL_DATABASE_FILE = path.join(testDirectory, 'hospital-data.sqlite');
  process.env.HOSPITAL_LEGACY_DATA_FILE = path.join(testDirectory, 'no-legacy-data.json');
  const store = require('../src/store');
  closeStore = store.closeStore;
  app = require('../server');
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  closeStore();
  fs.rmSync(testDirectory, { recursive: true, force: true });
  delete process.env.HOSPITAL_DATABASE_FILE;
  delete process.env.HOSPITAL_LEGACY_DATA_FILE;
});

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function upcomingMonday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return {
    date: date.toISOString().slice(0, 10),
    day: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  };
}

test('health endpoint lists all supported care departments', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.ok(body.departments.includes('Emergency Department (Casualty)'));
  assert.ok(body.departments.includes('General Medicine'));
});

test('home page introduces CI Care Intelligence and offers the uploaded video', async () => {
  const response = await fetch(baseUrl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /CI Care Intelligence/);
  assert.match(html, /id="introVideo"/);
  assert.match(html, /src="\/LOGO\.MP4\.mp4"/);
  assert.doesNotMatch(html, /Enter the app|id="enterApp"/);
  assert.match(html, /Our aim: clearer access to hospital care/);
  assert.match(html, /Designed around responsible care/);
  assert.match(html, /href="\/booking#emergency"/);
});

test('customer pages include the shared help assistant', async () => {
  const homeResponse = await fetch(baseUrl);
  const homeHtml = await homeResponse.text();
  const bookingResponse = await fetch(`${baseUrl}/booking`);
  const bookingHtml = await bookingResponse.text();
  assert.equal(homeResponse.status, 200);
  assert.equal(bookingResponse.status, 200);
  assert.match(homeHtml, /src="\/customer-assistant\.js"/);
  assert.match(bookingHtml, /src="\/customer-assistant\.js"/);
  const assistantScript = await fetch(`${baseUrl}/customer-assistant.js`);
  const assistantScriptText = await assistantScript.text();
  assert.equal(assistantScript.status, 200);
  assert.match(assistantScriptText, /Start guided booking/);
  assert.match(assistantScriptText, /Your assigned doctor is/);
  assert.match(assistantScriptText, /not medical advice/);
});

test('uploaded introduction video is served as an MP4 asset', async () => {
  const response = await fetch(`${baseUrl}/LOGO.MP4.mp4`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /video\/mp4/);
  assert.ok(Number(response.headers.get('content-length')) > 1000);
});

test('CI Care Intelligence logo is served as a PNG image', async () => {
  const response = await fetch(`${baseUrl}/logo.png`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/png/);
  assert.ok(Number(response.headers.get('content-length')) > 1000);
});

test('appointment and hospital summary data require an authenticated role', async () => {
  const appointments = await request('/api/appointments');
  const summary = await request('/api/hospital-summary');
  const report = await fetch(`${baseUrl}/api/reports/appointments.xlsx`);
  assert.equal(appointments.response.status, 401);
  assert.equal(summary.response.status, 401);
  assert.equal(report.status, 401);
});

test('hospital sign-in page requires only the single hospital admin password', async () => {
  const response = await fetch(`${baseUrl}/hospital-login`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Hospital admin password/);
  assert.doesNotMatch(html, /type="email"|name="email"/);
});

test('API responses include no-store and security headers', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('doctor directory hides account and personal profile fields', async () => {
  const { response, body } = await request('/api/doctors');
  assert.equal(response.status, 200);
  assert.deepEqual(body, []);
});

test('nearest hospital lookup validates patient coordinates', async () => {
  const { response, body } = await request('/api/hospitals/nearest?latitude=91&longitude=0');
  assert.equal(response.status, 400);
  assert.match(body.message, /valid current latitude and longitude/i);
});

test('booking requires a registered hospital', async () => {
  const { response, body } = await request('/api/triage', {
    method: 'POST',
    ...jsonBody({
      name: 'Patient Example',
      hospitalName: 'Not Registered Hospital',
      age: 35,
      gender: 'Other',
      phone: '+1 555 444 5555',
      disease: 'Hypertension',
      purpose: 'Treatment',
      date: upcomingMonday().date,
    }),
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /select a registered hospital/i);
});

test('invalid patient bookings are rejected without persisting a record', async () => {
  const { response, body } = await request('/api/triage', {
    method: 'POST',
    ...jsonBody({ name: '', disease: '' }),
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /valid patient details/i);
});

test('hospital, doctor, patient, and scheduling flows work with scoped sessions', async () => {
  const { response: hospitalRegistration } = await request('/api/hospital/register', {
    method: 'POST',
    ...jsonBody({
      name: 'Admin Person',
      hospitalName: 'City Test Hospital',
      email: 'admin@citytest.example',
      password: 'hospital-password',
      hospitalPhoneNumber: '+1 555 222 3333',
      hospitalAddress: '1 Test Street',
      hospitalMapLocation: 'https://maps.example.com/city-test',
      latitude: 40,
      longitude: -73,
    }),
  });
  assert.equal(hospitalRegistration.status, 201);

  const registrationPage = await fetch(`${baseUrl}/hospital-register`, { redirect: 'manual' });
  assert.equal(registrationPage.status, 302);
  assert.equal(registrationPage.headers.get('location'), '/hospital-login');
  const hospitalLoginPage = await fetch(`${baseUrl}/hospital-login`);
  const hospitalLoginHtml = await hospitalLoginPage.text();
  assert.match(hospitalLoginHtml, /id="firstHospitalSetup"/);
  assert.match(hospitalLoginHtml, /Initial setup only/);
  const hospitalDashboardPage = await fetch(`${baseUrl}/hospital`);
  assert.doesNotMatch(await hospitalDashboardPage.text(), /Register another hospital/);

  const { response: extraHospitalRegistration, body: extraHospitalBody } = await request('/api/hospital/register', {
    method: 'POST',
    ...jsonBody({
      name: 'Another Admin',
      hospitalName: 'Second Test Hospital',
      email: 'admin@secondtest.example',
      password: 'hospital-password',
      hospitalPhoneNumber: '+1 555 222 3333',
      hospitalAddress: '2 Test Street',
      hospitalMapLocation: 'https://maps.example.com/second-test',
      latitude: 40,
      longitude: -73,
    }),
  });
  assert.equal(extraHospitalRegistration.status, 409);
  assert.match(extraHospitalBody.message, /supports one hospital only/i);

  const { response: hospitalsResponse, body: hospitals } = await request('/api/hospitals');
  assert.equal(hospitalsResponse.status, 200);
  assert.deepEqual(hospitals, [{ hospitalName: 'City Test Hospital' }]);

  const { day } = upcomingMonday();
  const profilePhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lO8AAAAASUVORK5CYII=';
  async function registerDoctor(name, email, startTime, department = 'Cardiology', specialty = department) {
    const { response, body } = await request('/api/doctors/register', {
      method: 'POST',
      ...jsonBody({
        name,
        email,
        password: 'doctor-password',
        department,
        specialty,
        qualifications: 'MD',
        phoneNumber: '+1 555 333 4444',
        gender: 'Other',
        age: 40,
        workExperience: 10,
        profilePhoto,
        schedule: [{ day, slots: [startTime] }],
        hospitalName: 'City Test Hospital',
      }),
    });
    assert.equal(response.status, 201);
    assert.match(body.message, /after the hospital administrator approves/i);
  }
  await registerDoctor('Dr Cardiology', 'cardio@citytest.example', '09:00');
  await registerDoctor('Dr Relief', 'relief@citytest.example', '09:30');
  await registerDoctor('Dr Casualty', 'casualty@citytest.example', '10:00', 'Emergency Department (Casualty)', 'Emergency');
  const pendingDoctorLogin = await request('/api/doctors/signin', {
    method: 'POST',
    ...jsonBody({ email: 'cardio@citytest.example', password: 'doctor-password' }),
  });
  assert.equal(pendingDoctorLogin.response.status, 403);
  assert.match(pendingDoctorLogin.body.message, /awaiting approval/i);
  const { body: pendingPublicDoctors } = await request('/api/doctors?hospitalName=City%20Test%20Hospital');
  assert.deepEqual(pendingPublicDoctors, []);

  const { response: initialAdminLogin } = await request('/api/hospital/signin', {
    method: 'POST',
    ...jsonBody({ password: 'hospital-password' }),
  });
  const initialAdminCookie = initialAdminLogin.headers.get('set-cookie').split(';')[0];
  const unauthorizedRoster = await request('/api/hospital/doctors');
  assert.equal(unauthorizedRoster.response.status, 401);
  const { body: pendingRoster } = await request('/api/hospital/doctors', {
    headers: { Cookie: initialAdminCookie },
  });
  assert.equal(pendingRoster.length, 3);
  assert.ok(pendingRoster.every(doctor => doctor.approved === false));
  const { response: approvalResponse } = await request(
    `/api/doctors/${encodeURIComponent(pendingRoster[0].id)}/approval`,
    {
      method: 'POST',
      headers: { Cookie: initialAdminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    },
  );
  assert.equal(approvalResponse.status, 200);
  const { body: partlyApprovedDoctors } = await request('/api/doctors?hospitalName=City%20Test%20Hospital');
  assert.deepEqual(partlyApprovedDoctors.map(doctor => doctor.name), ['Dr Cardiology']);
  for (const doctor of pendingRoster.slice(1)) {
    const { response } = await request(`/api/doctors/${encodeURIComponent(doctor.id)}/approval`, {
      method: 'POST',
      headers: { Cookie: initialAdminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    assert.equal(response.status, 200);
  }
  await registerDoctor('Dr Removal Test', 'remove@citytest.example', '11:00');
  const { body: rosterWithRemovalTest } = await request('/api/hospital/doctors', {
    headers: { Cookie: initialAdminCookie },
  });
  const removalTestDoctor = rosterWithRemovalTest.find(item => item.name === 'Dr Removal Test');
  const { response: approveRemovalTest } = await request(
    `/api/doctors/${encodeURIComponent(removalTestDoctor.id)}/approval`,
    {
      method: 'POST',
      headers: { Cookie: initialAdminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    },
  );
  assert.equal(approveRemovalTest.status, 200);
  const { response: deniedRemoval, body: deniedRemovalBody } = await request('/api/doctors/remove', {
    method: 'POST',
    headers: { Cookie: initialAdminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorName: 'Dr Removal Test', adminPassword: 'wrong-password' }),
  });
  assert.equal(deniedRemoval.status, 401);
  assert.match(deniedRemovalBody.message, /password is incorrect/i);
  const { response: approvedRemoval } = await request('/api/doctors/remove', {
    method: 'POST',
    headers: { Cookie: initialAdminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorName: 'Dr Removal Test', adminPassword: 'hospital-password' }),
  });
  assert.equal(approvedRemoval.status, 200);

  const { body: registeredDoctors } = await request('/api/doctors?hospitalName=City%20Test%20Hospital');
  assert.equal(registeredDoctors.length, 3);
  assert.equal('email' in registeredDoctors[0], false);
  assert.equal('phoneNumber' in registeredDoctors[0], false);
  assert.equal('profilePhoto' in registeredDoctors[0], false);

  const appointmentDate = upcomingMonday().date;
  const { response: bookingResponse, body: booking } = await request('/api/triage', {
    method: 'POST',
    ...jsonBody({
      name: 'Patient Example',
      hospitalName: 'City Test Hospital',
      age: 45,
      gender: 'Prefer not to say',
      phone: '+1 555 444 5555',
      guardianAccompanying: false,
      disease: 'High blood pressure',
      purpose: 'Treatment',
      date: appointmentDate,
    }),
  });
  assert.equal(bookingResponse.status, 201);
  assert.equal(booking.hospitalName, 'City Test Hospital');
  assert.equal(booking.recommendedDoctor, 'Dr Cardiology');
  assert.ok(booking.recommendedDoctor, 'successful booking response must identify the assigned doctor');
  assert.equal(booking.timeSlot, '09:00');
  assert.ok(booking.appointmentId);

  const { response: emergencyResponse, body: emergencyBooking } = await request('/api/triage', {
    method: 'POST',
    ...jsonBody({
      name: 'Emergency Example',
      hospitalName: 'City Test Hospital',
      age: 45,
      gender: 'Prefer not to say',
      phone: '+1 555 444 6666',
      guardianAccompanying: false,
      disease: 'Chest pain and shortness of breath',
      purpose: 'Treatment',
      date: appointmentDate,
    }),
  });
  assert.equal(emergencyResponse.status, 201);
  assert.equal(emergencyBooking.department, 'Emergency Department (Casualty)');
  assert.equal(emergencyBooking.priority, 'Emergency');
  assert.ok(emergencyBooking.emergencyAdvice);

  const { response: doctorLogin, body: doctorLoginBody } = await request('/api/doctors/signin', {
    method: 'POST',
    ...jsonBody({ email: 'cardio@citytest.example', password: 'doctor-password' }),
  });
  assert.equal(doctorLogin.status, 200);
  assert.match(doctorLogin.headers.get('set-cookie'), /HttpOnly/);
  const doctorCookie = doctorLogin.headers.get('set-cookie').split(';')[0];
  assert.equal(doctorLoginBody.user.name, 'Dr Cardiology');

  const { response: doctorAppointments, body: doctorQueue } = await request('/api/appointments', {
    headers: { Cookie: doctorCookie },
  });
  assert.equal(doctorAppointments.status, 200);
  assert.equal(doctorQueue.length, 1);
  assert.equal(doctorQueue[0].patient, 'Patient Example');

  const { response: nearestHospitalResponse, body: nearestHospital } = await request('/api/hospitals/nearest?latitude=40.1&longitude=-73');
  assert.equal(nearestHospitalResponse.status, 200);
  assert.equal(nearestHospital.hospitalName, 'City Test Hospital');
  assert.equal(nearestHospital.phoneNumber, '+1 555 222 3333');
  assert.match(nearestHospital.mapLocation, /^https:/);

  const { response: adminLogin } = await request('/api/hospital/signin', {
    method: 'POST',
    ...jsonBody({ password: 'hospital-password' }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const { response: adminAppointments, body: adminQueue } = await request('/api/appointments', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminAppointments.status, 200);
  assert.equal(adminQueue[0].priority, 'Emergency');
  assert.equal(adminQueue.length, 2);

  const reportResponse = await fetch(`${baseUrl}/api/reports/appointments.xlsx`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(reportResponse.status, 200);
  assert.match(reportResponse.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(reportResponse.headers.get('cache-control'), /no-store/);
  const reportWorkbook = new ExcelJS.Workbook();
  await reportWorkbook.xlsx.load(Buffer.from(await reportResponse.arrayBuffer()));
  assert.equal(reportWorkbook.getWorksheet('Appointments').rowCount, 3);
  assert.equal(reportWorkbook.getWorksheet('Appointments').getRow(2).getCell(1).value, 'Emergency Example');
  assert.equal(reportWorkbook.getWorksheet('No-show follow-up').rowCount, 1);

  const { response: checkInResponse, body: checkInResult } = await request(
    `/api/appointments/${booking.appointmentId}/check-in`,
    { method: 'POST', headers: { Cookie: adminCookie } },
  );
  assert.equal(checkInResponse.status, 200);
  assert.match(checkInResult.message, /marked as arrived/);
  const { body: noShows } = await request('/api/no-shows', { headers: { Cookie: adminCookie } });
  assert.deepEqual(noShows, []);

  const { response: leaveResponse, body: leaveResult } = await request('/api/doctors/leave', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorName: 'Dr Cardiology', onLeave: true }),
  });
  assert.equal(leaveResponse.status, 200);
  assert.match(leaveResult.message, /1 appointment\(s\) reassigned/);

  const { body: reassignedQueue } = await request('/api/appointments', {
    headers: { Cookie: adminCookie },
  });
  const reassigned = reassignedQueue.find(item => item.patient === 'Patient Example');
  assert.equal(reassigned.recommendedDoctor, 'Dr Relief');
  assert.equal(reassigned.timeSlot, '09:30');

  const { response: logoutResponse } = await request('/api/session/logout', {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(logoutResponse.status, 204);
  const { response: expiredSession } = await request('/api/session', {
    headers: { Cookie: adminCookie },
  });
  assert.equal(expiredSession.status, 401);
});

test('sign-in endpoints rate-limit repeated failed attempts', async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { response } = await request('/api/hospital/signin', {
      method: 'POST',
      ...jsonBody({ password: `incorrect-password-${attempt}` }),
    });
    statuses.push(response.status);
  }
  const firstLimitedAttempt = statuses.indexOf(429);
  assert.ok(firstLimitedAttempt > 0, 'failed sign-ins should eventually be rate-limited');
  assert.ok(statuses.slice(0, firstLimitedAttempt).every(status => status === 401));
  assert.ok(statuses.slice(firstLimitedAttempt).every(status => status === 429));
});
