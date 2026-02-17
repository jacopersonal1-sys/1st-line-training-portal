module.exports = {
  testEnvironment: 'node',
  verbose: true,
  rootDir: '.',
  // Map your JS files if needed, or just point to where they are
  roots: ['<rootDir>/tests'],
  // Setup files if you need to mock localStorage or DOM
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['**/*.test.js'],
  moduleFileExtensions: ['js', 'json', 'node']
};