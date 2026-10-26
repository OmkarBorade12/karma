// Test setup for RTL under vitest (matchers + TextEncoder for jsdom fetch shims).
import '@testing-library/jest-dom/vitest'

// jsdom lacks some globals used by code paths under test.
if (typeof globalThis.fetch === 'undefined') {
  throw new Error('fetch must exist in the test environment')
}
