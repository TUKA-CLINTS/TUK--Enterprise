// Sign-in and create-account pages.
import { initShell } from '../script.js';
import { login, register, isSignedIn } from './auth.js';
import { toast } from './ui.js';

function nextTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && /^[a-z0-9-]+\.html$/i.test(next) ? next : 'dashboard.html';
}

initShell({ guest: true });

// Already signed in? Go straight to the app.
if (isSignedIn()) {
  window.location.replace(nextTarget());
}

function showError(form, message) {
  const box = form.querySelector('.form-error');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  } else {
    toast(message, 'error');
  }
}

function clearError(form) {
  const box = form.querySelector('.form-error');
  if (box) box.hidden = true;
}

// ---- Sign in ---------------------------------------------------------------

const signinForm = document.getElementById('signin-form');
if (signinForm) {
  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(signinForm);
    const email = signinForm.email.value.trim();
    const password = signinForm.password.value;
    const button = signinForm.querySelector('button[type="submit"]');

    if (!email || !password) {
      showError(signinForm, 'Enter your email address and password.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const user = await login(email, password);
      toast(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
      window.location.href = nextTarget();
    } catch (err) {
      if (err.offline) {
        showError(signinForm, 'No network connection. Signing in for the first time needs the server — after that, the app works offline on this device.');
      } else {
        showError(signinForm, err.message);
      }
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

// ---- Create account ---------------------------------------------------------

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(signupForm);

    const payload = {
      name: signupForm.name.value.trim(),
      email: signupForm.email.value.trim(),
      phone: signupForm.phone.value.trim(),
      department: signupForm.department.value,
      requirements: signupForm.requirements.value.trim()
    };

    if (!payload.name || payload.name.length < 2) return showError(signupForm, 'Enter your full name.');
    if (!payload.email) return showError(signupForm, 'Enter your email address.');
    if (!payload.department) return showError(signupForm, 'Choose the department you work in.');
    if (payload.requirements.length < 10) return showError(signupForm, 'Describe the requirements for your enrollment.');

    const button = signupForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Submitting application…';
    try {
      await register(payload);
      signupForm.reset();
      toast('Application submitted. Your manager will verify it before administrator approval.', 'success');
      button.textContent = 'Application submitted';
    } catch (err) {
      if (err.offline) {
        showError(signupForm, 'No network connection. Creating an account needs the server — please reconnect and try again.');
      } else {
        showError(signupForm, err.message);
      }
      button.disabled = false;
      button.textContent = 'Submit application';
    }
  });
}
