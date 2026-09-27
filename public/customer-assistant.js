(() => {
  const bookingForm = document.getElementById('bookingForm');
  const onBookingPage = Boolean(bookingForm);
  const style = document.createElement('style');
  style.textContent = `
    .customer-help-launch {
      position: fixed; z-index: 20; right: 22px; bottom: 22px; min-height: 54px;
      border: 0; border-radius: 999px; background: #0d6b60; color: #fff;
      padding: 0 20px; box-shadow: 0 8px 26px rgba(12, 63, 57, .28);
      cursor: pointer; font: inherit; font-weight: 800;
    }
    .customer-help-launch:hover { background: #09584f; }
    .customer-help-panel {
      position: fixed; z-index: 21; right: 22px; bottom: 88px; display: grid;
      grid-template-rows: auto minmax(140px, 1fr) auto auto; width: min(390px, calc(100vw - 28px));
      max-height: min(620px, calc(100dvh - 118px)); border: 1px solid #dfe9e6;
      border-radius: 18px; background: #fff; box-shadow: 0 18px 60px rgba(16, 49, 47, .22);
      overflow: hidden; color: #183238; font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .customer-help-panel[hidden] { display: none; }
    .customer-help-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 15px 17px; color: white; background: #0d5b54; }
    .customer-help-heading strong { font-size: 16px; }
    .customer-help-close { min-height: 36px; padding: 0 10px; border: 1px solid rgba(255,255,255,.45); border-radius: 8px; color: white; background: transparent; cursor: pointer; }
    .customer-help-log { display: grid; align-content: start; gap: 9px; min-height: 140px; overflow-y: auto; padding: 14px; }
    .customer-help-message { max-width: 95%; margin: 0; border-radius: 12px; padding: 10px 12px; color: #2d484b; background: #eaf1ef; white-space: pre-wrap; overflow-wrap: anywhere; }
    .customer-help-message.user { justify-self: end; color: #fff; background: #0d6b60; }
    .customer-help-quick { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 14px 10px; }
    .customer-help-quick button { min-height: 34px; border: 1px solid #c9ded8; border-radius: 999px; background: #f3f8f6; color: #24534e; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
    .customer-help-quick button:hover { background: #e4f2ed; }
    .customer-help-form { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 12px 14px; border-top: 1px solid #e5eeeb; }
    .customer-help-form input { min-width: 0; min-height: 42px; border: 1px solid #d3e0dc; border-radius: 9px; padding: 8px 10px; font: inherit; }
    .customer-help-form button { min-height: 42px; border: 0; border-radius: 9px; background: #0d6b60; color: #fff; padding: 0 14px; cursor: pointer; font: inherit; font-weight: 750; }
    .customer-help-safety { margin: 0; padding: 0 14px 11px; color: #708287; font-size: 11px; }
    @media (max-width: 520px) {
      .customer-help-launch { right: 14px; bottom: 14px; min-height: 50px; }
      .customer-help-panel { right: 10px; bottom: 74px; width: calc(100vw - 20px); max-height: calc(100dvh - 90px); }
    }
  `;
  document.head.append(style);

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'customer-help-launch';
  launcher.textContent = 'Help assistant';
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'customerHelpPanel');

  const panel = document.createElement('section');
  panel.id = 'customerHelpPanel';
  panel.className = 'customer-help-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Customer help assistant');

  const heading = document.createElement('div');
  heading.className = 'customer-help-heading';
  const title = document.createElement('strong');
  title.textContent = 'Care assistant';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'customer-help-close';
  close.textContent = 'Close';
  heading.append(title, close);

  const log = document.createElement('div');
  log.className = 'customer-help-log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');

  const quickActions = document.createElement('div');
  quickActions.className = 'customer-help-quick';
  const quickQuestions = [
    ['How do I book?', 'How do I book an appointment?'],
    ['Which doctor?', 'How is a doctor selected?'],
    ['Emergency help', 'What should I do in an emergency?'],
  ];
  for (const [label, question] of quickQuestions) {
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = label;
    action.addEventListener('click', () => respond(question, 'user'));
    quickActions.append(action);
  }
  if (onBookingPage) {
    const bookAction = document.createElement('button');
    bookAction.type = 'button';
    bookAction.textContent = 'Help me book';
    bookAction.addEventListener('click', startGuidedBooking);
    quickActions.append(bookAction);
  }

  const form = document.createElement('form');
  form.className = 'customer-help-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'question';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.placeholder = 'Ask how to use the app…';
  input.setAttribute('aria-label', 'Ask the care assistant');
  input.required = true;
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  form.append(input, send);

  const safety = document.createElement('p');
  safety.className = 'customer-help-safety';
  safety.textContent = 'Automated app guidance only—not medical advice. For emergencies, call local emergency services.';
  panel.append(heading, log, quickActions, form, safety);
  document.body.append(panel, launcher);

  let bookingStep = null;
  const bookingAnswers = {};
  const bookingQuestions = {
    name: 'What is the patient’s full name?',
    age: 'How old is the patient?',
    gender: 'What is the patient’s gender? Say female, male, other, or prefer not to say.',
    phone: 'What phone number can the hospital use to contact the patient?',
    disease: 'In your own words, what is the reason for the visit or symptoms? I cannot diagnose.',
    purpose: 'What is the visit for: regular checkup, blood test, treatment, or operation?',
    guardian: 'Will a guardian accompany the patient? Please answer yes or no.',
    guardianName: 'What is the guardian’s full name?',
    guardianAge: 'How old is the guardian?',
    guardianPhone: 'What phone number can the hospital use to contact the guardian?',
    date: 'What date would you prefer? Use YYYY-MM-DD, DD/MM/YYYY, or say today or tomorrow.',
    confirm: 'Please review the booking form. Reply “yes, book” to submit, or “no” to review/edit it without submitting.',
  };

  function addMessage(text, kind = '') {
    const message = document.createElement('p');
    message.className = `customer-help-message ${kind}`.trim();
    message.textContent = text;
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }

  function addBookingLink() {
    const link = document.createElement('a');
    link.href = '/booking';
    link.textContent = 'Open patient booking';
    link.className = 'customer-help-message';
    log.append(link);
  }

  function startGuidedBooking() {
    if (!onBookingPage) {
      addBookingLink();
      return;
    }
    for (const key of Object.keys(bookingAnswers)) delete bookingAnswers[key];
    bookingStep = 'name';
    addMessage('I’ll guide you through the booking details, fill the form, and wait for your confirmation before submitting.');
    addMessage(bookingQuestions.name);
    input.focus();
  }

  function localDateString(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function parseDate(value) {
    const normalized = value.trim().toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (normalized === 'today') return localDateString(today);
    if (normalized === 'tomorrow') {
      today.setDate(today.getDate() + 1);
      return localDateString(today);
    }
    const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const local = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!iso && !local) return null;
    const [, year, month, day] = iso || [null, local[3], local[2], local[1]];
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1
        || date.getDate() !== Number(day)) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function fillBookingForm() {
    for (const [field, value] of Object.entries(bookingAnswers)) {
      const control = document.getElementById(field);
      if (control && field !== 'guardian') control.value = value;
    }
    const guardian = document.getElementById('guardianAccompanying');
    const guardianFields = document.getElementById('guardianFields');
    if (guardian && guardianFields) {
      guardian.checked = Boolean(bookingAnswers.guardian);
      guardianFields.hidden = !guardian.checked;
      guardianFields.querySelectorAll('input').forEach(control => {
        control.disabled = !guardian.checked;
        control.required = guardian.checked;
      });
    }
    const hospital = document.getElementById('hospitalName');
    if (hospital && !hospital.value && hospital.options.length > 1) hospital.value = hospital.options[1].value;
    document.getElementById('form-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function nextBookingStep(step) {
    bookingStep = step;
    addMessage(bookingQuestions[step]);
    log.scrollTop = log.scrollHeight;
  }

  function processBookingAnswer(answer) {
    const normalized = answer.trim().toLowerCase();
    if (bookingStep === 'confirm') {
      if (/^(yes|yes book|yes, book|confirm|confirm booking|book appointment)$/i.test(normalized)) {
        const hospital = document.getElementById('hospitalName');
        if (!hospital.value) {
          addMessage('The hospital is not ready yet. Wait for hospital details to load, then try again.');
          return;
        }
        addMessage('Submitting your confirmed appointment request. I’ll show the assigned doctor in the confirmation.');
        fillBookingForm();
        bookingStep = null;
        bookingForm.requestSubmit(document.getElementById('submitButton'));
        return;
      }
      if (/^(no|not yet|review|edit|change)$/i.test(normalized)) {
        fillBookingForm();
        bookingStep = null;
        addMessage('No appointment was submitted. Review or edit the form, then submit it when ready.');
        return;
      }
      addMessage('Please reply “yes, book” to submit, or “no” to review/edit.');
      return;
    }

    let next;
    if (bookingStep === 'name' || bookingStep === 'guardianName') {
      if (answer.trim().length < 2) return addMessage(bookingQuestions[bookingStep]);
      bookingAnswers[bookingStep] = answer.trim().slice(0, 120);
      next = bookingStep === 'name' ? 'age' : 'guardianAge';
    } else if (bookingStep === 'age' || bookingStep === 'guardianAge') {
      const age = Number(normalized);
      if (!Number.isInteger(age) || age < (bookingStep === 'age' ? 0 : 1) || age > 130) {
        return addMessage('Please enter a valid age in years.');
      }
      bookingAnswers[bookingStep] = String(age);
      next = bookingStep === 'age' ? 'gender' : 'guardianPhone';
    } else if (bookingStep === 'gender') {
      const gender = ['female', 'male', 'other', 'prefer not to say'].find(item => normalized === item);
      if (!gender) return addMessage('Please answer female, male, other, or prefer not to say.');
      bookingAnswers.gender = gender === 'prefer not to say' ? 'Prefer not to say' : gender[0].toUpperCase() + gender.slice(1);
      next = 'phone';
    } else if (bookingStep === 'phone' || bookingStep === 'guardianPhone') {
      if (!/^\+?[\d\s().-]{7,20}$/.test(answer.trim())) return addMessage('Please enter a valid contact number.');
      bookingAnswers[bookingStep] = answer.trim();
      next = bookingStep === 'phone' ? 'disease' : 'date';
    } else if (bookingStep === 'disease') {
      bookingAnswers.disease = answer.trim().slice(0, 500);
      if (/chest pain|shortness of breath|difficulty breathing|stroke|seizure|unconscious|severe bleeding/i.test(answer)) {
        addMessage('If these symptoms may be an emergency, call your local emergency number or go to emergency care now. Do not wait for this booking.');
      }
      next = 'purpose';
    } else if (bookingStep === 'purpose') {
      const purpose = [
        ['Regular checkup', /check.?up|routine/],
        ['Blood test', /blood|lab test|test/],
        ['Treatment', /treatment|consultation|visit/],
        ['Operation', /operation|surgery/],
      ].find(([, pattern]) => pattern.test(normalized));
      if (!purpose) return addMessage('Please choose regular checkup, blood test, treatment, or operation.');
      bookingAnswers.purpose = purpose[0];
      next = 'guardian';
    } else if (bookingStep === 'guardian') {
      if (/^(yes|y|yeah)$/i.test(normalized)) {
        bookingAnswers.guardian = true;
        next = 'guardianName';
      } else if (/^(no|n|nope)$/i.test(normalized)) {
        bookingAnswers.guardian = false;
        next = 'date';
      } else return addMessage('Please answer yes or no.');
    } else if (bookingStep === 'date') {
      const date = parseDate(answer);
      const today = localDateString(new Date());
      if (!date || date < today) return addMessage('Please enter a valid date today or later, such as 2026-10-05.');
      bookingAnswers.date = date;
      fillBookingForm();
      addMessage(`Please review: ${bookingAnswers.name}, age ${bookingAnswers.age}, ${bookingAnswers.disease}; ${bookingAnswers.purpose}; ${date}.`);
      nextBookingStep('confirm');
      return;
    }
    nextBookingStep(next);
  }

  function responseFor(text) {
    const query = text.toLowerCase();
    if (/emergency|urgent|chest pain|breath|bleed|stroke/.test(query)) {
      return 'If someone may be having a medical emergency, do not wait for an online booking. Call your local emergency number or go to the nearest emergency department. On the booking page, “Find nearest registered hospital” can show the registered hospital and directions if you allow location access.';
    }
    if (/doctor|specialist|department|which.*(care|doctor)|cardio|neurolog|orthop|pediatric|oncolog|surg/.test(query)) {
      return 'On the booking page, describe the reason for the visit. The app uses simple keyword rules to suggest a department and finds an available, approved doctor in that department. This is not a diagnosis; hospital staff must review care decisions.';
    }
    if (/book|appointment|schedule|slot|date|time/.test(query)) {
      return 'To book, open patient booking, enter the patient and contact details, describe the visit reason, choose a visit purpose and date, and submit. The app shows the assigned doctor, department, date, and time in the confirmation. You can also use the guided booking helper there.';
    }
    if (/guardian|accompan/.test(query)) {
      return 'In patient booking, select “Yes, a guardian will accompany the patient” and fill in the guardian’s name, age, and phone number.';
    }
    if (/what can you|help|use this app|how does/.test(query)) {
      return 'I can explain patient booking, doctor matching, guardian details, and emergency directions. I can also take you to the guided booking helper. What would you like help with?';
    }
    return 'I can help with booking steps, doctor matching, guardian details, and emergency directions. Try asking “How do I book?” or use the buttons below.';
  }

  function respond(text, kind) {
    if (kind === 'user') addMessage(text, 'user');
    if (bookingStep) {
      processBookingAnswer(text);
      log.scrollTop = log.scrollHeight;
      return;
    }
    if (onBookingPage && /^(book|help me book|start booking|book appointment)$/i.test(text.trim())) {
      startGuidedBooking();
      return;
    }
    addMessage(responseFor(text));
    if (/book|appointment/.test(text.toLowerCase()) && onBookingPage) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'customer-help-quick';
      action.textContent = 'Start guided booking';
      action.addEventListener('click', () => {
        startGuidedBooking();
      }, { once: true });
      log.append(action);
    } else if (/book|appointment/.test(text.toLowerCase())) {
      addBookingLink();
    }
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open && !log.childElementCount) {
      addMessage('Hi! I can help you find your way around the app and guide you to patient booking.');
    }
    if (open) input.focus();
    else launcher.focus();
  }

  launcher.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    respond(question, 'user');
  });
  window.addEventListener('appointment-booked', event => {
    setOpen(true);
    const appointment = event.detail;
    addMessage(`Your appointment is booked. Your assigned doctor is ${appointment.recommendedDoctor}. Appointment: ${appointment.date} at ${appointment.timeSlot}, ${appointment.hospitalName}.`);
  });
})();
