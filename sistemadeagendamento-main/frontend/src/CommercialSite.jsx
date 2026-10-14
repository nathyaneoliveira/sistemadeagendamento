import { useEffect, useState } from 'react';
import { ThemeToggle, useTheme } from './theme.jsx';
import {
  BILLING_CYCLES,
  COMMERCIAL_PLAN_IDS,
  PLAN_CATALOG,
  PLAN_CAPABILITIES,
  getPlanBillingSummary,
} from '../../shared/planCatalog.js';

const SITE_SECTIONS = [
  { href: '/recursos', label: 'Recursos', id: 'recursos' },
  { href: '/planos', label: 'Planos', id: 'planos' },
  { href: '/sobre', label: 'Segurança', id: 'seguranca' },
  { href: '/contato', label: 'Contato', id: 'contato' },
];

function formatPriceInCents(value) {
  return (value / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

const FEATURES = [
  {
    icon: 'calendar',
    title: 'Agenda organizada',
    description: 'Consulte horários disponíveis, agendamentos e bloqueios de profissionais.',
  },
  {
    icon: 'team',
    title: 'Profissionais e serviços',
    description: 'Gerencie profissionais, horários de trabalho, serviços e associações.',
  },
  {
    icon: 'booking',
    title: 'Agendamentos',
    description: 'Crie atendimentos, acompanhe consultas e faça cancelamentos ou reagendamentos.',
  },
  {
    icon: 'link',
    title: 'Reserva pública',
    description: 'Disponibilize uma página pública para solicitações de agendamento da clínica.',
  },
  {
    icon: 'shield',
    title: 'Acesso protegido',
    description: 'A autenticação e as permissões ajudam a manter cada clínica no seu próprio espaço.',
  },
  {
    icon: 'history',
    title: 'Rastreabilidade',
    description: 'Registros de auditoria apoiam a rastreabilidade; a consulta está disponível no plano Profissional.',
  },
];

const FAQS = [
  {
    question: 'Quais planos estão disponíveis?',
    answer: 'A proposta apresenta os planos Essencial e Profissional. O Essencial inclui até 5 funcionários ativos; o Profissional permite funcionários ilimitados. Ambos incluem pacientes, agendamentos e serviços ilimitados.',
  },
  {
    question: 'Quais periodicidades são apresentadas?',
    answer: 'Os preços são exibidos para os ciclos mensal, trimestral e anual. O sistema ainda não processa pagamentos nem cria assinaturas pela página.',
  },
  {
    question: 'O que muda entre os planos?',
    answer: 'O Essencial permite até 5 funcionários ativos. O Profissional permite equipes sem limite máximo e também inclui recursos existentes de gestão de usuários, registros internos de pagamento e consulta de auditoria.',
  },
  {
    question: 'Como funcionam os ciclos trimestral e anual?',
    answer: 'O preço principal mostra o total do período contratado. Também exibimos o equivalente mensal e a economia em relação a pagar mês a mês. Não há parcelamento informado.',
  },
  {
    question: 'Já é possível pagar ou contratar uma assinatura?',
    answer: 'Ainda não. A página é uma apresentação comercial. Não há checkout, cobrança real ou confirmação de contratação.',
  },
  {
    question: 'Preciso instalar alguma coisa?',
    answer: 'O sistema é acessado pelo navegador. A implantação e a configuração da operação são feitas pela equipe responsável.',
  },
  {
    question: 'Posso cadastrar vários profissionais?',
    answer: 'O Essencial permite até 5 funcionários ativos. O Profissional não tem limite máximo de funcionários. Funcionários inativos não ocupam vagas do Essencial.',
  },
  {
    question: 'Pacientes podem solicitar um agendamento?',
    answer: 'Sim. A clínica pode configurar um link público de reserva, com serviços, profissionais e horários disponíveis.',
  },
  {
    question: 'Posso cancelar ou reagendar consultas?',
    answer: 'Sim. Os fluxos atuais permitem acompanhar consultas, cancelar atendimentos e solicitar reagendamentos conforme as permissões da conta.',
  },
  {
    question: 'Os dados de clínicas diferentes ficam separados?',
    answer: 'O sistema aplica isolamento entre clínicas e controle de acesso para que cada conta acesse somente os dados autorizados.',
  },
];

function FeatureIcon({ name }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01" /></>,
    team: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    booking: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.71-1.71" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
  };

  return (
    <span className="commercial-feature-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </svg>
    </span>
  );
}

function Brand({ footer = false }) {
  return (
    <a className={`commercial-brand${footer ? ' commercial-brand-footer' : ''}`} href="/" aria-label="NOA CONNECT — início">
      <img className="commercial-brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" />
    </a>
  );
}

function sectionForPath(pathname) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/planos') return 'planos';
  if (normalizedPath === '/recursos') return 'recursos';
  if (normalizedPath === '/sobre') return 'seguranca';
  if (normalizedPath === '/contato') return 'contato';
  return '';
}

