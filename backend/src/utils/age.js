/**
 * Age in whole years from a DD/MM/YYYY (or DD-MM-YYYY / DD.MM.YYYY) date of birth.
 * Returns null when the value can't be parsed. LLMs don't know today's date,
 * so age must always be computed here and handed to them.
 */
export function ageFromDob(dob, today = new Date()) {
  const m = String(dob ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const hadBirthday = today.getMonth() + 1 > month
    || (today.getMonth() + 1 === month && today.getDate() >= day);
  const age = today.getFullYear() - year - (hadBirthday ? 0 : 1);
  return age >= 0 && age < 130 ? age : null;
}

/** e.g. "21 October 2026" — injected into LLM prompts as the reference date. */
export const todayLabel = (d = new Date()) =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
