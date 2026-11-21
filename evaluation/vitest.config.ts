import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['evaluation/run.spec.ts'], testTimeout: 900000 } });
