 # CRM Boarding School - Implementation Plan

  ## Project Overview
  Mengembangkan fitur CRM untuk sekolah boarding dengan fokus pada customer/sales funneling untuk:
  - Orangtua siswa (current students)
  - Orangtua calon siswa (prospects)
  - Orangtua alumni
  - Eksternal

  ## Current State

  ### WhatsApp CRM Project (this repo):
  - ✅ Contact management dengan lead status
  - ✅ WhatsApp integration (Baileys)
  - ✅ Message history & activity tracking
  - ✅ Tag system
  - ✅ Notes system
  - ✅ Broadcast messaging
  - ✅ Google Contacts sync
  - ✅ WhatsApp group management (per class & dormitory)

  ### Existing School Systems:
  - ✅ Student Database App - already stores all student information
  - ✅ Ticketing App - handles support tickets/issues
  - ✅ Employee App - manages staff/teacher information
  - ✅ School Payment App - handles fee payments and billing
  - ✅ WhatsApp Groups - already organized by class and dormitory

  ### Integration Implications:
  **Student Data**: Don't need to create new student database - sync from existing student app
  **Payments**: Can link CRM contacts to payment records
  **Groups**: Can leverage existing WhatsApp class/dormitory groups for communication
  **Tickets**: Can integrate support ticket history into contact timeline

  ## Requirements Analysis

  ### Context from User:
  - ✅ School already has: student database app, ticketing app, employee app, payment app
  - ✅ WhatsApp groups organized by class and dormitory
  - ✅ Full end-to-end implementation needed
  - ✅ Custom funnel stages required (not default)

  ### 1. Contact Categorization
  **Need**: Distinguish different types of contacts for school context

  **Solution**: Extend contact categorization
  - Add contact_type field to contacts table
  - Categories:
  - `student_parent` - Orangtua siswa aktif
  - `prospect_parent` - Orangtua calon siswa
  - `alumni_parent` - Orangtua alumni
  - `external` - Kontak eksternal (umum)

  ### 1.1 Student Database Integration
  **Need**: Link CRM contacts to existing student data

  **Solution**: Reference-based integration (not duplicating data)
  - Add `external_student_id` field to contacts table
  - Add `external_student_source` field (e.g., 'student_db_app')
  - Store reference to student ID from Student Database App
  - Sync student info via API when needed
  - Display student info in CRM contact view (read-only)
  - Don't create separate students table - reference existing one

  ### 1.2 Payment Integration
  **Need**: Track payment status for parents

  **Solution**: Link to payment app
  - Add `payment_app_link` field to contacts (optional)
  - Show payment summary in contact view
  - Create shortcut to payment app details
  - Trigger payment reminders via WhatsApp broadcast

  ### 1.3 Ticket Integration
  **Need**: View support history for parents

  **Solution**: Link to ticketing app
  - Add `ticketing_app_link` field to contacts
  - Show ticket count in contact view
  - Create shortcut to ticketing app

  ### 1.4 WhatsApp Groups Integration
  **Need**: Leverage existing class/dormitory groups

  **Solution**: Link contacts to relevant groups
  - Auto-link parents to their child's class group
  - Auto-link parents to dormitory group (if applicable)
  - Show linked groups in contact view
  - Easy group messaging from contact

  ### 2. Student-Parent Relationship (Simplified)
  **Need**: Associate parent contacts with students

  **Solution**: External reference only
  - One contact can reference multiple students (siblings)
  - Store external_student_id as JSON array for siblings
  - Display student names fetched from Student App via API
  - No need for separate student_parents junction table

  ### 3. Sales Funnel for Prospects
  **Need**: Track enrollment funnel for prospective students

  **Solution**: Customizable lead statuses for enrollment stages
  - User can create custom funnel stages via UI
  - Default funnel stages for prospects (customizable):
  1. `Lead` - First contact/inquiry
  2. `Qualified` - Initial screening passed
  3. `Application` - Application submitted
  4. `Assessment` - Entrance test/interview
  5. `Accepted` - Offer extended
  6. `Enrolled` - Registration complete
  7. `Rejected` - Not admitted
  8. `Lost` - Chose other school
  - Support multiple funnels (enrollment, general inquiry, etc.)
  - Each session can have different funnel configurations

  ### 4. Activity Tracking Enhancement
  **Need**: Track parent interactions more comprehensively

  **Solution**: Extend activity logging
  - Add activity_types table
  - Log activities: calls, meetings, emails, WhatsApp messages, school visits, etc.
  - Add activities table linked to contacts

  ### 5. Reporting & Analytics
  **Need**: Track conversion metrics and funnel performance

  **Solution**: Create analytics endpoints
  - Funnel conversion report (stage-to-stage)
  - Source attribution (where leads came from)
  - Activity timeline per contact
  - Bulk upload/export for prospects

  ### 6. Registration Integration
  **Need**: Integrate with existing student registration system

  **Solution**: Create import/sync endpoints
  - Import from registration system
  - Status automation (Application → Enrolled)
  - Auto-create parent contacts when student enrolls

  ## Implementation Plan

  ### Pre-Implementation Checklist

  #### Environment Configuration
  Add to `.env`:
  ```env
  # External App Integration
  EXTERNAL_STUDENT_API_URL=http://localhost:3001/api
  EXTERNAL_STUDENT_API_KEY=your_key_here
  EXTERNAL_PAYMENT_API_URL=http://localhost:3002/api
  EXTERNAL_TICKETING_API_URL=http://localhost:3003/api
  
  # Sync Configuration
  SYNC_BATCH_SIZE=100
  SYNC_RETRY_ATTEMPTS=3
  SYNC_RETRY_DELAY_MS=5000
  SYNC_TIMEOUT_MS=30000
  
  # Activity Logging
  AUDIT_LOG_ENABLED=true
  ACTIVITY_AUTO_LOG_WHATSAPP=true
  ```

  #### Schema Version Strategy
  ```
  1.0.0 - Current (existing schema)
  1.1.0 - Add activity system (Phase 1)
  1.2.0 - Add contact type & external links (Phase 1)
  1.3.0 - Add analytics foundations (Phase 4)
  ```

  ### Phase 1: Database Schema Changes

  #### Files to modify:
  - `src/schemaDefinitions.js` - Add new table definitions
  - `scripts/migrate.js` - Create migration script (if needed)

  #### New Tables:

  **1. activities**
  ```sql
  CREATE TABLE activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  contact_id INT NOT NULL,
  activity_type_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  activity_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  outcome TEXT,
  next_action TEXT,
  next_action_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  INDEX idx_contact (contact_id),
  INDEX idx_session (session_id),
  INDEX idx_activity_date (activity_date)
  );
  ```

  **2. activity_types**
  ```sql
  CREATE TABLE activity_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  name VARCHAR(50) NOT NULL,
  icon VARCHAR(50),
  color VARCHAR(7) DEFAULT '#6366f1',
  INDEX idx_session (session_id)
  );
  ```

  #### Modify existing tables:

  **contacts** - Add fields:
  ```sql
  ALTER TABLE contacts
  ADD COLUMN contact_type ENUM('student_parent', 'prospect_parent', 'alumni_parent', 'external') DEFAULT 'external' AFTER source,
  ADD COLUMN external_student_ids JSON NULL COMMENT 'Array of student IDs from external systems' AFTER contact_type,
  ADD COLUMN external_student_source VARCHAR(100) NULL COMMENT 'Source system: student_db_app, etc.' AFTER external_student_ids,
  ADD COLUMN payment_app_link VARCHAR(500) NULL COMMENT 'Link to payment app record' AFTER external_student_source,
  ADD COLUMN ticketing_app_link VARCHAR(500) NULL COMMENT 'Link to ticketing app record' AFTER payment_app_link,
  ADD COLUMN linked_group_ids JSON NULL COMMENT 'Array of linked WhatsApp group IDs' AFTER ticketing_app_link,
  ADD INDEX idx_contact_type (contact_type);
  ```

  **lead_statuses** - Add funnel categories:
  ```sql
  ALTER TABLE lead_statuses
  ADD COLUMN category ENUM('enrollment', 'general', 'custom') DEFAULT 'general' AFTER color;
  ```

  #### Schema Validation & Migration Notes
  - Use `npm run db:migrate` for schema updates
  - Use `npm run db:validate` to verify schema consistency
  - Use `npm run db:backup` before any migration
  - All migrations must be idempotent (safe to run multiple times)
  - Log all schema changes in `schema_migrations` table with status tracking

  ### Phase 2: Backend API Development

  #### Files to create:
  - `src/activityRoutes.js` - Activity management endpoints
  - `src/analyticsRoutes.js` - Reporting endpoints
  - `src/externalAppSync.js` - External app integration (student DB, payment, ticketing)
  - `src/externalAppRoutes.js` - External app sync endpoints
  - `src/externalAppClient.js` - HTTP client with retry & error handling
  - `src/syncQueue.js` - Background sync queue with error recovery

  #### External App Integration: Enhanced Architecture
  
  **Error Handling & Retry Strategy**:
  ```javascript
  // src/externalAppClient.js should implement:
  1. Exponential backoff retry (3 attempts, 5-30 second delays)
  2. Request timeout (30 seconds default)
  3. Circuit breaker for failing endpoints
  4. Fallback to cached data if available
  5. Comprehensive error logging with request details
  6. Signature validation for webhook requests
  
  // Sync failure recovery:
  - Retry failed syncs within 5 minutes
  - Move to DLQ after max retries
  - Send alert notification after 3 failed attempts
  - Log to audit trail for manual review
  ```

  **Data Consistency Approach**:
  ```javascript
  // For concurrent updates:
  - Use optimistic locking with version field
  - Detect conflicts: compare last_sync_at timestamp
  - Resolution priority:
    1. Most recent external system wins
    2. Log conflict for manual review
    3. Merge strategy: keep contact info, update relationships
  
  // For partial sync failure:
  - Atomic transaction per contact/student pair
  - Rollback entire sync if critical error
  - Partial success OK for: payment status, ticket count
  - Critical failure for: student linking, lead status override
  ```

  **Webhook Security**:
  ```javascript
  // For registration system webhooks:
  1. Require HMAC-SHA256 signature in header
  2. Verify: signature = HMAC-SHA256(body, WEBHOOK_SECRET)
  3. Check X-Webhook-Timestamp within 5 minutes
  4. Prevent replay attacks with idempotency keys
  5. Log all webhook attempts (success/failure)
  ```

  #### Files to modify:
  - `src/index.js` - Register new routes
  - `src/crmRoutes.js` - Enhance existing CRM endpoints with contact_type filtering

  #### Key Endpoints:

  **Activities** (`/api/activities`):
  - GET `/` - List activities (with filters: contact, type, date range)
  - GET `/:id` - Get activity details
  - POST `/` - Create new activity
  - PUT `/:id` - Update activity
  - DELETE `/:id` - Delete activity
  - GET `/contact/:contactId` - Get activities for a contact

  **Activity Types** (`/api/activity-types`):
  - GET `/` - List activity types
  - POST `/` - Create activity type
  - PUT `/:id` - Update activity type
  - DELETE `/:id` - Delete activity type

  **Analytics** (`/api/analytics`):
  - GET `/funnel` - Funnel conversion report
  - GET `/funnel/stages` - Funnel stage breakdown
  - GET `/sources` - Lead source attribution
  - GET `/activities/summary` - Activity statistics
  - GET `/conversion` - Conversion metrics over time

  **Prospects** (`/api/prospects`):
  - GET `/` - List prospects (filtered by contact_type = 'prospect_parent')
  - POST `/import` - Import prospects from CSV
  - POST `/sync-student-db` - Sync from student database app
  - GET `/export` - Export prospects to CSV

  **External App Integration** (`/api/external`):
  - GET `/student/:studentId` - Fetch student info from Student DB App
  - POST `/link-student` - Link contact to student(s)
  - POST `/sync-payment` - Sync payment status
  - POST `/sync-tickets` - Sync ticket history

  ### Phase 3: Frontend UI Development

  #### Files to create:
  - `public/js/activities.js` - Activity tracking UI
  - `public/js/analytics.js` - Analytics dashboard UI
  - `public/js/prospects.js` - Prospect funnel UI
  - `public/js/externalApps.js` - External app integration UI

  #### Files to modify:
  - `public/index.html` - Add navigation items for new features
  - `public/js/app.js` - Register new modules

  #### UI Components:

  **1. Activities Module**
  - Activity timeline per contact
  - Add activity modal with:
    - Activity type selector
    - Date/time picker
    - Title and description
    - Outcome field
    - Next action planning
  - Activity list with filters (by type, date range, contact)
  - Calendar view (optional)
  - Auto-log WhatsApp messages as activities

  **2. Contact Type & Student Linking UI**
  - Contact form: add contact_type selector
  - Student search/link interface
  - Display linked student info (from external app)
  - Show payment status & ticketing links
  - Quick access to linked WhatsApp groups

  **3. Prospects Funnel View**
  - Kanban-style funnel board with drag-and-drop
  - Stage metrics (count, conversion %, average days)
  - Filter by academic year, source, tags
  - Bulk stage update capability
  - Stage transition confirmation with optional note

  **4. Analytics Dashboard**
  - Funnel conversion chart (Sankey diagram)
  - Lead source breakdown (pie chart)
  - Activity statistics (heatmap by day/hour)
  - Conversion trend over time (line chart)
  - Export reports functionality

  **5. Enhanced Contact Form**
  - Add contact type selector
  - Student linking capability
  - Default lead status based on type
  - External app link shortcuts

  ### Phase 4: Default Data Setup

  #### Files to create:
  - `scripts/seedSchoolData.js` - Seed default data for school CRM

  #### Default Activity Types:
  - Phone Call - 📞
  - WhatsApp Message - 💬
  - Email - 📧
  - School Visit - 🏫
  - Meeting - 👥
  - Note - 📝
  - Assessment - 📋
  - Follow-up - 🔜

  #### Default Lead Statuses for Enrollment:
  1. Lead - 🟢 #22c55e
  2. Qualified - 🔵 #3b82f6
  3. Application - 🟡 #eab308
  4. Assessment - 🟠 #f97316
  5. Accepted - 🟣 #a855f7
  6. Enrolled - 🟢 #10b981
  7. Rejected - 🔴 #ef4444
  8. Lost - ⚫ #6b7280

  #### Data Validation Rules
  
  **Activities Table**:
  ```javascript
  - title: required, max 255 chars
  - activity_type_id: required, must exist in activity_types
  - contact_id: required, must exist in contacts
  - activity_date: cannot be in future (validation on create/update)
  - next_action_date: optional, if set cannot be < activity_date
  ```

  **Contacts Table - Contact Type Rules**:
  ```javascript
  - prospect_parent: lead_status_id required & from enrollment funnel
  - student_parent: lead_status_id optional
  - alumni_parent: lead_status_id optional
  - external: lead_status_id optional
  
  - external_student_ids: if not empty, validate array format & check external system
  ```

  **Lead Status Transitions**:
  ```javascript
  - Prevent backward transitions (Enrolled -> Assessment not allowed)
  - Rejected/Lost are terminal (no further transitions)
  - Log all transitions with reason
  - Send notification on stage change
  ```

  #### Audit & Compliance
  
  **Add to activities table**:
  - `created_by`: VARCHAR(255) - tracking who created activity
  - `ip_address`: VARCHAR(45) - for compliance
  - `is_confidential`: BOOLEAN - for sensitive data

  **Lead Status Change Audit**:
  - Create `status_change_history` table
  - Track: old_status_id, new_status_id, changed_by, change_reason, timestamp
  - Enable status change reason requirement for prospect contacts

  **Performance Indexes for Analytics**:
  ```sql
  -- activities table:
  CREATE INDEX idx_contact_type_date ON activities(contact_id, activity_date);
  CREATE INDEX idx_type_date ON activities(activity_type_id, activity_date);
  
  -- lead_status changes:
  CREATE INDEX idx_status_change_date ON status_change_history(contact_id, timestamp);
  CREATE INDEX idx_status_change_to_status ON status_change_history(new_status_id, timestamp);
  ```

  ### Phase 5: Comprehensive Testing & Validation

  #### Unit Tests
  - Test activity creation with all field validations
  - Test lead status transition rules
  - Test external app API client retry logic
  - Test data mapping transformations
  - Test webhook signature validation
  - Test duplicate detection for imports

  #### Integration Tests
  - End-to-end contact to student linking flow
  - Activity creation and retrieval with filters
  - Lead status change with audit logging
  - External app sync with partial failure recovery
  - Concurrent activity creation (race condition testing)
  - Funnel report generation with multiple data sources

  #### Performance Tests
  - Load test: Funnel board with 10K+ contacts
  - Query performance: Analytics aggregation queries
  - Concurrent sync: Multiple external app syncs simultaneously
  - Memory usage: Activity timeline pagination

  #### Test Data Setup
  - Create test fixture: 1000+ prospects in various funnel stages
  - Create test fixture: Linked contacts with students
  - Create test fixture: Activity history with various types
  - Automation: Clean test data after test runs

  #### Testing Environment
  - Mock external app APIs for testing
  - Test database cleanup strategy
  - CI/CD integration for automated tests
  - Test coverage target: 80%+

  ### Phase 6: Registration System Integration

  #### Files to create:
  - `src/registrationSync.js` - Registration system sync handler
  - `src/registrationRoutes.js` - Registration sync endpoints

  #### Integration Approach:

  **Option A: Webhook-based Sync**
  - Registration system sends webhook when new registration created
  - Endpoint: `POST /api/registration/webhook`
  - Process:
  1. Receive registration data
  2. Validate webhook signature (HMAC-SHA256)
  3. Detect duplicate: check if parent already exists
  4. Create/update parent contact with contact_type = 'prospect_parent'
  5. Link to external student ID
  6. Set initial lead status = 'Lead'
  7. Send confirmation response
  8. Log webhook attempt

  **Option B: Scheduled Sync**
  - Cron job to fetch registrations periodically (every hour)
  - Endpoint: `POST /api/registration/sync`
  - Process:
  1. Query registration system API
  2. Fetch registrations since last sync
  3. Detect duplicates locally
  4. Batch create/update contacts
  5. Log sync results
  6. Retry on failure with exponential backoff

  **Data Mapping:**
  ```javascript
  {
  // From registration system → CRM
  student_name → contacts with contact_type=student_parent (via link)
  student_id → external_student_ids (JSON array)
  parent_name → contacts.name
  parent_phone → contacts.phone
  parent_email → contacts.email (if available)
  grade → stored for reference
  academic_year → used for funnel categorization
  
  // Validation:
  - student_id must be valid in external system
  - parent_phone must be valid WhatsApp format (+62...)
  - academic_year must match current/upcoming
  }
  ```

  **Configuration**:
  - Store registration system API credentials in env
  - Field mapping configuration (editable per session)
  - Sync history tracking (last_sync_at, next_sync_at)
  - Error handling and retry logging

  #### WhatsApp Integration Enhancements:
  - Auto-log WhatsApp messages as 'WhatsApp Message' activity type
  - Quick actions from chat: "Create activity from message"
  - Message templates for follow-ups (customizable per funnel stage)
  - Broadcast to funnel stage (e.g., "Send to all Qualified prospects")

  ## Implementation Order

  1. **Database Schema** (Priority 1)
  - Create migration script for new tables (activities, activity_types)
  - Create migration for contact table modifications
  - Create migration for lead_statuses modifications
  - Create migration for status_change_history table
  - Run migrations and validate schema

  2. **Backend API - Core** (Priority 1)
  - Implement activity CRUD endpoints
  - Implement activity type management
  - Implement activity filtering & search
  - Implement lead status tracking with audit
  - Test all API responses and error handling

  3. **Backend API - External Integration** (Priority 2)
  - Implement external app client with retry logic
  - Implement student linking endpoints
  - Implement payment/ticket sync endpoints
  - Implement webhook security validation
  - Create circuit breaker for external APIs

  4. **Basic Frontend** (Priority 2)
  - Activity timeline UI per contact
  - Activity creation/editing modal
  - Enhanced contact form with type & student linking
  - Contact view with external app links
  - Basic styling with Tailwind

  5. **Funnel & Analytics** (Priority 3)
  - Funnel board view with Kanban UI
  - Drag-and-drop stage transitions
  - Analytics dashboard (conversion charts)
  - Reporting endpoints for metrics
  - Export functionality

  6. **Testing & Validation** (Priority 3)
  - Unit tests for all business logic
  - Integration tests for external APIs
  - Load testing for funnel/analytics
  - E2E test flows
  - Test data fixtures setup

  7. **Registration Sync** (Priority 4)
  - Implement webhook receiver or scheduled sync
  - Implement duplicate detection
  - Implement batch import
  - Implement sync history tracking
  - Create data validation rules

  8. **Production Hardening** (Priority 4)
  - Performance optimization (indexes, caching)
  - Error monitoring & alerting
  - Audit logging & compliance
  - Documentation & runbooks
  - Security review & penetration testing

  ## Testing Strategy

  ### Unit Testing:
  - Test all API endpoints with valid/invalid inputs
  - Test database operations (CRUD for all tables)
  - Test business logic (lead status transitions, validations)
  - Test external app client retry & timeout handling
  - Test data transformations & mappings
  - Test webhook signature validation
  - Target: 80%+ code coverage

  ### Integration Testing:
  - Test contact to student linking end-to-end
  - Test activity creation and retrieval with various filters
  - Test funnel reporting with multiple data sources
  - Test external app API integration with mocked responses
  - Test concurrent activity creation (race conditions)
  - Test partial sync failure and recovery
  - Test lead status change with audit logging
  - Database transactions rollback on error

  ### E2E Testing (Manual + Automated):
  - Create contact → Link to student → Log activities → Generate reports
  - Import prospects → Move through funnel → Convert to enrolled
  - WhatsApp message → Auto-log as activity
  - Sync from external apps → Verify data consistency
  - Webhook registration → Create contacts → Verify linking

  ### Performance Testing:
  - Funnel board: 10K+ contacts load time < 2 seconds
  - Activity timeline: 1K+ activities pagination performance
  - Analytics aggregation: Convert data 10K contacts < 5 seconds
  - Concurrent syncs: 100+ simultaneous API calls

  ### Test Environment Setup:
  - Mock external app APIs (use test doubles)
  - Test database with fixtures (1K prospects, 500 activities)
  - CI/CD pipeline: Run tests on every commit
  - Automated cleanup of test data

  ### Manual Testing Checklist:
  - [ ] Can create contact with all types (student_parent, prospect_parent, etc.)
  - [ ] Can link contact to external student and view data
  - [ ] Can create activity and see it in timeline
  - [ ] Can move prospect through funnel stages
  - [ ] Can view funnel metrics and analytics
  - [ ] Can export prospects and activities
  - [ ] Can import new prospects via CSV/webhook
  - [ ] WhatsApp messages auto-log as activities
  - [ ] Payment/ticket links work correctly
  - [ ] External app sync handles failures gracefully

  ## Critical Files Summary

  ### New Files to Create:
  1. `src/activityRoutes.js` - Activity management endpoints
  2. `src/analyticsRoutes.js` - Reporting & analytics endpoints
  3. `src/externalAppSync.js` - External app integration handler
  4. `src/externalAppRoutes.js` - External app sync API endpoints
  5. `src/externalAppClient.js` - HTTP client with retry & error handling
  6. `src/syncQueue.js` - Background sync queue with error recovery
  7. `src/registrationSync.js` - Registration system sync handler
  8. `src/registrationRoutes.js` - Registration sync API endpoints
  9. `public/js/activities.js` - Activity tracking UI module
  10. `public/js/analytics.js` - Analytics dashboard UI module
  11. `public/js/prospects.js` - Prospect funnel UI module
  12. `public/js/externalApps.js` - External app integration UI module
  13. `scripts/seedSchoolData.js` - Default data seeding script
  14. `scripts/migrations/001-add-activity-tables.js` - Activity tables migration
  15. `scripts/migrations/002-add-contact-extensions.js` - Contact table extensions
  16. `scripts/migrations/003-add-audit-logging.js` - Audit tables migration

  ### Files to Modify:
  1. `src/schemaDefinitions.js` - Add new table definitions and modify existing tables
  2. `src/index.js` - Register new route modules
  3. `src/crmRoutes.js` - Enhance CRM endpoints with contact_type filtering
  4. `src/database.js` - Add connection pooling config & migration runner
  5. `public/index.html` - Add navigation items for new features
  6. `public/js/app.js` - Register new UI modules
  7. `.env.example` - Add required environment variables
  8. `package.json` - Add dev dependencies for testing (if needed)

  ## Performance & Optimization Strategy

  ### Database Performance

  **Indexing Strategy**:
  ```sql
  -- Critical indexes for activities queries:
  CREATE INDEX idx_contact_activity_date ON activities(contact_id, activity_date DESC);
  CREATE INDEX idx_activity_type_date ON activities(activity_type_id, activity_date DESC);
  CREATE INDEX idx_session_activity_date ON activities(session_id, activity_date DESC);
  
  -- For funnel reporting:
  CREATE INDEX idx_contact_lead_status ON contacts(contact_id, lead_status_id);
  CREATE INDEX idx_status_change_contact ON status_change_history(contact_id, timestamp DESC);
  
  -- For import/sync:
  CREATE INDEX idx_external_student_id ON contacts(external_student_ids); -- JSON index
  CREATE UNIQUE INDEX idx_phone_session ON contacts(phone, session_id);
  ```

  **Query Optimization**:
  - Use pagination for all list endpoints (default: 50 items/page)
  - Implement cursor-based pagination for large datasets
  - Use database aggregation (COUNT, SUM) instead of application-level
  - Cache contact type filters results (TTL: 1 hour)
  - Batch external API calls (max 100 per request)

  **Connection Pooling**:
  - MySQL connection pool size: 10 (min) to 20 (max)
  - Connection timeout: 30 seconds
  - Idle timeout: 5 minutes
  - Queue timeout: 10 seconds

  ### API Response Optimization

  **Pagination & Limiting**:
  - All list endpoints paginated
  - Maximum page size: 500 items
  - Default page size: 50 items
  - Include `total_count` in response metadata

  **Data Caching**:
  - Cache activity types per session (TTL: 24 hours)
  - Cache lead statuses per session (TTL: 24 hours)
  - Cache contact type counts (TTL: 1 hour)
  - Invalidate cache on data changes

  **Response Compression**:
  - Enable gzip compression for all JSON responses
  - Minify JSON payloads (remove unnecessary fields)
  - Use field filtering (allow clients to request only needed fields)

  ### External API Performance

  **Rate Limiting & Throttling**:
  - Local rate limiter: 1000 requests/minute per session
  - External API rate limiter: respect provider limits
  - Retry-After header support
  - Exponential backoff: 1s, 2s, 4s, 8s

  **Batch Operations**:
  - Batch student info fetches (max 100 per request)
  - Batch payment status updates (max 100 per request)
  - Implement bulk update endpoint for status changes

  **Circuit Breaker Pattern**:
  - Failure threshold: 5 consecutive failures
  - Open circuit timeout: 30 seconds
  - Half-open test: 1 request, then full reopen
  - Fall back to cached data when circuit open

  ### Monitoring & Alerts

  **Performance Metrics**:
  - API response time (p50, p95, p99)
  - Database query time
  - External API latency
  - Cache hit rate
  - Memory usage
  - Queue size (for async jobs)

  **Alerting Thresholds**:
  - API response time > 2 seconds: WARNING
  - Database query > 5 seconds: ERROR
  - External API error rate > 5%: WARNING
  - Memory usage > 80%: WARNING

  ## Security & Compliance

  ### Authentication & Authorization

  **API Security**:
  - All CRM endpoints require authenticated session
  - Use existing JWT/session middleware
  - Enforce role-based access (admin, staff, manager)
  - Rate limiting: 1000 requests/minute per user

  **External API Security**:
  - Store API keys in environment variables only
  - Never log or expose API keys
  - Use HMAC-SHA256 for webhook signature validation
  - Verify webhook timestamps (within 5 minutes)
  - Validate webhook origin IP (optional)

  **Data Security**:
  - Encrypt sensitive data in transit (HTTPS only in production)
  - Hash external student IDs for privacy
  - Mask payment information in logs
  - Don't log personally identifiable information (PII)

  ### Data Privacy & Compliance

  **Audit Logging**:
  - Log all contact data changes (who, what, when, why)
  - Log all lead status transitions with reason
  - Log all external system API calls (request/response)
  - Retention: Keep audit logs for 1 year

  **Data Retention**:
  - Archive prospects not contacted in 6 months (optional)
  - Delete soft-deleted contacts after 90 days
  - Keep activity history indefinitely (for reporting)
  - Allow data export on request (for GDPR compliance)

  **Data Access**:
  - Implement field-level access control (optional)
  - Log who views sensitive fields (payment, confidential notes)
  - Prevent bulk export of parent contact phone numbers
  - Require approval for external data sync

  ### Error Handling & Security

  **Error Response Standards**:
  - Don't expose database errors in responses
  - Don't expose file paths or system details
  - Use generic messages (e.g., "Invalid request")
  - Log full errors server-side for debugging

  **Input Validation**:
  - Validate all input (type, length, format)
  - Prevent SQL injection (use parameterized queries)
  - Prevent XSS (sanitize HTML input)
  - Validate JSON payloads with schema

  **Production Safeguards**:
  - Enable CORS only for allowed domains
  - Implement CSRF protection for form submissions
  - Use security headers (CSP, X-Frame-Options, etc.)
  - Regular security dependency updates

  ## Verification Steps

  After implementation, verify:

  **Core Functionality**:
  1. ✅ Contacts can be categorized by type (student_parent, prospect_parent, alumni_parent, external)
  2. ✅ Can link contacts to external student records with reference validation
  3. ✅ Can log activities with all types and view timeline per contact
  4. ✅ Can move prospects through funnel stages with validation rules
  5. ✅ All stage transitions properly logged with reason

  **External Integrations**:
  6. ✅ External app links work (payment, ticketing, student DB)
  7. ✅ External app sync handles failures with retry mechanism
  8. ✅ WhatsApp messages auto-log as 'WhatsApp Message' activities
  9. ✅ Webhook registration creates contacts with proper linking
  10. ✅ Duplicate detection works for import/registration sync

  **Analytics & Reporting**:
  11. ✅ Can view funnel conversion metrics (stage-to-stage %)
  12. ✅ Can view lead source breakdown
  13. ✅ Can generate activity statistics (count, types)
  14. ✅ Can export prospects with all fields
  15. ✅ Can export activity history with filters

  **Customization**:
  16. ✅ Can customize funnel stages via UI
  17. ✅ Can add new activity types
  18. ✅ Can configure field mapping for external systems
  19. ✅ Can set up custom lead status categories

  **Data Quality & Compliance**:
  20. ✅ All schema validations enforced
  21. ✅ Audit logging for all critical changes
  22. ✅ Status change history tracked with reasons
  23. ✅ Concurrent updates handled without conflicts
  24. ✅ Database migrations run successfully and are reversible

  **Performance & Reliability**:
  25. ✅ Funnel board loads in < 2 seconds with 10K+ contacts
  26. ✅ Activity timeline paginated efficiently
  27. ✅ External API failures don't block main functionality
  28. ✅ Circuit breaker prevents cascading failures
  29. ✅ All existing CRM features still work as expected

  ## Troubleshooting & Maintenance

  ### Common Issues & Solutions

  **Database Migration Failed**:
  ```bash
  # Check migration status
  npm run db:validate
  
  # Backup database before retry
  npm run db:backup
  
  # Retry migration with force
  npm run db:force-migrate
  
  # Check schema_migrations table for errors
  SELECT * FROM schema_migrations WHERE status = 'failed';
  ```

  **External API Sync Failing**:
  ```javascript
  // Check:
  1. API credentials in .env file correct
  2. External system URL accessible (ping endpoint)
  3. Firewall/network blocking (check error logs)
  4. API rate limiting (check response headers)
  5. Data format mismatch (check sync queue logs)
  
  // Recovery:
  - Check sync_queue table for failed items
  - Manually retry via: POST /api/external/sync-student-db
  - Check circuit breaker status
  ```

  **Activity Timeline Loading Slowly**:
  ```javascript
  // Optimization:
  1. Check indexes on activities table
  2. Verify pagination is working (default 50 items)
  3. Check query performance: EXPLAIN SELECT...
  4. Verify cache is enabled
  5. Consider archiving old activities
  ```

  **Webhook Registration Not Creating Contacts**:
  ```javascript
  // Debug:
  1. Check webhook logs for signature validation errors
  2. Verify registration system URL in .env
  3. Check payload format matches expected schema
  4. Verify rate limiting not blocking requests
  5. Check for duplicate detection false positives
  ```

  ### Monitoring & Health Checks

  **Daily Checks**:
  - [ ] Database backup completed successfully
  - [ ] API error rate < 0.5%
  - [ ] External API sync no errors
  - [ ] No database connection errors
  - [ ] Cache hit rate > 80%

  **Weekly Checks**:
  - [ ] Run analytics reports (no data gaps)
  - [ ] Verify funnel metrics accurate
  - [ ] Check for long-running queries
  - [ ] Review security audit logs
  - [ ] Check disk space usage

  **Monthly Checks**:
  - [ ] Database optimization (OPTIMIZE TABLE)
  - [ ] Performance tuning (analyze slow logs)
  - [ ] Security updates for dependencies
  - [ ] Backup restoration test (verify backups work)
  - [ ] Load testing with current data volume

  ### Maintenance Tasks

  **Database Maintenance**:
  ```bash
  # Optimize tables monthly
  OPTIMIZE TABLE activities, contacts, lead_statuses;
  
  # Analyze tables for query optimizer
  ANALYZE TABLE activities, contacts;
  
  # Check for corrupted tables
  CHECK TABLE activities, contacts;
  ```

  **Log Rotation**:
  - Application logs: rotate daily, keep 30 days
  - Audit logs: rotate weekly, keep 1 year
  - Sync logs: rotate daily, keep 90 days
  - Error logs: rotate on size (100MB), keep 10 files

  **Performance Tuning**:
  - Monitor slow query log (queries > 2 seconds)
  - Review index usage (unused indexes)
  - Check connection pool status
  - Monitor memory/CPU usage trends