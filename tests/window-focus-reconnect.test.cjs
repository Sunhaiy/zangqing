const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { act } = TestRenderer;

test('focusing the window reconnects the active session after a background disconnect', async () => {
  let focused = true;
  let reconnectCalls = 0;
  let statusListener;

  const fakeWindow = new EventTarget();
  fakeWindow.setTimeout = setTimeout;
  fakeWindow.clearTimeout = clearTimeout;
  fakeWindow.electron = {
    connectSSH: async () => ({ success: true }),
    sshReconnect: async () => {
      reconnectCalls += 1;
      return { success: true };
    },
    disconnectSSH: async () => undefined,
    onSSHStatus: (listener) => {
      statusListener = listener;
      return () => { statusListener = undefined; };
    },
    storeGet: async () => false,
    storeSet: async () => undefined,
    usageRecord: () => undefined,
  };

  global.window = fakeWindow;
  global.document = { hasFocus: () => focused };

  const { createServer } = await import('vite');
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  let renderer;
  let flushUsage;

  try {
    const { useSessions } = await vite.ssrLoadModule('/src/hooks/useSessions.ts');
    ({ flushUsage } = await vite.ssrLoadModule('/src/lib/usageTracker.ts'));
    let sessionApi;

    function Harness() {
      sessionApi = useSessions({
        openWorkspace: () => undefined,
        leaveWorkspace: () => undefined,
        onConnected: () => undefined,
      });
      return null;
    }

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness));
    });

    await act(async () => {
      await sessionApi.connect({
        id: 'server-1',
        name: 'Focus test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
      });
    });
    assert.equal(sessionApi.sessions[0].status, 'connected');

    focused = false;
    fakeWindow.dispatchEvent(new Event('blur'));
    await act(async () => {
      statusListener(undefined, { id: sessionApi.activeSessionId, status: 'disconnected' });
    });
    assert.equal(sessionApi.sessions[0].status, 'disconnected');
    assert.equal(reconnectCalls, 0, 'a background disconnect should wait until the user returns');

    focused = true;
    await act(async () => {
      fakeWindow.dispatchEvent(new Event('focus'));
      fakeWindow.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    assert.equal(reconnectCalls, 1);
    assert.equal(sessionApi.sessions[0].status, 'connected');

    // The IPC disconnect can be delivered just after the focus event. It must not miss
    // the recovery window merely because the session still looked connected at focus.
    focused = false;
    fakeWindow.dispatchEvent(new Event('blur'));
    focused = true;
    fakeWindow.dispatchEvent(new Event('focus'));
    await act(async () => {
      statusListener(undefined, { id: sessionApi.activeSessionId, status: 'disconnected' });
      await Promise.resolve();
    });

    assert.equal(reconnectCalls, 2);
    assert.equal(sessionApi.sessions[0].status, 'connected');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    flushUsage?.();
    await vite.close();
    delete global.window;
    delete global.document;
  }
});
