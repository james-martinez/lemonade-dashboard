import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Lemonade Dashboard is now active!');

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'lemonade.openSettings'; 
    context.subscriptions.push(statusBarItem);
    
    updateStatusBar(false);
    statusBarItem.show();

    context.subscriptions.push(vscode.commands.registerCommand('lemonade.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lemonade');
    }));

    const provider = new LemonadeDashboardProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(LemonadeDashboardProvider.viewType, provider)
    );
}

export function deactivate() {}

export function updateStatusBar(isConnected: boolean) {
    if (isConnected) {
        statusBarItem.text = '$(check) Lemonade: Connected';
        statusBarItem.tooltip = 'Lemonade Server is Online';
        statusBarItem.backgroundColor = undefined; 
    } else {
        statusBarItem.text = '$(error) Lemonade: Disconnected';
        statusBarItem.tooltip = 'Lemonade Server is Offline. Click to check settings.';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
}

export function getLemonadeConfig() {
    const config = vscode.workspace.getConfiguration('lemonade');
    let rawUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:8000';
    const token = config.get<string>('apiToken') || '';
    const defaultTab = config.get<string>('defaultTab') || 'main';

    rawUrl = rawUrl.trim().replace(/\/+$/, '');
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        rawUrl = `http://${rawUrl}`; 
    }

    const apiUrl = `${rawUrl}/api/v1`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return { rawUrl, apiUrl, headers, defaultTab };
}

class LemonadeDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'lemonadeDashboard';
    private _view?: vscode.WebviewView;
    private _lastLoadedModel: string | null = null;
    private _lastGitHubCheck: number = 0;
    private _latestGitHubVersion: string | null = null;
    private _lastServerModelsCheck: number = 0;
    private _serverModelsCache: any = null;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async data => {
            const { rawUrl, apiUrl, headers, defaultTab } = getLemonadeConfig();
            
            switch (data.type) {
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'lemonade');
                    break;


                case 'getDashboardData':
                    try {
                        const liveRes = await fetch(`${rawUrl}/live`, { headers });
                        if (!liveRes.ok) throw new Error("Server not live");

                        const [sysRes, modelsRes, healthRes, statsRes] = await Promise.all([
                            fetch(`${apiUrl}/system-info`, { headers }),
                            fetch(`${apiUrl}/models`, { headers }),
                            fetch(`${apiUrl}/health`, { headers }),
                            fetch(`${apiUrl}/stats`, { headers })
                        ]);

                        updateStatusBar(true);

                        // FIX: Cast JSON responses to any to resolve TypeScript 'unknown' errors
                        const sysInfo = (await sysRes.json()) as any;
                        const modelsData = (await modelsRes.json()) as any;
                        const healthData = (await healthRes.json()) as any;
                        
                        this._lastLoadedModel = healthData.model_loaded || null;

                        let statsData: any = {};
                        if (statsRes.ok) {
                            statsData = (await statsRes.json()) as any;
                        }

                        webviewView.webview.postMessage({
                            type: 'renderDashboard',
                            defaultTab: defaultTab,
                            sysInfo: sysInfo,
                            models: modelsData.data || [],
                            loadedModel: healthData.model_loaded || null,
                            healthStatus: healthData.status || 'unknown',
                            serverVersion: healthData.version || null,
                            websocketPort: healthData.websocket_port || null,
                            allModelsLoaded: healthData.all_models_loaded || [],
                            maxModels: healthData.max_models || {},
                            stats: statsData,
                            healthData: healthData
                        });

                        // Fetch latest version from GitHub to compare (cached for 12 hours)
                        const now = Date.now();
                        const cacheThreshold = 12 * 60 * 60 * 1000; // 12 hours
                        if (!this._latestGitHubVersion || (now - this._lastGitHubCheck) > cacheThreshold) {
                            try {
                                const ghRes = await fetch('https://api.github.com/repos/lemonade-sdk/lemonade/releases/latest', {
                                    headers: { 'User-Agent': 'Lemonade-VSCode-Extension' }
                                });
                                if (ghRes.ok) {
                                    const ghData = (await ghRes.json()) as any;
                                    this._latestGitHubVersion = ghData.tag_name;
                                    this._lastGitHubCheck = now;
                                }
                            } catch (ghErr) {
                                console.error("Failed to check GitHub version", ghErr);
                            }
                        }

                        if (this._latestGitHubVersion) {
                            webviewView.webview.postMessage({
                                type: 'updateVersionCheck',
                                latestVersion: this._latestGitHubVersion
                            });
                        }

                        // Fetch server_models.json for the pull model dropdown (cached for 12 hours)
                        if (!this._serverModelsCache || (now - this._lastServerModelsCheck) > cacheThreshold) {
                            try {
                                const modelsRes = await fetch('https://raw.githubusercontent.com/lemonade-sdk/lemonade/refs/heads/main/src/cpp/resources/server_models.json');
                                if (modelsRes.ok) {
                                    this._serverModelsCache = await modelsRes.json();
                                    this._lastServerModelsCheck = now;
                                }
                            } catch (err) {
                                console.error("Failed to fetch server_models.json", err);
                            }
                        }

                        if (this._serverModelsCache) {
                            webviewView.webview.postMessage({
                                type: 'serverModelsLoaded',
                                models: this._serverModelsCache
                            });
                        }
                    } catch (e) {
                        updateStatusBar(false);
                        webviewView.webview.postMessage({ type: 'serverOffline' });
                    }
                    break;

                case 'manageModelLifecycle':
                    try {
                        const endpoint = data.action === 'load' ? '/load' : '/unload';
                        const loadBody: any = {
                            model_name: data.modelName,
                            ctx_size: data.contextSize || 4096
                        };
                        if (data.llamacppArgs) {
                            loadBody.llamacpp_args = data.llamacppArgs;
                        }
                        if (data.llamacppBackend) {
                            loadBody.llamacpp_backend = data.llamacppBackend;
                        }
                        if (data.saveOptions !== undefined) {
                            loadBody.save_options = data.saveOptions;
                        }
                        const res = await fetch(`${apiUrl}${endpoint}`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(loadBody)
                        });
                        if (!res.ok) throw new Error("Action failed");
                        vscode.window.showInformationMessage(`Successfully ${data.action}ed ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to ${data.action} model ${data.modelName}.`);
                    }
                    break;

                case 'pullModel':
                    let finalModelName = data.modelName;
                    // If checkpoint or recipe is provided, ensure model name has "user." prefix
                    if ((data.checkpoint || data.recipe) && !finalModelName.startsWith("user.")) {
                        finalModelName = "user." + finalModelName;
                    }

                    vscode.window.showInformationMessage(`Pulling model: ${finalModelName}...`);
                    try {
                        const pullBody: any = { model_name: finalModelName };
                        if (data.checkpoint) pullBody.checkpoint = String(data.checkpoint);
                        if (data.recipe) pullBody.recipe = String(data.recipe);
                        if (data.mmproj) pullBody.mmproj = data.mmproj;
                        if (data.vision) pullBody.vision = true;
                        if (data.reasoning) pullBody.reasoning = true;
                        if (data.embedding) pullBody.embedding = true;
                        if (data.reranking) pullBody.reranking = true;

                        const res = await fetch(`${apiUrl}/pull?stream=true`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(pullBody)
                        });
                        if (!res.ok || !res.body) throw new Error("Pull failed");
                
                        const reader = res.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                
                            const events = buffer.split('\n\n');
                            buffer = events.pop() || '';
                
                            for (const evt of events) {
                                if (evt.includes('event: progress')) {
                                    const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
                                    if (dataLine) {
                                        try {
                                            const payload = JSON.parse(dataLine.replace('data:', '').trim());
                                            webviewView.webview.postMessage({
                                                type: 'pullProgress',
                                                status: 'downloading',
                                                model: data.modelName,
                                                file: payload.file,
                                                percent: payload.percent
                                            });
                                        } catch (e) {
                                            console.error("Error parsing progress event", e);
                                        }
                                    }
                                } else if (evt.includes('event: complete')) {
                                    webviewView.webview.postMessage({
                                        type: 'pullProgress',
                                        status: 'complete',
                                        model: data.modelName
                                    });
                                } else if (evt.includes('event: error')) {
                                    const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
                                    if (dataLine) {
                                        try {
                                            const payload = JSON.parse(dataLine.replace('data:', '').trim());
                                            webviewView.webview.postMessage({
                                                type: 'pullProgress',
                                                status: 'error',
                                                message: payload.error || payload.message || 'Unknown pull error'
                                            });
                                        } catch (e) {
                                            console.error("Error parsing error event", e);
                                        }
                                    }
                                }
                            }
                        }
                
                        vscode.window.showInformationMessage(`Successfully pulled ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to pull ${data.modelName}`);
                    }
                    break;

                case 'deleteModel':
                    try {
                        const res = await fetch(`${apiUrl}/delete`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model_name: data.modelName })
                        });
                        if (!res.ok) throw new Error("Delete failed");
                        vscode.window.showInformationMessage(`Deleted ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to delete ${data.modelName}`);
                    }
                    break;

                case 'installBackend':
                    vscode.window.showInformationMessage(`Installing recipe: ${data.recipeName}...`);
                    try {
                        const res = await fetch(`${apiUrl}/install`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                recipe: data.recipeName,
                                backend: data.backendName
                            })
                        });
                        if (!res.ok) throw new Error("Install failed");
                        vscode.window.showInformationMessage(`Successfully installed ${data.recipeName}:${data.backendName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to install ${data.recipeName}:${data.backendName}`);
                    }
                    break;

                case 'uninstallBackend':
                    try {
                        const res = await fetch(`${apiUrl}/uninstall`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                recipe: data.recipeName,
                                backend: data.backendName
                            })
                        });
                        if (!res.ok) throw new Error("Uninstall failed");
                        vscode.window.showInformationMessage(`Uninstalled ${data.recipeName}:${data.backendName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`${e}`);
                    }
                    break;

                case 'chatRequest':
                    try {
                        // Guard: no model loaded
                        if (!this._lastLoadedModel) {
                            vscode.window.showErrorMessage(
                                'No model is loaded. Please load a model before sending a chat request.'
                            );
                            webviewView.webview.postMessage({
                                type: 'chatError',
                                error: 'No model loaded. Please load a model first.'
                            });
                            break;
                        }

                        // The user specified to use the v1/chat/completions endpoint
                        // and ensure the model name is included if required.
                        const res = await fetch(`${rawUrl}/api/v1/chat/completions`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                model: this._lastLoadedModel,
                                messages: data.messages,
                                stream: true
                            })
                        });

                        if (!res.ok) throw new Error("Chat request failed");
                        if (!res.body) throw new Error("No response body");

                        const reader = res.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';

                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            const chunk = decoder.decode(value, { stream: true });
                            
                            // Basic SSE parsing for OpenAI-compatible format
                            buffer += chunk;
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const dataStr = line.slice(6).trim();
                                    if (dataStr === '[DONE]') continue;
                                    try {
                                        const json = JSON.parse(dataStr);
                                        const content = json.choices?.[0]?.delta?.content || "";
                                        if (content) {
                                            webviewView.webview.postMessage({
                                                type: 'chatResponseChunk',
                                                content: content
                                            });
                                        }
                                    } catch (e) {
                                        // Ignore partial JSON chunks
                                    }
                                }
                            }
                        }
                        webviewView.webview.postMessage({ type: 'chatResponseDone' });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Chat error: ${e}`);
                        webviewView.webview.postMessage({ type: 'chatError', error: String(e) });
                    }
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Lemonade Manager</title>
                <script type="module" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit/dist/toolkit.min.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
                <style>
                    body { padding: 0 10px; display: flex; flex-direction: column; gap: 20px; height: 100vh; margin: 0; box-sizing: border-box; }
                    .header-status { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
                    .status-badge { display: flex; align-items: center; gap: 6px; font-weight: 600; }
                    .indicator { width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-disabledForeground); }
                    .indicator.online { background: var(--vscode-testing-iconPassed); }
                    .indicator.offline { background: var(--vscode-testing-iconFailed); }
                    
                    .section { margin-top: 15px; }
                    .section h3 { font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
                    
                    .metric { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border); }
                    .metric-label { opacity: 0.8; }
                    .metric-value { font-family: var(--vscode-editor-font-family); font-weight: bold; }
                    
                    vscode-text-field, vscode-dropdown, vscode-button { width: 100%; margin-bottom: 10px; }

                    .scroll-controls { position: absolute; right: 20px; bottom: 150px; display: flex; flex-direction: column; gap: 5px; z-index: 100; }
                    .scroll-btn { width: 30px !important; height: 30px !important; min-width: 30px !important; padding: 0 !important; border-radius: 50% !important; }
                    .button-group { display: flex; gap: 10px; }
                    .recipe-list { font-size: 12px; margin-top: 10px; line-height: 1.6; }
                    .recipe-item { display: inline-block; padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; margin: 2px; }

                    /* Chat Styles */
                    #chatContainer { display: flex; flex-direction: column; height: calc(100vh - 140px); gap: 10px; position: relative; }
                    #chatMessages { flex: 1; overflow-y: auto; padding: 5px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; scroll-behavior: smooth; }
                    .message-wrapper { display: flex; flex-direction: column; gap: 4px; max-width: 90%; }
                    .message-wrapper.user { align-self: flex-end; }
                    .message-wrapper.bot { align-self: flex-start; }
                    .message { padding: 8px; border-radius: 4px; font-size: 13px; line-height: 1.4; position: relative; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; }
                    .user-message { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                    .bot-message { background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-editor-foreground); }
                    .bot-message pre { white-space: pre-wrap; word-break: break-all; }
                    .bot-message code { white-space: pre-wrap; word-break: break-all; }
                    .copy-btn { align-self: flex-end; opacity: 0; transition: opacity 0.2s; font-size: 10px; padding: 2px 6px; cursor: pointer; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; border: none; }
                    .message-wrapper:hover .copy-btn { opacity: 1; }
                    .chat-input-area { display: flex; gap: 5px; flex-shrink: 0; align-items: flex-end; }
                    #chatInput { flex: 1; width: 100%; }
                    #sendChatBtn { flex-shrink: 0; min-width: 60px; width: auto; }
                </style>
            </head>
            <body>
                <div class="header-status">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div class="status-badge">
                            <div id="statusDot" class="indicator offline"></div>
                            <span id="statusText">Disconnected</span>
                        </div>
                        <div id="activeModelHeader" style="font-size: 10px; opacity: 0.7; font-weight: normal;">No Model Active</div>
                    </div>
                    <vscode-badge id="speedBadge">0 t/s</vscode-badge>
                </div>

                <vscode-panels id="dashboardPanels">
                    <vscode-panel-tab id="tab-main">Main</vscode-panel-tab>
                    <vscode-panel-tab id="tab-system">System</vscode-panel-tab>
                    <vscode-panel-tab id="tab-health">Health</vscode-panel-tab>
                    <vscode-panel-tab id="tab-library">Library</vscode-panel-tab>
                    <vscode-panel-tab id="tab-backends">Backends</vscode-panel-tab>
                    <vscode-panel-tab id="tab-chat">Chat</vscode-panel-tab>

                    <!-- Main Tab: Loaded Models and Last Request Stats -->
                    <vscode-panel-view id="view-main" style="flex-direction: column;">
                        <div class="section">
                            <h3>Loaded Models</h3>
                            <div id="loadedModelsList" style="font-size: 12px; margin-bottom: 10px; color: var(--vscode-descriptionForeground);">No models loaded</div>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Load / Unload Models</h3>
                            <vscode-dropdown id="modelSelect">
                                <vscode-option value="">Fetching models...</vscode-option>
                            </vscode-dropdown>
                            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">
                                <vscode-text-field id="contextSize" placeholder="Context size eg. 4096" style="flex: 1;"></vscode-text-field>
                                <vscode-text-field id="llamacppBackend" placeholder="Backend eg. vulkan" style="flex: 1;"></vscode-text-field>
                            </div>
                            <vscode-text-field id="llamacppArgs" placeholder="LlamaCpp args (e.g., --temp 1.0 --top-p 0.95 --min-p 0.01 --top-k 40)" style="margin-bottom: 10px;"></vscode-text-field>
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <vscode-checkbox id="saveOptions">Save options to recipe_options.json</vscode-checkbox>
                            </div>
                            <div class="button-group">
                                <vscode-button appearance="primary" onclick="manageModel('load')">Load to VRAM</vscode-button>
                                <vscode-button appearance="secondary" onclick="manageModel('unload')">Unload</vscode-button>
                            </div>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Last Request Stats</h3>
                            <div class="metric"><span class="metric-label">Time to First Token</span><span id="ttft" class="metric-value">0s</span></div>
                            <div class="metric"><span class="metric-label">Tokens Per Second</span><span id="tps" class="metric-value">0</span></div>
                            <div class="metric"><span class="metric-label">Input Tokens</span><span id="inputTokens" class="metric-value">0</span></div>
                            <div class="metric"><span class="metric-label">Output Tokens</span><span id="outputTokens" class="metric-value">0</span></div>
                            <div class="metric"><span class="metric-label">Prompt Tokens</span><span id="promptTokens" class="metric-value">0</span></div>
                            <div class="metric"><span class="metric-label">Decode Times</span><span id="decodeTimes" class="metric-value">-</span></div>
                        </div>

                        <vscode-divider></vscode-divider>
                        
                        <div style="margin-top: auto; padding: 15px 0; text-align: center;">
                            <vscode-link href="https://github.com/lemonade-sdk/lemonade">
                                <span class="codicon codicon-github"></span> View Lemonade on GitHub
                            </vscode-link>
                        </div>
                    </vscode-panel-view>

                    <!-- System Tab: Server Info, Hardware Specs, Model Limits -->
                    <vscode-panel-view id="view-system" style="flex-direction: column;">
                        <div class="section">
                            <h3>Server Info</h3>
                            <div class="metric">
                                <span class="metric-label">Version</span>
                                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                    <span id="serverVersion" class="metric-value">-</span>
                                    <span id="versionStatus" style="font-size: 10px; margin-top: 2px;"></span>
                                </div>
                            </div>
                            <div class="metric"><span class="metric-label">WebSocket Port</span><span id="wsPort" class="metric-value">-</span></div>
                        </div>

                        <div class="section">
                            <h3>Hardware Specs</h3>
                            <div class="metric"><span class="metric-label">Processor</span><span id="cpuText" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Memory</span><span id="ramText" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">OS Version</span><span id="osVersion" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">OEM System</span><span id="oemSystem" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">BIOS Version</span><span id="biosVersion" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">CPU Max Clock</span><span id="cpuMaxClock" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Power Setting</span><span id="powerSetting" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">NPU Detected</span><span id="npuText" class="metric-value">-</span></div>
                        </div>

                        <div class="section">
                            <h3>Model Limits</h3>
                            <div class="metric"><span class="metric-label">LLM Slots</span><span id="maxLlm" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Embedding Slots</span><span id="maxEmbedding" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Reranking Slots</span><span id="maxReranking" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Audio Slots</span><span id="maxAudio" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">Image Slots</span><span id="maxImage" class="metric-value">-</span></div>
                            <div class="metric"><span class="metric-label">TTS Slots</span><span id="maxTts" class="metric-value">-</span></div>
                        </div>
                    </vscode-panel-view>

                    <vscode-panel-view id="view-health" style="flex-direction: column;">
                        <div class="section">
                            <h3>Server Health</h3>
                            <pre id="healthJson" style="font-size: 11px; font-family: var(--vscode-editor-font-family); background: var(--vscode-input-background); padding: 12px; border-radius: 3px; max-height: 300px; overflow-y: auto; color: var(--vscode-editor-foreground); white-space: pre-wrap; word-wrap: break-word;"></pre>
                        </div>
                    </vscode-panel-view>

                    <vscode-panel-view id="view-library" style="flex-direction: column;">
                        <div class="section">
                            <h3>Pull & Register Model</h3>
                            <p style="font-size: 11px; margin-bottom: 10px; opacity: 0.8;">
                                Pull a built-in model or register a new one from Hugging Face.
                            </p>

                            <vscode-dropdown id="serverModelSelect" style="margin-bottom: 10px;">
                                <vscode-option value="">Select a pre-configured model...</vscode-option>
                            </vscode-dropdown>
                            
                            <vscode-text-field id="pullInput" placeholder="e.g., user.Phi-4-Mini-GGUF">
                                Model Name
                            </vscode-text-field>

                            <vscode-text-field id="pullCheckpoint" placeholder="e.g., unsloth/Phi-4-mini-instruct-GGUF:Q4_K_M">
                                Checkpoint (Hugging Face ID)
                            </vscode-text-field>

                            <vscode-text-field id="pullRecipe" placeholder="e.g., llamacpp">
                                Recipe
                            </vscode-text-field>

                            <vscode-text-field id="pullMmproj" placeholder="Optional: mmproj file path">
                                Multimodal Projector (mmproj)
                            </vscode-text-field>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 10px;">
                                <vscode-checkbox id="pullVision">Vision</vscode-checkbox>
                                <vscode-checkbox id="pullReasoning">Reasoning</vscode-checkbox>
                                <vscode-checkbox id="pullEmbedding">Embedding</vscode-checkbox>
                                <vscode-checkbox id="pullReranking">Reranking</vscode-checkbox>
                            </div>
                            
                            <div id="pullProgressContainer" style="display: none; margin-bottom: 10px;">
                                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                                    <span id="pullProgressFile">Downloading...</span>
                                    <span id="pullProgressPercent">0%</span>
                                </div>
                                <vscode-progress-indicator id="pullProgressBar" value="0"></vscode-progress-indicator>
                            </div>

                            <vscode-button appearance="primary" id="pullBtn" onclick="pullModel()">Pull Model</vscode-button>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Manage Storage</h3>
                            <vscode-dropdown id="deleteSelect">
                                <vscode-option value="">Fetching models...</vscode-option>
                            </vscode-dropdown>
                            <vscode-button appearance="secondary" style="background: var(--vscode-errorForeground); color: white;" onclick="deleteModel()">
                                Delete Model
                            </vscode-button>
                        </div>
                    </vscode-panel-view>

                    <vscode-panel-view id="view-backends" style="flex-direction: column;">
                        <div class="section">
                            <h3>Manage Recipes</h3>
                            <vscode-text-field id="recipeInput" placeholder="e.g., llamacpp">
                                Recipe Name
                            </vscode-text-field>
                            <vscode-text-field id="backendInput" placeholder="e.g., vulkan">
                                Backend Name
                            </vscode-text-field>
                            <div class="button-group">
                                <vscode-button appearance="primary" onclick="installBackend()">Install</vscode-button>
                                <vscode-button appearance="secondary" onclick="uninstallBackend()">Uninstall</vscode-button>
                            </div>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>Supported Backend Types</h3>
                            <div id="recipeContainer" class="recipe-list">
                                Fetching system data...
                            </div>
                        </div>
                    </vscode-panel-view>

                    <vscode-panel-view id="view-chat" style="flex-direction: column;">
                        <div id="chatContainer">
                            <div id="chatMessages"></div>
                            <div class="scroll-controls">
                                <vscode-button class="scroll-btn" appearance="secondary" onclick="scrollToTop()" title="Scroll to Top">↑</vscode-button>
                                <vscode-button class="scroll-btn" appearance="secondary" onclick="scrollToBottom()" title="Scroll to Bottom">↓</vscode-button>
                            </div>
                            <div class="chat-input-area">
                                <vscode-text-area id="chatInput" placeholder="Ask Lemonade..." rows="4" resize="vertical"></vscode-text-area>
                                <div style="display: flex; flex-direction: column; gap: 5px;">
                                    <vscode-button id="sendChatBtn" appearance="primary" onclick="sendChat()">Send</vscode-button>
                                    <vscode-button appearance="secondary" onclick="clearChat()">Clear</vscode-button>
                                </div>
                            </div>
                        </div>
                    </vscode-panel-view>
                </vscode-panels>

                <script>
                    const vscode = acquireVsCodeApi();
                    let availableServerModels = {};

                    function requestDashboardData() { vscode.postMessage({ type: 'getDashboardData' }); }
                    function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
                    
                    function manageModel(action) {
                        const modelName = document.getElementById('modelSelect').value;
                        const contextSize = document.getElementById('contextSize').value || '4096';
                        const llamacppArgs = document.getElementById('llamacppArgs').value;
                        const llamacppBackend = document.getElementById('llamacppBackend').value;
                        const saveOptions = document.getElementById('saveOptions').checked;
                        if (modelName) vscode.postMessage({ type: 'manageModelLifecycle', action, modelName, contextSize: parseInt(contextSize), llamacppArgs, llamacppBackend, saveOptions });
                    }
                    function pullModel() {
                        const modelName = document.getElementById('pullInput').value;
                        const checkpoint = document.getElementById('pullCheckpoint').value;
                        const recipe = document.getElementById('pullRecipe').value;
                        const mmproj = document.getElementById('pullMmproj').value;
                        const vision = document.getElementById('pullVision').checked;
                        const reasoning = document.getElementById('pullReasoning').checked;
                        const embedding = document.getElementById('pullEmbedding').checked;
                        const reranking = document.getElementById('pullReranking').checked;

                        if (modelName) {
                            vscode.postMessage({
                                type: 'pullModel',
                                modelName,
                                checkpoint,
                                recipe,
                                mmproj,
                                vision,
                                reasoning,
                                embedding,
                                reranking
                            });
                        }
                    }
                    function deleteModel() {
                        const modelName = document.getElementById('deleteSelect').value;
                        if (modelName) vscode.postMessage({ type: 'deleteModel', modelName });
                    }
                    function installBackend() {
                        const recipeName = document.getElementById('recipeInput').value;
                        const backendName = document.getElementById('backendInput').value;
                        if (recipeName && backendName) {
                            vscode.postMessage({ type: 'installBackend', recipeName, backendName });
                        } else {
                            // Show some basic client-side validation if missing
                        }
                    }
                    function uninstallBackend() {
                        const recipeName = document.getElementById('recipeInput').value;
                        const backendName = document.getElementById('backendInput').value;
                        if (recipeName && backendName) {
                            vscode.postMessage({ type: 'uninstallBackend', recipeName, backendName });
                        }
                    }

                    let chatHistory = [];
                    let currentBotMessageElement = null;
                    let isAutoScrollEnabled = true;

                    const chatMessages = document.getElementById('chatMessages');
                    chatMessages.addEventListener('scroll', () => {
                        const { scrollTop, scrollHeight, clientHeight } = chatMessages;
                        // If user scrolls up significantly from bottom, disable auto-scroll
                        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
                        isAutoScrollEnabled = isAtBottom;
                    });

                    function scrollToTop() {
                        chatMessages.scrollTo({ top: 0, behavior: 'smooth' });
                    }

                    function scrollToBottom() {
                        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
                        isAutoScrollEnabled = true;
                    }

                    function copyToClipboard(text, btn) {
                        navigator.clipboard.writeText(text).then(() => {
                            const originalText = btn.innerText;
                            btn.innerText = 'Copied!';
                            setTimeout(() => btn.innerText = originalText, 2000);
                        });
                    }

                    function sendChat() {
                        const input = document.getElementById('chatInput');
                        const text = input.value.trim();
                        if (!text) return;

                        // Add user message to UI
                        appendMessage('user', text);
                        chatHistory.push({ role: 'user', content: text });
                        
                        // Clear the input area immediately
                        input.value = '';

                        // Disable button
                        document.getElementById('sendChatBtn').disabled = true;

                        // Prepare bot message placeholder
                        currentBotMessageElement = appendMessage('bot', '...');
                        currentBotMessageElement.setAttribute('data-raw', '...');

                        const modelSelect = document.getElementById('modelSelect');
                        const selectedModel = modelSelect ? modelSelect.value : "llama3";

                        vscode.postMessage({
                            type: 'chatRequest',
                            messages: chatHistory,
                            model: selectedModel
                        });
                    }

                    document.getElementById('chatInput').addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendChat();
                            // Ensure the input stays cleared and focused after send
                            const input = document.getElementById('chatInput');
                            input.value = '';
                            input.focus();
                        }
                    });

                    function clearChat() {
                        chatHistory = [];
                        document.getElementById('chatMessages').innerHTML = '';
                    }

                    function appendMessage(role, text) {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'message-wrapper ' + (role === 'user' ? 'user' : 'bot');
                        
                        const msgDiv = document.createElement('div');
                        msgDiv.className = 'message ' + (role === 'user' ? 'user-message' : 'bot-message');
                        
                        if (role === 'bot') {
                            msgDiv.innerHTML = marked.parse(text);
                        } else {
                            msgDiv.innerText = text;
                        }
                        
                        wrapper.appendChild(msgDiv);
                        
                        if (role === 'bot') {
                            const copyBtn = document.createElement('button');
                            copyBtn.className = 'copy-btn';
                            copyBtn.innerText = 'Copy';
                            copyBtn.onclick = () => copyToClipboard(text, copyBtn);
                            wrapper.appendChild(copyBtn);
                        }

                        const container = document.getElementById('chatMessages');
                        container.appendChild(wrapper);
                        
                        if (isAutoScrollEnabled) {
                            container.scrollTop = container.scrollHeight;
                        }
                        return msgDiv;
                    }

                    window.addEventListener('message', event => {
                        const msg = event.data;
                        
                        if (msg.type === 'renderDashboard') {
                            document.getElementById('statusDot').className = 'indicator online';
                            document.getElementById('statusText').innerText = 'Connected';

                            // Set default tab on first load
                            if (!window.hasSetDefaultTab && msg.defaultTab) {
                                const panels = document.getElementById('dashboardPanels');
                                if (panels) {
                                    panels.setAttribute('activeid', 'tab-' + msg.defaultTab);
                                }
                                window.hasSetDefaultTab = true;
                            }
                            
                            // Server info
                            document.getElementById('serverVersion').innerText = msg.serverVersion || '-';
                            document.getElementById('wsPort').innerText = msg.websocketPort ? String(msg.websocketPort) : '-';

                            // Active Model Header
                            document.getElementById('activeModelHeader').innerText = msg.loadedModel || 'No Model Active';
                            
                            // Stats
                            const tps = msg.stats?.tokens_per_second || 0;
                            document.getElementById('speedBadge').innerText = tps.toFixed(1) + ' t/s';
                            document.getElementById('ttft').innerText = (msg.stats?.time_to_first_token?.toFixed(2) || 0) + 's';
                            document.getElementById('tps').innerText = tps.toFixed(1);
                            document.getElementById('inputTokens').innerText = String(msg.stats?.input_tokens || 0);
                            document.getElementById('outputTokens').innerText = String(msg.stats?.output_tokens || 0);
                            document.getElementById('promptTokens').innerText = String(msg.stats?.prompt_tokens || 0);
                            
                            const decodeTimes = msg.stats?.decode_token_times;
                            document.getElementById('decodeTimes').innerText = decodeTimes && decodeTimes.length > 0
                                ? decodeTimes.map(t => t.toFixed(3)).join(', ')
                                : '-';

                            // Model limits
                            if (msg.maxModels) {
                                document.getElementById('maxLlm').innerText = msg.maxModels.llm ?? '-';
                                document.getElementById('maxEmbedding').innerText = msg.maxModels.embedding ?? '-';
                                document.getElementById('maxReranking').innerText = msg.maxModels.reranking ?? '-';
                                document.getElementById('maxAudio').innerText = msg.maxModels.audio ?? '-';
                                document.getElementById('maxImage').innerText = msg.maxModels.image ?? '-';
                                document.getElementById('maxTts').innerText = msg.maxModels.tts ?? '-';
                            }

                            // Loaded models
                            if (msg.allModelsLoaded && msg.allModelsLoaded.length > 0) {
                                const loadedHtml = msg.allModelsLoaded.map(m =>
                                    '<div style="margin-bottom: 6px;">' +
                                        '<strong>' + escapeHtml(m.model_name) + '</strong> (' + (m.type || '') + ')<br>' +
                                        '<span style="opacity: 0.7;">Device: ' + (m.device || 'N/A') + ' | Recipe: ' + (m.recipe || 'N/A') + '</span>' +
                                    '</div>'
                                ).join('');
                                document.getElementById('loadedModelsList').innerHTML = loadedHtml;
                            } else {
                                document.getElementById('loadedModelsList').innerText = 'No models loaded';
                            }

                            const modelOptions = msg.models.map(m => '<vscode-option value="' + escapeHtml(String(m.id)) + '">' + escapeHtml(String(m.id)) + '</vscode-option>').join('') || '<vscode-option value="">No models found</vscode-option>';
                            document.getElementById('modelSelect').innerHTML = modelOptions;
                            document.getElementById('deleteSelect').innerHTML = modelOptions;

                            // Store model data for populating saved options on selection
                            window.modelDataMap = {};
                            msg.models.forEach(m => {
                                if (m.recipe_options) {
                                    window.modelDataMap[m.id] = m.recipe_options;
                                }
                            });

                            // Update saved model options when model is selected
                            const modelSelect = document.getElementById('modelSelect');
                            modelSelect.addEventListener('change', (e) => {
                                const selectedModelId = e.target.value;
                                const contextSizeField = document.getElementById('contextSize');
                                const llamacppArgsField = document.getElementById('llamacppArgs');
                                const llamacppBackendField = document.getElementById('llamacppBackend');
                                
                                if (selectedModelId && window.modelDataMap[selectedModelId]) {
                                    const options = window.modelDataMap[selectedModelId];
                                    
                                    // Populate text fields with saved values
                                    if (options.ctx_size) {
                                        contextSizeField.value = String(options.ctx_size);
                                    } else {
                                        contextSizeField.value = '';
                                    }
                                    if (options.llamacpp_args) {
                                        llamacppArgsField.value = options.llamacpp_args;
                                    } else {
                                        llamacppArgsField.value = '';
                                    }
                                    if (options.llamacpp_backend) {
                                        llamacppBackendField.value = options.llamacpp_backend;
                                    } else {
                                        llamacppBackendField.value = '';
                                    }
                                } else {
                                    contextSizeField.value = '';
                                    llamacppArgsField.value = '';
                                    llamacppBackendField.value = '';
                                }
                            });

                            if (msg.sysInfo) {
                                document.getElementById('cpuText').innerText = msg.sysInfo['Processor'] || 'Unknown CPU';
                                document.getElementById('ramText').innerText = msg.sysInfo['Physical Memory'] || 'Unknown';
                                document.getElementById('osVersion').innerText = msg.sysInfo['OS Version'] || '-';
                                document.getElementById('oemSystem').innerText = msg.sysInfo['OEM System'] || '-';
                                document.getElementById('biosVersion').innerText = msg.sysInfo['BIOS Version'] || '-';
                                document.getElementById('cpuMaxClock').innerText = msg.sysInfo['CPU Max Clock'] || '-';
                                document.getElementById('powerSetting').innerText = msg.sysInfo['Windows Power Setting'] || '-';
                                
                                const hasNPU = msg.sysInfo.devices?.amd_npu?.available;
                                document.getElementById('npuText').innerText = hasNPU ? 'Yes (AMD XDNA)' : 'None';

                                if (msg.sysInfo.recipes) {
                                    const recipeNames = Object.keys(msg.sysInfo.recipes);
                                    document.getElementById('recipeContainer').innerHTML = recipeNames.length > 0
                                        ? recipeNames.map(r => '<span class="recipe-item">' + escapeHtml(r) + '</span>').join('')
                                        : 'No recipe data found.';
                                }
                            }

                            // Health JSON
                            if (msg.healthData) {
                                document.getElementById('healthJson').innerText = JSON.stringify(msg.healthData, null, 2);
                            }
                        } else if (msg.type === 'serverOffline') {
                            document.getElementById('statusDot').className = 'indicator offline';
                            document.getElementById('statusText').innerHTML = 'Disconnected (<a href="#" style="color: var(--vscode-textLink-foreground);" onclick="openSettings()">Configure</a>)';
                            
                            // Reset all fields
                            document.getElementById('serverVersion').innerText = '-';
                            document.getElementById('wsPort').innerText = '-';
                            document.getElementById('activeModelHeader').innerText = 'Offline';
                            document.getElementById('speedBadge').innerText = '0 t/s';
                            document.getElementById('ttft').innerText = '0s';
                            document.getElementById('tps').innerText = '0';
                            document.getElementById('inputTokens').innerText = '0';
                            document.getElementById('outputTokens').innerText = '0';
                            document.getElementById('promptTokens').innerText = '0';
                            document.getElementById('decodeTimes').innerText = '-';
                            document.getElementById('maxLlm').innerText = '-';
                            document.getElementById('maxEmbedding').innerText = '-';
                            document.getElementById('maxReranking').innerText = '-';
                            document.getElementById('maxAudio').innerText = '-';
                            document.getElementById('maxImage').innerText = '-';
                            document.getElementById('maxTts').innerText = '-';
                            document.getElementById('loadedModelsList').innerText = 'No models loaded';
                            document.getElementById('savedModelOptions').innerText = 'No saved options';
                            document.getElementById('cpuText').innerText = '-';
                            document.getElementById('ramText').innerText = '-';
                            document.getElementById('osVersion').innerText = '-';
                            document.getElementById('oemSystem').innerText = '-';
                            document.getElementById('biosVersion').innerText = '-';
                            document.getElementById('cpuMaxClock').innerText = '-';
                            document.getElementById('powerSetting').innerText = '-';
                            document.getElementById('npuText').innerText = '-';
                            
                            document.getElementById('modelSelect').innerHTML = '<vscode-option value="">Fetching...</vscode-option>';
                            document.getElementById('deleteSelect').innerHTML = '<vscode-option value="">Fetching...</vscode-option>';
                            document.getElementById('recipeContainer').innerHTML = 'Offline';
                            
                            document.getElementById('healthJson').innerText = JSON.stringify(msg.healthData || {}, null, 2);
                        } else if (msg.type === 'pullProgress') {
                            const container = document.getElementById('pullProgressContainer');
                            const fileEl = document.getElementById('pullProgressFile');
                            const percentEl = document.getElementById('pullProgressPercent');
                            const bar = document.getElementById('pullProgressBar');
                            const pullBtn = document.getElementById('pullBtn');

                            if (container) container.style.display = 'block';
                            if (pullBtn) pullBtn.disabled = true;

                            if (msg.status === 'downloading') {
                                if (fileEl) fileEl.innerText = 'Downloading: ' + (msg.file || 'model files...');
                                if (percentEl) percentEl.innerText = msg.percent + '%';
                                if (bar) bar.setAttribute('value', msg.percent);
                            } else if (msg.status === 'complete') {
                                if (fileEl) fileEl.innerText = 'Download Complete!';
                                if (percentEl) percentEl.innerText = '100%';
                                if (bar) bar.setAttribute('value', 100);
                                setTimeout(() => {
                                    if (container) container.style.display = 'none';
                                    if (pullBtn) pullBtn.disabled = false;
                                }, 3000);
                            } else if (msg.status === 'error') {
                                if (fileEl) fileEl.innerText = 'Error: ' + msg.message;
                                if (percentEl) percentEl.innerText = '';
                                if (pullBtn) pullBtn.disabled = false;
                            }
                        } else if (msg.type === 'chatResponseChunk') {
                            if (currentBotMessageElement) {
                                if (currentBotMessageElement.getAttribute('data-raw') === '...') {
                                    currentBotMessageElement.setAttribute('data-raw', '');
                                }
                                const newRaw = (currentBotMessageElement.getAttribute('data-raw') || '') + msg.content;
                                currentBotMessageElement.setAttribute('data-raw', newRaw);
                                currentBotMessageElement.innerHTML = marked.parse(newRaw);
                                
                                // Update copy button text if it exists in the wrapper
                                const wrapper = currentBotMessageElement.parentElement;
                                const copyBtn = wrapper.querySelector('.copy-btn');
                                if (copyBtn) {
                                    copyBtn.onclick = () => copyToClipboard(newRaw, copyBtn);
                                }

                                if (isAutoScrollEnabled) {
                                    const container = document.getElementById('chatMessages');
                                    container.scrollTop = container.scrollHeight;
                                }
                            }
                        } else if (msg.type === 'chatResponseDone') {
                            if (currentBotMessageElement) {
                                const finalRaw = currentBotMessageElement.getAttribute('data-raw') || '';
                                chatHistory.push({ role: 'assistant', content: finalRaw });
                            }
                            document.getElementById('sendChatBtn').disabled = false;
                            currentBotMessageElement = null;
                        } else if (msg.type === 'chatError') {
                            if (currentBotMessageElement) {
                                currentBotMessageElement.innerText = 'Error: ' + msg.error;
                            }
                            document.getElementById('sendChatBtn').disabled = false;
                            currentBotMessageElement = null;
                        } else if (msg.type === 'updateVersionCheck') {
                            const current = document.getElementById('serverVersion').innerText;
                            const latest = msg.latestVersion;
                            const statusEl = document.getElementById('versionStatus');
                            
                            if (current && latest && current !== '-') {
                                const cleanCurrent = current.replace(/^v/, '');
                                const cleanLatest = latest.replace(/^v/, '');
                                
                                if (cleanCurrent === cleanLatest) {
                                    statusEl.innerText = 'Up to date';
                                    statusEl.style.color = 'var(--vscode-testing-iconPassed)';
                                } else {
                                    statusEl.innerHTML = 'Update available: <a href="https://github.com/lemonade-sdk/lemonade/releases/latest" style="color: var(--vscode-textLink-foreground);">' + latest + '</a>';
                                    statusEl.style.color = 'var(--vscode-testing-iconFailed)';
                                }
                            }
                        } else if (msg.type === 'serverModelsLoaded') {
                            availableServerModels = msg.models;
                            const select = document.getElementById('serverModelSelect');
                            if (select) {
                                const options = Object.keys(availableServerModels).map(name =>
                                    '<vscode-option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</vscode-option>'
                                ).join('');
                                select.innerHTML = '<vscode-option value="">Select a pre-configured model...</vscode-option>' + options;
                                
                                select.addEventListener('change', (e) => {
                                    const selectedName = e.target.value;
                                    if (selectedName && availableServerModels[selectedName]) {
                                        const model = availableServerModels[selectedName];
                                        document.getElementById('pullInput').value = selectedName;
                                        
                                        // Handle single checkpoint string or checkpoints object
                                        if (typeof model.checkpoint === 'string') {
                                            document.getElementById('pullCheckpoint').value = model.checkpoint;
                                        } else if (model.checkpoints && model.checkpoints.main) {
                                            document.getElementById('pullCheckpoint').value = model.checkpoints.main;
                                        } else {
                                            document.getElementById('pullCheckpoint').value = '';
                                        }

                                        document.getElementById('pullRecipe').value = model.recipe || '';
                                        
                                        // Reset checkboxes
                                        document.getElementById('pullVision').checked = false;
                                        document.getElementById('pullReasoning').checked = false;
                                        document.getElementById('pullEmbedding').checked = false;
                                        document.getElementById('pullReranking').checked = false;

                                        // Set labels
                                        if (model.labels) {
                                            if (model.labels.includes('vision')) document.getElementById('pullVision').checked = true;
                                            if (model.labels.includes('reasoning')) document.getElementById('pullReasoning').checked = true;
                                            if (model.labels.includes('embeddings')) document.getElementById('pullEmbedding').checked = true;
                                            if (model.labels.includes('reranking')) document.getElementById('pullReranking').checked = true;
                                        }
                                    }
                                });
                            }
                        }
                    });
                    
                    function getLogLevelColor(level) {
                        const l = (level || '').toUpperCase();
                        if (l.includes('ERR') || l === 'FATAL') return 'var(--vscode-errorForeground)';
                        if (l.includes('WARN')) return 'var(--vscode-editorWarning-foreground)';
                        if (l.includes('INFO')) return '#3b82f6';
                        if (l.includes('DEBUG')) return 'var(--vscode-descriptionForeground)';
                        return 'var(--vscode-badge-background)';
                    }
                    
                    function escapeHtml(text) {
                        const div = document.createElement('div');
                        div.textContent = text;
                        return div.innerHTML;
                    }
                    
                    requestDashboardData();
                    setInterval(requestDashboardData, 3000);
                </script>
            </body>
            </html>
        `;
    }
}