async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && location.pathname !== '/doctor-login' && location.pathname !== '/hospital-login') {
      location.href = location.pathname.startsWith('/doctor') ? '/doctor-login' : '/hospital-login';
    }
    throw new Error(result.message || 'The request could not be completed.');
  }
  return result;
}

function addText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text == null ? '' : String(text);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function showMessage(target, text, isError = false) {
  target.textContent = text || '';
  target.classList.toggle('error', isError);
}

async function signOut() {
  await apiRequest('/api/session/logout', { method: 'POST' });
  location.href = '/';
}

function addSignOutButton(container) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'Sign out';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await signOut();
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  });
  container.append(button);
}
