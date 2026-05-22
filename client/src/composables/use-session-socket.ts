import { ref, watch, type Ref } from 'vue';
import { connectWS } from '../services/ws';

interface SessionSocketOptions {
  sessionId: Ref<string>;
  isAuthed: Ref<boolean>;
}

export function useSessionSocket({ sessionId, isAuthed }: SessionSocketOptions) {
  const status = ref('');
  let wsConn: ReturnType<typeof connectWS> | null = null;

  function closeSocket() {
    if (wsConn) {
      wsConn.close();
      wsConn = null;
    }
    status.value = '';
  }

  function connectSocket() {
    if (!sessionId.value || !isAuthed.value) return;
    closeSocket();
    status.value = 'connecting...';
    wsConn = connectWS({ sessionId: sessionId.value });
    wsConn.on('open', () => {
      wsConn?.send({ type: 'request_state' });
    });
    wsConn.on('welcome', (msg: { role?: string }) => {
      status.value = `ws: ${msg.role || ''}`;
    });
    wsConn.on('map_updated', () => {
      status.value = 'map updated (ws)';
      setTimeout(() => { status.value = ''; }, 1500);
    });
    wsConn.on('pong', () => {
      status.value = 'ws pong';
    });
  }

  watch(sessionId, connectSocket);
  watch(isAuthed, (val) => {
    if (val && sessionId.value) connectSocket();
    if (!val) closeSocket();
  });

  return {
    status,
    connectSocket,
    closeSocket
  };
}
