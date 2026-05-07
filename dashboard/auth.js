// Stub auth for the dashboard. Browser-side, localStorage-backed.
// The real Supabase / Auth.js / Clerk integration replaces window.OrcaAuth in the next sprint.

(function (global) {
  'use strict';
  const SESSION_KEY = 'orcatrade.dashboard.session.v1';

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }

  function buildSession({ email, name, workspaceName, role }) {
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'A valid email is required.' };
    }
    if (!name || name.length < 2) {
      return { ok: false, error: 'Your name is required.' };
    }
    return {
      ok: true,
      session: {
        email: String(email).trim().toLowerCase().slice(0, 200),
        name: String(name).trim().slice(0, 80),
        workspaceName: String(workspaceName || '').trim().slice(0, 120) || `${name.split(' ')[0]}'s workspace`,
        role: ['owner', 'admin', 'member', 'viewer'].includes(role) ? role : 'owner',
        authMode: 'stub-localstorage',
        authNote: 'Stub auth for demo. Real Supabase / Auth.js / Clerk integration is the next sprint.',
        createdAt: new Date().toISOString(),
      },
    };
  }

  global.OrcaAuth = {
    signIn({ email, name }) {
      const result = buildSession({ email, name });
      if (!result.ok) return result;
      writeSession(result.session);
      return { ok: true, session: result.session };
    },
    signUp({ email, name, workspaceName }) {
      const result = buildSession({ email, name, workspaceName, role: 'owner' });
      if (!result.ok) return result;
      writeSession(result.session);
      return { ok: true, session: result.session };
    },
    getSession: readSession,
    signOut() {
      clearSession();
      return { ok: true };
    },
    requireSession() {
      const session = readSession();
      if (!session) {
        window.location.href = './login/';
        return null;
      }
      return session;
    },
  };
})(window);
