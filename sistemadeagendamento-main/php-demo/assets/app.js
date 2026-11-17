const root = document.documentElement;
const savedTheme = localStorage.getItem('noa-demo-theme');
if (savedTheme) root.dataset.theme = savedTheme;
document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('noa-demo-theme', next);
}));

const sidebar = document.querySelector('#sidebar');
document.querySelector('#menuToggle')?.addEventListener('click', () => sidebar.classList.toggle('open'));
document.addEventListener('click', (event) => {
  if (sidebar?.classList.contains('open') && !sidebar.contains(event.target) && !event.target.closest('#menuToggle')) sidebar.classList.remove('open');
});

const modal = document.querySelector('#appointmentModal');
document.querySelectorAll('[data-open-modal]').forEach((button) => button.addEventListener('click', () => modal?.showModal()));
const toast = document.querySelector('#toast');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}
document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));

document.querySelector('#appointmentForm')?.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const patient = String(form.get('patient')).trim();
  if (!patient) return;
  const list = document.querySelector('#appointmentList');
  if (list) {
    const row = document.createElement('div');
    row.className = 'appointment-row';
    const initials = Array.from(patient)[0].toUpperCase();
    const values = [String(form.get('time')), '', initials, patient, String(form.get('service')), String(form.get('professional')), 'Aguardando'];
    row.innerHTML = `<span class="appointment-time"></span><span class="timeline-dot amber"></span><span class="patient-avatar amber"></span><span class="appointment-info"><b></b><small></small></span><span class="status-pill amber"></span><button class="row-more" aria-label="Mais opções">···</button>`;
    row.querySelector('.appointment-time').textContent = values[0];
    row.querySelector('.patient-avatar').textContent = values[2];
    row.querySelector('.appointment-info b').textContent = values[3];
    row.querySelector('.appointment-info small').textContent = `${values[4]} · ${values[5]}`;
    row.querySelector('.status-pill').textContent = values[6];
    list.prepend(row);
    const count = document.querySelector('#appointmentCount');
    if (count) count.textContent = String(Number(count.textContent) + 1);
  }
  modal.close();
  event.currentTarget.reset();
  showToast('Agendamento adicionado nesta demonstração.');
});

document.querySelector('#searchAppointments')?.addEventListener('input', (event) => {
  const term = event.target.value.trim().toLocaleLowerCase('pt-BR');
  document.querySelectorAll('tbody tr').forEach((row) => { row.hidden = !row.textContent.toLocaleLowerCase('pt-BR').includes(term); });
});
