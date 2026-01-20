# Sistem Autentikasi JWT dengan External SSO

Dokumentasi ini menjelaskan cara menggunakan sistem autentikasi JWT yang telah diimplementasikan dalam aplikasi.

## Overview

Aplikasi ini sekarang memiliki sistem autentikasi yang:
- Menggunakan JWT token yang diberikan oleh external SSO login page
- Menyimpan token di httpOnly cookie untuk keamanan
- Memvalidasi token secara lokal menggunakan JWT secret
- Melindungi semua API routes dan menu dari akses yang tidak sah

## Environment Variables

Tambahkan environment variables berikut ke file `.env`:

```bash
# JWT Authentication
JWT_SECRET=your-sso-jwt-secret-key-here
JWT_COOKIE_NAME=sso_token
SSO_LOGIN_URL=https://sso.example.com/login
SSO_REDIRECT_URL=https://your-app.com
```

### Penjelasan Environment Variables:

- **JWT_SECRET**: Secret key untuk validasi JWT token. Harus sama dengan secret key yang digunakan oleh SSO server untuk men-sign token.
- **JWT_COOKIE_NAME**: Nama cookie untuk menyimpan JWT token (default: `sso_token`)
- **SSO_LOGIN_URL**: URL halaman login SSO eksternal
- **SSO_REDIRECT_URL**: URL aplikasi ini untuk redirect setelah berhasil login

## Cara Kerja

### 1. Flow Autentikasi

```
1. User mencoba mengakses aplikasi
2. Frontend mengecek auth status via GET /api/auth/check
3. Jika belum login, redirect ke SSO_LOGIN_URL
4. User login di SSO server
5. SSO server redirect kembali dengan JWT token di cookie
6. Frontend cek auth status lagi
7. User dapat mengakses aplikasi
```

### 2. Proteksi Routes

Semua API routes sekarang diproteksi dengan middleware `authenticateToken`:
- `/api/*` - Semua CRM API endpoints
- `/sessions` - Manajemen session WhatsApp
- `/jobs` - Manajemen broadcast jobs

### 3. Frontend Functions

Fungsi-fungsi berikut tersedia di `public/js/utils.js`:

#### `checkAuthStatus()`

Mengecek apakah user sudah login atau belum.

```javascript
const authStatus = await checkAuthStatus();
console.log(authStatus.authenticated); // true/false
console.log(authStatus.user); // user data jika authenticated
```

#### `redirectIfNotAuthenticated(ssoLoginUrl)`

Redirect ke SSO login page jika user belum login.

```javascript
const isAuthenticated = await redirectIfNotAuthenticated('https://sso.example.com/login');
if (!isAuthenticated) {
  // User akan di-redirect ke SSO login page
}
```

#### `protectRoute(ssoLoginUrl, callback)`

Melindungi akses ke menu/halaman tertentu.

```javascript
await protectRoute('https://sso.example.com/login', () => {
  // Kode ini hanya akan dijalankan jika user sudah login
  loadDashboard();
});
```

#### `authenticatedFetch(url, options, ssoLoginUrl)`

Fetch API dengan automatic auth error handling.

```javascript
const response = await authenticatedFetch('/api/sessions', {}, 'https://sso.example.com/login');
// Jika 401/403, otomatis redirect ke login page
```

#### `authenticatedPostJson(url, body, ssoLoginUrl)` & `authenticatedGetJson(url, ssoLoginUrl)`

Wrapper untuk POST dan GET request dengan auth handling.

```javascript
// POST request
const data = await authenticatedPostJson('/api/sessions', { id: 'session1' }, 'https://sso.example.com/login');

// GET request
const sessions = await authenticatedGetJson('/api/sessions', 'https://sso.example.com/login');
```

## Implementasi di Frontend

