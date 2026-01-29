const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:3000/ws';

function makeEmitter() {
  const handlers = new Map();
  return {
    on(type, cb) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(cb);
    },
    off(type, cb) {
      handlers.get(type)?.delete(cb);
    },
    emit(type, payload) {
      handlers.get(type)?.forEach((cb) => cb(payload));
    }
  };
}

export function connectWS({ sessionId }) {
  const username = encodeURIComponent(localStorage.getItem('username') || '');
  const token = encodeURIComponent(localStorage.getItem('authToken') || localStorage.getItem('apiKey') || '');
  const sid = encodeURIComponent(sessionId || '');
  const url = `${WS_BASE}?username=${username}${token ? `&token=${token}` : ''}${sid ? `&sessionId=${sid}` : ''}`;
  const emitter = makeEmitter();
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => emitter.emit('open', {}));
  socket.addEventListener('message', (event) => {
    let data = null;
    try { data = JSON.parse(event.data); } catch { return; }
    emitter.emit(data.type, data);
  });

  return {
    on: emitter.on,
    off: emitter.off,
    send(obj) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    },
    close() {
      socket.close();
    }
  };
}

