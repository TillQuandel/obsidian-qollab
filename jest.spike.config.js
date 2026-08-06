// Eigene Config fuer die Messlaeufe, damit der normale `npx jest` unberuehrt
// bleibt: die Default-Config in package.json matcht nur `**/tests/**/*.test.ts`,
// diese hier nur `**/spike/**/*.spec.ts`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/spike/**/*.spec.ts'],
  moduleNameMapper: { '^obsidian$': '<rootDir>/jest.setup.js' },
  testTimeout: 1800000,
};
