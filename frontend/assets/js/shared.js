// ===========================================
// SHARED JAVASCRIPT - Common across all pages
// ===========================================

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
    mobileMenu.querySelectorAll('.mobile-nav-link').forEach(link => {
      link.addEventListener('click', function() {
        mobileMenu.classList.add('hidden');
        menuIcon?.classList.remove('hidden');
        closeIcon?.classList.add('hidden');
										   
		 
      });
    });
  }

  // ================================
  // Back to Top Button
  // ================================
  const backToTopBtn = document.getElementById('backToTop');
  if (backToTopBtn) {
										 
    window.addEventListener('scroll', function() {
      if (window.scrollY > 300) {
        backToTopBtn.classList.add('visible');
												  
      } else {
        backToTopBtn.classList.remove('visible');
												 
      }
    });

							  
									 
											 
																			  

    backToTopBtn.addEventListener('click', function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ================================
  // Newsletter Form
  // ================================
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const emailInput = document.getElementById('newsletterEmail') || this.querySelector('input[type="email"]');
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
});
