module.exports = async function handler(req, res) {
  // Allow CORS for same-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { name, email, company, message, project, type } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('No RESEND_API_KEY set — email not sent.');
    return res.status(200).json({ ok: true, demo: true });
  }

  const subject = type === 'waitlist'
    ? `New waitlist signup: ${name}`
    : `New inquiry from ${name}${company ? ` (${company})` : ''}`;

  const body = type === 'waitlist'
    ? `New waitlist signup\n\nName: ${name}\nEmail: ${email}`
    : `New inquiry via OrcaTrade\n\nName: ${name}\nEmail: ${email}${company ? `\nCompany: ${company}` : ''}${project ? `\n\nMessage:\n${project}` : ''}${message ? `\n\nMessage:\n${message}` : ''}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'OrcaTrade Site <noreply@orcatrade.pl>',
        to: ['orca@orcatrade.pl'],
        reply_to: email,
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Failed to send email.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact API error:', err);
    return res.status(500).json({ error: err.message });
  }
};