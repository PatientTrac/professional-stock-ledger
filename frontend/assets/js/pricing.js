// ===========================================
// PRICING PAGE SPECIFIC JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {
  // Pricing Toggle
  const pricingToggle = document.getElementById('pricingToggle');
  const toggleLabels = document.querySelectorAll('.toggle-label');
  const monthlyPrices = document.querySelectorAll('.price.monthly');
  const annualPrices = document.querySelectorAll('.price.annual');
  
  let isAnnual = false;

  if (pricingToggle) {
    pricingToggle.addEventListener('click', function() {
      isAnnual = !isAnnual;
      
      // Toggle switch visual
      this.classList.toggle('active', isAnnual);
      
      // Toggle labels
      toggleLabels.forEach(label => {
        if (label.dataset.period === 'annual') {
          label.classList.toggle('active', isAnnual);
        } else {
          label.classList.toggle('active', !isAnnual);
        }
      });
      
      // Toggle prices
      monthlyPrices.forEach(price => {
        price.style.display = isAnnual ? 'none' : 'inline';
      });
      
      annualPrices.forEach(price => {
        price.style.display = isAnnual ? 'inline' : 'none';
      });
    });
  }

  // Animate pricing cards on scroll
  const pricingCards = document.querySelectorAll('.pricing-card');
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = entry.target.classList.contains('featured') 
            ? 'scale(1.05)' 
            : 'translateY(0)';
        }, index * 150);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  pricingCards.forEach((card) => {
    card.style.opacity = '0';
    card.style.transform = card.classList.contains('featured') 
      ? 'scale(0.95)' 
      : 'translateY(20px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(card);
  });

  // FAQ items animation
  const faqItems = document.querySelectorAll('.faq-item');
  
  const faqObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, index * 100);
        faqObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  faqItems.forEach((item) => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(20px)';
    item.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    faqObserver.observe(item);
  });
});