### Contoh 1: Cek Auth Status Saat Load Halaman

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const SSO_LOGIN_URL = 'https://sso.example.com/login';

  // Cek auth status
  const authStatus = await checkAuthStatus();

  if (!authStatus.authenticated) {
    // Redirect ke login page
    window.location.href = SSO_LOGIN_URL;
    return;
  }

  // Load aplikasi jika sudah login
  loadApplication();
});
```

### Contoh 2: Proteksi Menu Navigation

```javascript
// Di navigation.js
function navigateToMenu(menuName) {
  const SSO_LOGIN_URL = 'https://sso.example.com/login';

  protectRoute(SSO_LOGIN_URL, () => {
    // Hanya dijalankan jika user sudah login
    switch(menuName) {
      case 'dashboard':
        showDashboard();
        break;
      case 'broadcast':
        showBroadcast();
        break;
      // ... menu lain
    }
  });
}
```

### Contoh 3: API Request dengan Auth Handling

```javascript
// Ganti postJson biasa dengan authenticatedPostJson
async function createSession(sessionId) {
  const SSO_LOGIN_URL = 'https://sso.example.com/login';

  try {
    const result = await authenticatedPostJson('/sessions', {
      id: sessionId
    }, SSO_LOGIN_URL);
    return result;
  } catch (error) {
    console.error('Failed to create session:', error);
    // Jika error 401/403, user sudah di-redirect ke login page
  }
}
```

### Contoh 4: Global Auth Check dengan setInterval

```javascript
// Cek auth status setiap 5 menit
setInterval(async () => {
  const authStatus = await checkAuthStatus();

  if (!authStatus.authenticated) {
    // Redirect ke login page jika token expired
    window.location.href = SSO_LOGIN_URL;
  }
}, 5 * 60 * 1000);
```

## Integrasi dengan SSO Server

SSO server Anda perlu:

1. **Set JWT token di httpOnly cookie** saat user berhasil login:

```javascript
// Di SSO server (Node.js example)
res.cookie('sso_token', jwtToken, {
  httpOnly: true,
  secure: true,      // jika HTTPS
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000 // 24 jam
});
```

2. **Redirect user kembali ke aplikasi** setelah login:

```javascript
// Di SSO server
res.redirect(process.env.SSO_REDIRECT_URL);
```

3. **JWT Token Structure**:

```json
{
  "user_id": "123",
  "email": "user@example.com",
  "name": "John Doe",
  "roles": ["admin"],
  "iat": 1234567890,
  "exp": 1234654290
}
```

## Troubleshooting

### Error: "No authentication token found"

**Penyebab**: JWT token tidak ditemukan di cookie.

**Solusi**:
- Pastikan SSO server sudah set cookie dengan nama yang sesuai (`JWT_COOKIE_NAME`)
- Cek browser devtools > Application > Cookies untuk memastikan cookie ter-set

### Error: "Invalid or expired token"

**Penyebab**: Token tidak valid atau sudah expired.

**Solusi**:
- Pastikan `JWT_SECRET` sama dengan secret key SSO server
- Cek expiry date token (default: 24 jam)
- Pastikan waktu server sudah sinkron

### User tidak bisa login setelah redirect dari SSO

**Penyebab**: Cookie tidak ter-set dengan benar.

**Solusi**:
- Pastikan SSO server dan aplikasi berada di domain yang sama (atau set domain cookie)
- Cek `SameSite` dan `Secure` attribute pada cookie
- Pastikan browser mengizinkan third-party cookies jika domain berbeda

## Testing

Untuk testing tanpa SSO server, Anda bisa:

1. Set JWT token secara manual menggunakan browser devtools:

```javascript
// Di browser console
document.cookie = "sso_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...; path=/; httponly";
```

2. Atau buat endpoint testing untuk set token:

```javascript
// Hanya untuk testing - JANGAN digunakan di production!
app.get('/test-login', (req, res) => {
  const testToken = jwt.sign({ user_id: 'test', email: 'test@example.com' }, JWT_SECRET);
  res.cookie('sso_token', testToken, { httpOnly: true });
  res.json({ message: 'Test login successful' });
});
```

## Keamanan

- JWT token disimpan di httpOnly cookie - tidak bisa diakses via JavaScript
- Selalu gunakan HTTPS di production
- Set `secure: true` pada cookie jika menggunakan HTTPS
- Gunakan `sameSite: 'strict'` untuk mencegah CSRF
- Secret key harus di-random dan tidak di-commit ke git
- Token expired secara otomatis (default: 24 jam)
