// Eigene Config fuer den Spike, damit `npx jest --no-cache` (67 Suiten) unberuehrt
// bleibt: die Default-Config matcht nur `**/tests/**/*.test.ts`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/spike/**/*.spec.ts'],
  moduleNameMapper: { '^obsidian$': '<rootDir>/jest.setup.js' },
  testTimeout: 120000,
};
