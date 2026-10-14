import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    // Argon2id ist absichtlich langsam; die Krypto-Tests brauchen mehr als die Standardzeit.
    testTimeout: 30_000,
  },
});
