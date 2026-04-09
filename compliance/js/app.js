document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('complianceForm');
  const cache = window.OrcaTradeCachePreference;
  
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      data.euMarket = formData.has('euMarket'); // Explicitly capture boolean state
      
      if (cache) {
        cache.writeWorkflowState('orcatradeComplianceOrder', JSON.stringify(data));
      } else {
        localStorage.setItem('orcatradeComplianceOrder', JSON.stringify(data));
      }
      
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.innerHTML = 'Analyzing... <span style="display:inline-block;animation:spin 1s linear infinite;margin-left:0.5rem">⭮</span>';
      submitBtn.disabled = true;

      // Transfer control immediately to check.html which handles loading and the API call
      window.location.href = 'check.html';
    });
  }
});
