// Form validation and handling

document.addEventListener('DOMContentLoaded', function() {
  const contactForm = document.getElementById('contact-form');
  
  if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Get form values
      const name = document.getElementById('name').value.trim();
      const company = document.getElementById('company').value.trim();
      const email = document.getElementById('email').value.trim();
      const project = document.getElementById('project').value.trim();
      
      // Basic validation
      if (!name || !company || !email) {
        alert('Please fill in all required fields.');
        return;
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
      }
      
      // Create mailto link with form data
      const subject = encodeURIComponent(`New Contact from ${name} at ${company}`);
      const body = encodeURIComponent(
        `Name: ${name}\n` +
        `Company: ${company}\n` +
        `Email: ${email}\n\n` +
        `Project Outline:\n${project}`
      );
      
      // Open email client
      window.location.href = `mailto:hello@orcatrade.com?subject=${subject}&body=${body}`;
      
      // Show success message
      const submitButton = contactForm.querySelector('button[type="submit"]');
      const originalText = submitButton.textContent;
      submitButton.textContent = 'Opening email client...';
      submitButton.disabled = true;
      
      setTimeout(() => {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      }, 2000);
    });
  }
});


