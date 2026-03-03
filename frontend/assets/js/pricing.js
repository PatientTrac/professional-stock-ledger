// ===========================================
// PRICING PAGE SPECIFIC JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {
  // ---- CONFIG (mirrors admin.js) ----
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const API_BASE_URL = isDev ? 'http://localhost:8888/api' : '/.netlify/functions';

  function getToken() { return localStorage.getItem('auth_token'); }
  function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } }

  // Pricing Toggle
  const pricingToggle = document.getElementById('pricingToggle');
  const toggleLabels = document.querySelectorAll('.toggle-label');
  const monthlyPrices = document.querySelectorAll('.price.monthly');
  const annualPrices = document.querySelectorAll('.price.annual');
  const subscribeButtons = document.querySelectorAll('.subscribe-btn');
  
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

      // Update subscribe button labels & data-period
      subscribeButtons.forEach(btn => {
        const plan = btn.dataset.plan;
        btn.dataset.period = isAnnual ? 'annual' : 'monthly';
        if (plan === 'professional') {
          btn.textContent = isAnnual ? 'Subscribe — $159/mo' : 'Subscribe — $199/mo';
        } else if (plan === 'business') {
          btn.textContent = isAnnual ? 'Subscribe — $319/mo' : 'Subscribe — $399/mo';
        }
      });
    });
  }

  // Subscribe button click handlers
  subscribeButtons.forEach(btn => {
    btn.addEventListener('click', async function() {
      const plan = this.dataset.plan;
      const period = this.dataset.period || 'monthly';
      const token = getToken();
      const user = getUser();

      // If not logged in, redirect to login with return URL
      if (!token || !user) {
        window.location.href = `login.html?mode=register&redirect=pricing&plan=${plan}&period=${period}`;
        return;
      }

      // Disable button during checkout creation
      this.disabled = true;
      const originalText = this.textContent;
      this.textContent = 'Redirecting to checkout...';

      try {
        const res = await fetch(`${API_BASE_URL}/stripe?action=create-checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ plan, period })
        });

        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create checkout');

        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } catch (error) {
        console.error('Checkout error:', error);
        alert('Failed to start checkout: ' + error.message);
        this.disabled = false;
        this.textContent = originalText;
      }
    });
  });

  // Check URL params for subscription result
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('subscription') === 'cancelled') {
    // Show a subtle message
    const badge = document.querySelector('.page-hero .badge span');
    if (badge) badge.textContent = 'Subscription cancelled. Choose a plan below.';
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
