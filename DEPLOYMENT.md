# Deployment Guide - WhiskeySocket

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [GitHub Container Registry Setup](#github-container-registry-setup)
- [Deploy to Render](#deploy-to-render)
- [Deploy to Railway](#deploy-to-railway)
- [Deploy to DigitalOcean](#deploy-to-digitalocean)
- [Manual Docker Deployment](#manual-docker-deployment)

---

## Overview

Project ini menggunakan Docker containerization untuk deployment yang mudah ke berbagai platform. Docker image akan otomatis di-build dan push ke **GitHub Container Registry (GHCR)** via GitHub Actions.

---

## Prerequisites

1. **Repository GitHub** - Push code ke GitHub
2. **GitHub Token** - Otomatis tersedia untuk GitHub Actions
3. **Akun Platform Deployment** (Render/Railway/DigitalOcean)

---

## GitHub Container Registry Setup

### 1. Package Repository Visibility

Secara default, package di GHCR bersifat **private**. Untuk membuatnya public:

1. Go to: https://github.com/users/YOUR_USERNAME/packages
2. Find: `whiskeysocket` package
3. Click **Package settings**
4. Scroll to **Danger Zone**
5. Click **Change visibility** → **Public**

Atau tetap private, tapi perlu token saat pull image.

### 2. Auto-Build Process

Setiap push ke branch `main` atau tag `v*.*.*` akan trigger:
- Build Docker image untuk `linux/amd64` dan `linux/arm64`
- Push ke GHCR dengan tags:
  - `latest` (untuk branch main)
  - `main-<sha>` (commit SHA)
  - `v1.0.0` (untuk version tags)

---

## Deploy to Render

### Option 1: Auto-Deploy dari GitHub (Recommended)

1. **Sign Up/Login** ke [render.com](https://render.com)
2. Connect GitHub repository
3. Pilih repository `whiskeysocket`
4. Render akan otomatis detect `render.yaml` dan `Dockerfile`
5. **Settings**:
   - **Name**: `whiskeysocket`
   - **Region**: Singapore (terdekat)
   - **Plan**: Free
   - **Health Check Path**: `/sessions`

6. **Advanced Settings** → **Add Environment Variable**:
   ```
   NODE_ENV=production
   PORT=3000
   ```

7. **Deploy!**

### Option 2: Deploy dari GHCR Image

1. Create new **Web Service**
2. Select **Dockerfile** → **Use an existing image**
3. Image URL: `ghcr.io/YOUR_USERNAME/whiskeysocket:latest`
4. Jika private image, add **Environment Variable**:
   ```
   RENDER_REGISTRY_USER=YOUR_GITHUB_USERNAME
   RENDER_REGISTRY_PASSWORD=YOUR_GITHUB_TOKEN
   ```

### Persistent Disk (Important!)

Render Free tier **tidak support persistent disk**. Data akan hilang saat redeploy.

Untuk production, gunakan **Starter Plan ($7/mo)** untuk:
- Persistent disk untuk `auth/` folder
- Auto-deploys dari branch main

Atau gunakan external storage seperti:
- Redis (untuk session state)
- PostgreSQL (untuk job storage)

---

## Deploy to Railway

1. **Sign Up/Login** ke [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from GitHub repo**
3. Pilih repository `whiskeysocket`
4. Railway akan otomatis detect `Dockerfile`
5. **Settings**:
   - **Root Directory**: `./`
   - **Dockerfile Path**: `Dockerfile`
6. **Add Variables**:
   ```
   NODE_ENV=production
   PORT=3000
   ```
7. **Deploy!**

### Persistent Volume

Railway support **persistent volume**:
1. Go ke **Variables** tab
2. Enable **Volumes**
3. Add:
   - `auth` (1 GB)
   - `jobs` (1 GB)

---

## Deploy to DigitalOcean App Platform

1. **Sign Up/Login** ke [digitalocean.com](https://digitalocean.com)
2. Go to **Apps** → **Create App**
3. Select **GitHub** → Connect repository
4. Configure:
   - **Branch**: `main`
   - **Build Command**: (leave empty for Docker)
   - **Run Command**: (leave empty for Docker)
5. **Components** → **Add Component** → **Dockerfile**
6. **HTTP Port**: `3000`
7. **Environment Variables**:
   ```
   NODE_ENV=production
   PORT=3000
   ```
8. **Deploy!**

### Persistent Storage

Di DigitalOcean, persistent storage menggunakan **Volumes**:
1. Add **Persistent Volume** component
2. Mount path: `/app/auth` (1 GB)
3. Mount path: `/app/jobs` (1 GB)

---

## Manual Docker Deployment

### Pull Image from GHCR

```bash
# Login ke GHCR (jika private)
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Pull image
docker pull ghcr.io/YOUR_USERNAME/whiskeysocket:latest

# Run container
docker run -d \
  --name whiskeysocket \
  -p 3000:3000 \
  -v $(pwd)/auth:/app/auth \
  -v $(pwd)/jobs:/app/jobs \
  -e NODE_ENV=production \
  -e PORT=3000 \
  ghcr.io/YOUR_USERNAME/whiskeysocket:latest
```

### Build Image Locally

```bash
# Build
docker build -t whiskeysocket .

# Run
docker run -d \
  --name whiskeysocket \
  -p 3000:3000 \
  -v $(pwd)/auth:/app/auth \
  -v $(pwd)/jobs:/app/jobs \
  whiskeysocket
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `3000` |

---

## Health Check

Aplikasi memiliki health check endpoint:
```
GET /sessions
```

Status: `200 OK` = Healthy

---

## Troubleshooting

### Build Failed di GitHub Actions

Cek **Actions** tab di repository untuk error logs. Common issues:
- Syntax error di Dockerfile
- Missing dependencies di `package.json`

### Container Crash

Cek logs di platform dashboard atau:
```bash
docker logs whiskeysocket
```

### Auth/Jobs Data Lost

Pastikan persistent volume ter-mount dengan benar:
```bash
docker inspect whiskeysocket | grep -A 5 Mounts
```

---

## Platform Comparison

| Feature | Render (Free) | Railway | DigitalOcean |
|---------|---------------|---------|--------------|
| Free Tier | ✅ 750h/mo | ✅ $5 credit | ❌ $5/mo min |
| Persistent Disk | ❌ (paid only) | ✅ | ✅ |
| Auto-Deploy | ✅ | ✅ | ✅ |
| Custom Domain | ❌ (paid only) | ✅ | ✅ |
| GitHub Integration | ✅ | ✅ | ✅ |

---

## Next Steps

1. ✅ Push semua file ke GitHub
2. ✅ Tunggu GitHub Actions selesai build
3. ✅ Deploy ke platform pilihan
4. ✅ Configure persistent storage (production)
5. ✅ Scan QR code untuk connect WhatsApp
6. ✅ Test API endpoints

---

## Support

Untuk issues atau questions:
- GitHub Issues: [Create Issue](https://github.com/YOUR_USERNAME/whiskeysocket/issues)
- Documentation: [Baileys Docs](https://github.com/WhiskeySockets/Baileys)
