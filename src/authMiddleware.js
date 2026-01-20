import jwt from 'jsonwebtoken';

// Get JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || process.env.SSO_JWT_SECRET || 'your-sso-jwt-secret-key';
const JWT_COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'sso_token';

/**
 * Middleware to verify JWT token from httpOnly cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function authenticateToken(req, res, next) {
  try {
    // Get token from httpOnly cookie
    const token = req.cookies?.[JWT_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token found'
      });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Invalid or expired token'
        });
      }

      // Attach user info to request
      req.user = decoded;
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Middleware to check if user is authenticated
 * Returns user info if authenticated, null if not
 * Does not block the request - just attaches auth status
 */
export function checkAuthStatus(req, res, next) {
  try {
    const token = req.cookies?.[JWT_COOKIE_NAME];

    if (!token) {
      req.isAuthenticated = false;
      req.user = null;
      return next();
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        req.isAuthenticated = false;
        req.user = null;
      } else {
        req.isAuthenticated = true;
        req.user = decoded;
      }
      next();
    });
  } catch (error) {
    console.error('Auth check error:', error);
    req.isAuthenticated = false;
    req.user = null;
    next();
  }
}

/**
 * Optional authentication middleware
 * Attaches user info if token exists, but doesn't block if not
 */
export function optionalAuth(req, res, next) {
  checkAuthStatus(req, res, next);
}

/**
 * Get JWT secret for use in other modules
 */
export function getJWTSecret() {
  return JWT_SECRET;
}

/**
 * Get JWT cookie name for use in other modules
 */
export function getCookieName() {
  return JWT_COOKIE_NAME;
}
