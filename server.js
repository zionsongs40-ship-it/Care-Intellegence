<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#071a21" />
    <title>CI Care Intelligence | Hospital appointments</title>
    <link rel="stylesheet" href="/styles.css" />
    <style>
      body.intro-active { overflow: hidden; }
      .intro-screen {
        position: fixed;
        z-index: 10;
        inset: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #071a21;
        color: #fff;
        transition: opacity .2s ease, visibility .2s ease;
      }
      .intro-screen.is-leaving { visibility: hidden; opacity: 0; }
      .intro-video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: .78;
      }
      .intro-shade {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(4,19,25,.18), rgba(4,19,25,.35) 48%, rgba(4,19,25,.88));
      }
      .intro-content {
        position: relative;
        z-index: 1;
        width: min(100% - 36px, 620px);
        align-self: end;
        margin: 0 auto clamp(42px, 9vh, 96px);
        text-align: center;
      }
      .intro-brand {
        margin: 0;
        font-size: clamp(38px, 9vw, 72px);
        font-weight: 850;
        letter-spacing: -.065em;
        line-height: 1;
      }
      .intro-brand span { color: #69d6c1; }
      .intro-logo { display: block; width: clamp(108px, 22vw, 168px); height: auto; margin: 0 auto 22px; border-radius: 24px; box-shadow: 0 14px 42px rgba(0,0,0,.18); }
      .intro-caption { margin: 13px 0 24px; color: rgba(255,255,255,.82); font-size: 14px; letter-spacing: .12em; text-transform: uppercase; }
      .intro-status { min-height: 20px; margin: 14px 0 0; color: rgba(255,255,255,.68); font-size: 12px; }
      .intro-progress { width: min(300px, 80%); height: 3px; margin: 18px auto 0; overflow: hidden; border-radius: 3px; background: rgba(255,255,255,.28); }
      .intro-progress span { display: block; width: 32%; height: 100%; border-radius: inherit; background: #69d6c1; animation: intro-loading 1.4s ease-in-out infinite alternate; }
      @keyframes intro-loading { from { transform: translateX(-25%); } to { transform: translateX(240%); } }
      .emergency-notice {
        border: 2px solid #e7a39a;
        background: linear-gradient(110deg, #fff0ed, #fff8f6);
        color: #70251d;
        box-shadow: 0 8px 24px rgba(162, 55, 37, .12);
      }
      .emergency-notice > strong { display: block; margin-bottom: 5px; color: #8e2318; font-size: 16px; }
      .emergency-cta {
        min-height: 56px;
        border: 2px solid #fff;
        background: #b42318;
        padding: 12px 20px;
        box-shadow: 0 5px 0 #7d1b13, 0 8px 20px rgba(125, 27, 19, .24);
        font-size: 16px;
        font-weight: 850;
        letter-spacing: .01em;
        transition: background .15s ease, box-shadow .15s ease, transform .15s ease;
      }
      .emergency-cta:hover {
        background: #8f1d14;
        box-shadow: 0 3px 0 #68150f, 0 6px 16px rgba(125, 27, 19, .24);
        transform: translateY(2px);
      }
      .emergency-cta:focus-visible { outline: 3px solid #183238; outline-offset: 3px; }
      .emergency-cta:active {
        box-shadow: 0 1px 0 #68150f, 0 3px 10px rgba(125, 27, 19, .2);
        transform: translateY(4px);
      }
      @media (max-width: 600px) {
        .emergency-cta { width: 100%; min-height: 58px; text-align: center; }
      }
      @media (prefers-reduced-motion: reduce) {
        .intro-progress span { animation: none; width: 100%; }
        .intro-screen { transition: none; }
        .emergency-cta { transition: none; }
      }
    </style>
  </head>
  <body class="intro-active">
    <section id="introScreen" class="intro-screen" aria-label="CI Care Intelligence introduction">
      <video id="introVideo" class="intro-video" autoplay muted playsinline preload="auto" aria-label="CI Care Intelligence logo introduction">
        <source src="/LOGO.MP4.mp4" type="video/mp4" />
      </video>
      <div class="intro-shade" aria-hidden="true"></div>
      <div class="intro-content">
        <img class="intro-logo" src="/logo.png" alt="CI Care Intelligence logo" />
        <p class="intro-brand"><span>CI</span> Care Intelligence</p>
        <p class="intro-caption">Your care journey starts here</p>
        <div id="introProgress" class="intro-progress" aria-hidden="true"><span></span></div>
        <p id="introStatus" class="intro-status" role="status">Loading your care experience…</p>
      </div>
    </section>
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" aria-label="CI Care Intelligence home"><img class="brand-logo" src="/logo.png" alt="" /><span>Care Intelligence</span></a>
        <nav class="nav" aria-label="Main navigation">
          <a href="/booking">Patient booking</a>
          <a href="/doctor-login">Doctor portal</a>
          <a href="/nurse-register">Nurse registration</a>
          <a href="/hospital-login">Hospital portal</a>
        </nav>
      </div>
    </header>
    <main class="page">
      <section class="hero">
        <div class="card hero-main">
          <div class="eyebrow">Connected care, clearer queues</div>
          <h1>Get to the right care, with less waiting.</h1>
          <p>Share your visit details, receive a department suggestion, and find an available doctor slot. Hospital teams can coordinate their queue and schedules from one place.</p>
          <div class="button-row">
            <a class="button" href="/booking">Book an appointment</a>
            <a class="button secondary" href="/hospital-login">Hospital sign in</a>
          </div>
          <p class="muted">A scheduling prototype, not a clinical diagnosis service.</p>
        </div>
        <aside class="card">
          <div class="eyebrow">Care pathways</div>
          <h2>Departments at a glance</h2>
          <div class="service-list">
            <div class="service"><strong>Emergency / Casualty</strong><span>Immediate assessment for emergencies, open 24/7.</span></div>
            <div class="service"><strong>Heart &amp; circulation</strong><span>Cardiology appointments and follow-up.</span></div>
            <div class="service"><strong>Brain &amp; nerves</strong><span>Neurology consultation requests.</span></div>
            <div class="service"><strong>Bones &amp; joints</strong><span>Orthopedics and injury follow-up.</span></div>
            <div class="service"><strong>Children's health</strong><span>Pediatrics for infants and young people.</span></div>
            <div class="service"><strong>Women's health</strong><span>OB/GYN appointments and follow-up.</span></div>
            <div class="service"><strong>Cancer care</strong><span>Oncology consultations and treatment visits.</span></div>
            <div class="service"><strong>Surgical care</strong><span>General surgery assessment and planning.</span></div>
          </div>
        </aside>
      </section>
      <section class="notice emergency-notice" role="note">
        <strong>Emergency symptoms?</strong> Call your local emergency number or go to the nearest emergency department now. Do not wait for an online booking.
        <div class="button-row">
          <a class="button emergency-cta" href="/booking#emergency" aria-label="Emergency: find the nearest registered hospital">Emergency · Find nearest hospital</a>
        </div>
        <p class="muted">Department matching uses prototype keyword rules; clinical staff must assess and confirm care.</p>
      </section>
      <section class="card" aria-labelledby="about-ci" style="margin-top:18px">
        <div class="eyebrow">About us</div>
        <h2 id="about-ci">Our aim: clearer access to hospital care</h2>
        <p>CI Care Intelligence is designed to help patients find a suitable hospital department and an available appointment, while helping hospital teams organize schedules and patient queues.</p>
        <p class="muted">By bringing booking details, doctor availability, and visit priority into one place, our aim is to make the path to care easier to understand and support smoother hospital coordination. CI provides scheduling assistance only; it does not diagnose conditions or replace decisions made by qualified healthcare professionals.</p>
        <h3>Making the first step easier</h3>
        <p>Finding the right place to start can feel confusing, especially when a hospital has many departments. Patients can share their reason for visiting, choose a hospital, and request an available appointment. CI uses basic information to suggest a department and match the request with that hospital's registered doctor schedules.</p>
        <h3>Supporting organized hospital teams</h3>
        <p>Hospital teams can use the queue to review upcoming visits, see appointment priorities, and keep track of doctor availability. When schedules change, the system can help staff see where appointments are assigned and manage follow-up for missed visits.</p>
        <h3>Designed around responsible care</h3>
        <p>Technology should make coordination clearer while keeping people at the center of care. CI is a scheduling prototype: its department suggestions are based on simple keyword rules, not a medical assessment. Hospital staff must review requests, confirm urgency, and make clinical decisions using their own professional judgment and hospital procedures.</p>
        <p class="muted">Our goal is to keep improving the experience so that booking is easier for patients and day-to-day scheduling is easier for care teams. The system is still a prototype and is not intended for real patient records or independent clinical use.</p>
      </section>
    </main>
    <script>
      const introScreen = document.getElementById('introScreen');
      const introVideo = document.getElementById('introVideo');
      const introStatus = document.getElementById('introStatus');
      const introProgress = document.getElementById('introProgress');
      let introDismissed = false;

      function enterCareApp() {
        if (introDismissed) return;
        introDismissed = true;
        introVideo.pause();
        document.body.classList.remove('intro-active');
        introScreen.classList.add('is-leaving');
        window.setTimeout(() => introScreen.remove(), 250);
      }

      const introTimeout = window.setTimeout(enterCareApp, 1200);
      introVideo.addEventListener('ended', enterCareApp);
      introVideo.addEventListener('error', () => {
        window.clearTimeout(introTimeout);
        introProgress.hidden = true;
        introStatus.textContent = 'Opening CI Care Intelligence…';
        enterCareApp();
      });
      introVideo.play().catch(() => {
        window.clearTimeout(introTimeout);
        introStatus.textContent = 'Opening CI Care Intelligence…';
        enterCareApp();
      });

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.clearTimeout(introTimeout);
        introVideo.pause();
        enterCareApp();
      }
    </script>
  </body>
</html>
