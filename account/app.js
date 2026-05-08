// Account page client — checks /api/auth/me on load, switches between
// loading / sign-in / sent / signed-in states.

(function () {
  'use strict';

  var states = {
    loading: document.getElementById('state-loading'),
    signin: document.getElementById('state-signin'),
    sent: document.getElementById('state-sent'),
    signedin: document.getElementById('state-signedin'),
  };

  function showState(name) {
    Object.keys(states).forEach(function (k) {
      states[k].classList.toggle('active', k === name);
    });
  }

  function setError(msg) {
    var el = document.getElementById('signin-err');
    if (el) el.textContent = msg || '';
  }

  // ── Initial: check sign-in status ────────────────────

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.ok) return r.json();
      return null;
    })
    .then(function (data) {
      if (data && data.user && data.user.email) {
        document.getElementById('signedin-email').textContent = data.user.email;
        showState('signedin');
      } else {
        showState('signin');
      }
    })
    .catch(function () { showState('signin'); });

  // ── Sign-in form submission ──────────────────────────

  var form = document.getElementById('signin-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setError('');
      var email = document.getElementById('email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError('Enter a valid email address.');
        return;
      }
      var btn = document.getElementById('signin-btn');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          btn.disabled = false;
          btn.textContent = 'Send me a sign-in link';
          if (resp.ok) {
            document.getElementById('sent-email').textContent = email;
            showState('sent');
          } else {
            setError(resp.j && resp.j.error ? resp.j.error : 'Could not send sign-in link.');
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Send me a sign-in link';
          setError('Network error: ' + (err.message || 'unknown'));
        });
    });
  }

  // ── Resend (back to signin form) ─────────────────────

  var resend = document.getElementById('resend-link');
  if (resend) {
    resend.addEventListener('click', function (e) {
      e.preventDefault();
      showState('signin');
    });
  }

  // ── Logout ───────────────────────────────────────────

  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { showState('signin'); });
    });
  }
})();
