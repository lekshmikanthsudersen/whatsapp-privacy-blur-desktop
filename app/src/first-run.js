const statusElement = document.getElementById('status');

async function completePreset(presetName) {
  statusElement.textContent = 'Saving settings...';
  await window.privacySettings.completeFirstRun(presetName);
}

for (const button of document.querySelectorAll('[data-preset]')) {
  button.addEventListener('click', () => {
    completePreset(button.dataset.preset);
  });
}
