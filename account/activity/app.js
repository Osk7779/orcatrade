// /account/activity/ — renders the signed-in user's security/account
// event timeline (Sprint BG-5.6).
//
// Single GET to /api/account/activity. Server has already filtered to
// rows mentioning the user's email and redacted any other email
// addresses to "(another user)". This script only handles presentation.

'use strict';

// Event-type → { label, pillClass } for friendly rendering. Anything not
// in this map falls through to a generic "other" pill so we never crash
// on a new event type the API has added before the UI ships.
var EVENT_META = {
  auth_signin:               { label: 'Signed in',              pill: 'signin'  },
  auth_logout:               { label: 'Signed out',             pill: 'logout'  },
  auth_revoke_all:           { label: 'Signed out everywhere',  pill: 'revoke'  },
  account_exported:          { label: 'Downloaded data export', pill: 'export'  },
  org_created:               { label: 'Created an organisation', pill: 'org'    },
  org_member_invited:        { label: 'Org membership change',   pill: 'org'    },
  org_member_removed:        { label: 'Removed from organisation', pill: 'org'  },
  org_ownership_transferred: { label: 'Org ownership transferred', pill: 'org'  },
};

function fmtWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // YYYY-MM-DD HH:MM (UTC). Geist Mono renders nicely in this shape.
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Per-event-type detail line. Each branch returns a short human-readable
// string describing the row beyond just its label. Email values have
// already been redacted server-side to "(another user)" when they refer
// to someone other than the signed-in user.
function renderDetail(ev, me) {
  switch (ev.type) {
    case 'auth_signin': {
      var bits = [];
      if (ev.source) bits.push('source: ' + ev.source);
      if (ev.ip)     bits.push('IP: ' + ev.ip);
      return bits.join(' · ');
    }
    case 'auth_logout':
      return ev.method ? ('method: ' + ev.method) : '';
    case 'auth_revoke_all':
      return 'Every active session was invalidated.';
    case 'account_exported':
      return 'saved plans: ' + (ev.savedPlanCount || 0)
        + ' · event rows: ' + (ev.eventCount || 0);
    case 'org_created':
      return ev.orgName ? ('"' + ev.orgName + '"') : '';
    case 'org_member_invited': {
      var who;
      if (ev.email && ev.email === me) {
        // You invited someone.
        who = 'You invited ' + (ev.inviteeEmail || '(another user)');
      } else if (ev.inviteeEmail === me) {
        // You were invited.
        who = 'You were invited by ' + (ev.email || '(another user)');
      } else {
        who = 'Membership change';
      }
      var role = ev.role ? ' as ' + ev.role : '';
      return who + role;
    }
    case 'org_member_removed': {
      if (ev.email === me) return 'You removed ' + (ev.removedEmail || '(another user)');
      if (ev.removedEmail === me) return 'You were removed by ' + (ev.email || '(another user)');
      return '';
    }
    case 'org_ownership_transferred': {
      if (ev.email === me) return 'You transferred ownership to ' + (ev.toEmail || '(another user)');
      if (ev.toEmail === me) return 'You received ownership from ' + (ev.email || '(another user)');
      return '';
    }
    default:
      return '';
  }
}

function renderRow(ev, me) {
  var meta = EVENT_META[ev.type] || { label: ev.type, pill: 'other' };
  var pill = '<span class="pill ' + meta.pill + '">' + escapeHtml(ev.type.split('_')[0]) + '</span>';
  var title = pill + escapeHtml(meta.label);
  var detail = renderDetail(ev, me);
  var html = ''
    + '<div class="event-row">'
    +   '<div class="title">' + title + '</div>'
    +   '<div class="when">' + escapeHtml(fmtWhen(ev.at)) + '</div>'
    +   (detail ? ('<div class="detail">' + escapeHtml(detail) + '</div>') : '')
    + '</div>';
  return html;
}

async function load() {
  var authNeeded = document.getElementById('authNeeded');
  var content = document.getElementById('content');
  var events = document.getElementById('events');
  var errEl = document.getElementById('error');

  try {
    var me = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!me.ok) {
      authNeeded.hidden = false;
      return;
    }
    var meJson = await me.json();
    var myEmail = (meJson.user && meJson.user.email) || '';
    content.hidden = false;

    var resp = await fetch('/api/account/activity', { credentials: 'same-origin' });
    if (!resp.ok) {
      events.innerHTML = '';
      errEl.hidden = false;
      errEl.textContent = 'Could not load your activity (HTTP ' + resp.status + ').';
      return;
    }
    var data = await resp.json();
    var rows = Array.isArray(data.events) ? data.events : [];
    if (rows.length === 0) {
      events.innerHTML = '<div class="empty">No security events recorded yet. They\'ll appear here as you use OrcaTrade.</div>';
      return;
    }
    events.innerHTML = rows.map(function (ev) { return renderRow(ev, myEmail); }).join('');
  } catch (err) {
    errEl.hidden = false;
    errEl.textContent = 'Could not load your activity: ' + (err && err.message ? err.message : 'unknown error');
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', load);
}

// Test surface — exported on globalThis when present, no-op in browsers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EVENT_META, fmtWhen, escapeHtml, renderDetail, renderRow };
}