export default function CommercialSite() {
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('yearly');
  const selectedCycle = BILLING_CYCLES[selectedPeriod];

  useEffect(() => {
    const pathSection = sectionForPath(window.location.pathname);
    const sectionId = pathSection ||
      (window.location.pathname === '/' ? window.location.hash.slice(1) : '');
    if (sectionId) {
      window.requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
      });
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    document.title = 'NOA CONNECT | Gestão de clínicas';
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.content = 'Organize a agenda da clínica, gerencie profissionais e serviços e acompanhe seus atendimentos em um só lugar.';
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.content = 'NOA CONNECT | Gestão de clínicas';
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) {
      ogDescription.content = 'Agenda, profissionais, serviços e atendimentos reunidos em um sistema para clínicas.';
    }
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="commercial-site">
      <a className="commercial-skip-link" href="#conteudo">Pular para o conteúdo</a>
      <header className="commercial-header">
        <div className="commercial-header-inner">
          <Brand />
          <button
            type="button"
            className="commercial-menu-toggle"
            aria-label={menuOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
            aria-expanded={menuOpen}
            aria-controls="commercial-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <nav id="commercial-navigation" className={`commercial-nav${menuOpen ? ' commercial-nav-open' : ''}`} aria-label="Navegação principal">
            {SITE_SECTIONS.map((item) => (
              <a key={item.id} href={item.href} onClick={closeMenu}>{item.label}</a>
            ))}
            <a href="/#faq" onClick={closeMenu}>FAQ</a>
            <a className="commercial-login-link" href="/login" onClick={closeMenu}>Entrar</a>
            <a className="commercial-button commercial-button-small" href="/login" onClick={closeMenu}>Começar agora</a>
          </nav>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      {menuOpen ? <button type="button" className="commercial-menu-backdrop" onClick={closeMenu} aria-label="Fechar menu" /> : null}

      <main id="conteudo">
        <section className="commercial-hero">
          <div className="commercial-container commercial-hero-grid">
            <div className="commercial-hero-copy">
              <p className="commercial-kicker"><span /> GESTÃO DE CLÍNICAS, EM CONEXÃO</p>
              <h1>Gestão de clínicas de forma <span>simples, organizada e inteligente.</span></h1>
              <p className="commercial-hero-description">
                Organize horários, profissionais, serviços e atendimentos em um só lugar — com uma experiência feita para a rotina da sua clínica.
              </p>
              <div className="commercial-hero-actions">
                <a className="commercial-button" href="/login">Começar agora <span aria-hidden="true">→</span></a>
                <a className="commercial-button commercial-button-secondary" href="/planos">Conhecer o plano</a>
              </div>
              <p className="commercial-access-note">O acesso requer uma conta criada pela equipe responsável da clínica.</p>
            </div>
            <div className="commercial-hero-art" aria-label="Ilustração abstrata de agenda e horários">
              <div className="commercial-art-orbit commercial-art-orbit-one" />
              <div className="commercial-art-orbit commercial-art-orbit-two" />
              <div className="commercial-art-calendar">
                <div className="commercial-art-calendar-top">
                  <span className="commercial-art-dot" />
                  <span className="commercial-art-line commercial-art-line-wide" />
                  <span className="commercial-art-menu-dots">···</span>
                </div>
                <div className="commercial-art-calendar-heading">
                  <span className="commercial-art-line commercial-art-line-title" />
                  <span className="commercial-art-line commercial-art-line-short" />
                </div>
                <div className="commercial-art-week">
                  {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, index) => (
                    <span className={index === 2 ? 'commercial-art-day-selected' : ''} key={`${day}-${index}`}>{day}</span>
                  ))}
                </div>
                <div className="commercial-art-slots">
                  {['08:00', '09:00', '10:00', '11:00'].map((time, index) => (
                    <div className="commercial-art-slot-row" key={time}>
                      <span>{time}</span>
                      <span className={`commercial-art-slot${index === 1 ? ' commercial-art-slot-filled' : ''}${index === 3 ? ' commercial-art-slot-soft' : ''}`} />
                    </div>
                  ))}
                </div>
                <div className="commercial-art-footer"><span /><span /><span /></div>
              </div>
              <div className="commercial-art-check" aria-hidden="true">✓</div>
              <div className="commercial-art-sparkle" aria-hidden="true">✳</div>
            </div>
          </div>
        </section>

        <section className="commercial-benefits" aria-label="Benefícios">
          <div className="commercial-container commercial-benefit-row">
            <p><span aria-hidden="true">✓</span> Agenda em um só lugar</p>
            <p><span aria-hidden="true">✓</span> Rotinas mais organizadas</p>
            <p><span aria-hidden="true">✓</span> Acesso separado por clínica</p>
          </div>
        </section>

        <section className="commercial-section" id="recursos">
          <div className="commercial-container">
            <div className="commercial-section-heading">
              <p className="commercial-kicker">RECURSOS DO SISTEMA</p>
              <h2>O essencial para acompanhar a rotina da clínica</h2>
              <p>Ferramentas para organizar a operação, sem complicar o dia a dia.</p>
            </div>
            <div className="commercial-feature-grid">
              {FEATURES.map((feature) => (
                <article className="commercial-feature-card" key={feature.title}>
                  <FeatureIcon name={feature.icon} />
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="commercial-how-section">
          <div className="commercial-container commercial-how-grid">
            <div className="commercial-section-heading commercial-how-heading">
              <p className="commercial-kicker">COMO FUNCIONA</p>
              <h2>Uma rotina mais clara, passo a passo</h2>
              <p>Configure a operação da clínica e acompanhe os atendimentos pelo mesmo sistema.</p>
            </div>
            <ol className="commercial-steps">
              <li><span>01</span><div><h3>Configure o acesso da clínica</h3><p>Uma pessoa administradora prepara os acessos da equipe.</p></div></li>
              <li><span>02</span><div><h3>Cadastre profissionais e serviços</h3><p>Organize a equipe, os serviços e as associações disponíveis.</p></div></li>
              <li><span>03</span><div><h3>Defina horários e disponibilidade</h3><p>Configure jornadas de trabalho e bloqueios de agenda.</p></div></li>
              <li><span>04</span><div><h3>Acompanhe os atendimentos</h3><p>Crie, consulte e gerencie os agendamentos da clínica.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="commercial-section commercial-security-section" id="seguranca">
          <div className="commercial-container commercial-security-card">
            <div className="commercial-security-icon"><FeatureIcon name="shield" /></div>
            <div>
              <p className="commercial-kicker">SEGURANÇA E PRIVACIDADE</p>
              <h2>Cada clínica, no seu próprio espaço</h2>
              <p>
                O sistema combina autenticação, permissões por perfil e separação entre clínicas para ajudar a proteger as informações da operação. A consulta dos registros de auditoria está disponível no plano Profissional.
              </p>
            </div>
            <a className="commercial-text-link" href="/recursos">Conheça os recursos <span aria-hidden="true">→</span></a>
          </div>
        </section>

        <section className="commercial-pricing-section" id="planos">
          <div className="commercial-container">
            <div className="commercial-section-heading">
              <p className="commercial-kicker">PLANOS COMERCIAIS</p>
              <h2>O plano certo para o tamanho da sua clínica</h2>
              <p>Compare os limites e escolha entre os ciclos mensal, trimestral e anual. Pacientes, agendamentos e serviços são ilimitados nos dois planos.</p>
            </div>
            <fieldset className="commercial-period-selector commercial-period-selector-global">
              <legend>Escolha a periodicidade</legend>
              <div className="commercial-period-options">
                {Object.entries(BILLING_CYCLES).map(([key, cycle]) => (
                  <label
                    className={`commercial-period-option${selectedPeriod === key ? ' commercial-period-selected' : ''}`}
                    key={key}
                  >
                    <input
                      type="radio"
                      name="billing-period"
                      value={key}
                      checked={selectedPeriod === key}
                      onChange={() => setSelectedPeriod(key)}
                    />
                    <span>{cycle.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="commercial-tier-grid" aria-live="polite" aria-atomic="false">
              {COMMERCIAL_PLAN_IDS.map((planId) => {
                const plan = PLAN_CATALOG[planId];
                const billingSummary = getPlanBillingSummary(planId, selectedPeriod);
                const includedCapabilities = Object.entries(plan.capabilities)
                  .filter(([, available]) => available)
                  .map(([key]) => PLAN_CAPABILITIES[key].label);

                return (
                  <article
                    className={`commercial-tier-card${planId === 'professional' ? ' commercial-tier-card-popular' : ''}`}
                    key={planId}
                    aria-labelledby={`plan-${planId}-title`}
                  >
                    {planId === 'professional' ? (
                      <span className="commercial-tier-badge">MAIS POPULAR</span>
                    ) : null}
                    <p className="commercial-tier-eyebrow">{planId === 'essential' ? 'PLANO DE ENTRADA' : `PLANO ${plan.name.toUpperCase()}`}</p>
                    <h3 id={`plan-${planId}-title`}>{plan.name}</h3>
                    <p className="commercial-tier-description">{plan.description}</p>
                    <p className="commercial-tier-price">
                      <strong>{formatPriceInCents(billingSummary.priceInCents)}</strong>
                      <span>{selectedPeriod === 'monthly' ? '/mês' : `total do ${selectedCycle.period}`}</span>
                    </p>
                    {selectedPeriod !== 'monthly' ? (
                      <>
                        <p className="commercial-monthly-equivalent">
                          Equivale a <strong>{formatPriceInCents(billingSummary.monthlyEquivalentInCents)}/mês</strong>
                        </p>
                        <p className="commercial-savings">
                          Economize <strong>{formatPriceInCents(billingSummary.savingsInCents)}</strong> em relação a pagar mês a mês.
                        </p>
                      </>
                    ) : null}
                    <ul className="commercial-tier-limits">
                      {Object.entries(plan.limits).map(([resource, limit]) => (
                        <li key={resource}>
                          <span aria-hidden="true">✓</span>
                          {resource === 'professionals'
                            ? (limit === null ? 'Funcionários ilimitados' : `Até ${limit} funcionários ativos`)
                            : `${resource === 'patients' ? 'Pacientes' : resource === 'appointments' ? 'Agendamentos' : resource === 'services' ? 'Serviços' : 'Usuários administrativos'} ilimitados`}
                        </li>
                      ))}
                    </ul>
                    <h4>Recursos disponíveis</h4>
                    <ul className="commercial-tier-features">
                      {includedCapabilities.map((feature) => (
                        <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>
                      ))}
                    </ul>
                    <a className="commercial-button" href="/login">Começar agora <span aria-hidden="true">→</span></a>
                    <p className="commercial-checkout-note">O botão leva ao login existente. Não cria uma assinatura nem inicia pagamento.</p>
                  </article>
                );
              })}
            </div>
            <p className="commercial-pricing-disclaimer">
              Valores apresentados como proposta comercial. Não há checkout, cobrança real nem contratação iniciada por esta página.
            </p>
          </div>
        </section>

        <section className="commercial-section commercial-faq-section" id="faq">
          <div className="commercial-container commercial-faq-grid">
            <div className="commercial-section-heading">
              <p className="commercial-kicker">DÚVIDAS FREQUENTES</p>
              <h2>Informação clara para começar</h2>
              <p>Veja o que o sistema oferece hoje e o que ainda não faz parte da operação.</p>
            </div>
            <div className="commercial-faq-list">
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="commercial-cta-section" id="contato">
          <div className="commercial-container commercial-cta-card">
            <div>
              <p className="commercial-kicker">CLÍNICA AGENDA</p>
              <h2>Pronto para organizar a gestão da sua clínica?</h2>
              <p>Entre com uma conta existente ou fale com a pessoa administradora da sua clínica para solicitar acesso.</p>
            </div>
            <div className="commercial-cta-actions">
              <a className="commercial-button commercial-button-light" href="/login">Ir para o login</a>
              <a className="commercial-button commercial-button-outline-light" href="/planos">Conhecer o plano</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="commercial-footer">
        <div className="commercial-container">
          <div className="commercial-footer-main">
            <div className="commercial-footer-brand-column">
              <Brand footer />
              <p>Agenda, equipe e atendimentos da clínica em um só lugar.</p>
            </div>
            <div className="commercial-footer-links">
              <div><h2>Produto</h2><a href="/recursos">Recursos</a><a href="/planos">Planos comerciais</a><a href="/sobre">Segurança</a></div>
              <div><h2>Ajuda</h2><a href="/#faq">Perguntas frequentes</a><a href="/contato">Contato e acesso</a><a href="/login">Entrar</a></div>
              <div><h2>Informações</h2><span aria-disabled="true">Termos (em preparação)</span><span aria-disabled="true">Privacidade (em preparação)</span></div>
            </div>
          </div>
          <div className="commercial-footer-bottom">
            <span>NOA CONNECT</span>
            <span>Apresentação comercial; contratação e pagamentos ainda não estão disponíveis.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
