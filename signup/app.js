// /signup/ — Sprint password-auth-v1 client.
//
// Two-mode signup: magic-link only OR email + password. The password
// path stages a pending signup on the server; only the email-confirmation
// link finalises the account. /api/auth/signup is the entry point for
// both flows.

(function () {
  'use strict';

  var states = {
    signup: document.getElementById('state-signup'),
    sent: document.getElementById('state-sent'),
  };

  function showState(name) {
    Object.keys(states).forEach(function (k) {
      states[k].classList.toggle('active', k === name);
    });
  }

  function setError(msg) {
    var el = document.getElementById('signup-err');
    if (el) el.textContent = msg || '';
  }

  var passwordMode = false;
  var toggleBtn = document.getElementById('toggle-mode-btn');
  var pwField = document.getElementById('password-field');
  var leadMagic = document.getElementById('signup-lead-magic');
  var leadPw = document.getElementById('signup-lead-password');
  var signupBtn = document.getElementById('signup-btn');

  function applyMode() {
    if (pwField) pwField.hidden = !passwordMode;
    if (leadMagic) leadMagic.hidden = passwordMode;
    if (leadPw) leadPw.hidden = !passwordMode;
    if (signupBtn) signupBtn.textContent = passwordMode ? 'Create account' : 'Send me a sign-in link';
    if (toggleBtn) toggleBtn.textContent = passwordMode ? 'Use magic link instead' : 'Use email + password';
  }
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      passwordMode = !passwordMode;
      setError('');
      applyMode();
    });
  }

  var form = document.getElementById('signup-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setError('');
      var email = document.getElementById('email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError('Enter a valid email address.');
        return;
      }
      var body = { email: email };
      if (passwordMode) {
        var pw = (document.getElementById('password').value || '');
        if (pw.length < 12) { setError('Password must be at least 12 characters.'); return; }
        body.password = pw;
      }
      var btn = document.getElementById('signup-btn');
      btn.disabled = true;
      var oldLabel = btn.textContent;
      btn.textContent = 'Sending…';
      fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          btn.disabled = false;
          btn.textContent = oldLabel;
          if (resp.ok) {
            var withPw = !!(resp.j && resp.j.withPassword);
            document.getElementById('sent-email-1').textContent = email;
            document.getElementById('sent-email-2').textContent = email;
            document.getElementById('sent-msg-magic').hidden = withPw;
            document.getElementById('sent-msg-password').hidden = !withPw;
            showState('sent');
          } else {
            setError((resp.j && resp.j.error) || 'Could not start signup.');
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = oldLabel;
          setError('Network error: ' + (err.message || 'unknown'));
        });
    });
  }

  var back = document.getElementById('back-link');
  if (back) {
    back.addEventListener('click', function (e) {
      e.preventDefault();
      showState('signup');
    });
  }
})();
