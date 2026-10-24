// Apply the saved theme before styles paint, including on iPhone Home Screen.
try {
  const dark = JSON.parse(localStorage.getItem('smsdesk.theme')) === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#111111' : '#ffffff';
} catch {}
