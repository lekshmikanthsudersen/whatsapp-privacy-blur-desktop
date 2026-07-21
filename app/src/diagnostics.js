const diagnosticsElement = document.getElementById('diagnostics');
const refreshButton = document.getElementById('refresh');
const exportButton = document.getElementById('export');
const supportExportButton = document.getElementById('support-export');
const statusElement = document.getElementById('status');

function diagnosticsBridge() {
  const bridge = window.privacySettings;
  if (!bridge || typeof bridge.getDiagnostics !== 'function') {
    throw new Error('The diagnostics bridge is unavailable. Close this window and reopen Tools > Diagnostics.');
  }
  return bridge;
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message.slice(0, 240) : 'Diagnostics could not be loaded.';
}

function showError(error) {
  const message = errorMessage(error);
  diagnosticsElement.textContent = `Diagnostics unavailable\n\n${message}\n\nTry Refresh. If the problem remains, close this window and reopen Tools > Diagnostics.`;
  statusElement.textContent = 'No WhatsApp content was loaded into this report.';
}

async function refreshDiagnostics() {
  try {
    refreshButton.disabled = true;
    const diagnostics = await diagnosticsBridge().getDiagnostics();
    diagnosticsElement.textContent = JSON.stringify(diagnostics, null, 2);
    statusElement.textContent = 'Live, redacted health summary. No WhatsApp content is included.';
  } catch (error) {
    showError(error);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', refreshDiagnostics);

exportButton.addEventListener('click', async () => {
  try {
    const result = await diagnosticsBridge().exportDiagnostics();
    statusElement.textContent = result.canceled ? 'Export cancelled.' : 'Safe report exported.';
  } catch (error) {
    showError(error);
  }
});

supportExportButton.addEventListener('click', async () => {
  try {
    const result = await diagnosticsBridge().exportSupportBundle();
    statusElement.textContent = result.canceled ? 'Support bundle cancelled.' : 'Support bundle exported.';
  } catch (error) {
    showError(error);
  }
});

window.addEventListener('error', (event) => showError(event.error));
window.addEventListener('unhandledrejection', (event) => showError(event.reason));

refreshDiagnostics();
window.setInterval(refreshDiagnostics, 5000);
