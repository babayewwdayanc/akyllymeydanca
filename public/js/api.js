// Serwere sorag. Oýunçynyň we administratoryň tokenleri localStorage-da saklanýar.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* gizlin režim */ } },
};

export const session = {
  get token() { return store.get('am_token'); },
  set token(v) { store.set('am_token', v); },
  get adminToken() { return store.get('am_admin_token'); },
  set adminToken(v) { store.set('am_admin_token', v); },
  me: null,
  admin: null,
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function authHeaders(admin) {
  const headers = {};
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (admin && session.adminToken) headers['x-admin-token'] = session.adminToken;
  return headers;
}

export async function api(path, { method = 'GET', body, form, admin = false, signal } = {}) {
  const headers = authHeaders(admin);
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
    if (res.status === 401) {
      if (admin) session.adminToken = null;
      else if (!path.startsWith('/api/login')) session.token = null;
    }
    throw new ApiError(data.error || `Ýalňyşlyk ${res.status}`, res.status);
  }
  return data;
}

/** Faýly ýüklemek (uly wideolar üçin) — göterim bilen. */
export function upload(path, form, { admin = false, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    for (const [k, v] of Object.entries(authHeaders(admin))) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* boş */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `Ýalňyşlyk ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Ýükleme kesildi. Internedi barlaň.', 0));
    xhr.send(form);
  });
}
