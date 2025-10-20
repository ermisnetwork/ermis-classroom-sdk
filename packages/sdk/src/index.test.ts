import { describe, it, expect } from 'vitest';
import { SDK, createSDK } from './index';
import { formatMessage, isValidApiKey } from './utils';

describe('SDK', () => {
  it('should create an SDK instance', () => {
    const sdk = createSDK({ apiKey: 'test-key' });
    expect(sdk).toBeInstanceOf(SDK);
  });

  it('should initialize successfully', async () => {
    const sdk = createSDK({ apiKey: 'test-key', debug: true });
    await expect(sdk.init()).resolves.toBeUndefined();
  });

  it('should return config', () => {
    const config = { apiKey: 'test-key', debug: true };
    const sdk = createSDK(config);
    expect(sdk.getConfig()).toEqual(config);
  });

  it('should process input', async () => {
    const sdk = createSDK({ apiKey: 'test-key' });
    const result = await sdk.doSomething('test');
    expect(result).toBe('Processed: test');
  });
});

describe('Utils', () => {
  it('should format message', () => {
    expect(formatMessage('hello')).toBe('[SDK] hello');
  });

  it('should validate API key', () => {
    expect(isValidApiKey('valid-key')).toBe(true);
    expect(isValidApiKey('')).toBe(false);
  });
});

