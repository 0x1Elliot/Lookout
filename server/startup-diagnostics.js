const categories = new Set(['configuration_missing', 'configuration_invalid', 'database_authentication', 'database_tls', 'database_initialization']);

export function startupFailure(category) {
  return Object.assign(new Error('Application initialization failed.'), { startupCategory: category });
}

export function startupCategory(error) {
  if (categories.has(error?.startupCategory)) return error.startupCategory;
  if (['28P01', '28000'].includes(error?.code)) return 'database_authentication';
  if (['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_CERTIFICATE_VERIFY_FAILED', 'ENOENT'].includes(error?.code)) return 'database_tls';
  return 'database_initialization';
}

export function reportStartupFailure(error, log) {
  try { log('Lookout startup failed.', { code: startupCategory(error) }); }
  catch { /* A logging failure must not change the fail-closed API response. */ }
}
