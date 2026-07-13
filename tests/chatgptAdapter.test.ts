import { getPromptText, setPromptText } from '../src/content/domAdapters/chatgptAdapter';

describe('getPromptText: textarea', () => {
  test('reads .value from an HTMLTextAreaElement', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello from a textarea';
    expect(getPromptText(textarea)).toBe('hello from a textarea');
  });
});

describe('getPromptText: contenteditable', () => {
  test('reads textContent when innerText is unavailable (jsdom has no layout engine)', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'hello from a contenteditable div';
    expect(getPromptText(div)).toBe('hello from a contenteditable div');
  });

  test('falls back to textContent when innerText is an empty string -- the exact zero-redaction bug', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'real prompt text';
    // Simulates the real-browser case where innerText legitimately reads ''
    // before layout has settled -- `??` would have returned '' here and
    // silently produced zero detections; `||` must fall through.
    Object.defineProperty(div, 'innerText', { value: '', configurable: true });
    expect(getPromptText(div)).toBe('real prompt text');
  });

  test('returns an empty string when both innerText and textContent are empty', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(getPromptText(div)).toBe('');
  });
});

describe('setPromptText: textarea', () => {
  test('sets .value and dispatches an input event', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    let inputFired = false;
    textarea.addEventListener('input', () => {
      inputFired = true;
    });

    setPromptText(textarea, 'new value');

    expect(textarea.value).toBe('new value');
    expect(inputFired).toBe(true);
    document.body.removeChild(textarea);
  });
});

describe('setPromptText: contenteditable', () => {
  test('updates the visible text (via execCommand or the textContent fallback)', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.textContent = 'old text';
    document.body.appendChild(div);

    setPromptText(div, 'new sanitized text');

    expect(getPromptText(div)).toBe('new sanitized text');
    document.body.removeChild(div);
  });
});
