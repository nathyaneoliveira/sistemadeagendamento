import { useEffect, useMemo, useState } from 'react';
import { resolveApiUrl } from './apiConfig.js';
import { clinicToday } from './clinicTime.js';
import { ThemeToggle, useTheme } from './theme.jsx';

const API_URL = resolveApiUrl({
  isProduction: import.meta.env.PROD,
  apiUrl: import.meta.env.VITE_API_URL,
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createRequestKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const values = new Uint8Array(16);
  globalThis.crypto.getRandomValues(values);
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  const hex = [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getStoredRequestKey(clinicSlug) {
  const storageKey = `public-booking:${clinicSlug}:request-key`;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved && UUID_PATTERN.test(saved)) return saved;
    const created = createRequestKey();
    sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return createRequestKey();
  }
}

function storeRequestKey(clinicSlug, key) {
  try {
    sessionStorage.setItem(`public-booking:${clinicSlug}:request-key`, key);
  } catch {
    return;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Não foi possível conectar à clínica. Tente novamente.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(payload?.message || 'Não foi possível concluir a solicitação.');
  return payload;
}

function formatMoney(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(value, timeZone) {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function formatTime(value, timeZone) {
  return new Date(value).toLocaleTimeString('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PublicBooking({ clinicSlug }) {
  const [theme, toggleTheme] = useTheme();
  const [clinic, setClinic] = useState(null);
  const [services, setServices] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [slots, setSlots] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState('');
  const [selectedStart, setSelectedStart] = useState('');
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [clinicError, setClinicError] = useState('');
  const [clinicRetry, setClinicRetry] = useState(0);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState('');
  const [servicesRetry, setServicesRetry] = useState(0);
  const [professionalsLoading, setProfessionalsLoading] = useState(false);
  const [professionalsError, setProfessionalsError] = useState('');
  const [professionalsRetry, setProfessionalsRetry] = useState(0);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => getStoredRequestKey(clinicSlug));

  const selectedService = services.find((service) => service.id === serviceId);
  const selectedProfessional = professionals.find((professional) => professional.id === professionalId);
  const selectedSlot = slots.find((slot) => slot.scheduledStart === selectedStart);
  const publicPath = useMemo(() => `/clinics/${encodeURIComponent(clinicSlug)}`, [clinicSlug]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setClinicError('');
    request(`/public${publicPath}`, { signal: controller.signal })
      .then((clinicPayload) => {
        setClinic(clinicPayload.data);
        setDate(clinicToday(clinicPayload.data.timezone));
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setClinicError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [clinicRetry, publicPath]);

  useEffect(() => {
    const controller = new AbortController();
    setServicesLoading(true);
    setServicesError('');
    request(`/public${publicPath}/services`, { signal: controller.signal })
      .then((payload) => {
        const availableServices = Array.isArray(payload.data) ? payload.data : [];
        setServices(availableServices);
        setServiceId((current) => availableServices.some((service) => service.id === current) ? current : '');
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setServicesError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setServicesLoading(false);
      });
    return () => controller.abort();
  }, [publicPath, servicesRetry]);

  useEffect(() => {
    if (!serviceId) {
      setProfessionals([]);
      setProfessionalsLoading(false);
      setProfessionalsError('');
      return undefined;
    }
    const controller = new AbortController();
    setProfessionals([]);
    setProfessionalsLoading(true);
    setProfessionalsError('');
    request(`/public${publicPath}/services/${encodeURIComponent(serviceId)}/professionals`, {
      signal: controller.signal,
    })
      .then((payload) => {
        const availableProfessionals = Array.isArray(payload.data) ? payload.data : [];
        setProfessionals(availableProfessionals);
        setProfessionalId((current) => availableProfessionals.some((professional) => professional.id === current) ? current : '');
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setProfessionalsError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfessionalsLoading(false);
      });
    return () => controller.abort();
  }, [professionalsRetry, publicPath, serviceId]);

  useEffect(() => {
    if (!clinic || !serviceId || !professionalId || !date) {
      setSlots([]);
      setAvailabilityLoading(false);
      setAvailabilityError('');
      return undefined;
    }
    const controller = new AbortController();
    setSlots([]);
    setSelectedStart('');
    setAvailabilityLoading(true);
    setAvailabilityError('');
    const path = `/public${publicPath}/services/${encodeURIComponent(serviceId)}` +
      `/professionals/${encodeURIComponent(professionalId)}/availability?date=${encodeURIComponent(date)}`;
    request(path, { signal: controller.signal })
      .then((payload) => setSlots(Array.isArray(payload.data) ? payload.data : []))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setAvailabilityError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });
    return () => controller.abort();
  }, [availabilityRetry, clinic, date, professionalId, publicPath, serviceId]);

  const updateCustomer = (field, value) => {
    setCustomer((current) => ({ ...current, [field]: value }));
  };

  const confirmBooking = async () => {
    if (!selectedService || !selectedProfessional || !selectedSlot || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await request(`/public${publicPath}/appointments`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          serviceId,
          professionalId,
          scheduledStart: selectedSlot.scheduledStart,
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          ...(customer.email.trim() ? { email: customer.email.trim() } : {}),
        }),
      });
      setConfirmation(result.data);
      const nextKey = createRequestKey();
      setIdempotencyKey(nextKey);
      storeRequestKey(clinicSlug, nextKey);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startAnotherBooking = () => {
    setServiceId('');
    setProfessionalId('');
    setSelectedStart('');
    setCustomer({ name: '', phone: '', email: '' });
    setConfirmation(null);
    setStep(1);
    const nextKey = createRequestKey();
    setIdempotencyKey(nextKey);
    storeRequestKey(clinicSlug, nextKey);
  };

  if (loading) {
    return (
      <main className="public-booking-shell">
        <div className="public-booking-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <section className="auth-card"><p role="status">Carregando agendamento...</p></section>
      </main>
    );
  }

  if (clinicError && !clinic) {
    return (
      <main className="public-booking-shell">
        <div className="public-booking-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <section className="auth-card">
          <p className="eyebrow">Agendamento online</p>
          <h1>Clínica indisponível</h1>
          <p className="error-text" role="alert">{clinicError}</p>
          <button type="button" onClick={() => setClinicRetry((attempt) => attempt + 1)}>Tentar novamente</button>
        </section>
      </main>
    );
  }

  if (confirmation) {
    return (
      <main className="public-booking-shell">
        <div className="public-booking-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <section className="public-booking-card" aria-labelledby="booking-confirmed-heading">
          <p className="eyebrow">Agendamento online</p>
          <h1 id="booking-confirmed-heading">Agendamento confirmado</h1>
          <p className="success-text" role="status">Seu horário foi reservado com sucesso.</p>
          <dl className="public-confirmation-list">
            <div><dt>Protocolo</dt><dd>{confirmation.code}</dd></div>
            <div><dt>Clínica</dt><dd>{confirmation.clinic.name}</dd></div>
            <div><dt>Serviço</dt><dd>{confirmation.service.name}</dd></div>
            <div><dt>Profissional</dt><dd>{confirmation.professional.name}</dd></div>
            <div><dt>Data e horário</dt><dd>{formatDateTime(confirmation.scheduledStart, clinic.timezone)}</dd></div>
            <div><dt>Duração</dt><dd>{confirmation.service.durationMinutes} minutos</dd></div>
            <div><dt>Preço</dt><dd>{formatMoney(confirmation.service.price)}</dd></div>
            <div><dt>Cliente</dt><dd>{confirmation.customer.name} · {confirmation.customer.phone}</dd></div>
            {confirmation.customer.email ? <div><dt>E-mail</dt><dd>{confirmation.customer.email}</dd></div> : null}
            {confirmation.clinic.phone ? <div><dt>Contato da clínica</dt><dd>{confirmation.clinic.phone}</dd></div> : null}
          </dl>
          <button type="button" onClick={startAnotherBooking}>Fazer outro agendamento</button>
        </section>
      </main>
    );
  }

  return (
    <main className="public-booking-shell">
      <div className="public-booking-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
      <section className="public-booking-card" aria-labelledby="public-booking-heading">
        <p className="eyebrow">Agendamento online</p>
        <h1 id="public-booking-heading">{clinic?.name || 'Agendamento'}</h1>
        {clinic?.address ? <p className="muted-text">{clinic.address}</p> : null}
        <p className="muted-text">Etapa {step} de 6</p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}

        {step === 1 ? (
          <section aria-labelledby="public-service-heading">
            <h2 id="public-service-heading">1. Escolha o serviço</h2>
            {servicesLoading ? <p role="status">Carregando serviços...</p> : null}
            {servicesError ? (
              <div>
                <p className="error-text" role="alert">{servicesError}</p>
                <button type="button" onClick={() => setServicesRetry((attempt) => attempt + 1)}>Tentar novamente</button>
              </div>
            ) : null}
            {!servicesLoading && !servicesError && services.length ? (
              <div className="public-choice-list">
                {services.map((service) => (
                  <label className="public-choice" key={service.id}>
                    <input
                      type="radio"
                      name="service"
                      value={service.id}
                      checked={serviceId === service.id}
                      onChange={() => {
                        setServiceId(service.id);
                        setProfessionalId('');
                        setSelectedStart('');
                        setSlots([]);
                      }}
                    />
                    <span><strong>{service.name}</strong><small>{service.duration_minutes} minutos · {formatMoney(service.price)}</small></span>
                  </label>
                ))}
              </div>
            ) : null}
            {!servicesLoading && !servicesError && !services.length ? <p className="muted-text">Esta clínica não possui serviços disponíveis para agendamento.</p> : null}
            <button type="button" disabled={!serviceId || servicesLoading || Boolean(servicesError)} onClick={() => setStep(2)}>Continuar</button>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="public-professional-heading">
            <h2 id="public-professional-heading">2. Escolha o profissional</h2>
            {professionalsLoading ? <p role="status">Carregando profissionais...</p> : null}
            {professionalsError ? (
              <div>
                <p className="error-text" role="alert">{professionalsError}</p>
                <button type="button" onClick={() => setProfessionalsRetry((attempt) => attempt + 1)}>Tentar novamente</button>
              </div>
            ) : null}
            <div className="public-choice-list">
              {professionals.map((professional) => (
                <label className="public-choice" key={professional.id}>
                  <input
                    type="radio"
                    name="professional"
                    value={professional.id}
                    checked={professionalId === professional.id}
                    onChange={() => {
                      setProfessionalId(professional.id);
                      setSelectedStart('');
                      setSlots([]);
                    }}
                  />
                  <span><strong>{professional.name}</strong></span>
                </label>
              ))}
            </div>
            {!professionalsLoading && !professionalsError && !professionals.length ? <p className="muted-text">Não há profissionais disponíveis para este serviço.</p> : null}
            <div className="public-form-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(1)}>Voltar</button>
              <button type="button" disabled={!professionalId || professionalsLoading || Boolean(professionalsError)} onClick={() => setStep(3)}>Continuar</button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section aria-labelledby="public-date-heading">
            <h2 id="public-date-heading">3. Escolha a data</h2>
            <label className="public-field">
              Data da consulta ({clinic?.timezone})
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelectedStart('');
                }}
                required
              />
            </label>
            <div className="public-form-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(2)}>Voltar</button>
              <button type="button" disabled={!date} onClick={() => setStep(4)}>Ver horários</button>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section aria-labelledby="public-slot-heading">
            <h2 id="public-slot-heading">4. Escolha o horário</h2>
            <p className="muted-text">{date} · horário da clínica</p>
            {availabilityLoading ? <p role="status">Consultando disponibilidade...</p> : null}
            {availabilityError ? (
              <div>
                <p className="error-text" role="alert">{availabilityError}</p>
                <button type="button" onClick={() => setAvailabilityRetry((attempt) => attempt + 1)}>Tentar novamente</button>
              </div>
            ) : null}
            {!availabilityLoading && !availabilityError && slots.length === 0 ? <p className="muted-text">Não há horários disponíveis nesta data.</p> : null}
            <div className="slot-grid">
              {slots.map((slot) => (
                <button
                  type="button"
                  key={slot.scheduledStart}
                  className={`slot-button${selectedStart === slot.scheduledStart ? ' selected' : ''}`}
                  aria-pressed={selectedStart === slot.scheduledStart}
                  onClick={() => setSelectedStart(slot.scheduledStart)}
                >
                  {formatTime(slot.scheduledStart, clinic.timezone)}
                </button>
              ))}
            </div>
            <div className="public-form-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(3)}>Voltar</button>
              <button type="button" disabled={!selectedSlot} onClick={() => setStep(5)}>Continuar</button>
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section aria-labelledby="public-contact-heading">
            <h2 id="public-contact-heading">5. Seus dados de contato</h2>
            <form className="public-contact-form" onSubmit={(event) => { event.preventDefault(); setStep(6); }}>
              <label className="public-field">Nome completo
                <input required minLength="2" maxLength="200" autoComplete="name" value={customer.name} onChange={(event) => updateCustomer('name', event.target.value)} />
              </label>
              <label className="public-field">Telefone
                <input required type="tel" minLength="8" maxLength="20" autoComplete="tel" value={customer.phone} onChange={(event) => updateCustomer('phone', event.target.value)} />
              </label>
              <label className="public-field">E-mail (opcional)
                <input type="email" maxLength="254" autoComplete="email" value={customer.email} onChange={(event) => updateCustomer('email', event.target.value)} />
              </label>
              <div className="public-form-actions">
                <button type="button" className="secondary-button" onClick={() => setStep(4)}>Voltar</button>
                <button type="submit">Revisar agendamento</button>
              </div>
            </form>
          </section>
        ) : null}

        {step === 6 ? (
          <section aria-labelledby="public-review-heading">
            <h2 id="public-review-heading">6. Revise e confirme</h2>
            <dl className="public-confirmation-list">
              <div><dt>Clínica</dt><dd>{clinic?.name}</dd></div>
              <div><dt>Serviço</dt><dd>{selectedService?.name}</dd></div>
              <div><dt>Profissional</dt><dd>{selectedProfessional?.name}</dd></div>
              <div><dt>Data e horário</dt><dd>{selectedSlot && formatDateTime(selectedSlot.scheduledStart, clinic.timezone)}</dd></div>
              <div><dt>Duração</dt><dd>{selectedService?.duration_minutes} minutos</dd></div>
              <div><dt>Preço</dt><dd>{selectedService && formatMoney(selectedService.price)}</dd></div>
              <div><dt>Cliente</dt><dd>{customer.name}</dd></div>
              <div><dt>Telefone</dt><dd>{customer.phone}</dd></div>
              {customer.email ? <div><dt>E-mail</dt><dd>{customer.email}</dd></div> : null}
            </dl>
            <div className="public-form-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(5)}>Voltar</button>
              <button type="button" disabled={submitting} onClick={confirmBooking}>
                {submitting ? 'Confirmando...' : 'Confirmar agendamento'}
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
