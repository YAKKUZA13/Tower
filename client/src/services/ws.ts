const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:3000/ws';

type Handler = (payload: Record<string, unknown>) => void;

function makeEmitter() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    on(type: string, cb: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)?.add(cb);
    },
    off(type: string, cb: Handler) {
      handlers.get(type)?.delete(cb);
    },
    emit(type: string, payload: Record<string, unknown>) {
      handlers.get(type)?.forEach((cb) => cb(payload));
    }
  };
}

export function connectWS({ sessionId }: { sessionId: string }) {
  const token = encodeURIComponent(localStorage.getItem('authToken') || '');
  const sid = encodeURIComponent(sessionId || '');
  const url = `${WS_BASE}?${token ? `token=${token}` : ''}${sid ? `&sessionId=${sid}` : ''}`;
  const emitter = makeEmitter();
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => emitter.emit('open', {}));
  socket.addEventListener('message', (event) => {
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof data.type === 'string') emitter.emit(data.type, data);
  });

  return {
    on: emitter.on,
    off: emitter.off,
    send(obj: Record<string, unknown>) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
      }
    },
    close() {
      socket.close();
    }
  };
}
