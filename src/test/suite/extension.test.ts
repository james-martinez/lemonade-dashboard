import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { LemonadeDashboardProvider, activate } from '../../extension';

suite('LemonadeDashboardProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock extension context to activate it (which initializes statusBarItem)
        const mockContext: any = {
            subscriptions: { push: () => {} },
            extensionUri: vscode.Uri.file(__dirname)
        };
        activate(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should gracefully handle fetch error when retrieving server_models.json', async () => {
        const dummyUri = vscode.Uri.file(__dirname);
        const provider = new LemonadeDashboardProvider(dummyUri);

        const postedMessages: any[] = [];
        let messageHandler: any;

        const webviewView: any = {
            webview: {
                options: {},
                html: '',
                onDidReceiveMessage: (handler: any) => {
                    messageHandler = handler;
                },
                postMessage: async (msg: any) => {
                    postedMessages.push(msg);
                    return true;
                }
            }
        };

        const context: any = {};
        const token: any = {};

        provider.resolveWebviewView(webviewView, context, token);

        assert.ok(messageHandler, "Message handler should be registered");

        // Mock fetch globally
        const fetchStub = sandbox.stub(globalThis, 'fetch');

        // Setup successful responses for most endpoints
        const defaultOkResponse = {
            ok: true,
            json: async () => ({})
        } as any;

        // Return a mock object depending on the url
        fetchStub.callsFake(async (url: any, opts: any) => {
            const urlStr = url.toString();
            if (urlStr.includes('server_models.json')) {
                throw new Error("Simulated network failure for server_models.json");
            }
            if (urlStr.includes('api.github.com')) {
                return { ok: true, json: async () => ({ tag_name: 'v1.0.0' }) } as any;
            }
            if (urlStr.includes('live')) {
                return { ok: true } as any; // No json needed for live
            }
            // All other responses mock success
            return defaultOkResponse;
        });

        // Suppress console.error during test
        const consoleErrorStub = sandbox.stub(console, 'error');

        // Trigger the handler
        await messageHandler({ type: 'getDashboardData' });

        // Note: the original code had a comment `// Silently ignore if models can't be fetched`
        // that got replaced during our debugging but we must ensure it doesn't fail either way.

        // Assert that the dashboard data was sent (it is sent before fetch server_models.json in the actual code)
        const renderDashboardMsg = postedMessages.find(m => m.type === 'renderDashboard');
        assert.ok(renderDashboardMsg, "renderDashboard should be sent successfully");

        // Assert that serverOffline was NOT sent
        const serverOfflineMsg = postedMessages.find(m => m.type === 'serverOffline');
        assert.strictEqual(serverOfflineMsg, undefined, "serverOffline should not be sent");

        // Assert that serverModelsLoaded was NOT sent
        const serverModelsLoadedMsg = postedMessages.find(m => m.type === 'serverModelsLoaded');
        assert.strictEqual(serverModelsLoadedMsg, undefined, "serverModelsLoaded should not be sent");
    });
});
