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

  ### Phase 2: Backend API Development

  #### Files to create:
  - `src/activityRoutes.js` - Activity management endpoints
  - `src/analyticsRoutes.js` - Reporting endpoints
  - `src/externalAppSync.js` - External app integration (student DB, payment, ticketing)
  - `src/externalAppRoutes.js` - External app sync endpoints

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
  - Activity list with filters
  - Calendar view (optional)

  **3. Prospects Funnel View**
  - Kanban-style funnel board
  - Drag-and-drop stage changes
  - Stage metrics (count, value)
  - Filter by academic year
  - Bulk stage update

  **4. Analytics Dashboard**
  - Funnel conversion chart
  - Lead source breakdown
  - Activity statistics
  - Conversion trend over time
  - Export reports

  **5. Enhanced Contact Form**
  - Add contact type selector
  - Link to student (if applicable)
  - Default lead status based on type

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
  2. Validate and map fields
  3. Create student record
  4. Create parent contacts
  5. Set initial lead status
  6. Send confirmation

  **Option B: Scheduled Sync**
  - Cron job to fetch registrations periodically
  - Endpoint: `POST /api/registration/sync`
  - Process:
  1. Query registration system API
  2. Detect new/updated records
  3. Sync to CRM
  4. Log sync results

  **Data Mapping:**
  ```javascript
  {
  // From registration system → CRM
  student_name → students.student_name,
  student_id → students.student_id_number,
  parent_name → contacts.name,
  parent_phone → contacts.phone,
  parent_email → contacts.email (if added),
  grade → students.grade,
  academic_year → students.academic_year
  }
  ```

  **Configuration:**
  - Store registration system API credentials
  - Field mapping configuration (editable)
  - Sync history and error logging

  #### WhatsApp Integration Enhancements:
  - Auto-log WhatsApp messages as activities
  - Quick actions from chat: "Create activity from message"
  - Message templates for follow-ups

  ## Implementation Order

  1. **Database Schema** (Priority 1)
  - Create migration script
  - Run migrations
  - Test schema

  2. **Backend API** (Priority 1)
  - Implement student routes
  - Implement activity routes
  - Enhance CRM routes

  3. **Basic Frontend** (Priority 2)
  - Student management UI
  - Activity logging UI
  - Enhanced contact form

  4. **Funnel & Analytics** (Priority 3)
  - Funnel board view
  - Analytics dashboard
  - Reporting endpoints

  5. **Integration** (Priority 4)
  - WhatsApp activity logging
  - Registration import
  - Data seeding

  ## Testing Strategy

  ### Unit Testing:
  - Test all API endpoints
  - Test database operations
  - Test business logic

  ### Integration Testing:
  - Test contact to student linking
  - Test activity creation and retrieval
  - Test funnel reporting
  - Test external app API integration

  ### E2E Testing:
  - Link contact to student → Log activities → Generate reports
  - Import prospects → Move through funnel → Convert to enrolled
  - WhatsApp message → Auto-log as activity
  - Sync data from external apps

  ## Critical Files Summary

  ### New Files to Create:
  1. `src/activityRoutes.js` - Activity management endpoints
  2. `src/analyticsRoutes.js` - Reporting & analytics
  3. `src/externalAppSync.js` - External app integration (student DB, payment, ticketing)
  4. `src/externalAppRoutes.js` - External app sync endpoints
  5. `public/js/activities.js` - Activity UI
  6. `public/js/analytics.js` - Analytics UI
  7. `public/js/prospects.js` - Prospect funnel UI
  8. `public/js/externalApps.js` - External app integration UI
  9. `scripts/seedSchoolData.js` - Default data seeding

  ### Files to Modify:
  1. `src/schemaDefinitions.js` - Add new table definitions (activities, activity_types) and modify contacts table
  2. `src/index.js` - Register new routes
  3. `src/crmRoutes.js` - Enhance existing CRM endpoints with contact_type filtering
  4. `public/index.html` - Add navigation items
  5. `public/js/app.js` - Register new modules

  ## Verification Steps

  After implementation, verify:

  1. ✅ Contacts can be categorized by type (student_parent, prospect_parent, etc.)
  2. ✅ Can link contacts to external student records
  3. ✅ Can log activities for contacts
  4. ✅ Can view funnel conversion metrics
  5. ✅ Can import/export prospects
  6. ✅ WhatsApp messages auto-log as activities
  7. ✅ Can generate analytics reports
  8. ✅ Can customize funnel stages via UI
  9. ✅ External app links work (payment, ticketing)
  10. ✅ All existing CRM features still work
  11. ✅ Database migrations run successfully