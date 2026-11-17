const portalRoot = document.documentElement;
if (localStorage.getItem('noa-demo-theme')) portalRoot.dataset.theme = localStorage.getItem('noa-demo-theme');
document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
  portalRoot.dataset.theme = portalRoot.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('noa-demo-theme', portalRoot.dataset.theme);
}));
const periodPrices = {
  monthly: { essential: ['R$ 150', 'R$ 150,00/mês'], professional: ['R$ 250', 'R$ 250,00/mês'], cycle: '/ mês' },
  quarterly: { essential: ['R$ 400', 'R$ 133,33/mês'], professional: ['R$ 675', 'R$ 225,00/mês'], cycle: '/ trimestre' },
  yearly: { essential: ['R$ 1.400', 'R$ 116,67/mês'], professional: ['R$ 2.400', 'R$ 200,00/mês'], cycle: '/ ano' },
};
document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-period]').forEach((item) => item.classList.toggle('active', item === button));
  const price = periodPrices[button.dataset.period];
  document.querySelector('[data-price-essential]').textContent = price.essential[0];
  document.querySelector('[data-month-essential]').textContent = price.essential[1];
  document.querySelector('[data-price-professional]').textContent = price.professional[0];
  document.querySelector('[data-month-professional]').textContent = price.professional[1];
  document.querySelectorAll('[data-cycle-label]').forEach((label) => { label.textContent = price.cycle; });
}));

document.querySelector('#siteMenu')?.addEventListener('click', () => {
  const nav = document.querySelector('.site-header nav');
  if (!nav) return;
  const open = nav.classList.toggle('site-nav-open');
  nav.style.display = open ? 'flex' : '';
});

document.querySelectorAll('.demo-login-form').forEach((form) => form.addEventListener('submit', (event) => {
  event.preventDefault();
  window.location.href = `?page=${form.dataset.next}`;
}));
document.querySelector('.demo-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  event.currentTarget.querySelector('.form-feedback').textContent = 'Se o endereço estiver associado a uma conta, você receberá instruções. (Demonstração)';
});
document.querySelector('.reset-demo-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = event.currentTarget.querySelectorAll('input[type="password"]');
  const feedback = event.currentTarget.querySelector('.form-feedback');
  feedback.textContent = fields[0].value === fields[1].value
    ? 'Senha atualizada nesta simulação. Volte ao login para continuar.'
    : 'As senhas não coincidem.';
});
document.querySelectorAll('.show-password').forEach((button) => button.addEventListener('click', () => {
  const field = button.parentElement.querySelector('input');
  field.type = field.type === 'password' ? 'text' : 'password';
}));

document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = button.dataset.toast;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2200);
}));

const ownerSearch = document.querySelector('#ownerSearch');
const ownerPlanFilter = document.querySelector('#ownerPlanFilter');
const ownerStatusFilter = document.querySelector('#ownerStatusFilter');
function filterOwnerRows() {
  const term = ownerSearch?.value.trim().toLocaleLowerCase('pt-BR') || '';
  const plan = ownerPlanFilter?.value || '';
  const status = ownerStatusFilter?.value || '';
  document.querySelectorAll('[data-owner-row]').forEach((row) => {
    const matchesText = row.textContent.toLocaleLowerCase('pt-BR').includes(term);
    row.hidden = !matchesText || (plan && row.dataset.plan !== plan) || (status && row.dataset.status !== status);
  });
}
ownerSearch?.addEventListener('input', filterOwnerRows);
ownerPlanFilter?.addEventListener('change', filterOwnerRows);
ownerStatusFilter?.addEventListener('change', filterOwnerRows);

let selectedService = document.querySelector('.service-choice.selected')?.dataset.service || 'Consulta inicial';
let selectedSlot = '';
document.querySelectorAll('.service-choice').forEach((button) => button.addEventListener('click', () => {
  selectedService = button.dataset.service;
  document.querySelectorAll('.service-choice').forEach((item) => item.classList.toggle('selected', item === button));
}));
const bookingSteps = [1, 2, 3].map((number) => document.querySelector(`#bookingStep${number}`));
function setBookingStep(number) {
  bookingSteps.forEach((step, index) => step?.classList.toggle('hidden', index + 1 !== number));
  document.querySelectorAll('.booking-step').forEach((step, index) => step.classList.toggle('active', index < number));
  if (number === 3) {
    const date = document.querySelector('#bookingDate')?.value;
    const time = selectedSlot;
    const formattedDate = date ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR') : 'data escolhida';
    document.querySelector('#bookingSummary').textContent = `${selectedService} · ${formattedDate} às ${time}`;
  }
}
document.querySelector('#bookingDate')?.addEventListener('change', (event) => {
  const date = event.target.value;
  const label = date ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Horários disponíveis';
  document.querySelector('#slotHeading').textContent = label.toLocaleUpperCase('pt-BR');
  selectedSlot = '';
  document.querySelectorAll('.time-slot').forEach((item) => item.classList.remove('selected'));
  document.querySelector('#slotContinue').disabled = true;
});
document.querySelectorAll('[data-booking-next]').forEach((button) => button.addEventListener('click', () => {
  const number = Number(button.dataset.bookingNext);
  if (number === 3 && !selectedSlot) return;
  setBookingStep(number);
}));
document.querySelectorAll('.time-slot').forEach((button) => button.addEventListener('click', () => {
  selectedSlot = button.textContent.trim();
  document.querySelectorAll('.time-slot').forEach((item) => item.classList.toggle('selected', item === button));
  document.querySelector('#slotContinue').disabled = false;
}));

