/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so dist/ works from any static host or subpath (C1, BE-01).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
