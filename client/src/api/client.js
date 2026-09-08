import axios from 'axios';
import { notifications } from '@mantine/notifications';

const TOKEN_KEY = 'biscuit-erp-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

let redirecting = false;

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const payload = error.response?.data;
    const message = payload?.error || error.message || 'Something went wrong';
    const details = payload?.details;

    if (status === 401 && !redirecting && !window.location.pathname.startsWith('/login')) {
      redirecting = true;
      clearToken();
      notifications.show({ color: 'red', title: 'Session ended', message: 'Please sign in again' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 600);
    }

    error.friendly = Array.isArray(details) ? message + ': ' + details.join('; ') : message;
    return Promise.reject(error);
  }
);

/** Surfaces an API failure as a toast and returns the message. */
export function showError(error, title = 'Could not complete that') {
  const message = error?.friendly || error?.message || 'Unexpected error';
  /*
   * Guard the heading. React Query calls onError(error, variables, context),
   * so handing it this function directly puts the mutation's variables - an
   * id, or the whole form object - where the title belongs, and the toast
   * ends up headed with a raw ObjectId or "[object Object]".
   */
  const heading = typeof title === 'string' && title.trim() ? title : 'Could not complete that';
  notifications.show({ color: 'red', title: heading, message, autoClose: 6000 });
  return message;
}

export function showSuccess(message, title = 'Done') {
  notifications.show({ color: 'teal', title, message });
}

/**
 * Downloads a report as CSV or PDF. The browser cannot send an Authorization
 * header on a plain link, so the file is fetched as a blob and saved from
 * memory.
 */
export async function downloadReport(key, { format = 'csv', params = {}, filename } = {}) {
  const res = await api.get('/reports/' + key, {
    params: { ...params, format },
    responseType: 'blob',
  });

  const disposition = res.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const name = filename || match?.[1] || key + '.' + format;

  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
