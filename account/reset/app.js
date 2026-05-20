// /account/reset/ — Sprint password-auth-v1 client.
//
// Reads ?token=<jti.sig> from the URL; posts the user's new password
// alongside the token to /api/auth/password/reset/confirm. The server
// validates the token (HMAC + single-use KV record), updates the
// password, revokes all other sessions for this email, and drops a
// fresh session cookie so the user lands signed in.

(function () {
  'use strict';

  var states = {
    form: document.getElementById('state-form'),
    noToken: document.getElementById('state-no-token'),
    done: document.getElementById('state-done'),
  };
  function showState(name) {
    Object.keys(states).forEach(function (k) {
      states[k].classList.toggle('active', k === name);
    });
  }

  function setError(msg) {
    var el = document.getElementById('reset-err');
    if (el) el.textContent = msg || '';
  }

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || '';
  // Sprint returnto-resume-v1 — honour ?return= so a reset that started
  // from /pricing/?subscribe=… lands back there post-confirm.
  var pageReturnTo = params.get('return') || '';
  if (!token) {
    showState('noToken');
    return;
  }

  var form = document.getElementById('reset-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setError('');
      var newPw = (document.getElementById('newPassword').value || '');
      if (newPw.length < 12) { setError('Password must be at least 12 characters.'); return; }
      var btn = document.getElementById('reset-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      fetch('/api/auth/password/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: token, newPassword: newPw, returnTo: pageReturnTo || undefined }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          btn.disabled = false;
          btn.textContent = 'Save new password';
          if (resp.ok) {
            // If the server echoed a safe returnTo, bounce straight
            // there. Otherwise show the success state.
            if (resp.j && resp.j.returnTo) {
              window.location.href = resp.j.returnTo;
              return;
            }
            showState('done');
          } else {
            setError((resp.j && resp.j.error) || 'Could not save new password.');
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Save new password';
          setError('Network error: ' + (err.message || 'unknown'));
        });
    });
  }
})();
