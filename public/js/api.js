// Запросы к серверу. Токен игрока и ключ админа хранятся в localStorage.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

export const session = {
  get token() { return store.get('am_token'); },
  set token(v) { store.set('am_token', v); },
  get adminKey() { return store.get('am_admin'); },
  set adminKey(v) { store.set('am_admin', v); },
  me: null,
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, form, admin = false, signal } = {}) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (admin && session.adminKey) headers['x-admin-key'] = session.adminKey;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, signal });
  } catch {
    throw new ApiError('Serwer bilen aragatnaşyk ýok. Internedi barlaň we täzeden synanyşyň.', 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/login')) session.token = null;
    throw new ApiError(data.error || `Ýalňyşlyk ${res.status}`, res.status);
  }
  return data;
}

/** Загрузка файла с прогрессом (для больших видео). */
export function upload(path, form, { admin = false, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    if (session.token) xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    if (admin && session.adminKey) xhr.setRequestHeader('x-admin-key', session.adminKey);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* пусто */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `Ýalňyşlyk ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Ýükleme kesildi. Internedi barlaň.', 0));
    xhr.send(form);
  });
}
