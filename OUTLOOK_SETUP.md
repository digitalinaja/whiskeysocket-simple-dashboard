# Microsoft Office 365 / Outlook Integration Setup Guide

This guide will help you set up Microsoft Office 365 (Outlook) contacts integration for the Whiskeysocket CRM system.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create Microsoft Azure App Registration](#create-microsoft-azure-app-registration)
3. [Configure Environment Variables](#configure-environment-variables)
4. [Install Dependencies](#install-dependencies)
5. [Run Database Migrations](#run-database-migrations)
6. [Test the Integration](#test-the-integration)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, make sure you have:

- ✅ A Microsoft Azure account (free tier works)
- ✅ Administrator access to Azure Portal
- ✅ Node.js installed (v16 or higher)
- ✅ MySQL/TiDB database access
- ✅ The Whiskeysocket CRM codebase

---

## Create Microsoft Azure App Registration

### Step 1: Access Azure Portal

1. Go to [https://portal.azure.com](https://portal.azure.com)
2. Sign in with your Microsoft account
3. Navigate to **Microsoft Entra ID** (formerly Azure Active Directory)

### Step 2: Register New Application

1. In the left sidebar, click on **App registrations**
2. Click **New registration**
3. Fill in the form:
   - **Name**: `Whiskeysocket CRM` (or any name you prefer)
   - **Supported account types**: Select one of:
     - **Accounts in any organizational directory and personal Microsoft accounts** (recommended for testing)
     - **Accounts in any organizational directory** (for enterprise use)
     - **Accounts in this organizational directory only** (single-tenant)
   - **Redirect URI**: Select **Web** and enter:
     ```
     http://localhost:3000/auth/microsoft/callback
     ```
     For production, use:
     ```
     https://your-domain.com/auth/microsoft/callback
     ```
4. Click **Register**

### Step 3: Get Application Credentials

1. After registration, you'll see the **Overview** page
2. Copy and save:
   - **Application (client) ID** → This is your `MICROSOFT_CLIENT_ID`
   - **Directory (tenant) ID** → This is your `MICROSOFT_TENANT_ID` (or use `common` for multi-tenant)

### Step 4: Create Client Secret

1. In the left sidebar, click **Certificates & secrets**
2. Under **Client secrets**, click **New client secret**
3. Add a description (e.g., "Whiskeysocket CRM Production")
4. Choose expiration period (recommended: 180 days or more)
5. Click **Add**
6. **IMPORTANT**: Copy the **Value** immediately (you won't see it again!)
   - This is your `MICROSOFT_CLIENT_SECRET`

### Step 5: Configure API Permissions

1. In the left sidebar, click **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph** → **Delegated permissions**
4. Search for and select:
   - ✅ **Contacts.Read** (Read user contacts)
5. Click **Add permissions**
6. **IMPORTANT**: Click **Grant admin consent for [Your Organization]** button
   - This is required for the permissions to work

### Step 6: Verify Configuration

Your app registration should now have:
- ✅ Application (client) ID
- ✅ Client secret
- ✅ Redirect URI configured
- ✅ Contacts.Read permission granted
- ✅ Admin consent granted

---

## Configure Environment Variables

### Development Environment

Update your `.env` file with the Microsoft credentials:

```env
# Microsoft Office 365 OAuth
MICROSOFT_CLIENT_ID=your-actual-application-client-id-here
MICROSOFT_CLIENT_SECRET=your-actual-client-secret-value-here
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
BASE_URL=http://localhost:3000
```

### Production Environment

For production, update the redirect URIs:

```env
# Microsoft Office 365 OAuth
MICROSOFT_CLIENT_ID=your-actual-application-client-id-here
MICROSOFT_CLIENT_SECRET=your-actual-client-secret-value-here
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://your-domain.com/auth/microsoft/callback
BASE_URL=https://your-domain.com
```

**IMPORTANT**: Also update the redirect URI in your Azure App Registration to match your production URL!

---

## Install Dependencies

The integration uses **native fetch** (built into Node.js 18+). No additional dependencies required!

If you're using Node.js version < 18, you'll need to upgrade to Node.js 18+ or install the `node-fetch` polyfill.

**Check your Node.js version:**
```bash
node --version
```

**Upgrade if needed (recommended: v18 or v20):**
```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Or download from https://nodejs.org
```

---

## Run Database Migrations

The integration requires new database tables and schema updates:

### Option 1: Automatic Migration (Recommended)

If your app has automatic migration on startup:

```bash
npm start
```

The app will automatically create/update:
- `outlook_tokens` table
- `outlook_contact_id` column in `contacts` table
- Update `source` ENUM to include 'outlook'

### Option 2: Manual SQL Execution

Connect to your database and run:

```sql
-- Create outlook_tokens table
CREATE TABLE IF NOT EXISTS outlook_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expiry_date TIMESTAMP NULL,
  scope TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session (session_id)
);

-- Add outlook_contact_id column to contacts table
ALTER TABLE contacts
ADD COLUMN outlook_contact_id VARCHAR(255) NULL AFTER google_contact_id;

-- Add index for outlook_contact_id
CREATE INDEX idx_outlook_contact ON contacts(outlook_contact_id);

-- Update source ENUM to include 'outlook'
ALTER TABLE contacts
MODIFY COLUMN source ENUM('whatsapp','google','outlook','both') DEFAULT 'whatsapp';
```

---

## Test the Integration

### Step 1: Start Your Application

```bash
npm start
```

### Step 2: Navigate to Contacts Page

1. Open your browser: `http://localhost:3000`
2. Go to **Contacts & Leads** (CRM) section
3. You should see three sync buttons:
   - 📱 Sync WhatsApp
   - 📇 Sync Google
   - 📧 Sync Outlook

### Step 3: Connect to Outlook

1. Click **Connect Outlook** button
2. You'll be redirected to Microsoft login page
3. Sign in with your Microsoft account
4. Grant permissions to read your contacts
5. You'll be redirected back to the app
6. You should see: ✅ Connected to Outlook

### Step 4: Sync Contacts

1. Click **📧 Sync Outlook** button
2. Wait for the sync to complete (may take a few seconds)
3. You'll see a success message with counts:
   - New contacts added
   - Existing contacts updated
   - Contacts merged (if phone number already existed)
   - Contacts skipped (no phone number)

### Step 5: Verify Synced Contacts

1. Check the contacts list
2. You should see contacts from your Outlook
3. Contacts with phone numbers will be imported
4. Duplicate phone numbers will be merged automatically

---

## How It Works

### Technology Choice

The integration uses **native fetch API** instead of external HTTP libraries:

| Approach | Pros | Cons |
|----------|------|------|
| ✅ **Native fetch** (used) | Built-in Node.js 18+, no dependencies, faster | Requires Node.js 18+ |
| ❌ axios | Extra dependency, larger bundle size | More features |
| 🔄 Microsoft Graph SDK | Official SDK, like googleapis | More complex setup |

**Why fetch over axios?**
- Google Contacts uses `googleapis` SDK (official, provides HTTP client)
- Microsoft Graph doesn't require SDK - simple REST API
- Native fetch is sufficient and reduces dependencies
- Smaller bundle size, faster startup

### OAuth 2.0 Flow

1. **Authorization**: User clicks "Connect Outlook"
2. **Redirect**: App redirects to Microsoft OAuth login
3. **Consent**: User grants permissions
4. **Callback**: Microsoft redirects back with authorization code
5. **Token Exchange**: App exchanges code for access & refresh tokens
6. **Storage**: Tokens are stored in `outlook_tokens` table
7. **API Access**: App uses tokens to access Microsoft Graph API

### Contact Sync Process

1. **Fetch Contacts**: App fetches all contacts from Microsoft Graph API
2. **Normalize Phone Numbers**: Converts to international format (e.g., 08xx → 628xx)
3. **Deduplication**: Checks if phone number already exists
4. **Merge Logic**:
   - **New contact**: Creates with `source='outlook'`
   - **Existing WhatsApp**: Updates to `source='both'`
   - **Existing Google**: Keeps `source='google'`, updates name
5. **Update Names**: Uses Outlook display name (more official)

### Token Refresh

- Access tokens expire after ~1 hour
- App automatically refreshes using refresh token
- Refresh tokens typically last for 90 days
- User must re-authorize if refresh token expires

---

## Troubleshooting

### Issue 1: "No Microsoft tokens found for session"

**Cause**: OAuth flow not completed or tokens expired

**Solution**:
1. Click "Connect Outlook" to re-authorize
2. Check browser console for errors
3. Verify redirect URI matches exactly in Azure

### Issue 2: "Failed to sync contacts: Invalid token"

**Cause**: Access token expired or invalid

**Solution**:
1. Disconnect and reconnect Outlook
2. Check `MICROSOFT_CLIENT_SECRET` is correct
3. Verify API permissions in Azure Portal

### Issue 3: Redirect URI Mismatch

**Error**: `AADSTS50011: The reply address specified in the request does not match the reply addresses configured for the application`

**Solution**:
1. Go to Azure Portal → App Registration
2. Click **Authentication** (left sidebar)
3. Add the exact redirect URI:
   - Development: `http://localhost:3000/auth/microsoft/callback`
   - Production: `https://your-domain.com/auth/microsoft/callback`
4. Make sure there are no trailing slashes

### Issue 4: Insufficient Permissions

**Error**: `Error accessing contacts: Access token missing or insufficient`

**Solution**:
1. Go to Azure Portal → App Registration → API permissions
2. Verify **Contacts.Read** permission is added
3. Click **Grant admin consent** button
4. Wait a few minutes for consent to propagate

### Issue 5: No Contacts Synced

**Possible causes**:
1. Outlook account has no contacts with phone numbers
2. Phone numbers are in invalid format
3. All contacts were skipped due to missing phone numbers

**Solution**:
1. Check server logs for sync details
2. Verify contacts have phone numbers in Outlook
3. Check if contacts were merged (already existed)

### Issue 6: CORS Errors

**Error**: CORS policy errors in browser console

**Solution**:
- This should not happen as we're using server-side API calls
- If it occurs, check your BASE_URL configuration

### Issue 7: Database Errors

**Error**: `Table 'whiskeysocket_crm.outlook_tokens' doesn't exist`

**Solution**:
1. Run database migrations (see above)
2. Verify table was created successfully
3. Check database user has CREATE TABLE permissions

---

## Security Best Practices

### ✅ DO:

1. **Rotate secrets regularly** - Update client secret every 90 days
2. **Use HTTPS in production** - Never expose tokens over HTTP
3. **Limit API permissions** - Only request Contacts.Read
4. **Monitor token usage** - Check for unusual activity
5. **Store tokens securely** - Tokens are encrypted in database
6. **Use separate apps** - Different apps for dev/staging/production

### ❌ DON'T:

1. **Commit .env file** - Never commit secrets to git
2. **Share client secrets** - Keep them confidential
3. **Use production secrets in dev** - Use separate Azure apps
4. **Ignore token expiration** - Implement proper refresh logic
5. **Grant excess permissions** - Only request what you need

---

## Advanced Configuration

### Custom Tenant ID

For single-tenant applications (your organization only):

```env
MICROSOFT_TENANT_ID=your-organization-tenant-id
```

Find your tenant ID in Azure Portal → Microsoft Entra ID → Overview

### Multiple Redirect URIs

You can add multiple redirect URIs in Azure Portal:

- `http://localhost:3000/auth/microsoft/callback` (development)
- `https://staging.your-domain.com/auth/microsoft/callback` (staging)
- `https://app.your-domain.com/auth/microsoft/callback` (production)

### Custom Scopes

By default, the app requests:
- `https://graph.microsoft.com/Contacts.Read`

To add more scopes (e.g., Mail.Read), modify `src/outlookContacts.js`:

```javascript
const scopes = [
  'https://graph.microsoft.com/Contacts.Read',
  'https://graph.microsoft.com/Mail.Read'
];
```

Then grant admin consent in Azure Portal.

---

## API Endpoints

The integration adds these endpoints to your application:

### Public Endpoints

- **GET /auth/microsoft** - Initiates OAuth flow
- **GET /auth/microsoft/callback** - OAuth callback handler

### Protected Endpoints (Require JWT Auth)

- **GET /api/outlook/sync-status** - Check connection status
- **POST /api/outlook/sync-contacts** - Trigger contact sync
- **POST /api/outlook/disconnect** - Disconnect account

---

## Resources

### Documentation

- [Microsoft Graph API Documentation](https://learn.microsoft.com/en-us/graph/api/resources/contact)
- [Microsoft Graph JavaScript SDK](https://github.com/microsoftgraph/msgraph-sdk-javascript)
- [OAuth 2.0 Authorization Code Flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

### Search Results (2025)

Based on research from:
- [Tutorial: Call Microsoft Graph API from Express.js](https://docs.azure.cn/en-us/entra/identity-platform/tutorial-web-app-node-call-microsoft-graph-api) (June 18, 2025)
- [List contacts - Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/user-list-contacts?view=graph-rest-1.0) (July 23, 2025)
- [Microsoft Graph sample Node.js Express app](https://learn.microsoft.com/en-us/samples/microsoftgraph/msgraph-sample-nodeexpressapp/microsoft-graph-sample-nodejs-express-app/) (October 10, 2024)
- [Practical guide to use the Microsoft Graph-API](https://dev.to/davelosert/practical-guide-to-use-the-microsoft-graph-api-4ahn) (TypeScript & Node.js examples)

---

## Support

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review server logs for detailed error messages
3. Verify Azure Portal configuration
4. Test with [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)

---

## Changelog

### Version 1.0.0 (Current)

- ✅ Initial Outlook/Office 365 integration
- ✅ OAuth 2.0 authentication flow
- ✅ Contact sync with phone number normalization
- ✅ Automatic token refresh
- ✅ Contact deduplication and merging
- ✅ UI integration with existing CRM

---

## License

This integration is part of the Whiskeysocket CRM project.

**© 2025 - Whiskeysocket CRM**

---

**Last Updated**: January 27, 2026

**Microsoft Graph API Version**: v1.0

**Node.js Compatibility**: v16, v18, v20+
