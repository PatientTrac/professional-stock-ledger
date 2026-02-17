// ===========================================
// ABOUT PAGE SPECIFIC JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {
  // Animate value cards on scroll
  const valueCards = document.querySelectorAll('.value-card');
  
  const valueObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, index * 100);
        valueObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  valueCards.forEach((card) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    valueObserver.observe(card);
  });

  // Animate team cards on scroll
  const teamCards = document.querySelectorAll('.team-card');
  
  const teamObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, index * 100);
        teamObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  teamCards.forEach((card) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    teamObserver.observe(card);
  });

  // Animate stat cards on scroll
  const statCards = document.querySelectorAll('.stat-card');
  
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }, index * 100);
        statObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  statCards.forEach((card) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    statObserver.observe(card);
  });

  // Animate about content
  const aboutContent = document.querySelector('.about-content');
  const imageCard = document.querySelector('.image-card');

  if (aboutContent) {
    aboutContent.style.opacity = '0';
    aboutContent.style.transform = 'translateX(-30px)';
    
    setTimeout(() => {
      aboutContent.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
      aboutContent.style.opacity = '1';
      aboutContent.style.transform = 'translateX(0)';
    }, 200);
  }

  if (imageCard) {
    imageCard.style.opacity = '0';
    imageCard.style.transform = 'translateX(30px)';
    
    setTimeout(() => {
      imageCard.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
      imageCard.style.opacity = '1';
      imageCard.style.transform = 'translateX(0)';
    }, 400);
  }
});
