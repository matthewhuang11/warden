(function () {
  'use strict';

  const patternList = document.getElementById('pattern-list');
  const emptyState = document.getElementById('empty-state');
  const addForm = document.getElementById('add-form');
  const labelInput = document.getElementById('new-label');
  const patternInput = document.getElementById('new-pattern');
  const flagsInput = document.getElementById('new-flags');
  const formError = document.getElementById('form-error');
  const testInput = document.getElementById('test-input');
  const testResults = document.getElementById('test-results');

  let customPatterns = [];

  function render() {
    patternList.innerHTML = '';
    emptyState.style.display = customPatterns.length === 0 ? 'block' : 'none';

    customPatterns.forEach((p, index) => {
      const row = document.createElement('tr');

      const labelCell = document.createElement('td');
      labelCell.textContent = p.type;

      const patternCell = document.createElement('td');
      patternCell.className = 'warden-pattern-cell';
      patternCell.textContent = p.pattern;

      const flagsCell = document.createElement('td');
      flagsCell.textContent = p.flags || '';

      const actionCell = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'warden-remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => removePattern(index));
      actionCell.appendChild(removeBtn);

      row.appendChild(labelCell);
      row.appendChild(patternCell);
      row.appendChild(flagsCell);
      row.appendChild(actionCell);
      patternList.appendChild(row);
    });
  }

  async function persist() {
    await WardenSettings.saveSettings({ customPatterns });
  }

  async function removePattern(index) {
    customPatterns = customPatterns.filter((_, i) => i !== index);
    await persist();
    render();
    runTest();
  }

  function runTest() {
    const text = testInput.value;
    testResults.innerHTML = '';
    if (!text.trim()) return;

    const matches = WardenDetection.detect(text, customPatterns);
    if (matches.length === 0) {
      testResults.textContent = 'No sensitive content detected.';
      return;
    }
    matches.forEach((m) => {
      const chip = document.createElement('span');
      chip.className = 'warden-match-chip';
      chip.textContent = `${m.type}: ${m.value}`;
      testResults.appendChild(chip);
    });
  }

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.textContent = '';

    const type = labelInput.value.trim().toUpperCase().replace(/\s+/g, '_');
    const pattern = patternInput.value.trim();
    const flags = flagsInput.value.trim();

    if (!type || !pattern) {
      formError.textContent = 'Label and pattern are both required.';
      return;
    }

    try {
      new RegExp(pattern, flags || undefined);
    } catch (err) {
      formError.textContent = `Invalid regex: ${err.message}`;
      return;
    }

    customPatterns.push({ type, pattern, flags });
    await persist();
    render();
    addForm.reset();
    runTest();
  });

  testInput.addEventListener('input', runTest);

  async function init() {
    const settings = await WardenSettings.loadSettings();
    customPatterns = settings.customPatterns || [];
    render();
  }

  init();
})();
