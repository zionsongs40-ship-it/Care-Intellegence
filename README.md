# CI Care Intelligence Hospital Appointment Prototype

A local hospital scheduling prototype with open patient booking, symptom-keyword department suggestions, doctor availability, and hospital and doctor workspaces.

The home page plays the `LOGO.MP4.mp4` introduction before showing the app. It continues automatically when the video finishes, and opens the app automatically if video playback is unavailable or reduced motion is preferred.

## What is included

- Patient registration with age, gender, contact, optional accompanying guardian, selected hospital, symptoms/reason, visit purpose, notes, and a preferred date. Doctor and appointment availability are matched within the chosen hospital.
- Customer-facing home and booking pages have a persistent help assistant for app guidance, doctor matching, and emergency instructions. From booking, it can collect details, fill the form, and submit only after customer review and confirmation; the on-screen confirmation names the assigned doctor. It is rule-based, not a generative AI or diagnosis service; no SMS provider is configured.
- Department suggestions for casualty, cardiology, neurology, orthopedics, pediatrics, OB/GYN, oncology, general surgery, and general medicine.
- Emergency indicators are routed to casualty first and shown with an instruction to seek immediate emergency care. The app does not diagnose or assess clinical urgency.
- Doctor selection uses availability for the selected weekday and avoids already-booked slots.
- Hospital and doctor dashboards use server-side, role-scoped sessions. Hospital queues sort emergency cases first; doctors only see appointments assigned to their account.
- Hospital admins can manage their roster. Marking a doctor on leave attempts to reassign future appointments to another doctor at that hospital; if no suitable open slot exists, the change is rejected rather than silently losing the booking.
- New doctor registrations are pending until the hospital administrator approves them in the hospital roster. Pending doctors cannot sign in and are excluded from patient booking; existing accounts remain approved unless explicitly marked otherwise. Approved doctors sign in normally. Removing a doctor requires the signed-in hospital administrator's password again, and future appointments must be reassigned first.
- Hospital staff can mark patients arrived. After the appointment time plus a 15-minute grace period, unarrived appointments are removed from the active queue, freeing the slot, and added to the hospital's no-show follow-up list. Staff can record call attempts and the patient's reported reason. No SMS or phone calls are sent automatically.
- Hospital admins can download a hospital-scoped Excel workbook with appointment and no-show follow-up sheets. The workbook contains sensitive patient details; use only on authorized devices and follow the hospital's approved retention and sharing policies.
- Phone and desktop layouts switch automatically with the browser viewport; no separate mode setting is required.
- The patient emergency notice can find the nearest registered hospital using the patient's location after permission is granted, then offers a phone call and map directions. Location is used for that lookup only and is not saved. Hospitals need accurate latitude/longitude, phone, and map details to be included; this feature does not call emergency services automatically.
- Passwords for new accounts are stored as salted scrypt hashes. Legacy account passwords are hashed when JSON records are migrated.
- Only doctors attached to a registered hospital can receive bookings. Create a hospital account and register its doctors (including casualty coverage) before opening patient booking.
- This school-project configuration supports one hospital. Initial registration is available only until the first hospital account is created; afterwards the registration page redirects to sign-in and attempts to register another facility are rejected by the API. Doctor profiles and patient bookings remain associated with that hospital.
- Because this configuration allows exactly one hospital, hospital administrators sign in with the hospital admin password only; doctor sign-in remains email and password.
- HTTP security headers are enabled, API responses are marked non-cacheable, and sign-in, registration, and booking endpoints have basic rate limits. These limits use in-memory storage and are not shared across app instances.

## Run locally

```bash
npm install
npm start
```

Visit `http://localhost:3000`. Patient booking is public. Doctor and hospital users register accounts before signing in.

## Fictional school-project data

To populate the local app with a fictional hospital and sample doctors for a school demo, stop the server and run:

```bash
npm run seed:demo
npm start
```

The seed adds one clearly labeled fictional hospital and nine fake doctor profiles across the listed departments, using sample Indian names. It does not create appointments or emergency-location coordinates, does not run automatically, and will not overwrite non-demo records. Running it again safely refreshes the names on existing demo profiles. The local-only demo password is `DemoProject123!`; the hospital account is `hospital.admin@demo.invalid`, and doctor accounts use `doctor.1@demo.invalid` through `doctor.9@demo.invalid`. This public demo password is not suitable for any deployed environment. Do not use the seeded profiles or credentials as real identities, and do not enter real patient information.

To rotate the shared password for the fictional demo hospital and all nine fictional demo doctor accounts, stop the server and run:

```bash
npm run reset:demo-password
npm start
```

The command generates a new random password and prints it once. It preserves hospital and doctor profiles and any existing appointments. It refuses to run unless it finds exactly the expected demo hospital and nine linked demo doctor accounts. Keep the generated password private.

## Tests

```bash
npm test
```

## Prototype and deployment limits

This is not a clinical system and is not ready for real patient data or production use. Local prototype data is stored in `data/hospital-data.sqlite`; the first startup imports existing `data/hospital-data.json` records once and leaves the JSON file in place. This local SQLite setup is intended for one app process and modest development datasets, not a huge database or concurrent multi-hospital production workloads. Back up the JSON file before first startup and keep both files private. Sessions are held in server memory and end when the process restarts. The rate limiter is also in-memory. The current public hospital/doctor registration flow does not verify an organization's identity or staff credentials. The Excel download is an unencrypted copy of patient information and is not audit-logged. The current inline scripts mean the Content Security Policy header is not enabled yet.

Before real patient use, deploy only after a qualified team has designed and reviewed the database and session architecture, identity proofing and staff approval, least-privilege access, durable cross-instance rate limiting, comprehensive audit logging, encrypted storage and backups, secrets management, monitoring and incident response, secure export controls, privacy/compliance obligations for the selected Indian deployment, and clinical workflow validation. Use HTTPS behind a correctly configured trusted proxy; set `TRUST_PROXY=true` only when the app is actually behind that proxy. Apply operating-system/disk encryption and restrict access to SQLite files and downloaded workbooks. Hospital staff must confirm triage and appointment decisions. These code changes are hardening steps, not a certification or go-live approval.

SQLite uses the Node.js built-in `node:sqlite` module. Run with Node.js 22.13 or newer. Node may print an experimental API warning for its built-in SQLite module.

Set `NOSHOW_GRACE_MINUTES` to change the no-show grace period. The default is 15 minutes.

If someone may be experiencing an emergency, they should contact local emergency services or go directly to an emergency department; they should not wait for an online booking.
