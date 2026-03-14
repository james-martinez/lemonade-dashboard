import * as assert from 'assert';
import * as vscode from 'vscode';
import * as extension from '../../extension';

suite('Extension Test Suite - getLemonadeConfig', () => {
    let originalGetConfiguration: any;
    let mockContext: any;
    let mockSecrets: Record<string, string>;

    setup(() => {
        originalGetConfiguration = vscode.workspace.getConfiguration;
        mockSecrets = {};
        mockContext = {
            secrets: {
                get: async (key: string) => mockSecrets[key] || undefined,
                store: async (key: string, value: string) => { mockSecrets[key] = value; },
                delete: async (key: string) => { delete mockSecrets[key]; }
            }
        };
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

    test('should use default values when no config is set', async () => {
        mockConfig({});
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'http://127.0.0.1:8000');
        assert.strictEqual(config.apiUrl, 'http://127.0.0.1:8000/api/v1');
        assert.deepStrictEqual(config.headers, { 'Content-Type': 'application/json' });
        assert.strictEqual(config.defaultTab, 'main');
    });

    test('should use new servers array configuration when provided', async () => {
        mockConfig({
            servers: [
                { name: 'Server 1', url: 'http://server1:8080', apiToken: 'token1' },
                { name: 'Server 2', url: 'http://server2:9090', apiToken: 'token2' }
            ]
        });
        mockSecrets['lemonade.apiToken.Server 1'] = 'secret-token1';
        mockSecrets['lemonade.apiToken.Server 2'] = 'secret-token2';

        const config0 = await extension.getLemonadeConfig(mockContext, 0);
        assert.strictEqual(config0.rawUrl, 'http://server1:8080');
        assert.strictEqual(config0.headers['Authorization'], 'Bearer secret-token1');

        const config1 = await extension.getLemonadeConfig(mockContext, 1);
        assert.strictEqual(config1.rawUrl, 'http://server2:9090');
        assert.strictEqual(config1.headers['Authorization'], 'Bearer secret-token2');
    });

    test('should fallback to deprecated config if servers array is empty', async () => {
        mockConfig({
            servers: [],
            serverUrl: 'http://legacy:1234',
            apiToken: 'legacy-token'
        });
        mockSecrets['lemonade.apiToken'] = 'legacy-secret';
        const config = await extension.getLemonadeConfig(mockContext, 0);
        assert.strictEqual(config.rawUrl, 'http://legacy:1234');
        assert.strictEqual(config.headers['Authorization'], 'Bearer legacy-secret');
    });

    test('should fallback to deprecated config if server index is out of bounds', async () => {
        mockConfig({
            servers: [{ name: 'Server 1', url: 'http://server1:8080' }],
            serverUrl: 'http://legacy:1234'
        });
        const config = await extension.getLemonadeConfig(mockContext, 1); // Index 1 does not exist
        assert.strictEqual(config.rawUrl, 'http://legacy:1234');
    });

    test('should properly transform URL without http/https prefix', async () => {
        mockConfig({ serverUrl: 'localhost:8080' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'http://localhost:8080');
        assert.strictEqual(config.apiUrl, 'http://localhost:8080/api/v1');
    });

    test('should properly transform URL with trailing slashes', async () => {
        mockConfig({ serverUrl: 'http://localhost:8080///' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'http://localhost:8080');
        assert.strictEqual(config.apiUrl, 'http://localhost:8080/api/v1');
    });

    test('should maintain http prefix if provided', async () => {
        mockConfig({ serverUrl: 'http://my-server.com:3000' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'http://my-server.com:3000');
        assert.strictEqual(config.apiUrl, 'http://my-server.com:3000/api/v1');
    });

    test('should maintain https prefix if provided', async () => {
        mockConfig({ serverUrl: 'https://my-secure-server.com' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'https://my-secure-server.com');
        assert.strictEqual(config.apiUrl, 'https://my-secure-server.com/api/v1');
    });

    test('should strip whitespace from URL', async () => {
        mockConfig({ serverUrl: '  https://my-secure-server.com  ' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.rawUrl, 'https://my-secure-server.com');
    });

    test('should generate appropriate authorization headers if API token is present', async () => {
        mockConfig({ apiToken: 'my-super-secret-token' });
        mockSecrets['lemonade.apiToken'] = 'my-super-secret-token-secret';
        const config = await extension.getLemonadeConfig(mockContext);
        assert.deepStrictEqual(config.headers, {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-super-secret-token-secret'
        });
    });

    test('should respect custom defaultTab configuration', async () => {
        mockConfig({ defaultTab: 'system' });
        const config = await extension.getLemonadeConfig(mockContext);
        assert.strictEqual(config.defaultTab, 'system');
    });
});
