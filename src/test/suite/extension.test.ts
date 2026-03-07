import * as assert from 'assert';
import * as vscode from 'vscode';
import * as extension from '../../extension';

suite('Extension Test Suite - getLemonadeConfig', () => {
    let originalGetConfiguration: any;

    setup(() => {
        originalGetConfiguration = vscode.workspace.getConfiguration;
    });

    teardown(() => {
        Object.defineProperty(vscode.workspace, 'getConfiguration', {
            value: originalGetConfiguration
        });
    });

    function mockConfig(mockValues: Record<string, any>) {
        Object.defineProperty(vscode.workspace, 'getConfiguration', {
            value: (section?: string) => {
                if (section === 'lemonade') {
                    return {
                        get: (key: string) => mockValues[key]
                    };
                }
                return originalGetConfiguration(section);
            }
        });
    }

    test('should use default values when no config is set', () => {
        mockConfig({});
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'http://127.0.0.1:8000');
        assert.strictEqual(config.apiUrl, 'http://127.0.0.1:8000/api/v1');
        assert.deepStrictEqual(config.headers, { 'Content-Type': 'application/json' });
        assert.strictEqual(config.defaultTab, 'main');
    });

    test('should properly transform URL without http/https prefix', () => {
        mockConfig({ serverUrl: 'localhost:8080' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'http://localhost:8080');
        assert.strictEqual(config.apiUrl, 'http://localhost:8080/api/v1');
    });

    test('should properly transform URL with trailing slashes', () => {
        mockConfig({ serverUrl: 'http://localhost:8080///' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'http://localhost:8080');
        assert.strictEqual(config.apiUrl, 'http://localhost:8080/api/v1');
    });

    test('should maintain http prefix if provided', () => {
        mockConfig({ serverUrl: 'http://my-server.com:3000' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'http://my-server.com:3000');
        assert.strictEqual(config.apiUrl, 'http://my-server.com:3000/api/v1');
    });

    test('should maintain https prefix if provided', () => {
        mockConfig({ serverUrl: 'https://my-secure-server.com' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'https://my-secure-server.com');
        assert.strictEqual(config.apiUrl, 'https://my-secure-server.com/api/v1');
    });

    test('should strip whitespace from URL', () => {
        mockConfig({ serverUrl: '  https://my-secure-server.com  ' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.rawUrl, 'https://my-secure-server.com');
    });

    test('should generate appropriate authorization headers if API token is present', () => {
        mockConfig({ apiToken: 'my-super-secret-token' });
        const config = extension.getLemonadeConfig();
        assert.deepStrictEqual(config.headers, {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-super-secret-token'
        });
    });

    test('should respect custom defaultTab configuration', () => {
        mockConfig({ defaultTab: 'system' });
        const config = extension.getLemonadeConfig();
        assert.strictEqual(config.defaultTab, 'system');
    });
});
