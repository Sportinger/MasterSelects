const INVALID_PROJECT_NAME_CHARS = /[<>:"/\\|?*]/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateProjectName(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Enter a project name.';
  if (name.length > 120) return 'Use 120 characters or fewer.';
  if (INVALID_PROJECT_NAME_CHARS.test(name)) {
    return 'Project names cannot contain < > : " / \\ | ? or *.';
  }
  if (name === '.' || name === '..' || name.endsWith('.')) {
    return 'Project names cannot end with a period.';
  }
  if (RESERVED_WINDOWS_NAME.test(name)) {
    return 'Choose a different name. This name is reserved by the operating system.';
  }
  return null;
}
