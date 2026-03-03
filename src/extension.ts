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

    return { rawUrl, apiUrl, headers };
}

class LemonadeDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'lemonadeDashboard';
    private _view?: vscode.WebviewView;

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
            const { rawUrl, apiUrl, headers } = getLemonadeConfig();
            
            switch (data.type) {
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'lemonade');
                    break;

                case 'getLogs':
                    try {
                        const res = await fetch(`${rawUrl}/logs`, { headers });
                        if (!res.ok) throw new Error("Failed to fetch logs");
                        const logsData = await res.json();
                        webviewView.webview.postMessage({
                            type: 'renderLogs',
                            logs: logsData.logs || logsData || []
                        });
                    } catch (e) {
                        webviewView.webview.postMessage({ type: 'logsError', error: e.message });
                    }
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
                        
                        let statsData: any = {};
                        if (statsRes.ok) {
                            statsData = (await statsRes.json()) as any;
                        }

                        webviewView.webview.postMessage({
                            type: 'renderDashboard',
                            sysInfo: sysInfo,
                            models: modelsData.data || [],
                            loadedModel: healthData.model_loaded || null,
                            healthStatus: healthData.status || 'unknown',
                            serverVersion: healthData.version || null,
                            websocketPort: healthData.websocket_port || null,
                            allModelsLoaded: healthData.all_models_loaded || [],
                            maxModels: healthData.max_models || {},
                            stats: statsData
                        });
                    } catch (e) {
                        updateStatusBar(false);
                        webviewView.webview.postMessage({ type: 'serverOffline' });
                    }
                    break;

                case 'manageModelLifecycle':
                    try {
                        const endpoint = data.action === 'load' ? '/load' : '/unload';
                        const res = await fetch(`${apiUrl}${endpoint}`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model_name: data.modelName })
                        });
                        if (!res.ok) throw new Error("Action failed");
                        vscode.window.showInformationMessage(`Successfully ${data.action}ed ${data.modelName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to ${data.action} model ${data.modelName}.`);
                    }
                    break;

                case 'pullModel':
                    vscode.window.showInformationMessage(`Pulling model: ${data.modelName}...`);
                    try {
                        const res = await fetch(`${apiUrl}/pull?stream=true`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ model_name: data.modelName })
                        });
                        if (!res.ok || !res.body) throw new Error("Pull failed");
                
                        const reader = res.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                
                            const events = buffer.split('\\n\\n');
                            buffer = events.pop() || '';
                
                            for (const evt of events) {
                                if (evt.includes('event: progress')) {
                                    const dataLine = evt.split('\\n').find(l => l.startsWith('data:'));
                                    if (dataLine) {
                                        const payload = JSON.parse(dataLine.replace('data:', '').trim());
                                        webviewView.webview.postMessage({
                                            type: 'pullProgress',
                                            model: data.modelName,
                                            percent: payload.percent
                                        });
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
                            body: JSON.stringify({ recipe: data.recipeName })
                        });
                        if (!res.ok) throw new Error("Install failed");
                        vscode.window.showInformationMessage(`Successfully installed ${data.recipeName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to install ${data.recipeName}`);
                    }
                    break;

                case 'uninstallBackend':
                    try {
                        const res = await fetch(`${apiUrl}/uninstall`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ recipe: data.recipeName })
                        });
                        if (!res.ok) throw new Error("Uninstall failed");
                        vscode.window.showInformationMessage(`Uninstalled ${data.recipeName}`);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to uninstall ${data.recipeName}`);
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
                <style>
                    body { padding: 0 10px; display: flex; flex-direction: column; gap: 20px; }
                    .header-status { display: flex; justify-content: space-between; align-items: center; margin-top: 15px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-panel-border); }
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
                    .button-group { display: flex; gap: 10px; }
                    .recipe-list { font-size: 12px; margin-top: 10px; line-height: 1.6; }
                    .recipe-item { display: inline-block; padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; margin: 2px; }
                </style>
            </head>
            <body>
                <div class="header-status">
                    <div class="status-badge">
                        <div id="statusDot" class="indicator offline"></div>
                        <span id="statusText">Disconnected</span>
                    </div>
                    <vscode-badge id="speedBadge">0 t/s</vscode-badge>
                </div>

                <vscode-panels>
                    <vscode-panel-tab id="tab-1">Main</vscode-panel-tab>
                    <vscode-panel-tab id="tab-2">System</vscode-panel-tab>
                    <vscode-panel-tab id="tab-3">Library</vscode-panel-tab>
                    <vscode-panel-tab id="tab-4">Backends</vscode-panel-tab>

                    <!-- Main Tab: Loaded Models and Last Request Stats -->
                    <vscode-panel-view id="view-1" style="flex-direction: column;">
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

                        <div class="section">
                            <h3>Loaded Models</h3>
                            <div id="loadedModelsList" style="font-size: 12px; margin-bottom: 10px; color: var(--vscode-descriptionForeground);">No models loaded</div>
                            <vscode-dropdown id="modelSelect">
                                <vscode-option value="">Fetching models...</vscode-option>
                            </vscode-dropdown>
                            <div class="button-group">
                                <vscode-button appearance="primary" onclick="manageModel('load')">Load to VRAM</vscode-button>
                                <vscode-button appearance="secondary" onclick="manageModel('unload')">Unload</vscode-button>
                            </div>
                        </div>

                        <vscode-divider></vscode-divider>

                        <div class="section">
                            <h3>System Logs</h3>
                            <div id="logsContainer" style="font-size: 11px; font-family: var(--vscode-editor-font-family); background: var(--vscode-input-background); padding: 8px; border-radius: 3px; max-height: 150px; overflow-y: auto; color: var(--vscode-editor-foreground);"></div>
                            <vscode-button appearance="secondary" onclick="refreshLogs()">Refresh Logs</vscode-button>
                        </div>
                    </vscode-panel-view>

                    <!-- System Tab: Server Info, Hardware Specs, Model Limits -->
                    <vscode-panel-view id="view-2" style="flex-direction: column;">
                        <div class="section">
                            <h3>Server Info</h3>
                            <div class="metric"><span class="metric-label">Version</span><span id="serverVersion" class="metric-value">-</span></div>
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

                    <vscode-panel-view id="view-3" style="flex-direction: column;">
                        <div class="section">
                            <h3>Pull New Model</h3>
                            <vscode-text-field id="pullInput" placeholder="e.g., Qwen/Qwen2.5-Coder-7B-Instruct-GGUF">
                                HuggingFace Repo ID
                            </vscode-text-field>
                            <vscode-button appearance="primary" onclick="pullModel()">Download Model</vscode-button>
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

                    <vscode-panel-view id="view-4" style="flex-direction: column;">
                        <div class="section">
                            <h3>Manage Recipes</h3>
                            <vscode-text-field id="recipeInput" placeholder="e.g., llamacpp:vulkan">
                                Recipe Name
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
                </vscode-panels>

                <script>
                    const vscode = acquireVsCodeApi();

                    function requestDashboardData() { vscode.postMessage({ type: 'getDashboardData' }); }
                    function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
                    function refreshLogs() { vscode.postMessage({ type: 'getLogs' }); }
                    
                    function manageModel(action) {
                        const modelName = document.getElementById('modelSelect').value;
                        if (modelName) vscode.postMessage({ type: 'manageModelLifecycle', action, modelName });
                    }
                    function pullModel() {
                        const modelName = document.getElementById('pullInput').value;
                        if (modelName) vscode.postMessage({ type: 'pullModel', modelName });
                    }
                    function deleteModel() {
                        const modelName = document.getElementById('deleteSelect').value;
                        if (modelName) vscode.postMessage({ type: 'deleteModel', modelName });
                    }
                    function installBackend() {
                        const recipeName = document.getElementById('recipeInput').value;
                        if (recipeName) vscode.postMessage({ type: 'installBackend', recipeName });
                    }
                    function uninstallBackend() {
                        const recipeName = document.getElementById('recipeInput').value;
                        if (recipeName) vscode.postMessage({ type: 'uninstallBackend', recipeName });
                    }

                    window.addEventListener('message', event => {
                        const msg = event.data;
                        
                        if (msg.type === 'renderDashboard') {
                            document.getElementById('statusDot').className = 'indicator online';
                            document.getElementById('statusText').innerText = 'Connected';
                            
                            // Server info
                            document.getElementById('serverVersion').innerText = msg.serverVersion || '-';
                            document.getElementById('wsPort').innerText = msg.websocketPort ? \`\${msg.websocketPort}\` : '-';
                            
                            // Stats
                            const tps = msg.stats?.tokens_per_second || 0;
                            document.getElementById('speedBadge').innerText = \`\${tps.toFixed(1)} t/s\`;
                            document.getElementById('ttft').innerText = \`\${msg.stats?.time_to_first_token?.toFixed(2) || 0}s\`;
                            document.getElementById('tps').innerText = \`\${tps.toFixed(1)}\`;
                            document.getElementById('inputTokens').innerText = \`\${msg.stats?.input_tokens || 0}\`;
                            document.getElementById('outputTokens').innerText = \`\${msg.stats?.output_tokens || 0}\`;
                            document.getElementById('promptTokens').innerText = \`\${msg.stats?.prompt_tokens || 0}\`;
                            
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
                                    \`<div style="margin-bottom: 6px;">
                                        <strong>\${m.model_name}</strong> (\${m.type})<br>
                                        <span style="opacity: 0.7;">Device: \${m.device || 'N/A'} | Recipe: \${m.recipe || 'N/A'}</span>
                                    </div>\`
                                ).join('');
                                document.getElementById('loadedModelsList').innerHTML = loadedHtml;
                            } else {
                                document.getElementById('loadedModelsList').innerText = 'No models loaded';
                            }

                            const modelOptions = msg.models.map(m => \`<vscode-option value="\${m.id}">\${m.id}</vscode-option>\`).join('') || '<vscode-option value="">No models found</vscode-option>';
                            document.getElementById('modelSelect').innerHTML = modelOptions;
                            document.getElementById('deleteSelect').innerHTML = modelOptions;

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
                                        ? recipeNames.map(r => \`<span class="recipe-item">\${r}</span>\`).join('')
                                        : 'No recipe data found.';
                                }
                            }
                        } else if (msg.type === 'serverOffline') {
                            document.getElementById('statusDot').className = 'indicator offline';
                            document.getElementById('statusText').innerHTML = 'Disconnected (<a href="#" style="color: var(--vscode-textLink-foreground);" onclick="openSettings()">Configure</a>)';
                            
                            // Reset all fields
                            document.getElementById('serverVersion').innerText = '-';
                            document.getElementById('wsPort').innerText = '-';
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
                            
                            document.getElementById('logsContainer').innerHTML = '<span style="opacity: 0.5;">Logs unavailable</span>';
                        } else if (msg.type === 'renderLogs') {
                            const logs = msg.logs;
                            if (logs && logs.length > 0) {
                                const logsHtml = logs.map(log => {
                                    const timestamp = log.timestamp || log.ts || log.time || new Date().toISOString();
                                    const level = log.level || log.log_level || 'INFO';
                                    const message = log.message || log.msg || log.text || '';
                                    return `<div style="margin-bottom: 4px; padding: 2px 4px; border-bottom: 1px solid var(--vscode-widget-border);">
                                        <span style="opacity: 0.6; font-size: 10px;">${timestamp}</span>
                                        <span style="display: inline-block; width: 40px; margin-left: 4px; padding: 1px 3px; border-radius: 2px; font-size: 9px; background: ${getLogLevelColor(level)}; color: white;">${level}</span>
                                        <span style="margin-left: 6px;">${escapeHtml(message)}</span>
                                    </div>`;
                                }).join('');
                                document.getElementById('logsContainer').innerHTML = logsHtml;
                            } else {
                                document.getElementById('logsContainer').innerHTML = '<span style="opacity: 0.5;">No logs available</span>';
                            }
                        } else if (msg.type === 'logsError') {
                            document.getElementById('logsContainer').innerHTML = `<span style="color: var(--vscode-errorForeground);">Error: ${escapeHtml(msg.error)}</span>`;
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
                    setInterval(refreshLogs, 5000);
                </script>
            </body>
            </html>
        `;
    }
}