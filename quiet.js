// Oculta los volcados de sesiones de libsignal de los registros (contienen material de claves).
for (const m of ['log', 'info', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => {
    const first = typeof a[0] === 'string' ? a[0] : '';
    if (/^(Closing session|Closing open session|Opening session|Removing old closed session|Migrating session|Session already|Failed to decrypt|Bad MAC)/.test(first) || (a[0] && typeof a[0] === 'object' && ('_chains' in a[0] || 'registrationId' in a[0]))) return;
    orig(...a);
  };
}
