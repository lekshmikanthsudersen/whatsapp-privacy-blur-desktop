const diagnosticsElement = document.getElementById('diagnostics');
const exportButton = document.getElementById('export');
const supportExportButton = document.getElementById('support-export');
const statusElement = document.getElementById('status');

async function refreshDiagnostics() {
  const diagnostics = await window.privacySettings.getDiagnostics();
  diagnosticsElement.textContent = JSON.stringify(diagnostics, null, 2);
}

exportButton.addEventListener('click', async () => {
  const result = await window.privacySettings.exportDiagnostics();
  statusElement.textContent = result.canceled ? 'Export cancelled.' : `Exported to ${result.filePath}`;
});

supportExportButton.addEventListener('click', async () => {
  const result = await window.privacySettings.exportSupportBundle();
  statusElement.textContent = result.canceled ? 'Support bundle cancelled.' : `Support bundle exported to ${result.filePath}`;
});

refreshDiagnostics();
window.setInterval(refreshDiagnostics, 5000);
