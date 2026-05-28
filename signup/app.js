// /signup/ — Sprint password-auth-v1 client.
//
// Two-mode signup: magic-link only OR email + password. The password
// path stages a pending signup on the server; only the email-confirmation
// link finalises the account. /api/auth/signup is the entry point for
// both flows.

(function () {
  'use strict';

  // Sprint auth-i18n-v1 — dynamic copy via the shared auth dict.
  function T(key, fallback) {
    return (window.authT && window.authT(key)) || fallback;
  }

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
    if (!el) return;
    // Plain-text error path (default).
    el.textContent = msg || '';
    el.classList.remove('signup-err-account-exists');
  }

  // Sprint account-uniqueness-v1 — when the server tells us the email
  // is already claimed (409 account-exists), swap the plain error for
  // a richer "sign in instead" message + link so the user has a clear
  // one-click path forward without retyping.
  function setAccountExistsError(j, email) {
    var el = document.getElementById('signup-err');
    if (!el) return;
    var signInUrl = (j && j.signInUrl) || '/account/';
    var params = [];
    // Carry the email so /account/ can pre-fill the sign-in input —
    // saves the user from typing the same address twice in a row.
    if (email) params.push('email=' + encodeURIComponent(email));
    if (pageReturnTo) params.push('return=' + encodeURIComponent(pageReturnTo));
    var href = signInUrl + (params.length ? '?' + params.join('&') : '');
    var msg = (j && j.error) || T('errAccountExists', 'An account with this email already exists.');
    var linkLabel = T('btnSignInInstead', 'Sign in instead →');
    el.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = msg + ' ';
    var a = document.createElement('a');
    a.href = href;
    a.textContent = linkLabel;
    el.appendChild(span);
    el.appendChild(a);
    el.classList.add('signup-err-account-exists');
  }

  // Sprint returnto-resume-v1 — thread ?return= through signup so the
  // user lands back where they came from after the email-confirmation
  // click (or magic-link click). Server validates for safety.
  var pageReturnTo = (function () {
    try { return new URLSearchParams(window.location.search).get('return') || ''; }
    catch (_) { return ''; }
  })();

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
    if (signupBtn) signupBtn.textContent = passwordMode ? T('btnCreateAccount', 'Create account') : T('btnSendLink', 'Send me a sign-in link');
    if (toggleBtn) toggleBtn.textContent = passwordMode ? T('btnUseMagic', 'Use magic link instead') : T('btnUsePassword', 'Use email + password');
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
        setError(T('errEmail', 'Enter a valid email address.'));
        return;
      }
      var body = { email: email };
      if (passwordMode) {
        var pw = (document.getElementById('password').value || '');
        if (pw.length < 12) { setError(T('errPwShort', 'Password must be at least 12 characters.')); return; }
        body.password = pw;
      }
      if (pageReturnTo) body.returnTo = pageReturnTo;
      var btn = document.getElementById('signup-btn');
      btn.disabled = true;
      var oldLabel = btn.textContent;
      btn.textContent = T('btnSending', 'Sending…');
      fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
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
          } else if (resp.status === 409 && resp.j && resp.j.reason === 'account-exists') {
            setAccountExistsError(resp.j, email);
          } else {
            setError((resp.j && resp.j.error) || T('errSignupFailed', 'Could not start signup.'));
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = oldLabel;
          setError(T('errNetwork', 'Network error:') + ' ' + (err.message || 'unknown'));
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
