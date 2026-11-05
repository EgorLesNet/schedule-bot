// Pure context checks; no DB access or client-supplied authority.
const FIELDS = ['faculty', 'course', 'stream', 'file'];
export function sameExamScope(a, b) {
  return Boolean(a && b && FIELDS.every(key => typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]));
}
export function resolveExamScope(user, entries) {
  if (!user || !user.course || !user.stream || !Array.isArray(entries)) return null;
  const entry = entries.find(item => String(item.course) === String(user.course) && item.key === user.stream);
  if (!entry || !entry.faculty || !entry.file) return null;
  // Saved settings store the canonical faculty name. Never silently fall back to another faculty.
  if (user.faculty !== undefined && user.faculty !== null && user.faculty !== '' && user.faculty !== entry.faculty) return null;
  return { faculty: entry.faculty, course: String(entry.course), stream: entry.key, file: entry.file };
}
