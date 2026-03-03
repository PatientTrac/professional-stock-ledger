// ===========================================
// LOGIN PAGE JAVASCRIPT
// ===========================================

document.addEventListener('DOMContentLoaded', function() {

  const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8888/api'
    : '/.netlify/functions';

  // DOM Elements
  const loginFormWrapper = document.getElementById('loginForm');
  const registerFormWrapper = document.getElementById('registerForm');
  const forgotPasswordFormWrapper = document.getElementById('forgotPasswordForm');
  const showRegisterLink = document.getElementById('showRegister');
  const showLoginLink = document.getElementById('showLogin');
  const showForgotPasswordLink = document.getElementById('showForgotPassword');
  const showLoginFromForgotLink = document.getElementById('showLoginFromForgot');

  const loginFormElement = document.getElementById('loginFormElement');
  const registerFormElement = document.getElementById('registerFormElement');
  const forgotPasswordFormElement = document.getElementById('forgotPasswordFormElement');

  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');
  const registerSuccess = document.getElementById('registerSuccess');
  const forgotError = document.getElementById('forgotError');
  const forgotSuccess = document.getElementById('forgotSuccess');

  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const forgotBtn = document.getElementById('forgotBtn');

  const loginPasswordToggle = document.getElementById('loginPasswordToggle');

  // Check URL params for mode
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'register') showRegisterForm();
   

  // Clear stale session

  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
  sessionStorage.clear();

  const logoutMessage = sessionStorage.getItem('logout_message');
  if (logoutMessage) {
    sessionStorage.removeItem('logout_message');
    showError(loginError, logoutMessage);
    loginError.style.display = 'block';
  }

  // ── Form Toggle ──
  showRegisterLink?.addEventListener('click', e => { e.preventDefault(); showRegisterForm(); });
  showLoginLink?.addEventListener('click', e => { e.preventDefault(); showLoginForm(); });
  showForgotPasswordLink?.addEventListener('click', e => { e.preventDefault(); showForgotForm(); });
  showLoginFromForgotLink?.addEventListener('click', e => { e.preventDefault(); showLoginForm(); });

  function showRegisterForm() {
    loginFormWrapper.style.display = 'none';
    forgotPasswordFormWrapper.style.display = 'none';
    registerFormWrapper.style.display = 'block';
    registerFormWrapper.style.animation = 'none';
    setTimeout(() => registerFormWrapper.style.animation = 'fadeIn 0.4s ease', 10);
    clearErrors();
  }

  function showLoginForm() {
    registerFormWrapper.style.display = 'none';
    forgotPasswordFormWrapper.style.display = 'none';
    loginFormWrapper.style.display = 'block';
    loginFormWrapper.style.animation = 'none';
    setTimeout(() => loginFormWrapper.style.animation = 'fadeIn 0.4s ease', 10);
    clearErrors();
  }

  function showForgotForm() {
    loginFormWrapper.style.display = 'none';
    registerFormWrapper.style.display = 'none';
    forgotPasswordFormWrapper.style.display = 'block';
    forgotPasswordFormWrapper.style.animation = 'none';
    setTimeout(() => forgotPasswordFormWrapper.style.animation = 'fadeIn 0.4s ease', 10);
    clearErrors();
  }

  function clearErrors() {
    [loginError, registerError, registerSuccess, forgotError, forgotSuccess].forEach(el => {
      if (el) el.style.display = 'none';
    });
  }

  // ── Password Toggle ──
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

  // ── Validation ──
  function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
  function sanitizeInput(input) { return input.trim().substring(0, 255); }
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

  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
  }

  function showSuccess(element, message) {
    element.textContent = message;
    element.style.display = 'block';
  }

  // ── Login ──
  loginFormElement?.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearErrors();

    const email = sanitizeInput(document.getElementById('loginEmail').value);
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;
    if (!validateEmail(email)) { showError(loginError, 'Please enter a valid email address'); return; }
    if (!password) { showError(loginError, 'Please enter your password'); return; }
    setLoading(loginBtn, true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
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

  // ── Register (no password – temp password emailed) ──
  registerFormElement?.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearErrors();

    const full_name = sanitizeInput(document.getElementById('registerName').value);
    const email = sanitizeInput(document.getElementById('registerEmail').value);
    const agreeTerms = document.getElementById('agreeTerms').checked;
    if (!full_name || full_name.length < 2) { showError(registerError, 'Please enter your full name'); return; }
    if (!validateEmail(email)) { showError(registerError, 'Please enter a valid email address'); return; }
    if (!agreeTerms) { showError(registerError, 'Please agree to the Terms of Service'); return; }
    setLoading(registerBtn, true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, full_name })
      });

      const data = await response.json();

      if (data.success) {
        showSuccess(registerSuccess, data.message || 'Account created! Check your email for your temporary password.');
        setTimeout(() => showLoginForm(), 4000);
      } else {
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

  // ── Forgot Password ──
  forgotPasswordFormElement?.addEventListener('submit', async function(e) {
    e.preventDefault();
    clearErrors();

    const email = sanitizeInput(document.getElementById('forgotEmail').value);
    if (!validateEmail(email)) { showError(forgotError, 'Please enter a valid email address'); return; }

    setLoading(forgotBtn, true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (data.success) {
        showSuccess(forgotSuccess, data.message || 'If an account exists, a temporary password has been sent to your email.');
        setTimeout(() => showLoginForm(), 4000);
      } else {
        showError(forgotError, data.error || 'Something went wrong. Please try again.');
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      showError(forgotError, 'Unable to connect to server. Please try again.');
    } finally {
      setLoading(forgotBtn, false);
    }
  });
});
