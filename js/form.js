// OrcaTrade contact form handler — posts to /api/contact

document.addEventListener('DOMContentLoaded', function () {
  const contactForm = document.getElementById('contact-form');
  if (!contactForm) return;

  // Add form-msg element if not already present
  if (!contactForm.querySelector('.form-msg')) {
    const btn = contactForm.querySelector('button[type="submit"]');
    if (btn) {
      const msgEl = document.createElement('div');
      msgEl.className = 'form-msg';
      msgEl.style.cssText = 'font-size:0.88rem;margin-top:0.5rem;min-height:1.2em;';
      btn.parentNode.insertBefore(msgEl, btn);
    }
  }

  contactForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const btn = contactForm.querySelector('button[type="submit"]');
    const msg = contactForm.querySelector('.form-msg');
    const originalText = btn ? btn.textContent : '';

    const name    = (document.getElementById('name')    || {}).value || '';
    const company = (document.getElementById('company') || {}).value || '';
    const email   = (document.getElementById('email')   || {}).value || '';
    const project = (document.getElementById('project') || {}).value || '';

    if (!name || !email) {
      if (msg) { msg.textContent = 'Please fill in your name and email.'; msg.style.color = '#dc5050'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, company, email, project, type: 'contact' }),
      });

      const json = await res.json();

      if (res.ok) {
        contactForm.reset();
        if (msg) {
          msg.textContent = "Message sent. We'll reply within one business day.";
          msg.style.color = '#5cb88a';
        }
        if (btn) { btn.textContent = 'Sent'; }
      } else {
        throw new Error(json.error || 'Something went wrong.');
      }
    } catch (err) {
      if (msg) {
        msg.textContent = 'Could not send — please email us directly at orca@orcatrade.pl';
        msg.style.color = '#dc5050';
      }
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  });
});