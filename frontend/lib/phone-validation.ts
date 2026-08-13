/**
 * Strict Phone Number Validation for India & International Mobile Formats.
 *
 * Valid formats:
 * - 10-digit mobile number: e.g. 9876543210
 * - Country code prefix: e.g. +91 9876543210, +919876543210, 09876543210
 *
 * Must contain between 10 and 15 pure numeric digits and pass valid phone format check.
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (!trimmed) return false;

  // Extract pure numeric digits
  const digitsOnly = trimmed.replace(/[^0-9]/g, "");

  // Must have at least 10 digits and max 15 digits
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return false;
  }

  // Must match valid phone character pattern (optional leading +, digits, spaces, hyphens, brackets)
  const phoneRegex = /^[+]?[0-9\s\-()]{10,18}$/;
  return phoneRegex.test(trimmed);
}
