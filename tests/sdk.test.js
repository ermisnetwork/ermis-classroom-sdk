/**
 * Basic SDK tests
 */

import ErmisClassroom from '../src/index.js';

describe('ErmisClassroom SDK', () => {
  test('should have version property', () => {
    expect(ErmisClassroom.version).toBeDefined();
    expect(typeof ErmisClassroom.version).toBe('string');
  });

  test('should have create method', () => {
    expect(typeof ErmisClassroom.create).toBe('function');
  });

  test('should have connect method', () => {
    expect(typeof ErmisClassroom.connect).toBe('function');
  });

  test('should have events constants', () => {
    expect(ErmisClassroom.events).toBeDefined();
    expect(typeof ErmisClassroom.events).toBe('object');
  });

  test('should have MediaDevices utilities', () => {
    expect(ErmisClassroom.MediaDevices).toBeDefined();
    expect(typeof ErmisClassroom.MediaDevices.getDevices).toBe('function');
  });

  test('should have RoomTypes constants', () => {
    expect(ErmisClassroom.RoomTypes).toBeDefined();
    expect(ErmisClassroom.RoomTypes.MAIN).toBe('main');
    expect(ErmisClassroom.RoomTypes.BREAKOUT).toBe('breakout');
  });

  test('should create client with config', () => {
    const client = ErmisClassroom.create({
      host: 'localhost:9999',
      debug: true
    });

    expect(client).toBeDefined();
    expect(typeof client.authenticate).toBe('function');
    expect(typeof client.createRoom).toBe('function');
  });
});

describe('Client Configuration', () => {
  test('should accept valid configuration', () => {
    const config = {
      host: 'test.com:9999',
      apiUrl: 'https://test.com:9999/meeting',
      debug: false,
      reconnectAttempts: 3
    };

    const client = ErmisClassroom.create(config);
    expect(client).toBeDefined();
  });

  test('should have default configuration values', () => {
    const client = ErmisClassroom.create({
      host: 'test.com:9999'
    });

    const clientConfig = client.getConfig();
    expect(clientConfig.host).toBe('test.com:9999');
    expect(clientConfig.reconnectAttempts).toBeDefined();
  });
});