const contractForm = document.querySelector('#contractForm');
if (contractForm) {
  const contractPrices = {
    essential: { name: 'Essencial', description: 'Até 5 profissionais ativos', extra: '✓ Até 5 profissionais ativos', prices: { monthly: 150, quarterly: 400, yearly: 1400 } },
    professional: { name: 'Profissional', description: 'Profissionais ilimitados e auditoria', extra: '✓ Profissionais ilimitados + auditoria', prices: { monthly: 250, quarterly: 675, yearly: 2400 } },
  };
  const cycleLabels = { monthly: ['/ mês', 'Cobrança mensal'], quarterly: ['/ trimestre', 'Cobrança a cada 3 meses'], yearly: ['/ ano', 'Cobrança anual'] };
  const brl = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const selectedContractPlan = () => contractForm.querySelector('[name="plan"]:checked').value;
  const selectedContractCycle = () => contractForm.querySelector('[name="cycle"]:checked').value;
  function updateContractSummary() {
    const plan = contractPrices[selectedContractPlan()];
    const cycle = selectedContractCycle();
    const amount = plan.prices[cycle];
    document.querySelector('#contractPlanName').textContent = plan.name;
    document.querySelector('#contractPlanDescription').textContent = plan.description;
    document.querySelector('#contractPrice').textContent = brl(amount);
    document.querySelector('#contractCycleLabel').textContent = cycleLabels[cycle][0];
    document.querySelector('#contractEquivalent').textContent = cycle === 'monthly' ? cycleLabels[cycle][1] : `${cycleLabels[cycle][1]} · ${brl(amount / (cycle === 'yearly' ? 12 : 3))}/mês equivalente`;
    document.querySelector('#contractExtra').textContent = plan.extra;
    contractForm.dataset.planName = plan.name;
    contractForm.dataset.cycleName = { monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' }[cycle];
    contractForm.dataset.totalPrice = brl(amount);
  }
  contractForm.querySelectorAll('[name="plan"], [name="cycle"]').forEach((input) => input.addEventListener('change', updateContractSummary));
  document.querySelectorAll('[data-contract-next]').forEach((button) => button.addEventListener('click', () => {
    const target = Number(button.dataset.contractNext);
    if (target === 3) {
      const fields = [...contractForm.querySelectorAll('#contractStep2 input[required]')];
      const invalid = fields.find((field) => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      const values = new FormData(contractForm);
      const review = document.querySelector('#contractReview');
      review.replaceChildren();
      [['Clínica', values.get('clinic')], ['Responsável', values.get('contact')], ['E-mail', values.get('email')], ['Telefone', values.get('phone')], ['Localização', values.get('location')]].forEach(([label, value]) => {
        const row = document.createElement('div'); row.className = 'contract-review-row';
        const term = document.createElement('span'); term.textContent = label;
        const detail = document.createElement('b'); detail.textContent = value;
        row.append(term, detail); review.append(row);
      });
      const proposal = document.createElement('div'); proposal.className = 'contract-review-proposal';
      proposal.textContent = `${contractForm.dataset.planName} · ${contractForm.dataset.cycleName} · ${contractForm.dataset.totalPrice}`;
      review.prepend(proposal);
    }
    contractForm.querySelectorAll('.contract-step').forEach((step) => step.classList.toggle('hidden', step.id !== `contractStep${target}`));
    document.querySelectorAll('.contract-progress span').forEach((step, index) => step.classList.toggle('active', index < target));
    document.querySelector('#contractStep' + target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  contractForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!document.querySelector('#contractConsent').checked) { document.querySelector('#contractConsent').reportValidity(); return; }
    contractForm.querySelectorAll('.contract-step').forEach((step) => step.classList.add('hidden'));
    document.querySelector('#contractSuccess').classList.remove('hidden');
    document.querySelectorAll('.contract-progress span').forEach((step) => step.classList.add('active'));
    document.querySelector('#contractSuccess').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  updateContractSummary();
}
document.querySelector('#bookingSubmit')?.addEventListener('click', (event) => {
  event.preventDefault();
  const requiredFields = [...document.querySelectorAll('#bookingStep3 input[required]')];
  if (requiredFields.some((input) => !input.checkValidity())) {
    requiredFields.find((input) => !input.checkValidity())?.reportValidity();
    return;
  }
  document.querySelector('#bookingStep3').classList.add('hidden');
  document.querySelector('#bookingSuccess').classList.remove('hidden');
  document.querySelectorAll('.booking-step').forEach((step) => step.classList.add('active'));
});

document.querySelectorAll('#searchAppointments, .clinic-search').forEach((clinicSearch) => clinicSearch.addEventListener('input', (event) => {
  const term = event.target.value.trim().toLocaleLowerCase('pt-BR');
  document.querySelectorAll('tbody tr').forEach((row) => { row.hidden = !row.textContent.toLocaleLowerCase('pt-BR').includes(term); });
}));
