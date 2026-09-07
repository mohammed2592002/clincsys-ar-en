/**
 * Utility helpers for Egyptian Phone Numbers (11 digits starting with 01)
 */

const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Normalizes any string to English digits and strips non-digit characters.
 * Limits length to 11 digits.
 */
export function formatEgyptianPhoneInput(input: string): string {
  if (!input) return '';
  
  // Replace Eastern Arabic / Persian numerals with standard ASCII digits
  let normalized = input.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGITS[d] || d);
  
  // Strip any non-digit character (spaces, dashes, pluses, letters)
  normalized = normalized.replace(/\D/g, '');
  
  // Handle international Egyptian format +20 or 0020 if pasted
  if (normalized.startsWith('2001') && normalized.length >= 13) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('201') && normalized.length >= 12) {
    normalized = '0' + normalized.slice(2);
  } else if (normalized.startsWith('00201') && normalized.length >= 14) {
    normalized = '0' + normalized.slice(4);
  }
  
  // Limit to max 11 digits
  return normalized.slice(0, 11);
}

/**
 * Checks whether the given phone number is a valid 11-digit Egyptian mobile number starting with 01.
 */
export function isValidEgyptianPhone(phone: string): boolean {
  if (!phone) return false;
  const clean = formatEgyptianPhoneInput(phone);
  return clean.length === 11 && clean.startsWith('01');
}

/**
 * Returns a human-friendly Arabic error message if the phone is invalid, or null if valid.
 */
export function getEgyptianPhoneError(
  phone: string,
  isRequired = false,
  fieldName = 'رقم الهاتف'
): string | null {
  const clean = formatEgyptianPhoneInput(phone);
  
  if (!clean) {
    if (isRequired) {
      return `يرجى إدخال ${fieldName}`;
    }
    return null;
  }
  
  if (!clean.startsWith('01')) {
    return `يجب أن يبدأ ${fieldName} بـ 01 (مثل: 01012345678)`;
  }
  
  if (clean.length !== 11) {
    return `يجب أن يتكون ${fieldName} من 11 رقماً بالضبط (المسجل حالياً: ${clean.length} أرقام)`;
  }
  
  return null;
}
