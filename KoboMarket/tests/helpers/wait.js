// Event listeners run AFTER the HTTP response (setImmediate), so a test must
// wait a moment for their effect. Polls `check` until it returns truthy, up to 2s.
async function waitFor(check, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Gives already-scheduled listeners time to run (to prove something did NOT happen).
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { waitFor, settle };
