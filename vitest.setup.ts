import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Note: src/App.tsx is intentionally not tested in Phase 0.
// It's deeply coupled to AudioContext, createMediaElementSource, and
// requestAnimationFrame — adding integration tests there is deferred
// to Phase 3 (gapless playback), when we'll be refactoring that
// pipeline anyway and the mocking work pays for itself.
