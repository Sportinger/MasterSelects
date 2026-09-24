export const ANDROID_ORIGIN = 'https://www.masterselects.com';

export function normalizeFingerprint(value) {
  if (typeof value !== 'string' || !/^(?:[a-f\d]{64}|(?:[a-f\d]{2}:){31}[a-f\d]{2})$/i.test(value)) {
    throw new Error('Expected a SHA-256 certificate fingerprint (64 hexadecimal digits).');
  }
  return value.replaceAll(':', '').toUpperCase().match(/../g).join(':');
}

export function createAssetLinks(packageName, fingerprints) {
  if (!['com.masterselects.app', 'com.masterselects.app.debug'].includes(packageName)) {
    throw new Error('Unexpected Android package name.');
  }
  if (!fingerprints.length) throw new Error('At least one signing certificate is required.');
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: packageName,
      sha256_cert_fingerprints: [...new Set(fingerprints.map(normalizeFingerprint))],
    },
  }];
}

export function hasAssetLink(statements, expected) {
  const target = expected[0].target;
  return Array.isArray(statements) && statements.some(statement =>
    statement?.relation?.includes('delegate_permission/common.handle_all_urls')
    && statement?.target?.namespace === 'android_app'
    && statement.target.package_name === target.package_name
    && Array.isArray(statement.target.sha256_cert_fingerprints)
    && target.sha256_cert_fingerprints.every(fingerprint =>
      statement.target.sha256_cert_fingerprints.some(candidate => {
        try { return normalizeFingerprint(candidate) === fingerprint; } catch { return false; }
      })),
  );
}
