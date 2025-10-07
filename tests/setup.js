/**
 * Jest setup file
 * This file is run before each test file
 */

// Mock global objects for browser environment
global.navigator = {
  mediaDevices: {
    getUserMedia: jest.fn().mockResolvedValue({}),
    enumerateDevices: jest.fn().mockResolvedValue([]),
  },
  permissions: {
    query: jest.fn().mockResolvedValue({ state: 'granted' }),
  },
};

global.window = {
  addEventListener: jest.fn(),
  location: {
    protocol: 'https:',
    host: 'localhost:3000',
  },
};

global.document = {
  addEventListener: jest.fn(),
  getElementById: jest.fn(),
  createElement: jest.fn().mockReturnValue({
    appendChild: jest.fn(),
    setAttribute: jest.fn(),
    style: {},
  }),
  hidden: false,
};

// Mock console methods to avoid noise in tests
console.warn = jest.fn();
console.debug = jest.fn();

// Setup test timeout
jest.setTimeout(30000);