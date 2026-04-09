// OrcaTrade universal form handler
// Intercepts any form with data-contact attribute and POSTs to /api/contact

(function () {
  function handleForm(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      const btn = form.querySelector('[type="submit"]');
      const msg = form.querySelector('.form-msg');
      const originalText = btn ? btn.textContent : '';

      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      const data = {
        name:    (form.querySelector('[name="name"]')    || {}).value || '',
        email:   (form.querySelector('[name="email"]')   || {}).value || '',
        company: (form.querySelector('[name="company"]') || {}).value || '',
        project: (form.querySelector('[name="project"]') || {}).value || '',
        message: (form.querySelector('[name="message"]') || {}).value || '',
        type:    form.dataset.contact || 'contact',
      };

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const json = await res.json();

        if (res.ok) {
          form.reset();
          if (msg) {
            msg.textContent = data.type === 'waitlist'
              ? "You're on the list. We'll be in touch."
              : data.type === 'intelligence-setup'
                ? "Request received. We'll send an async setup path and next steps by email."
              : data.type === 'cbam-readiness'
                ? "Request received. We'll reply with next steps for a CBAM readiness call."
              : "Message sent. We'll reply within one business day.";
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
  }

  document.querySelectorAll('form[data-contact]').forEach(handleForm);
})();
