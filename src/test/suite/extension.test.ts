import * as assert from 'assert';
import * as sinon from 'sinon';
import * as proxyquire from 'proxyquire';

const vscodeMock = {
    workspace: {
        getConfiguration: sinon.stub().returns({
            get: sinon.stub().returns('http://127.0.0.1:8000')
        })
    },
    window: {
        createStatusBarItem: sinon.stub().returns({
            show: sinon.stub(),
            text: '',
            tooltip: '',
            backgroundColor: undefined
        }),
        registerWebviewViewProvider: sinon.stub(),
        showErrorMessage: sinon.stub()
    },
    commands: {
        registerCommand: sinon.stub(),
        executeCommand: sinon.stub()
    },
    StatusBarAlignment: { Right: 2 },
    ThemeColor: class {}
};

const proxied = proxyquire.noCallThru();

describe('Extension Test Suite', () => {
    let extensionModule: any;
    let globalFetchStub: sinon.SinonStub;

    beforeEach(() => {
        extensionModule = proxied.load('../../extension', {
            'vscode': vscodeMock
        });
        globalFetchStub = sinon.stub(global, 'fetch');
    });

    afterEach(() => {
        sinon.restore();
    });

    it('ChatRequest handles partial JSON chunks correctly by reading streams', async () => {
        // Find the provider class manually from module since it's not exported
        const activateMock = extensionModule.activate;
        const contextMock = {
            subscriptions: [],
            extensionUri: {}
        };
        activateMock(contextMock);

        // The second arg to registerWebviewViewProvider is the provider instance
        const registerCall = vscodeMock.window.registerWebviewViewProvider.getCall(0);
        const provider = registerCall.args[1];

        const postMessageSpy = sinon.spy();
        const webviewViewMock = {
            webview: {
                options: {},
                html: '',
                onDidReceiveMessage: sinon.stub(),
                postMessage: postMessageSpy
            }
        };

        // Initialize the webview
        provider.resolveWebviewView(webviewViewMock, {}, {});

        // Mock state so chatRequest succeeds the guard clause
        provider['_lastLoadedModel'] = 'llama3';

        // Get the onDidReceiveMessage callback that the extension registered
        const messageHandler = webviewViewMock.webview.onDidReceiveMessage.getCall(0).args[0];

        // Prepare our mock stream
        const encoder = new TextEncoder();
        let chunkIndex = 0;
        const chunks = [
            'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n',
            'data: {"choices": [{"delta": {"content": " World"',
            '}}]}\n\n',
            'data: [DONE]\n\n'
        ];

        const mockReader = {
            read: sinon.stub().callsFake(async () => {
                if (chunkIndex < chunks.length) {
                    const value = encoder.encode(chunks[chunkIndex]);
                    chunkIndex++;
                    return { value, done: false };
                }
                return { done: true };
            })
        };

        globalFetchStub.resolves({
            ok: true,
            body: {
                getReader: () => mockReader
            }
        });

        // Trigger the chat request
        await messageHandler({
            type: 'chatRequest',
            messages: [{ role: 'user', content: 'test' }]
        });

        const chunkCalls = postMessageSpy.getCalls().filter(c => c.args[0].type === 'chatResponseChunk');

        assert.strictEqual(chunkCalls.length, 2);
        assert.deepStrictEqual(chunkCalls[0].args[0], { type: 'chatResponseChunk', content: 'Hello' });
        assert.deepStrictEqual(chunkCalls[1].args[0], { type: 'chatResponseChunk', content: ' World' });

        const doneCall = postMessageSpy.getCalls().find(c => c.args[0].type === 'chatResponseDone');
        assert.ok(doneCall);
    });

    it('ChatRequest ignores genuinely invalid JSON until complete', async () => {
        const activateMock = extensionModule.activate;
        const contextMock = {
            subscriptions: [],
            extensionUri: {}
        };

        // Ensure clean state from previous tests
        vscodeMock.window.registerWebviewViewProvider.resetHistory();
        activateMock(contextMock);

        const registerCall = vscodeMock.window.registerWebviewViewProvider.getCall(0);
        const provider = registerCall.args[1];

        const postMessageSpy = sinon.spy();
        const webviewViewMock = {
            webview: {
                options: {},
                html: '',
                onDidReceiveMessage: sinon.stub(),
                postMessage: postMessageSpy
            }
        };

        provider.resolveWebviewView(webviewViewMock, {}, {});
        provider['_lastLoadedModel'] = 'llama3';
        const messageHandler = webviewViewMock.webview.onDidReceiveMessage.getCall(0).args[0];

        const encoder = new TextEncoder();
        let chunkIndex = 0;
        const chunks = [
            'data: { "invalid": JSON \n\n',
            'data: [DONE]\n\n'
        ];

        const mockReader = {
            read: sinon.stub().callsFake(async () => {
                if (chunkIndex < chunks.length) {
                    const value = encoder.encode(chunks[chunkIndex]);
                    chunkIndex++;
                    return { value, done: false };
                }
                return { done: true };
            })
        };

        globalFetchStub.resolves({
            ok: true,
            body: {
                getReader: () => mockReader
            }
        });

        await messageHandler({
            type: 'chatRequest',
            messages: [{ role: 'user', content: 'test' }]
        });

        const chunkCalls = postMessageSpy.getCalls().filter(c => c.args[0].type === 'chatResponseChunk');
        assert.strictEqual(chunkCalls.length, 0);

        const doneCall = postMessageSpy.getCalls().find(c => c.args[0].type === 'chatResponseDone');
        assert.ok(doneCall);
    });
});
