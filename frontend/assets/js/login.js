// ===========================================
// LOGIN PAGE JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {
  // API Base URL - auto-detect local vs production
  const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8888/api'
    : '/.netlify/functions';

  // DOM Elements
  const loginFormWrapper = document.getElementById('loginForm');
  const registerFormWrapper = document.getElementById('registerForm');
  const showRegisterLink = document.getElementById('showRegister');
  const showLoginLink = document.getElementById('showLogin');
  
  const loginFormElement = document.getElementById('loginFormElement');
  const registerFormElement = document.getElementById('registerFormElement');
  
  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');
  const registerSuccess = document.getElementById('registerSuccess');
  
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  
  // Password toggle buttons
  const loginPasswordToggle = document.getElementById('loginPasswordToggle');
  const registerPasswordToggle = document.getElementById('registerPasswordToggle');

  // Check URL params for mode
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'register') {
    showRegisterForm();
  }

  // Check if already logged in
  const token = localStorage.getItem('auth_token');
  if (token) {
    // Redirect to app if already logged in
    window.location.href = 'app.html';
    return;
  }

  // Toggle between login and register forms
  showRegisterLink?.addEventListener('click', function(e) {
    e.preventDefault();
    showRegisterForm();
  });

  showLoginLink?.addEventListener('click', function(e) {
    e.preventDefault();
    showLoginForm();
  });

  function showRegisterForm() {
    loginFormWrapper.style.display = 'none';
    registerFormWrapper.style.display = 'block';
    registerFormWrapper.style.animation = 'none';
    setTimeout(() => registerFormWrapper.style.animation = 'fadeIn 0.4s ease', 10);
    clearErrors();
  }

  function showLoginForm() {
    registerFormWrapper.style.display = 'none';
    loginFormWrapper.style.display = 'block';
    loginFormWrapper.style.animation = 'none';
    setTimeout(() => loginFormWrapper.style.animation = 'fadeIn 0.4s ease', 10);
    clearErrors();
  }

  function clearErrors() {
    loginError.style.display = 'none';
    registerError.style.display = 'none';
    registerSuccess.style.display = 'none';
  }

  // Password visibility toggle
  function setupPasswordToggle(toggleBtn, inputId) {
    if (!toggleBtn) return;
    
    toggleBtn.addEventListener('click', function() {
      const input = document.getElementById(inputId);
      const eyeIcon = this.querySelector('.eye-icon');
      const eyeOffIcon = this.querySelector('.eye-off-icon');
      
      if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.style.display = 'none';
        eyeOffIcon.style.display = 'block';
      } else {
        input.type = 'password';
        eyeIcon.style.display = 'block';
        eyeOffIcon.style.display = 'none';
      }
    });
  }

  setupPasswordToggle(loginPasswordToggle, 'loginPassword');
  setupPasswordToggle(registerPasswordToggle, 'registerPassword');

  // Input validation
  function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  function validatePassword(password) {
    return password && password.length >= 8;
  }

  function sanitizeInput(input) {
    return input.trim().substring(0, 255);
  }

  // Set button loading state
  function setLoading(button, isLoading) {
    const btnText = button.querySelector('.btn-text');
    const btnLoader = button.querySelector('.btn-loader');
    
    if (isLoading) {
      button.disabled = true;
      btnText.style.display = 'none';
      btnLoader.style.display = 'flex';
    } else {
      button.disabled = false;
      btnText.style.display = 'inline';
      btnLoader.style.display = 'none';
    }
  }

  // Show error message
  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
  }

  // Login form submission
  loginFormElement?.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearErrors();
    
    const email = sanitizeInput(document.getElementById('loginEmail').value);
    const password = document.getElementById('loginPassword').value;

    // Client-side validation
    if (!validateEmail(email)) {
      showError(loginError, 'Please enter a valid email address');
      return;
    }

    if (!password) {
      showError(loginError, 'Please enter your password');
      return;
    }

    setLoading(loginBtn, true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth?action=login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        // Store auth data
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Redirect to app
        window.location.href = 'app.html';
      } else {
        showError(loginError, data.error || 'Invalid email or password');
      }
    } catch (error) {
      console.error('Login error:', error);
      showError(loginError, 'Unable to connect to server. Please try again.');
    } finally {
      setLoading(loginBtn, false);
    }
  });

  // Register form submission
  registerFormElement?.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearErrors();

    const full_name = sanitizeInput(document.getElementById('registerName').value);
    const email = sanitizeInput(document.getElementById('registerEmail').value);
    const password = document.getElementById('registerPassword').value;
    const agreeTerms = document.getElementById('agreeTerms').checked;

    // Client-side validation
    if (!full_name || full_name.length < 2) {
      showError(registerError, 'Please enter your full name');
      return;
    }

    if (!validateEmail(email)) {
      showError(registerError, 'Please enter a valid email address');
      return;
    }

    if (!validatePassword(password)) {
      showError(registerError, 'Password must be at least 8 characters');
      return;
    }

    if (!agreeTerms) {
      showError(registerError, 'Please agree to the Terms of Service');
      return;
    }

    setLoading(registerBtn, true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth?action=register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, full_name })
      });

      const data = await response.json();

      if (data.success) {
        // Store auth data
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Show success and redirect
        registerSuccess.textContent = 'Account created successfully! Redirecting...';
        registerSuccess.style.display = 'block';
        
        setTimeout(() => {
          window.location.href = 'app.html';
        }, 1500);
      } else {
        // Handle specific errors
        if (data.error === 'User already exists') {
          showError(registerError, 'An account with this email already exists. Try logging in instead.');
        } else {
          showError(registerError, data.error || 'Registration failed. Please try again.');
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      showError(registerError, 'Unable to connect to server. Please try again.');
    } finally {
      setLoading(registerBtn, false);
    }
  });
});
