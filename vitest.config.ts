import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/pmos/**/*.test.{ts,js}'],
    setupFiles: ['tests/pmos/setup.ts'],
  },
});
