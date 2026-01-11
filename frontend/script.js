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
  // Back to Top Button
  // ================================
  const backToTopButton = document.getElementById('backToTop');

  if (backToTopButton) {
    backToTopButton.addEventListener('click', function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
});