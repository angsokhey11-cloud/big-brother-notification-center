const pages = {
  overview: 'Notification Center',
  staff: 'Staff Telegram Mapping',
  rules: 'Notification Rules',
  logs: 'Delivery Logs',
};

const navItems = document.querySelectorAll('.nav-item');
const pageSections = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');
const refreshBtn = document.getElementById('refreshBtn');
const testMessageBtn = document.getElementById('testMessageBtn');
const toast = document.getElementById('toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function setPage(name) {
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.page === name));
  pageSections.forEach((section) => section.classList.toggle('active', section.id === `page-${name}`));
  pageTitle.textContent = pages[name] || 'Notification Center';
  window.location.hash = name === 'overview' ? '' : name;
}

navItems.forEach((item) => {
  item.addEventListener('click', () => setPage(item.dataset.page));
});

refreshBtn.addEventListener('click', () => {
  showToast('UI refreshed. Live backend status connection is the next build step.');
});

testMessageBtn.addEventListener('click', () => {
  showToast('Secure test-message endpoint is not connected to this public page yet. Bot token stays in Supabase Secrets.');
});

const initialPage = window.location.hash.replace('#', '');
if (initialPage && pages[initialPage]) setPage(initialPage);

window.addEventListener('hashchange', () => {
  const name = window.location.hash.replace('#', '') || 'overview';
  if (pages[name]) setPage(name);
});
