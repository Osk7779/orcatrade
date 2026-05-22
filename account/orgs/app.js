// /account/orgs/ — Organisation management UI (BG-3.1 closeout).
//
// Single-page UI with two modes:
//   - List + create (default, no query string)
//   - Detail (?id=<orgId>) — members, invite form, remove buttons
//
// Bootstraps from /api/auth/me (same pattern as /account/privacy/).
// All mutations route through the /api/orgs handler shipped in BG-3.1.

(function () {
  'use strict';

  let me = null;
  let myRoleInCurrentOrg = null; // 'owner' | 'admin' | 'member' | null

  function el(id) { return document.getElementById(id); }

  function showMsg(targetId, text, kind) {
    const e = el(targetId);
    if (!e) return;
    e.textContent = text;
    e.className = 'msg ' + kind;
    e.hidden = false;
  }
  function clearMsg(targetId) {
    const e = el(targetId);
    if (e) e.hidden = true;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getOrgIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  // ── Bootstrap ────────────────────────────────────────

  async function bootstrap() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) throw new Error('not signed in');
      const body = await res.json();
      if (!body.email) throw new Error('no email');
      me = body.email;
    } catch (_) {
      el('authNeeded').hidden = false;
      return;
    }

    el('content').hidden = false;
    el('userEmailList').textContent = me;
    el('userEmailDetail').textContent = me;

    const orgId = getOrgIdFromUrl();
    if (orgId) {
      el('detailView').hidden = false;
      await loadDetail(orgId);
    } else {
      el('listView').hidden = false;
      await loadList();
    }
  }

  // ── List view ────────────────────────────────────────

  async function loadList() {
    clearMsg('listMsg');
    try {
      const res = await fetch('/api/orgs', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      renderList(body.orgs || []);
    } catch (err) {
      showMsg('listMsg', 'Could not load your orgs: ' + err.message, 'err');
    }
  }

  function renderList(orgs) {
    const host = el('orgsList');
    if (!orgs.length) {
      host.innerHTML = '<div class="empty">You\'re not in any organisations yet. Create one below or ask a colleague to invite you.</div>';
      return;
    }
    host.innerHTML = orgs.map(o => (
      '<div class="org-row">'
      + '<div>'
      + '<div class="name">' + escapeHtml(o.name) + '</div>'
      + '<div class="meta">' + escapeHtml(o.id) + ' · created ' + new Date(o.createdAt).toLocaleDateString('en-GB')
      + (o.ownerEmail === me ? ' · you\'re the owner' : '')
      + '</div>'
      + '</div>'
      + '<a class="open" href="/account/orgs/?id=' + encodeURIComponent(o.id) + '">Manage →</a>'
      + '</div>'
    )).join('');
  }

  async function handleCreate() {
    const name = el('newOrgName').value.trim();
    clearMsg('createMsg');
    if (!name) {
      showMsg('createMsg', 'Please enter a name for your organisation.', 'err');
      return;
    }
    const btn = el('createBtn');
    btn.disabled = true;
    showMsg('createMsg', 'Creating…', 'info');
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      showMsg('createMsg', 'Created. Redirecting to org page…', 'ok');
      setTimeout(() => {
        window.location.href = '/account/orgs/?id=' + encodeURIComponent(body.org.id);
      }, 800);
    } catch (err) {
      showMsg('createMsg', 'Create failed: ' + err.message, 'err');
      btn.disabled = false;
    }
  }

  // ── Detail view ──────────────────────────────────────

  async function loadDetail(orgId) {
    clearMsg('membersMsg');
    try {
      const res = await fetch('/api/orgs/' + encodeURIComponent(orgId), { credentials: 'include' });
      if (res.status === 403) {
        el('detailName').textContent = 'Access denied';
        showMsg('membersMsg', "You're not a member of this organisation. Ask the owner to invite you, or return to your list.", 'err');
        return;
      }
      if (res.status === 404) {
        el('detailName').textContent = 'Organisation not found';
        showMsg('membersMsg', "That org doesn't exist (or was deleted). Return to your list.", 'err');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      renderDetail(body.org, body.members || []);
    } catch (err) {
      showMsg('membersMsg', 'Could not load org: ' + err.message, 'err');
    }
  }

  function renderDetail(org, members) {
    el('detailName').textContent = org.name;
    el('detailMeta').textContent = org.id
      + ' · owner ' + (org.ownerEmail === me ? 'you' : org.ownerEmail)
      + ' · ' + members.length + ' member' + (members.length === 1 ? '' : 's');

    // Determine my role for permission gating.
    const myMembership = members.find(m => m.email === me.toLowerCase());
    myRoleInCurrentOrg = myMembership ? myMembership.role : null;
    const canInvite = myRoleInCurrentOrg === 'owner' || myRoleInCurrentOrg === 'admin';
    el('inviteCard').hidden = !canInvite;

    // SSO config is owner-only — surface the link for the owner.
    const ssoRow = el('ssoLinkRow');
    if (ssoRow) {
      if (myRoleInCurrentOrg === 'owner') {
        const link = el('ssoConfigLink');
        if (link) link.setAttribute('href', '/account/orgs/sso/?org=' + encodeURIComponent(org.id));
        ssoRow.hidden = false;
      } else {
        ssoRow.hidden = true;
      }
    }

    const host = el('membersList');
    host.innerHTML = members.map(m => (
      '<div class="member-row">'
      + '<div class="email">' + escapeHtml(m.email) + (m.email === me.toLowerCase() ? ' <span style="color:rgba(255,255,255,0.4);font-size:0.74rem">(you)</span>' : '') + '</div>'
      + '<div class="role ' + escapeHtml(m.role) + '">' + escapeHtml(m.role) + '</div>'
      + (canInvite && m.role !== 'owner' && m.email !== me.toLowerCase()
          ? '<button class="btn btn-danger" data-remove="' + escapeHtml(m.email) + '">Remove</button>'
          : '<div></div>')
      + '</div>'
    )).join('');

    // Wire up remove buttons.
    host.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => handleRemove(org.id, btn.getAttribute('data-remove')));
    });
  }

  async function handleInvite(orgId) {
    const email = el('inviteEmail').value.trim();
    const role = el('inviteRole').value;
    clearMsg('inviteMsg');
    if (!email) {
      showMsg('inviteMsg', 'Please enter an email address.', 'err');
      return;
    }
    const btn = el('inviteBtn');
    btn.disabled = true;
    showMsg('inviteMsg', 'Inviting…', 'info');
    try {
      const res = await fetch('/api/orgs/' + encodeURIComponent(orgId) + '/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const note = body.alreadyMember ? 'Already a member — no change.' : 'Invited.';
      showMsg('inviteMsg', note + ' Refreshing…', 'ok');
      el('inviteEmail').value = '';
      setTimeout(() => loadDetail(orgId), 600);
    } catch (err) {
      showMsg('inviteMsg', 'Invite failed: ' + err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function handleRemove(orgId, email) {
    if (!confirm('Remove ' + email + ' from this organisation? They lose access immediately.')) return;
    clearMsg('membersMsg');
    try {
      const res = await fetch('/api/orgs/' + encodeURIComponent(orgId) + '/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      showMsg('membersMsg', 'Removed. Refreshing…', 'ok');
      setTimeout(() => loadDetail(orgId), 600);
    } catch (err) {
      showMsg('membersMsg', 'Remove failed: ' + err.message, 'err');
    }
  }

  // ── Bootstrap (browser-only) ─────────────────────────

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      bootstrap();
      const createBtn = el('createBtn');
      if (createBtn) createBtn.addEventListener('click', handleCreate);
      const inviteBtn = el('inviteBtn');
      if (inviteBtn) inviteBtn.addEventListener('click', function () {
        const orgId = getOrgIdFromUrl();
        if (orgId) handleInvite(orgId);
      });
      const newOrgInput = el('newOrgName');
      if (newOrgInput) newOrgInput.addEventListener('keypress', function (ev) {
        if (ev.key === 'Enter') handleCreate();
      });
    });
  }
})();
