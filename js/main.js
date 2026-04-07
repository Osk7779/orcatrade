// OrcaTrade Group — main JS

document.addEventListener('DOMContentLoaded', function () {

  // ── Year ──────────────────────────────────────────────────────
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ── Smooth scroll with header offset ─────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href !== '#' && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const offset = target.getBoundingClientRect().top + window.scrollY - 80;
          window.scrollTo({ top: offset, behavior: 'smooth' });
        }
      }
    });
  });

  // ── Section reveal + staggered card entrance ──────────────────
  const CARD_SELECTORS = '.group-card, .rep-card, .news-card, .feature-card, .card, .process-card';

  // Set cards to initial hidden state before observer fires
  document.querySelectorAll(CARD_SELECTORS).forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(18px)';
    card.style.transition = 'opacity 0.45s ease-out, transform 0.45s ease-out';
  });

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const section = entry.target;
      section.classList.add('visible');

      // Stagger child cards after section fades in
      section.querySelectorAll(CARD_SELECTORS).forEach((card, i) => {
        setTimeout(() => {
          card.style.opacity = '1';
          card.style.transform = 'none';
        }, 80 + i * 75);
      });

      observer.unobserve(section);
    });
  }, { threshold: 0.05 });

  document.querySelectorAll('.section').forEach(s => observer.observe(s));

  // Safety fallback — force everything visible after 2s
  setTimeout(function () {
    document.querySelectorAll('.section').forEach(el => el.classList.add('visible'));
    document.querySelectorAll(CARD_SELECTORS).forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }, 2000);

  // ── Mission "Read more" toggle ────────────────────────────────
  const missionToggle = document.getElementById('missionToggle');
  const missionMore   = document.getElementById('missionMore');
  if (missionToggle && missionMore) {
    missionToggle.addEventListener('click', function () {
      const open = missionMore.style.display !== 'none';
      missionMore.style.display = open ? 'none' : 'block';
      missionToggle.textContent  = open ? 'Read more ↓' : 'Read less ↑';
      missionToggle.setAttribute('aria-expanded', String(!open));
    });
  }

  // ── Leadership intro "Read more" toggle ───────────────────────
  const leaderToggle = document.getElementById('leaderToggle');
  const leaderMore   = document.getElementById('leaderMore');
  if (leaderToggle && leaderMore) {
    leaderToggle.addEventListener('click', function () {
      const open = leaderMore.style.display !== 'none';
      leaderMore.style.display = open ? 'none' : 'block';
      leaderToggle.textContent  = open ? 'Read more ↓' : 'Read less ↑';
      leaderToggle.setAttribute('aria-expanded', String(!open));
    });
  }

  // ── Active nav highlight on scroll ───────────────────────────
  const sections = document.querySelectorAll('.section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  function highlightActive() {
    let current = '';
    const pos = window.scrollY + 150;
    sections.forEach(s => {
      if (pos >= s.offsetTop && pos < s.offsetTop + s.clientHeight) current = s.id;
    });
    navLinks.forEach(link => {
      const active = link.getAttribute('href') === `#${current}` ||
                     (current === 'top' && link.getAttribute('href') === '#top');
      link.style.opacity    = active ? '1' : '0.72';
      link.style.fontWeight = active ? '500' : 'normal';
    });
  }

  window.addEventListener('scroll', highlightActive, { passive: true });
  highlightActive();

});