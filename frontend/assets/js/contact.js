// ===========================================
// CONTACT PAGE SPECIFIC JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {
  // Contact Form Submission
  const contactForm = document.getElementById('contactForm');
  
  if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Get form values
      const firstName = document.getElementById('firstName').value;
      const lastName = document.getElementById('lastName').value;
      const email = document.getElementById('email').value;
      const company = document.getElementById('company').value;
      const inquiryType = document.getElementById('inquiryType').value;
      const message = document.getElementById('message').value;
      
      // Here you would typically send the data to a server
      console.log('Form submitted:', {
        firstName,
        lastName,
        email,
        company,
        inquiryType,
        message
      });
      
      // Show success message
      alert('Thank you for your message! We\'ll get back to you within 24 hours.');
      
      // Reset form
      contactForm.reset();
    });
  }

  // Animate form and info cards on load
  const formWrapper = document.querySelector('.contact-form-wrapper');
  const infoCards = document.querySelectorAll('.info-card, .quick-links-card, .social-card');

  if (formWrapper) {
    formWrapper.style.opacity = '0';
    formWrapper.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
      formWrapper.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      formWrapper.style.opacity = '1';
      formWrapper.style.transform = 'translateY(0)';
    }, 100);
  }

  infoCards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
      card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 200 + (index * 100));
  });

  // Form input focus effects
  const formInputs = document.querySelectorAll('.form-input, .form-textarea, .form-select');
  
  formInputs.forEach(input => {
    input.addEventListener('focus', function() {
      this.parentElement.classList.add('focused');
    });
    
    input.addEventListener('blur', function() {
      this.parentElement.classList.remove('focused');
    });
  });

  // Map placeholder hover effect
  const mapPlaceholder = document.querySelector('.map-placeholder');
  
  if (mapPlaceholder) {
    mapPlaceholder.addEventListener('click', function() {
      // Open Google Maps with the address
      window.open('https://www.google.com/maps/search/123+Financial+District+New+York+NY+10004', '_blank');
    });
    
    mapPlaceholder.style.cursor = 'pointer';
  }
});
