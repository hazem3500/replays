// Optional enhancement: copy buttons on the code blocks. The page works without it.
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const code = button.closest('.code')?.querySelector('code');
    if (!code || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1600);
    } catch {
      button.textContent = 'Select and copy';
    }
  });
}
