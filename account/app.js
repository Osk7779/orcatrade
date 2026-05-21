// Account page client — checks /api/auth/me on load, switches between
// loading / sign-in / sent / signed-in states.

(function () {
  'use strict';

  // Sprint auth-i18n-v1 — resolve dynamic copy (button states, errors)
  // via the shared auth i18n dict. authT falls back to EN then the key;
  // the local fallback covers the case where auth-i18n.js didn't load.
  function T(key, fallback) {
    return (window.authT && window.authT(key)) || fallback;
  }

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
        // Sprint admin-session-auth — surface the admin dashboards card
        // when the signed-in user's email is on ORCATRADE_ADMIN_EMAILS.
        // The server makes the decision; the client just renders.
        if (data.isAdmin) {
          var adminCard = document.getElementById('admin-card');
          if (adminCard) adminCard.hidden = false;
        }
        // Sprint first-run-welcome-v1 — ?welcome=1 → show hero now.
        if (consumeWelcomeParam()) applyFirstRun(true);
        // Sprint onboarding-v1 — checklist after auth resolves.
        loadOnboarding();
      } else {
        showState('signin');
      }
    })
    .catch(function () { showState('signin'); });

  // ── Sprint first-run-welcome-v1 ──────────────────────
  // Two first-run signals: an explicit ?welcome=1 from signup-confirm,
  // and a brand-new user (zero completed onboarding steps) arriving by
  // any path (e.g. a first-ever magic-link sign-in). Either flips the
  // signed-in view from "Welcome back" to the orienting hero.
  var firstRunShown = false;

  function consumeWelcomeParam() {
    var has = false;
    try {
      var params = new URLSearchParams(window.location.search);
      has = params.get('welcome') === '1';
      if (has) {
        params.delete('welcome');
        var qs = params.toString();
        var clean = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
        window.history.replaceState({}, '', clean);
      }
    } catch (_) { /* non-blocking */ }
    return has;
  }

  function applyFirstRun(on) {
    if (on && firstRunShown) return;
    var hero = document.getElementById('welcome-hero');
    var returning = document.getElementById('returning-header');
    if (on) {
      if (hero) hero.hidden = false;
      if (returning) returning.hidden = true;
      firstRunShown = true;
    } else if (!firstRunShown) {
      // Only assert the returning header when first-run hasn't already
      // been triggered by ?welcome=1 earlier in this load.
      if (hero) hero.hidden = true;
      if (returning) returning.hidden = false;
    }
  }

  // ── Sprint onboarding-v1 ─────────────────────────────
  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function renderOnboarding(payload) {
    if (!payload || !payload.progress || !payload.steps) return '';
    var p = payload.progress;
    if (p.allDone) return '';                  // hide once everything is done
    var nextKey = payload.nextStep ? payload.nextStep.key : null;
    var rows = payload.steps.map(function (step) {
      var done = !!p[step.key];
      var isNext = !done && step.key === nextKey;
      var cls = done ? 'done' : (isNext ? 'next' : '');
      var check = done ? '✓' : (isNext ? '→' : '');
      var cta = isNext
        ? '<a class="ob-cta" href="' + escapeHtml(step.href) + '">' + escapeHtml(step.cta) + '</a>'
        : '';
      return '<li class="' + cls + '">'
        + '<span class="ob-check">' + check + '</span>'
        + '<span>' + escapeHtml(step.label) + '</span>'
        + cta
      + '</li>';
    }).join('');
    return ''
      + '<div class="ob-kicker">Getting started</div>'
      + '<h2>Make OrcaTrade work for you</h2>'
      + '<div class="ob-progress">'
      +   p.completed + ' of ' + p.total + ' steps complete'
      + '</div>'
      + '<ul class="ob-steps">' + rows + '</ul>';
  }

  function loadOnboarding() {
    var el = document.getElementById('onboarding-card');
    if (!el) return;
    fetch('/api/account/onboarding', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        // Sprint first-run-welcome-v1 — a user with zero completed
        // onboarding steps is brand new; show the hero even if they
        // didn't arrive via the ?welcome=1 signup-confirm redirect
        // (e.g. first-ever magic-link sign-in). applyFirstRun no-ops
        // if the hero is already shown.
        if (data.progress && data.progress.completed === 0) applyFirstRun(true);
        var html = renderOnboarding(data);
        if (!html) { el.hidden = true; return; }
        el.innerHTML = html;
        el.hidden = false;
      })
      .catch(function () { /* non-blocking */ });
  }

  // Sprint returnto-resume-v1 — read ?return= from the URL once and
  // thread it through every sign-in flow so the user lands back where
  // they came from (typically /pricing/?subscribe=…). Server validates
  // for open-redirect safety; the client just passes the string through.
  var pageReturnTo = (function () {
    try { return new URLSearchParams(window.location.search).get('return') || ''; }
    catch (_) { return ''; }
  })();

  // ── Sign-in form submission (Sprint password-auth-v1) ──
  //
  // Two modes share the form: magic-link (default) and password. The
  // toggle button flips a flag + reveals/hides the password field. The
  // submit handler routes to /api/auth/request OR /api/auth/login.

  var passwordMode = false;
  var toggleBtn = document.getElementById('toggle-mode-btn');
  var pwField = document.getElementById('password-field');
  var leadMagic = document.getElementById('signin-lead-magic');
  var leadPw = document.getElementById('signin-lead-password');
  var signinBtn = document.getElementById('signin-btn');

  function applyMode() {
    if (pwField) pwField.hidden = !passwordMode;
    if (leadMagic) leadMagic.hidden = passwordMode;
    if (leadPw) leadPw.hidden = !passwordMode;
    if (signinBtn) signinBtn.textContent = passwordMode ? T('btnSignIn', 'Sign in') : T('btnSendLink', 'Send me a sign-in link');
    if (toggleBtn) toggleBtn.textContent = passwordMode ? T('btnUseMagic', 'Use magic link instead') : T('btnUsePasswordInstead', 'Use password instead');
  }
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      passwordMode = !passwordMode;
      setError('');
      applyMode();
    });
  }

  // Forgot-password link: prompt for email if blank, then POST to
  // /api/auth/password/reset/request. Universal 202 response — the UI
  // shows the same confirmation regardless of whether the email has
  // a password set, to avoid leaking that detail.
  var forgotLink = document.getElementById('forgot-password-link');
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      var emailInput = document.getElementById('email');
      var email = (emailInput && emailInput.value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError(T('errEnterEmailFirst', 'Enter your email address first, then click Forgot password.'));
        if (emailInput) emailInput.focus();
        return;
      }
      setError('');
      forgotLink.textContent = T('btnSending', 'Sending…');
      fetch('/api/auth/password/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function () {
          forgotLink.textContent = T('forgotPassword', 'Forgot password?');
          document.getElementById('sent-email').textContent = email;
          showState('sent');
        })
        .catch(function () {
          forgotLink.textContent = T('forgotPassword', 'Forgot password?');
          setError(T('errResetNetwork', 'Network error sending reset link. Try again.'));
        });
    });
  }

  var form = document.getElementById('signin-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setError('');
      var email = document.getElementById('email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError(T('errEmail', 'Enter a valid email address.'));
        return;
      }
      var btn = document.getElementById('signin-btn');
      btn.disabled = true;
      if (passwordMode) {
        var password = (document.getElementById('password').value || '');
        if (!password) {
          btn.disabled = false;
          setError(T('errEnterPassword', 'Enter your password.'));
          return;
        }
        btn.textContent = T('btnSigningIn', 'Signing in…');
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: email, password: password, returnTo: pageReturnTo || undefined }),
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }).catch(function () { return { ok: r.ok, j: {} }; }); })
          .then(function (resp) {
            btn.disabled = false;
            btn.textContent = T('btnSignIn', 'Sign in');
            if (resp.ok) {
              // Server echoes the validated returnTo (open-redirect-safe).
              // Use it if present, else just reload — same as before.
              if (resp.j && resp.j.returnTo) window.location.href = resp.j.returnTo;
              else window.location.reload();
            } else {
              setError(resp.j && resp.j.error ? resp.j.error : T('errCouldNotSignIn', 'Could not sign in.'));
            }
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = T('btnSignIn', 'Sign in');
            setError(T('errNetwork', 'Network error:') + ' ' + (err.message || 'unknown'));
          });
        return;
      }
      btn.textContent = T('btnSending', 'Sending…');
      fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email, returnTo: pageReturnTo || undefined }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          btn.disabled = false;
          btn.textContent = T('btnSendLink', 'Send me a sign-in link');
          if (resp.ok) {
            document.getElementById('sent-email').textContent = email;
            showState('sent');
          } else {
            setError(resp.j && resp.j.error ? resp.j.error : T('errCouldNotSendLink', 'Could not send sign-in link.'));
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = T('btnSendLink', 'Send me a sign-in link');
          setError(T('errNetwork', 'Network error:') + ' ' + (err.message || 'unknown'));
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

  // ── Sign out everywhere (Sprint BG-3.2 phase 1) ─────
  //
  // Writes a per-email "minimum iat" timestamp on the server so every
  // active cookie for this email — across every device — stops working
  // on the next request. Sensitive endpoints (/api/account/*, /api/orgs/*)
  // already use getCurrentUserStrict, which honours that timestamp.

  var revokeBtn = document.getElementById('revoke-all-btn');
  if (revokeBtn) {
    revokeBtn.addEventListener('click', function () {
      var ok = confirm(
        'Sign out of every device where this email is signed in?\n\n' +
        'Use this if you think someone else might have access to your sessions. ' +
        'You will need a fresh magic-link to sign in again.'
      );
      if (!ok) return;
      var msg = document.getElementById('revoke-all-msg');
      revokeBtn.disabled = true;
      revokeBtn.textContent = 'Working…';
      if (msg) msg.textContent = '';
      fetch('/api/auth/revoke-all', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (resp) {
          revokeBtn.disabled = false;
          revokeBtn.textContent = 'Sign out everywhere';
          if (resp.ok) {
            showState('signin');
          } else if (msg) {
            msg.textContent = (resp.j && resp.j.error) || 'Could not revoke sessions.';
          }
        })
        .catch(function (err) {
          revokeBtn.disabled = false;
          revokeBtn.textContent = 'Sign out everywhere';
          if (msg) msg.textContent = 'Network error: ' + (err.message || 'unknown');
        });
    });
  }
})();
