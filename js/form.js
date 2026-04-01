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

      // Optional order-specific fields
      const productCategoryInput = document.getElementById('product-category');
      const orderQuantityInput = document.getElementById('order-quantity');
      const targetPriceInput = document.getElementById('target-price');
      const incotermsInput = document.getElementById('incoterms');
      const timelineInput = document.getElementById('timeline');
      
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
      
      // Build email subject and body
      const subject = encodeURIComponent(`New Order Inquiry from ${name} at ${company}`);

      const lines = [
        `Name: ${name}`,
        `Company: ${company}`,
        `Email: ${email}`,
        '',
        `Product / Project Details:`,
        project || 'N/A'
      ];

      const productCategory = productCategoryInput && productCategoryInput.value.trim();
      const orderQuantity = orderQuantityInput && orderQuantityInput.value.trim();
      const targetPrice = targetPriceInput && targetPriceInput.value.trim();
      const incoterms = incotermsInput && incotermsInput.value.trim();
      const timeline = timelineInput && timelineInput.value.trim();

      if (productCategory || orderQuantity || targetPrice || incoterms || timeline) {
        lines.push('', 'Order Parameters:');
      }

      if (productCategory) {
        lines.push(`- Product category: ${productCategory}`);
      }
      if (orderQuantity) {
        lines.push(`- Estimated order quantity: ${orderQuantity}`);
      }
      if (targetPrice) {
        lines.push(`- Target price: ${targetPrice}`);
      }
      if (incoterms) {
        lines.push(`- Preferred incoterms & destination: ${incoterms}`);
      }
      if (timeline) {
        lines.push(`- Target delivery timeline: ${timeline}`);
      }

      const body = encodeURIComponent(lines.join('\n'));
      
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


