# Student Database API Improvement Plan

## Overview

Meningkatkan API Student Database (https://siswa.dq.akses.live) untuk mendukung integrasi dengan WhatsApp CRM Dashboard sesuai standar REST API best practice.

**Architecture: Hybrid (APISIX Gateway + Backend Code)**

**Current State:**
- ~5000 students
- Fetch all: ~12 seconds
- No pagination wrapper
- No incremental sync support
- No authentication

**Target State:**
- **APISIX Gateway**: Authentication, rate limiting, CORS, caching
- **Backend Code**: Response wrapper, pagination, incremental sync filter
- Response time < 3 seconds for incremental sync

---

## Architecture: APISIX + Backend

### Layer Separation

```
┌─────────────────────────────────────────────────────────────────┐
│                       APISIX Gateway Layer                      │
│  Cross-Cutting Concerns (No Backend Code Changes Needed)       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Plugins:                                                 │  │
│  │ ✅ key-auth (API Key Authentication)                    │  │
│  │ ✅ limit-count (Rate Limiting: 1000 req/min)           │  │
│  │ ✅ cors (Cross-Origin Resource Sharing)                │  │
│  │ ✅ proxy-cache (Response Caching)                      │  │
│  │ ✅ request-id (Request Tracing)                        │  │
│  │ ✅ prometheus (Metrics & Monitoring)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ Proxy
                             ↓
                  ┌──────────────────────┐
                  │   Backend PHP App    │
                  │  Business Logic      │
                  │  (Code Changes)       │
                  │                       │
                  │ ✅ Response wrapper    │
                  │ ✅ Pagination logic   │
                  │ ✅ updated_since      │
                  │ ✅ Search filters     │
                  │ ✅ DB optimization    │
                  └──────────────────────┘
```

### APISIX vs Backend Responsibility

| Feature | APISIX | Backend | Notes |
|---------|--------|---------|-------|
| API Key Authentication | ✅ Yes | ❌ No | Plugin: `key-auth` |
| Rate Limiting | ✅ Yes | ❌ No | Plugin: `limit-count` |
| CORS | ✅ Yes | ❌ No | Plugin: `cors` |
| Response Caching | ✅ Yes | ❌ No | Plugin: `proxy-cache` |
| Request Logging | ✅ Yes | ❌ No | Plugin: `http-logger` |
| **Response Wrapper** | ❌ No | ✅ Yes | Requires backend code |
| **Pagination** | ❌ No | ✅ Yes | Requires SQL LIMIT/OFFSET |
| **updated_since Filter** | ❌ No | ✅ Yes | Requires SQL WHERE |
| **Search Logic** | ❌ No | ✅ Yes | Requires backend code |
| **DB Indexing** | ❌ No | ✅ Yes | Database optimization |

---

## APISIX Configuration

### Route Setup

```yaml
# APISIX Route Configuration
# Apply via Admin API or Dashboard

routes:
  - uri: /api/siswa*
    name: "student-db-api"
    plugins:
      # 1. API Key Authentication
      key-auth:
        header: "X-API-Key"

      # 2. Rate Limiting (1000 requests per minute)
      limit-count:
        count: 1000
        time_window: 60
        rejected_code: 429
        rejected_msg: "Rate limit exceeded. Please try again later."
        policy: redis
        redis_host: "redis.default.svc.cluster.local"
        redis_port: 6379
        redis_database: 1
        redis_timeout: 1001

      # 3. CORS Configuration
      cors:
        allow_origins: "https://wa-crm.example.com,https://wa-dashboard.example.com"
        allow_methods: "GET, OPTIONS"
        allow_headers: "X-API-Key, Content-Type, Authorization"
        expose_headers: "X-Request-Id"
        max_age: 3600

      # 4. Request ID (Tracing)
      request-id:
        include_in_response: true

      # 5. Response Cache (5 minutes for GET requests)
      proxy-cache:
        cache_zone: "disk_cache_one"
        cache_key:
          - "uri"
          - "X-API-Key"
        cache_bypass: ["Authorization"]
        cache_method:
          - "GET"
        hide_cache_headers: false
        cache_control: false
        cache_zone_size: "512m"
        schema_type: "redis"

      # 6. Prometheus Metrics
      prometheus:
        prefer_name: "student_db_api"

    upstream:
      type: "roundrobin"
      nodes:
        - host: "backend-siswa.internal"
          port: 8080
          weight: 1
      timeout:
        connect: 6s
        send: 6s
        read: 30s

    status: 1
```

### Consumer (API Key) Setup

```yaml
# Create consumer for WhatsApp CRM
consumers:
  - username: "whatsapp-crm"
    desc: "WhatsApp CRM Dashboard Production"
    plugins:
      key-auth:
        key: "prod-api-key-xxx-yyy-zzz"

  - username: "whatsapp-crm-staging"
    desc: "WhatsApp CRM Dashboard Staging"
    plugins:
      key-auth:
        key: "staging-api-key-xxx-yyy-zzz"
```

### SSL/TLS Configuration

```yaml
# SSL for HTTPS
apisix:
  ssl:
    ssl_trusted_certificate: /path/to/ca-certificates.crt
    ssl_protocols: "TLSv1.2 TLSv1.3"

  enable_admin: true
  admin_key:
    - name: "admin-key"
      key: "your-admin-key-here"
      role: admin
```

---

## API Endpoints Specification

### 1. GET /api/siswa - Get All Students (with Pagination)

**Current:**
```http
GET /api/siswa
Response: [...] (direct array, no wrapper)
```

**Proposed:**
```http
GET /api/siswa?page=1&limit=100&updated_since=2026-01-01T00:00:00Z

Response:
{
  "success": true,
  "message": "Students retrieved successfully",
  "data": [
    {
      "idsiswa": "25148",
      "nis": "0113690518",
      "nama": "Muhammad Aryasatya Raditya Nugraha",
      "jenkel": "L",
      "kelas": "9E",
      "nama_asrama": "AN NABA 5",
      "hp_ortu": "085715982451",
      "dataOrtu": {
        "nama_ayah": "Ir Agung nugraha",
        "nama_ibu": "Ambar tri agustin",
        "nohandphone_ibu": "085715982451"
      },
      "created_at": "2026-01-08T07:23:30Z",
      "updated_at": "2026-01-08T07:23:30Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 5000,
    "total_pages": 50,
    "has_next": true,
    "has_prev": false
  },
  "meta": {
    "fetched_at": "2026-02-03T10:00:00Z",
    "query_time_ms": 250
  }
}
```

### 2. GET /api/siswa/:id - Get Student by ID

**Current:**
```http
GET /api/siswa/?s=25148
Response: [...] (array with 1 item)
```

**Proposed:**
```http
GET /api/siswa/25148

Response:
{
  "success": true,
  "message": "Student retrieved successfully",
  "data": {
    "idsiswa": "25148",
    "nis": "0113690518",
    "nama": "Muhammad Aryasatya Raditya Nugraha",
    "jenkel": "L",
    "kelas": "9E",
    "nama_asrama": "AN NABA 5",
    "hp_ortu": "085715982451",
    "dataOrtu": { ... },
    "created_at": "2026-01-08T07:23:30Z",
    "updated_at": "2026-01-08T07:23:30Z"
  }
}
```

### 3. GET /api/students/search - Search Students

**Current:**
```http
GET /api/searchSiswaByNama?q=ahmad
Response: { status: 200, count: 20, data: [...] }
```

**Proposed:**
```http
GET /api/students/search?q=ahmad&kelas=10A&asrama=AN%20NABA%201&page=1&limit=20

Response:
{
  "success": true,
  "message": "Search completed",
  "data": [...],
  "pagination": { ... },
  "meta": {
    "search_query": "ahmad",
    "filters": {
      "kelas": "10A",
      "asrama": "AN NABA 1"
    }
  }
}
```

### 4. GET /api/students/:idsiswa/parents - Get Student Parents (New)

**Proposed:**
```http
GET /api/students/25148/parents

Response:
{
  "success": true,
  "data": {
    "ayah": {
      "nama": "Ir Agung nugraha",
      "nohandphone": "",
      "email": null,
      "alamat": null
    },
    "ibu": {
      "nama": "Ambar tri agustin",
      "nohandphone": "085715982451",
      "email": null,
      "alamat": null
    },
    "wali": {
      "nama": null,
      "nohandphone": null,
      "email": null,
      "alamat": null
    }
  }
}
```

---

## Authentication Strategy

### Option 1: API Key (Recommended - Simple)

**Implementation:**
```php
// .htaccess or index.php
$headers = getallheaders();
$apiKey = $headers['X-API-Key'] ?? '';

// Validate
$validKeys = ['your-production-key', 'your-staging-key'];
if (!in_array($apiKey, $validKeys)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Invalid API key']);
    exit;
}
```

**Client Usage:**
```javascript
fetch('https://siswa.dq.akses.live/api/siswa', {
    headers: {
        'X-API-Key': 'your-production-key'
    }
})
```

### Option 2: Bearer Token (More Secure)

**Implementation:**
```php
$headers = getallheaders();
$authHeader = $headers['Authorization'] ?? '';

if (!preg_match('/Bearer\s+(.*)$/i', $authHeader, $matches)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Missing token']);
    exit;
}

$token = $matches[1];
// Validate JWT or check database
```

---

## Database Schema Changes

### Add/Update Fields

```sql
-- Ensure updated_at exists and is populated
ALTER TABLE siswa
MODIFY COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add index for updated_at (critical for incremental sync)
CREATE INDEX idx_updated_at ON siswa(updated_at);

-- Add index for common search fields
CREATE INDEX idx_kelas ON siswa(kelas);
CREATE INDEX idx_asrama ON siswa(nama_asrama);
CREATE INDEX idx_hp_ortu ON siswa(hp_ortu);

-- Create API keys table (if using API key auth)
CREATE TABLE api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  INDEX idx_key_hash (key_hash)
);

-- Insert initial API key
INSERT INTO api_keys (key_name, key_hash)
VALUES ('whatsapp-crm', 'hash_of_your_api_key');
```

---

## Backend Implementation Guide

### File Structure

```
/api
  /config
    database.php
    config.php
  /middleware
    auth.php
    rateLimiter.php
  /controllers
    StudentController.php
  /models
    Student.php
  /utils
    Response.php
    Validator.php
  index.php
  siswa.php (existing, to be refactored)
```

### 1. Response Wrapper Class

```php
<?php
// utils/Response.php

class Response {
    public static function success($data, $message = 'Success', $pagination = null) {
        $response = [
            'success' => true,
            'message' => $message,
            'data' => $data
        ];

        if ($pagination) {
            $response['pagination'] = $pagination;
        }

        $response['meta'] = [
            'fetched_at' => date('c'),
            'query_time_ms' => self::getQueryTime()
        ];

        header('Content-Type: application/json');
        echo json_encode($response, JSON_PRETTY_PRINT);
        exit;
    }

    public static function error($message, $code = 400) {
        http_response_code($code);
        echo json_encode([
            'success' => false,
            'error' => $message
        ], JSON_PRETTY_PRINT);
        exit;
    }

    private static $startTime;

    public static function startTimer() {
        self::$startTime = microtime(true);
    }

    private static function getQueryTime() {
        return round((microtime(true) - self::$startTime) * 1000, 2);
    }
}

// Usage at start of each request
Response::startTimer();
?>
```

### 2. Pagination Handler

```php
<?php
// utils/Pagination.php

class Pagination {
    public static function getParams() {
        $page = max(1, intval($_GET['page'] ?? 1));
        $limit = min(100, max(1, intval($_GET['limit'] ?? 100)));
        $offset = ($page - 1) * $limit;

        return compact('page', 'limit', 'offset');
    }

    public static function buildPagination($page, $limit, $total) {
        $totalPages = ceil($total / $limit);

        return [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => $totalPages,
            'has_next' => $page < $totalPages,
            'has_prev' => $page > 1
        ];
    }
}
?>
```

### 3. Student Controller (Refactored)

```php
<?php
// controllers/StudentController.php

class StudentController {
    private $db;

    public function __construct($database) {
        $this->db = $database;
    }

    /**
     * GET /api/siswa
     * Query params: page, limit, updated_since
     */
    public function index() {
        $params = Pagination::getParams();
        $updatedSince = $_GET['updated_since'] ?? null;

        // Build query
        $sql = "SELECT * FROM siswa";
        $countSql = "SELECT COUNT(*) as total FROM siswa";

        // Add updated_since filter
        if ($updatedSince) {
            $date = date('Y-m-d H:i:s', strtotime($updatedSince));
            $sql .= " WHERE updated_at >= '$date'";
            $countSql .= " WHERE updated_at >= '$date'";
        }

        // Get total count
        $countResult = $this->db->query($countSql)->fetch();
        $total = $countResult['total'];

        // Add pagination
        $sql .= " ORDER BY updated_at DESC LIMIT {$params['limit']} OFFSET {$params['offset']}";

        // Execute
        $result = $this->db->query($sql)->fetchAll();

        // Build response
        $pagination = Pagination::buildPagination(
            $params['page'],
            $params['limit'],
            $total
        );

        Response::success($result, 'Students retrieved successfully', $pagination);
    }

    /**
     * GET /api/siswa/:id
     */
    public function show($id) {
        $stmt = $this->db->prepare("SELECT * FROM siswa WHERE idsiswa = ?");
        $stmt->execute([$id]);
        $student = $stmt->fetch();

        if (!$student) {
            Response::error('Student not found', 404);
        }

        Response::success($student, 'Student retrieved successfully');
    }

    /**
     * GET /api/students/search
     * Query params: q, kelas, asrama, page, limit
     */
    public function search() {
        $query = $_GET['q'] ?? '';
        $kelas = $_GET['kelas'] ?? null;
        $asrama = $_GET['asrama'] ?? null;

        if (empty($query)) {
            Response::error('Query parameter "q" is required', 400);
        }

        $params = Pagination::getParams();

        // Build search query
        $sql = "SELECT * FROM siswa WHERE nama LIKE ?";
        $countSql = "SELECT COUNT(*) as total FROM siswa WHERE nama LIKE ?";

        $searchTerm = "%$query%";

        // Add filters
        if ($kelas) {
            $sql .= " AND kelas = ?";
            $countSql .= " AND kelas = ?";
        }
        if ($asrama) {
            $sql .= " AND nama_asrama = ?";
            $countSql .= " AND nama_asrama = ?";
        }

        // Get total count
        $stmt = $this->db->prepare($countSql);
        $bindParams = [$searchTerm];
        if ($kelas) $bindParams[] = $kelas;
        if ($asrama) $bindParams[] = $asrama;
        $stmt->execute($bindParams);
        $total = $stmt->fetch()['total'];

        // Add pagination
        $sql .= " ORDER BY nama ASC LIMIT {$params['limit']} OFFSET {$params['offset']}";

        // Execute search
        $stmt = $this->db->prepare($sql);
        $stmt->execute($bindParams);
        $result = $stmt->fetchAll();

        // Build response
        $pagination = Pagination::buildPagination(
            $params['page'],
            $params['limit'],
            $total
        );

        $meta = [
            'search_query' => $query,
            'filters' => []
        ];
        if ($kelas) $meta['filters']['kelas'] = $kelas;
        if ($asrama) $meta['filters']['asrama'] = $asrama;

        Response::success($result, 'Search completed', $pagination, $meta);
    }
}
?>
```

### 4. Authentication Middleware

```php
<?php
// middleware/auth.php

class AuthMiddleware {
    private static $validKeys = [
        'prod-key-xxx' => 'whatsapp-crm-prod',
        'staging-key-xxx' => 'whatsapp-crm-staging',
        'test-key-xxx' => 'whatsapp-crm-test'
    ];

    public static function authenticate() {
        $headers = getallheaders();
        $apiKey = $headers['X-API-Key'] ?? '';

        if (empty($apiKey)) {
            Response::error('API key is required', 401);
        }

        if (!isset(self::$validKeys[$apiKey])) {
            // Log failed attempt
            error_log("Failed API auth attempt: $apiKey");
            Response::error('Invalid API key', 401);
        }

        // Update last_used_at
        $keyName = self::$validKeys[$apiKey];
        // TODO: Update database record

        return $keyName;
    }

    public static function checkRateLimit($keyName) {
        // Implement rate limiting per key
        // Example: 1000 requests per minute
        // Use Redis or database for tracking

        return true;
    }
}

// Usage
// AuthMiddleware::authenticate();
?>
```

### 5. Route Setup

```php
<?php
// index.php

require_once 'config/database.php';
require_once 'utils/Response.php';
require_once 'utils/Pagination.php';
require_once 'middleware/auth.php';
require_once 'controllers/StudentController.php';

// Start timer
Response::startTimer();

// Authenticate (optional, can be per-route)
// AuthMiddleware::authenticate();

$controller = new StudentController($db);

// Simple routing
$requestUri = $_SERVER['REQUEST_URI'];
$requestMethod = $_SERVER['REQUEST_METHOD'];

// Parse path
$path = parse_url($requestUri, PHP_URL_PATH);

// Route matching
if ($path === '/api/siswa' || $path === '/api/students') {
    if ($requestMethod === 'GET') {
        $controller->index();
    }
} elseif (preg_match('#^/api/siswa/(\d+)$#', $path, $matches)) {
    if ($requestMethod === 'GET') {
        $controller->show($matches[1]);
    }
} elseif ($path === '/api/students/search') {
    if ($requestMethod === 'GET') {
        $controller->search();
    }
} elseif (preg_match('#^/api/students/(\d+)/parents$#', $path, $matches)) {
    if ($requestMethod === 'GET') {
        $controller->getParents($matches[1]);
    }
} else {
    Response::error('Endpoint not found', 404);
}
?>
```

---

## Implementation Steps

### Phase 1: Critical Changes (1-2 days)

**Step 1: Database Preparation**
```sql
-- Add indexes
CREATE INDEX idx_updated_at ON siswa(updated_at);
CREATE INDEX idx_kelas ON siswa(kelas);
CREATE INDEX idx_nama_asrama ON siswa(nama_asrama);

-- Verify updated_at is populated
UPDATE siswa SET updated_at = created_at WHERE updated_at IS NULL;
```

**Step 2: Response Wrapper**
- Create `Response.php` utility class
- Wrap existing endpoint responses

**Step 3: Pagination**
- Add `page` and `limit` query parameters
- Return pagination metadata

**Step 4: Incremental Sync**
- Add `updated_since` query parameter
- Filter by `updated_at >= ?`

### Phase 2: Authentication (1 day)

**Step 1: API Key Implementation**
- Create `api_keys` table
- Implement authentication middleware
- Generate first API key

**Step 2: Documentation**
- Document authentication method
- Provide example usage

### Phase 3: Additional Endpoints (1 day)

**Step 1: Search Enhancement**
- Add filters: kelas, asrama
- Proper response format

**Step 2: Parents Endpoint**
- New endpoint: `/api/students/:id/parents`
- Structured parent data

### Phase 4: Testing & Optimization (1 day)

**Step 1: Performance Testing**
- Test with 5000 records
- Verify < 3 seconds for incremental sync

**Step 2: Documentation**
- API documentation (Postman/Swagger)
- Example requests/responses

---

## Testing Checklist

### Functional Testing
- [ ] GET /api/siswa returns wrapped response
- [ ] Pagination works correctly
- [ ] `updated_since` filter returns only changed records
- [ ] GET /api/siswa/:id returns single object, not array
- [ ] Search with filters works
- [ ] API key authentication works
- [ ] Invalid API key returns 401

### Performance Testing
- [ ] Full sync (5000 records) < 15 seconds
- [ ] Incremental sync (100 records) < 1 second
- [ ] Single student fetch < 100ms
- [ ] Search query < 500ms

### Integration Testing
- [ ] CRM can fetch all students
- [ ] CRM can fetch by ID
- [ ] CRM can use updated_since
- [ ] Phone numbers can be normalized
- [ ] Error handling works

---

## Migration Strategy

### Option A: Parallel Deployment (Zero Downtime)

1. **Deploy new API alongside old API**
   - Old: `/api/siswa` (unchanged)
   - New: `/api/v2/siswa` (new endpoints)

2. **Update CRM to use v2**
   - Gradual migration
   - Test thoroughly

3. **Deprecate old API**
   - Add deprecation header
   - Plan removal in 3 months

### Option B: Direct Update (With Testing)

1. **Update staging environment first**
   - Test all endpoints
   - Verify CRM integration

2. **Production deployment**
   - During low-traffic period
   - Rollback plan ready

3. **Monitor for issues**
   - Check error logs
   - Monitor response times

---

## Security Considerations

### API Key Security

```php
// Generate secure API keys
function generateApiKey() {
    return bin2hex(random_bytes(32));
}

// Hash keys before storing
$hashedKey = password_hash($apiKey, PASSWORD_DEFAULT);

// Validate with timing-safe comparison
if (hash_equals($storedHash, hash('sha256', $inputKey))) {
    // Valid
}
```

### Rate Limiting

```php
// Simple rate limiting per API key
$key = 'rate_limit:' . $apiKey . ':' . date('YmdHi');

$redis = new Redis();
$redis->connect('127.0.0.1', 6379);

$current = $redis->incr($key);
if ($current === 1) {
    $redis->expire($key, 60); // Expire in 60 seconds
}

if ($current > 1000) { // 1000 requests per minute
    Response::error('Rate limit exceeded', 429);
}
```

### CORS Configuration

```php
// Allow only specific domains
$allowedOrigins = [
    'https://wa-crm.example.com',
    'https://wa-dashboard.example.com'
];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: X-API-Key, Content-Type');
}
```

---

## Documentation Template

### API Documentation Example

```markdown
# Student Database API Documentation

## Base URL
`https://siswa.dq.akses.live/api`

## Authentication
All requests must include API key:
```
X-API-Key: your-api-key-here
```

## Endpoints

### Get All Students
`GET /siswa`

Query Parameters:
- `page` (integer, optional): Page number (default: 1)
- `limit` (integer, optional): Items per page (default: 100, max: 100)
- `updated_since` (ISO date, optional): Filter by updated date

Example:
```bash
curl -H "X-API-Key: your-key" \
  "https://siswa.dq.akses.live/api/siswa?page=1&limit=100&updated_since=2026-01-01T00:00:00Z"
```
```

---

## Postman Collection

Import this collection for testing:

```json
{
  "info": {
    "name": "Student DB API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "base_url",
      "value": "https://siswa.dq.akses.live/api"
    },
    {
      "key": "api_key",
      "value": "your-api-key-here"
    }
  ]
}
```

---

## Rollout Plan

### Week 1: Development
- [ ] Set up development environment
- [ ] Implement response wrapper
- [ ] Add pagination
- [ ] Add incremental sync

### Week 2: Authentication
- [ ] Implement API key system
- [ ] Add authentication middleware
- [ ] Generate production keys

### Week 3: Testing
- [ ] Unit tests
- [ ] Integration tests with CRM
- [ ] Performance testing

### Week 4: Deployment
- [ ] Deploy to staging
- [ ] Test with CRM
- [ ] Deploy to production
- [ ] Monitor and optimize

---

## Success Criteria

### Technical Metrics
- [ ] API response time < 3 seconds (incremental)
- [ ] API response time < 15 seconds (full sync)
- [ ] 99.9% uptime
- [ ] Zero data loss in sync

### Functional Metrics
- [ ] CRM successfully syncs all 5000 students
- [ ] Incremental sync works correctly
- [ ] Search functionality works
- [ ] Authentication works

### Business Metrics
- [ ] Integration completed within 4 weeks
- [ ] No downtime during deployment
- [ ] CRM team satisfied with API performance
