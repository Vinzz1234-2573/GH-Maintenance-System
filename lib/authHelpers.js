// Pure helpers for the login / sign-up forms: input validation and turning
// Supabase Auth errors into plain-language messages. No Supabase calls and
// no browser APIs here, so scripts/test-auth-helpers.mjs can run them in
// plain Node.

export const MIN_PASSWORD_LENGTH = 8;

export const COMPANY_EMAIL_MESSAGE =
  "Sign-ups are limited to company email addresses. Please use your work email.";

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

// "Looks like an email" — one @, something on both sides, a dot in the
// domain, no spaces. The server (Supabase Auth) is the real judge.
export function isValidEmail(email) {
  const value = String(email ?? "").trim();
  if (value.length > 254) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

// Returns an error message, or null when the password is acceptable.
export function validatePassword(password) {
  if (!password) return "Please enter a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Login only checks that both fields are filled in: rejecting a short
// password here would just hide the real "incorrect email or password".
export function validateLogin({ email, password }) {
  if (!String(email ?? "").trim()) return "Please enter your email.";
  if (!isValidEmail(email)) return "Please enter a valid email address.";
  if (!password) return "Please enter your password.";
  return null;
}

// Returns the first problem as a message, or null when the form is OK.
export function validateSignup({ email, password, confirm }) {
  if (!String(email ?? "").trim()) return "Please enter your email.";
  if (!isValidEmail(email)) return "Please enter a valid email address.";
  const passwordError = validatePassword(password);
  if (passwordError) return passwordError;
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

// Supabase Auth errors -> friendly text. Matches on the stable `code` when
// there is one, and on the message text otherwise (the database trigger's
// exception, network failures, older server versions).
export function friendlyAuthError(error) {
  if (!error) return "";
  const code = String(error.code ?? error.error_code ?? "");
  const message = String(error.message ?? error.msg ?? error.error_description ?? "");
  const status = typeof error.status === "number" ? error.status : null;

  if (/limited to company email/i.test(message)) return COMPANY_EMAIL_MESSAGE;
  // When a signup trigger raises, Supabase Auth often hides the text behind
  // this generic message. In this app the likely cause is the company-domain
  // rule, so say that (and keep the other possibility open).
  if (/database error saving new user/i.test(message)) {
    return `${COMPANY_EMAIL_MESSAGE} If you did use a company address, please contact your administrator.`;
  }

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Incorrect email or password.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Please confirm your email address first — check your inbox for the confirmation link.";
  }
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/i.test(message)) {
    return "An account with this email already exists. Please log in instead.";
  }
  if (code === "weak_password" || /password (is )?(too )?(weak|short)|password should be at least/i.test(message)) {
    return `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters, ideally a mix of letters and numbers.`;
  }
  if (code === "signup_disabled" || /signups? (not allowed|disabled)/i.test(message)) {
    return "Sign-ups are turned off right now. Please contact your administrator.";
  }
  if (code === "validation_failed" || code === "email_address_invalid" || /unable to validate email|invalid email/i.test(message)) {
    return "Please enter a valid email address.";
  }
  if (
    code === "over_request_rate_limit" || code === "over_email_send_rate_limit" ||
    status === 429 || /rate limit|too many requests|security purposes/i.test(message)
  ) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (/failed to fetch|network|fetch failed|load failed/i.test(message) || status === 0) {
    return "Can't reach the server. Check your internet connection and try again.";
  }
  return message || "Something went wrong. Please try again.";
}
