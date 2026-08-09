import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// src/App.test.tsx covers App wiring since 2026-08-09: the audio engine
// extraction (useAudioEngine) made `vi.mock` a clean decouple, so the old
// "App is untestable until the audio refactor" note no longer applies.
// The harness mocks useAudioEngine, useMediaSession, ./lib/storage, and
// music-metadata — see the top of App.test.tsx.
