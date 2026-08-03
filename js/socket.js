class WebSocketManager {
    constructor(host) {
        this.host = (host && host !== 'localhost' && host.length > 0)
            ? host
            : '127.0.0.1:24050';
        this.sockets = {};
    }

    createConnection(url, callback, filters) {
        let retryTimer = null;
        const counterPath = window.COUNTER_PATH ? encodeURI(window.COUNTER_PATH) : '';
        const ws = new WebSocket(`ws://${this.host}${url}?l=${counterPath}`);
        this.sockets[url] = ws;

        ws.onopen = () => {
            console.log(`[OPEN] ${url}: Connected`);
            if (retryTimer) clearTimeout(retryTimer);
            if (Array.isArray(filters)) {
                ws.send(`applyFilters:${JSON.stringify(filters)}`);
            }
        };

        ws.onclose = (event) => {
            console.log(`[CLOSED] ${url}: ${event.reason}`);
            delete this.sockets[url];
            retryTimer = setTimeout(() => {
                this.createConnection(url, callback, filters);
            }, 1000);
        };

        ws.onerror = () => {
            console.log(`[ERROR] ${url}`);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.error != null) {
                    console.error(`[MESSAGE_ERROR] ${url}:`, data.error);
                    return;
                }
                if (data.message?.error != null) {
                    console.error(`[MESSAGE_ERROR] ${url}:`, data.message.error);
                    return;
                }
                callback(data);
            } catch (error) {
                console.log(`[MESSAGE_ERROR] ${url}: Couldn't parse`, error);
            }
        };
    }

    api_v2(callback, filters) {
        this.createConnection('/websocket/v2', callback, filters);
    }

    api_v2_precise(callback, filters) {
        this.createConnection('/websocket/v2/precise', callback, filters);
    }

    commands(callback) {
        this.createConnection('/websocket/commands', callback);
    }

    sendCommand(name, command, retries = 1) {
        const ws = this.sockets['/websocket/commands'];
        if (!ws) {
            if (retries <= 5) {
                setTimeout(() => this.sendCommand(name, command, retries + 1), 200);
            }
            return;
        }
        try {
            const payload = typeof command === 'object' ? JSON.stringify(command) : command;
            ws.send(`${name}:${payload}`);
        } catch (error) {
            if (retries <= 3) {
                console.log(`[COMMAND_ERROR] Retry ${retries}`, error);
                setTimeout(() => this.sendCommand(name, command, retries + 1), 1000);
                return;
            }
            console.error(`[COMMAND_ERROR]`, error);
        }
    }

    async calculate_pp(params) {
        try {
            if (typeof params !== 'object') {
                return { error: 'Wrong argument type, should be object with params' };
            }
            const url = new URL(`http://${this.host}/api/calculate/pp`);
            Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
            const request = await fetch(url, { method: 'GET' });
            return await request.json();
        } catch (error) {
            console.error(error);
            return { error: error.message };
        }
    }

    async getBeatmapOsuFile(file_path) {
        try {
            const encoded = file_path.split('/').map(encodeURIComponent).join('/');
            const request = await fetch(`http://${this.host}/files/beatmap/${encoded}`, { method: 'GET' });
            return await request.text();
        } catch (error) {
            console.error(error);
            return { error: error.message };
        }
    }

    close(url) {
        if (url) {
            this.sockets[url]?.close();
            return;
        }
        Object.values(this.sockets).forEach(ws => ws?.close());
    }
}

export default WebSocketManager;
