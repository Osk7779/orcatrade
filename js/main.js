// Main JavaScript file for orcatrade website

// Auto-update footer year
document.addEventListener('DOMContentLoaded', function() {
  const yearElement = document.getElementById('year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Smooth scrolling for anchor links with offset for sticky header
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      // Only handle if it's a hash link on the same page
      if (href !== '#' && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const headerOffset = 80;
          const elementPosition = target.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }
    });
  });

  // Scroll animation for sections
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -100px 0px'
  };

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, observerOptions);

  // Observe all sections except hero (which is already visible)
  document.querySelectorAll('.section:not(.section--hero)').forEach(section => {
    observer.observe(section);
  });

  // Highlight active navigation link based on scroll position
  const sections = document.querySelectorAll('.section[id]');
  const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  
  function highlightActiveSection() {
    let current = '';
    const scrollPosition = window.pageYOffset + 150;

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;
      if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.style.opacity = '0.72';
      link.style.fontWeight = 'normal';
      const href = link.getAttribute('href');
      if (href === `#${current}` || (current === 'top' && (href === '#top' || href === '#'))) {
        link.style.opacity = '1';
        link.style.fontWeight = '500';
      }
    });
  }

  // Highlight on scroll
  window.addEventListener('scroll', highlightActiveSection);
  highlightActiveSection(); // Initial call
});

