// Tests for lib/authHelpers.js (form validation + friendly auth errors) —
// no framework, just node:assert. No database or network needed.
//
//   node scripts/test-auth-helpers.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// lib/*.js is ESM syntax in a package without "type": "module"; Node handles
// it but prints a one-off warning. Re-run ourselves once with it silenced.
if (!process.env.GH_AUTH_TEST_CHILD) {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", fileURLToPath(import.meta.url)],
    { env: { ...process.env, GH_AUTH_TEST_CHILD: "1" }, stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

const {
  MIN_PASSWORD_LENGTH, COMPANY_EMAIL_MESSAGE, normalizeEmail, isValidEmail,
  validatePassword, validateLogin, validateSignup, friendlyAuthError,
} = await import("../lib/authHelpers.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

test("normalizeEmail trims and lower-cases", () => {
  assert.equal(normalizeEmail("  Zul@GentleHill.my "), "zul@gentlehill.my");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(null), "");
});

test("isValidEmail accepts normal addresses", () => {
  for (const e of ["a@b.co", "zul@gentlehill.my", "first.last+tag@sub.example.com", " a@b.co "]) {
    assert.equal(isValidEmail(e), true, e);
  }
});

test("isValidEmail rejects malformed addresses", () => {
  for (const e of ["", "   ", "plain", "a@", "@b.co", "a@b", "a@b.", "a@.co", "a@b..co", "a b@c.co", "a@b c.co", "a@@b.co", "a@b@c.co", null, undefined]) {
    assert.equal(isValidEmail(e), false, String(e));
  }
  assert.equal(isValidEmail("a@" + "b".repeat(250) + ".co"), false); // > 254 chars
});

test("validatePassword enforces the minimum length", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(validatePassword("12345678"), null);
  assert.equal(validatePassword("a much longer passphrase"), null);
  assert.match(validatePassword("1234567"), /at least 8 characters/);
  assert.match(validatePassword(""), /enter a password/i);
  assert.match(validatePassword(undefined), /enter a password/i);
});

test("validateLogin", () => {
  assert.equal(validateLogin({ email: "a@b.co", password: "x" }), null); // short password is fine at login
  assert.match(validateLogin({ email: "", password: "x" }), /enter your email/i);
  assert.match(validateLogin({ email: "nope", password: "x" }), /valid email/i);
  assert.match(validateLogin({ email: "a@b.co", password: "" }), /enter your password/i);
});

test("validateSignup: ok and each failure, in order", () => {
  const ok = { email: "new@gentlehill.my", password: "password1", confirm: "password1" };
  assert.equal(validateSignup(ok), null);
  assert.match(validateSignup({ ...ok, email: "" }), /enter your email/i);
  assert.match(validateSignup({ ...ok, email: "new@" }), /valid email/i);
  assert.match(validateSignup({ ...ok, password: "short", confirm: "short" }), /at least 8/);
  assert.equal(validateSignup({ ...ok, confirm: "password2" }), "Passwords do not match.");
  assert.equal(validateSignup({ ...ok, confirm: "" }), "Passwords do not match.");
  // email problem is reported before a password problem
  assert.match(validateSignup({ email: "bad", password: "x", confirm: "y" }), /valid email/i);
});

test("friendlyAuthError: invalid credentials", () => {
  assert.equal(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }), "Incorrect email or password.");
  assert.equal(friendlyAuthError({ message: "Invalid login credentials" }), "Incorrect email or password.");
});

test("friendlyAuthError: already registered", () => {
  assert.match(friendlyAuthError({ code: "user_already_exists", message: "User already registered", status: 422 }), /already exists.*log in/i);
  assert.match(friendlyAuthError({ message: "User already registered" }), /already exists/i);
  assert.match(friendlyAuthError({ code: "email_exists", message: "x" }), /already exists/i);
});

test("friendlyAuthError: weak password", () => {
  assert.match(friendlyAuthError({ code: "weak_password", message: "Password should be at least 6 characters.", status: 422 }), /too weak.*8 characters/i);
  assert.match(friendlyAuthError({ message: "Password should be at least 6 characters" }), /too weak/i);
});

test("friendlyAuthError: the database's company-email message", () => {
  assert.equal(friendlyAuthError({ message: "Signups are limited to company email addresses" }), COMPANY_EMAIL_MESSAGE);
  assert.equal(friendlyAuthError({ message: "ERROR: Signups are limited to company email addresses (SQLSTATE P0001)" }), COMPANY_EMAIL_MESSAGE);
  // Supabase Auth's generic wrapper for a failing signup trigger:
  const wrapped = friendlyAuthError({ code: "unexpected_failure", message: "Database error saving new user", status: 500 });
  assert.ok(wrapped.startsWith(COMPANY_EMAIL_MESSAGE), wrapped);
  assert.match(wrapped, /contact your administrator/i);
});

test("friendlyAuthError: unconfirmed email, rate limit, signups off, invalid email", () => {
  assert.match(friendlyAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }), /confirm your email/i);
  assert.match(friendlyAuthError({ code: "over_request_rate_limit", message: "x", status: 429 }), /too many attempts/i);
  assert.match(friendlyAuthError({ status: 429, message: "anything" }), /too many attempts/i);
  assert.match(friendlyAuthError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }), /too many attempts/i);
  assert.match(friendlyAuthError({ code: "signup_disabled", message: "Signups not allowed for this instance" }), /turned off/i);
  assert.match(friendlyAuthError({ code: "validation_failed", message: "Unable to validate email address: invalid format" }), /valid email/i);
});

test("friendlyAuthError: network problems", () => {
  assert.match(friendlyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), /can't reach the server/i);
  assert.match(friendlyAuthError({ message: "fetch failed" }), /can't reach the server/i);
});

test("friendlyAuthError: unknown, empty and malformed inputs", () => {
  assert.equal(friendlyAuthError({ message: "Something odd happened" }), "Something odd happened");
  assert.equal(friendlyAuthError({ status: null }), "Something went wrong. Please try again.");
  assert.equal(friendlyAuthError({}), "Something went wrong. Please try again.");
  assert.equal(friendlyAuthError(null), "");
  assert.equal(friendlyAuthError(undefined), "");
  assert.equal(friendlyAuthError({ message: "x", status: null }), "x"); // null status must not read as "network"
});

if (process.exitCode) {
  console.error(`some auth helper tests failed (${passed} passed)`);
} else {
  console.log(`all ${passed} auth helper tests passed`);
}
