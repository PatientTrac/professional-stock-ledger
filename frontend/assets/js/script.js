// AegisIQ Stock Ledger - JavaScript

document.addEventListener('DOMContentLoaded', function() {
  // ================================
  // Mobile Menu Toggle
  // ================================
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const mobileMenu = document.getElementById('mobileMenu');
  const menuIcon = mobileMenuToggle?.querySelector('.menu-icon');
  const closeIcon = mobileMenuToggle?.querySelector('.close-icon');

  if (mobileMenuToggle && mobileMenu) {
    mobileMenuToggle.addEventListener('click', function() {
      const isOpen = !mobileMenu.classList.contains('hidden');
      
      if (isOpen) {
        mobileMenu.classList.add('hidden');
        menuIcon?.classList.remove('hidden');
        closeIcon?.classList.add('hidden');
      } else {
        mobileMenu.classList.remove('hidden');
        menuIcon?.classList.add('hidden');
        closeIcon?.classList.remove('hidden');
      }
    });

    // Close mobile menu when clicking a link
    const mobileNavLinks = mobileMenu.querySelectorAll('.mobile-nav-link');
    mobileNavLinks.forEach(link => {
      link.addEventListener('click', function() {
        mobileMenu.classList.add('hidden');
        menuIcon?.classList.remove('hidden');
        closeIcon?.classList.add('hidden');
      });
    });
  }

  // ================================
  // Video Demo Play/Back Functionality
  // ================================
  const playButton = document.getElementById('playButton');
  const capTablePreview = document.getElementById('capTablePreview');
  const videoPlaying = document.getElementById('videoPlaying');
  const backToPreview = document.getElementById('backToPreview');

  if (playButton && videoPlaying && capTablePreview) {
    playButton.addEventListener('click', function() {
      capTablePreview.classList.add('hidden');
      playButton.classList.add('hidden');
      videoPlaying.classList.remove('hidden');
    });
  }

  if (backToPreview && videoPlaying && capTablePreview && playButton) {
    backToPreview.addEventListener('click', function() {
      videoPlaying.classList.add('hidden');
      capTablePreview.classList.remove('hidden');
      playButton.classList.remove('hidden');
    });
  }


  // ================================
  // Newsletter Form (Placeholder)
  // ================================
  const newsletterForm = document.getElementById('newsletterForm');

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const emailInput = document.getElementById('newsletterEmail');
      const email = emailInput?.value;
      
      if (email) {
        alert('Thank you for subscribing! We\'ll keep you updated.');
        emailInput.value = '';
      }
    });
  }

  // ================================
  // Smooth Scroll for Anchor Links
  // ================================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href && href !== '#') {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });

  // ================================
  // Header Background on Scroll
  // ================================
  const header = document.querySelector('.header');
  
  if (header) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
        header.style.background = 'hsl(243 51% 13% / 0.98)';
      } else {
        header.style.background = 'hsl(243 51% 15% / 0.95)';
      }
    });
  }

  // ================================
  // Intersection Observer for Animations
  // ================================
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Observe feature cards
  document.querySelectorAll('.feature-card').forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = `all 0.5s ease ${index * 0.1}s`;
    observer.observe(card);
  });

  // Observe stat cards
  document.querySelectorAll('.stat-card').forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = `all 0.5s ease ${index * 0.1}s`;
    observer.observe(card);
  });

  // ================================
  // Demo Request Dialog
  // ================================
  const demoBtn = document.getElementById('scheduleDemoBtn');
  const demoOverlay = document.getElementById('demoDialogOverlay');
  const demoCloseBtn = document.getElementById('demoDialogClose');
  const demoForm = document.getElementById('demoRequestForm');
  const demoSuccess = document.getElementById('demoSuccess');
  const demoCloseSuccess = document.getElementById('demoCloseSuccess');

  function openDemoDialog() {
    if (demoOverlay) {
      demoOverlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeDemoDialog() {
    if (demoOverlay) {
      demoOverlay.classList.add('hidden');
      document.body.style.overflow = '';
      // Reset form state
      if (demoForm) {
        demoForm.classList.remove('hidden');
        demoForm.reset();
      }
      if (demoSuccess) demoSuccess.classList.add('hidden');
    }
  }

  if (demoBtn) demoBtn.addEventListener('click', openDemoDialog);
  if (demoCloseBtn) demoCloseBtn.addEventListener('click', closeDemoDialog);
  if (demoCloseSuccess) demoCloseSuccess.addEventListener('click', closeDemoDialog);

  // Close on overlay click
  if (demoOverlay) {
    demoOverlay.addEventListener('click', function(e) {
      if (e.target === demoOverlay) closeDemoDialog();
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && demoOverlay && !demoOverlay.classList.contains('hidden')) {
      closeDemoDialog();
    }
  });

  if (demoForm) {
    demoForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const submitBtn = document.getElementById('demoSubmitBtn');
      
      // Show loading state
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }

      // Simulate API call (replace with real backend call later)
      setTimeout(() => {
        // Hide form, show success
        demoForm.classList.add('hidden');
        if (demoSuccess) demoSuccess.classList.remove('hidden');
        
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Demo Credentials';
        }
      }, 1500);
    });
  }
});