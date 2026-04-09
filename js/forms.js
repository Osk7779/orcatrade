// OrcaTrade universal form handler
// Intercepts any form with data-contact attribute and POSTs to /api/contact

(function () {
  const LANG = (document.documentElement.lang || 'en').slice(0, 2);
  const COPY = {
    en: {
      sending: 'Sending…',
      waitlist: "You're on the list. We'll be in touch.",
      setup: "Request received. We'll send an async setup path and next steps by email.",
      cbam: "Request received. We'll reply with next steps for a CBAM readiness call.",
      sent: "Message sent. We'll reply within one business day.",
      sentShort: 'Sent',
      error: 'Could not send — please email us directly at orca@orcatrade.pl',
    },
    de: {
      sending: 'Wird gesendet…',
      waitlist: 'Sie stehen auf der Liste. Wir melden uns.',
      setup: 'Anfrage erhalten. Wir senden Ihnen per E-Mail einen asynchronen Setup-Pfad und die nächsten Schritte.',
      cbam: 'Anfrage erhalten. Wir antworten mit den nächsten Schritten für ein CBAM-Bereitschaftsgespräch.',
      sent: 'Nachricht gesendet. Wir antworten innerhalb eines Werktages.',
      sentShort: 'Gesendet',
      error: 'Senden fehlgeschlagen — bitte schreiben Sie uns direkt an orca@orcatrade.pl',
    },
    pl: {
      sending: 'Wysyłanie…',
      waitlist: 'Jesteś na liście. Odezwiemy się.',
      setup: 'Prośba odebrana. Wyślemy asynchroniczną ścieżkę wdrożenia i kolejne kroki e-mailem.',
      cbam: 'Prośba odebrana. Odpowiemy z kolejnymi krokami dotyczącymi rozmowy o gotowości CBAM.',
      sent: 'Wiadomość wysłana. Odpowiemy w ciągu jednego dnia roboczego.',
      sentShort: 'Wysłano',
      error: 'Nie udało się wysłać — napisz bezpośrednio na orca@orcatrade.pl',
    },
  };
  const t = COPY[LANG] || COPY.en;

  function handleForm(form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      const btn = form.querySelector('[type="submit"]');
      const msg = form.querySelector('.form-msg');
      const originalText = btn ? btn.textContent : '';

      if (btn) { btn.disabled = true; btn.textContent = t.sending; }

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
              ? t.waitlist
              : data.type === 'intelligence-setup'
                ? t.setup
              : data.type === 'cbam-readiness'
                ? t.cbam
              : t.sent;
            msg.style.color = '#5cb88a';
          }
          if (btn) { btn.textContent = t.sentShort; }
        } else {
          throw new Error(json.error || 'Something went wrong.');
        }
      } catch (err) {
        if (msg) {
          msg.textContent = t.error;
          msg.style.color = '#dc5050';
        }
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
      }
    });
  }

  document.querySelectorAll('form[data-contact]').forEach(handleForm);
})();
