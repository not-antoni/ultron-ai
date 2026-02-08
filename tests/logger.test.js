'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

// Test the logger module format logic directly
// (We can't easily capture console output in node:test,
//  so we test the module's exported API behavior)

describe('Logger', () => {
    test('createLogger returns object with all level methods', () => {
        const { createLogger } = require('../src/logger');
        const logger = createLogger('Test');
        assert.strictEqual(typeof logger.debug, 'function');
        assert.strictEqual(typeof logger.info, 'function');
        assert.strictEqual(typeof logger.warn, 'function');
        assert.strictEqual(typeof logger.error, 'function');
    });

    test('init accepts options without error', () => {
        const { init } = require('../src/logger');
        // Should not throw
        init({ level: 'debug' });
        init({ level: 'error' });
        init({ level: 'info' });
        init({}); // defaults
    });

    test('LEVELS has correct ordering', () => {
        const { LEVELS } = require('../src/logger');
        assert.ok(LEVELS.debug < LEVELS.info);
        assert.ok(LEVELS.info < LEVELS.warn);
        assert.ok(LEVELS.warn < LEVELS.error);
    });

    test('logger methods do not throw', () => {
        const { createLogger, init } = require('../src/logger');
        init({ level: 'error' }); // suppress output during tests
        const logger = createLogger('TestSilent');
        // These should all execute without throwing
        logger.debug('debug message');
        logger.info('info message');
        logger.warn('warn message', 'extra');
        logger.error('error message', new Error('test error'));
        // Reset to info for other tests
        init({ level: 'info' });
    });
});
