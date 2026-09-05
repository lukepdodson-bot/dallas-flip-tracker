import axios from 'axios';

const TOKEN_KEY = 'daub.token';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    // The server always says what went wrong in `error`. Surface that rather
    // than "Request failed with status code 400", which tells a user nothing.
    error.message = error.response?.data?.error || error.message;
    if (error.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

export const setToken    = token => localStorage.setItem(TOKEN_KEY, token);
export const clearToken  = () => localStorage.removeItem(TOKEN_KEY);
export const hasToken    = () => Boolean(localStorage.getItem(TOKEN_KEY));

/** Cents in, "$1,200.00" out. Money is never a float on either side. */
export function money(cents) {
  if (cents === null || cents === undefined) return '--';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function shortDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Fetch a protected file and hand it to the browser.
 *
 * Licence PDFs, tax statements and licensed image files all sit behind the
 * Authorization header, so a plain anchor would 401. This pulls the bytes with
 * the token attached and then triggers the save.
 */
export async function downloadFile(url, filename) {
  const response = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: revoking synchronously can beat the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
