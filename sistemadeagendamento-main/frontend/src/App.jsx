import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  clinicDateAt,
  clinicDateTimeToIso,
  clinicToday,
  isValidIanaTimeZone,
} from './clinicTime.js';
import { resolveApiUrl } from './apiConfig.js';
import { ThemeToggle, useTheme } from './theme.jsx';

const API_URL = resolveApiUrl({
  isProduction: import.meta.env.PROD,
  apiUrl: import.meta.env.VITE_API_URL,
});
const EMPTY_DATA = { appointments: [], professionals: [], patients: [], specialties: [], services: [] };
const CLINIC_TABS = new Set(['dashboard', 'professionals', 'services', 'schedule', 'appointments', 'settings']);
const WEEKDAYS = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];
const MONEY_INPUT_PATTERN = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/;
const BLOCK_TYPES = [
  { value: 'vacation', label: 'Férias' },
  { value: 'holiday', label: 'Feriado' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'absence', label: 'Ausência' },
  { value: 'custom', label: 'Personalizado' },
];

function formatClinicDateTime(value, timeZone) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

function formatDateTime(value, timeZone) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

function formatTime(value, timeZone) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
}

class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function apiRequest(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const isLoginRequest = path === '/auth/login' || path === '/auth/login/select-clinic';
    const message = response.status === 401 && !isLoginRequest
      ? 'Sua sessão expirou. Entre novamente.'
      : response.status === 401 || response.status === 403
        ? payload?.message || 'Você não tem permissão para realizar esta ação.'
        : response.status === 404
          ? 'O registro solicitado não foi encontrado ou não está acessível.'
          : response.status >= 500
            ? 'Não foi possível concluir a solicitação. Tente novamente.'
            : payload?.message || 'Não foi possível concluir a solicitação.';
    throw new ApiError(response.status, message, payload);
  }

  return payload;
}

function dataList(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function appointmentStatusClass(status) {
  switch (status) {
    case 'scheduled':
      return 'badge badge-scheduled';
    case 'cancelled':
      return 'badge badge-cancelled';
    case 'no_show':
      return 'badge badge-no-show';
    case 'completed':
      return 'badge badge-completed';
    case 'rescheduled':
      return 'badge badge-rescheduled';
    case 'confirmed':
      return 'badge badge-confirmed';
    default:
      return 'badge badge-muted';
  }
}

const ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  professionals: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  services: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </>
  ),
  appointments: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" />
    </>
  ),
  settings: (
    <>
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.7Z" transform="translate(-1 -2)" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m18 6-12 12M6 6l12 12" />,
  brand: (
    <>
      <path d="M12 5v14M5 12h14" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
};

function Icon({ name, size = 18 }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] || ICONS.dashboard}
    </svg>
  );
}

function ClinicApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [theme, toggleTheme] = useTheme();
  const [logged, setLogged] = useState(false);
  const clinicPath = location.pathname.replace(/\/+$/, '');
  const clinicTab = clinicPath.startsWith('/clinic/')
    ? clinicPath.slice('/clinic/'.length)
    : 'dashboard';
  const tab = CLINIC_TABS.has(clinicTab) ? clinicTab : 'dashboard';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuWasOpen = useRef(false);
  const mobileMenuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const sidebarCloseRef = useRef(null);
  const [form, setForm] = useState({ email: '', password: '' });
  const [clinicSelection, setClinicSelection] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [success, setSuccess] = useState('');
  const [dashboard, setDashboard] = useState(EMPTY_DATA);
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => clinicToday('UTC'));
  const [selectedSlot, setSelectedSlot] = useState('');
  const [availability, setAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [appointmentMode, setAppointmentMode] = useState('create');
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [notesBusy, setNotesBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [workSchedules, setWorkSchedules] = useState([]);
  const [professionalBlocks, setProfessionalBlocks] = useState([]);
  const [blocksLoadMessage, setBlocksLoadMessage] = useState('');
  const [managementDate, setManagementDate] = useState(() => clinicToday('UTC'));
  const [managementLoading, setManagementLoading] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceForm, setServiceForm] = useState({
    id: '',
    name: '',
    description: '',
    durationMinutes: '30',
    price: '0',
    professionalIds: [],
  });
  const [scheduleForm, setScheduleForm] = useState({
    weekday: '1',
    startTime: '',
    endTime: '',
    durationMinutes: '30',
    breakDurationMinutes: '0',
  });
  const [blockForm, setBlockForm] = useState({
    blockType: 'custom',
    startDatetime: '',
    endDatetime: '',
    reason: '',
  });
  const [timezoneDraft, setTimezoneDraft] = useState('UTC');
  const [publicSlugDraft, setPublicSlugDraft] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const sessionGeneration = useRef(0);
  const availabilityRequestId = useRef(0);
  const managementRequestId = useRef(0);
  const logoutInProgress = useRef(false);
  const clinicTimezone = user?.clinic_timezone || 'UTC';

  useEffect(() => {
    document.title = logged ? 'Painel | NOA CONNECT' : 'Entrar | NOA CONNECT';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = 'Acesse o sistema de gestão da sua clínica.';
  }, [logged]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      if (mobileMenuWasOpen.current) mobileMenuButtonRef.current?.focus();
      mobileMenuWasOpen.current = false;
      return undefined;
    }

    mobileMenuWasOpen.current = true;
    sidebarCloseRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = sidebarRef.current?.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
      );
      if (!focusableElements?.length) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const endSession = useCallback(() => {
    sessionGeneration.current += 1;
    availabilityRequestId.current += 1;
    managementRequestId.current += 1;
    localStorage.removeItem('clinic_token');
    setForm((previous) => ({ ...previous, password: '' }));
    setLogged(false);
    setUser(null);
    setDashboard(EMPTY_DATA);
    setSubscription(null);
    setSelectedProfessionalId('');
    setSelectedPatientId('');
    setSelectedSpecialtyId('');
    setSelectedServiceId('');
    setServiceForm({
      id: '',
      name: '',
      description: '',
      durationMinutes: '30',
      price: '0',
      professionalIds: [],
    });
    setSelectedSlot('');
    setReschedulingAppointment(null);
    setNotes('');
    setNoteDraft('');
    setEditingNoteId('');
    setAvailability([]);
    setWorkSchedules([]);
    setProfessionalBlocks([]);
    setBlocksLoadMessage('');
    setPageError('');
    setSuccess('');
    navigateRef.current('/login', { replace: true });
  }, []);

  const handleLogout = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    setLoggingOut(true);
    setError('');

    const token = localStorage.getItem('clinic_token');
    let logoutFailed = false;
    try {
      if (token) {
        await apiRequest('/auth/logout', token, { method: 'POST' });
      }
    } catch {
      logoutFailed = Boolean(token);
    } finally {
      endSession();
      setError(logoutFailed ? 'Sessão encerrada localmente.' : '');
      logoutInProgress.current = false;
      setLoggingOut(false);
    }
  };

  const handleRequestError = useCallback((requestError, fallback = 'Não foi possível carregar os dados.') => {
    if (requestError?.status === 401) {
      endSession();
      setError(requestError.message);
      return;
    }
    setPageError(requestError?.message || fallback);
  }, [endSession]);

  const loadDashboard = useCallback(async (token) => {
    const generation = sessionGeneration.current;
    let payloads;
    try {
      payloads = await Promise.all([
        apiRequest('/appointments', token),
        apiRequest('/professionals', token),
        apiRequest('/patients', token),
        apiRequest('/specialties', token),
        apiRequest('/services', token),
      ]);
    } catch (requestError) {
      if (
        generation !== sessionGeneration.current ||
        localStorage.getItem('clinic_token') !== token
      ) {
        return null;
      }
      throw requestError;
    }
    if (
      generation !== sessionGeneration.current ||
      localStorage.getItem('clinic_token') !== token
    ) {
      return null;
    }
    const [appointmentsPayload, professionalsPayload, patientsPayload, specialtiesPayload, servicesPayload] = payloads;
    const next = {
      appointments: dataList(appointmentsPayload),
      professionals: dataList(professionalsPayload),
      patients: dataList(patientsPayload),
      specialties: dataList(specialtiesPayload),
      services: dataList(servicesPayload),
    };
    setDashboard(next);
    setSelectedProfessionalId((current) =>
      next.professionals.some((item) => item.id === current)
        ? current
        : next.professionals.find((item) => item.status === 'active')?.id || ''
    );
    return next;
  }, []);

  const refreshAvailability = useCallback(async (token, professionalId, date, serviceId, appointmentId) => {
    if (!token || !professionalId || !date) {
      availabilityRequestId.current += 1;
      setAvailability([]);
      return [];
    }

    const requestId = ++availabilityRequestId.current;
    setAvailability([]);
    setAvailabilityLoading(true);
    try {
      const query = new URLSearchParams({ date });
      if (serviceId) query.set('serviceId', serviceId);
      if (appointmentId && serviceId) query.set('appointmentId', appointmentId);
      const payload = await apiRequest(
        `/schedules/professionals/${encodeURIComponent(professionalId)}/availability?${query.toString()}`,
        token
      );
      const slots = Array.isArray(payload?.data?.availableSlots) ? payload.data.availableSlots : [];
      if (requestId === availabilityRequestId.current) setAvailability(slots);
      return slots;
    } finally {
      if (requestId === availabilityRequestId.current) setAvailabilityLoading(false);
    }
  }, []);

  const loadProfessionalManagement = useCallback(async (token, professionalId, date) => {
    if (!token || !professionalId || !date) {
      managementRequestId.current += 1;
      setWorkSchedules([]);
      setProfessionalBlocks([]);
      return;
    }

    const requestId = ++managementRequestId.current;
    setManagementLoading(true);
    setProfessionalBlocks([]);
    setBlocksLoadMessage('');
    try {
      const [scheduleResult, availabilityResult] = await Promise.allSettled([
        apiRequest(`/schedules/professionals/${encodeURIComponent(professionalId)}`, token),
        apiRequest(
          `/schedules/professionals/${encodeURIComponent(professionalId)}/availability?date=${encodeURIComponent(date)}`,
          token
        ),
      ]);
      if (requestId !== managementRequestId.current) return;
      if (scheduleResult.status === 'rejected') throw scheduleResult.reason;
      setWorkSchedules(dataList(scheduleResult.value));
      if (availabilityResult.status === 'rejected') {
        if (availabilityResult.reason?.status !== 404) throw availabilityResult.reason;
        setBlocksLoadMessage('A API não retorna disponibilidade para este profissional; verifique se ele está ativo.');
        return;
      }
      setProfessionalBlocks(Array.isArray(availabilityResult.value?.data?.blocks) ? availabilityResult.value.data.blocks : []);
    } finally {
      if (requestId === managementRequestId.current) setManagementLoading(false);
    }
  }, []);

  const loadClinicSettings = useCallback(async (token) => {
    return apiRequest('/settings', token);
  }, []);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('clinic_token');

    if (!token) {
      setSessionReady(true);
      return () => { active = false; };
    }

    (async () => {
      try {
        const me = await apiRequest('/auth/me', token);
        if (!active) return;
        setUser(me?.data || null);
        const timezone = me?.data?.clinic_timezone || 'UTC';
        setSelectedDate(clinicToday(timezone));
        setManagementDate(clinicToday(timezone));
        setLogged(true);
        await loadDashboard(token);
      } catch (requestError) {
        if (!active) return;
        if (requestError?.status === 401) {
          endSession();
          setError(requestError.message);
        } else {
          setPageError(requestError?.message || 'Não foi possível carregar o painel.');
          setLogged(true);
        }
      } finally {
        if (active) setSessionReady(true);
      }
    })();

    return () => { active = false; };
  }, [endSession, loadDashboard]);

  useEffect(() => {
    if (!location.pathname.startsWith('/clinic')) return;
    if (location.pathname !== '/clinic' && !location.pathname.startsWith('/clinic/')) {
      navigate('/', { replace: true });
      return;
    }

    const pathTab = location.pathname.replace(/\/+$/, '').slice('/clinic/'.length);
    if (location.pathname !== '/clinic' && pathTab && !CLINIC_TABS.has(pathTab)) {
      navigate('/', { replace: true });
      return;
    }
    if (sessionReady && !logged) navigate('/login', { replace: true });
  }, [location.pathname, logged, navigate, sessionReady]);

  useEffect(() => {
    if (!logged || !sessionReady || !selectedProfessionalId || !selectedDate) {
      setAvailability([]);
      return undefined;
    }
    if (appointmentMode === 'create' && !selectedServiceId) {
      setAvailability([]);
      return undefined;
    }
    const token = localStorage.getItem('clinic_token');
    if (!token) return undefined;

    let active = true;
    setSelectedSlot('');
    setPageError('');
    refreshAvailability(
      token,
      selectedProfessionalId,
      selectedDate,
      selectedServiceId,
      appointmentMode === 'reschedule' ? reschedulingAppointment?.id : undefined
    )
      .catch((requestError) => {
        if (active) handleRequestError(requestError, 'Não foi possível atualizar a disponibilidade.');
      });

    return () => { active = false; };
  }, [appointmentMode, clinicTimezone, handleRequestError, logged, refreshAvailability, reschedulingAppointment?.id, selectedDate, selectedProfessionalId, selectedServiceId, sessionReady]);

  useEffect(() => {
    if (
      tab !== 'professionals' ||
      !logged ||
      !sessionReady ||
      !selectedProfessionalId ||
      !managementDate ||
      !['admin', 'reception', 'professional'].includes(user?.role)
    ) {
      return undefined;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) return undefined;
    let active = true;
    loadProfessionalManagement(token, selectedProfessionalId, managementDate)
      .catch((requestError) => {
        if (active) handleRequestError(requestError, 'Não foi possível carregar horários e bloqueios.');
      });

    return () => {
      active = false;
      managementRequestId.current += 1;
      setManagementLoading(false);
    };
  }, [
    handleRequestError,
    loadProfessionalManagement,
    logged,
    managementDate,
    clinicTimezone,
    selectedProfessionalId,
    sessionReady,
    tab,
    user?.role,
  ]);

  useEffect(() => {
    if (tab !== 'settings' || !logged || !sessionReady || user?.role !== 'admin') return undefined;
    const token = localStorage.getItem('clinic_token');
    if (!token) return undefined;

    let active = true;
    setSettingsLoading(true);
    loadClinicSettings(token)
      .then((payload) => {
        if (!active) return;
        const timezone = payload?.data?.timezone || 'UTC';
        setTimezoneDraft(timezone);
        setPublicSlugDraft(payload?.data?.public_slug || '');
        setUser((current) => current ? { ...current, clinic_timezone: timezone } : current);
      })
      .catch((requestError) => {
        if (active) handleRequestError(requestError, 'Não foi possível carregar as configurações da clínica.');
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });

    return () => { active = false; };
  }, [handleRequestError, loadClinicSettings, logged, sessionReady, tab, user?.role]);

  useEffect(() => {
    if (!logged || !sessionReady || user?.role !== 'admin') {
      setSubscription(null);
      return undefined;
    }
    const token = localStorage.getItem('clinic_token');
    if (!token) return undefined;

    let active = true;
    setSubscriptionLoading(true);
    apiRequest('/subscriptions/current', token)
      .then((payload) => {
        if (active) setSubscription(payload?.data || null);
      })
      .catch((requestError) => {
        if (active) handleRequestError(requestError, 'Não foi possível carregar a assinatura da clínica.');
      })
      .finally(() => {
        if (active) setSubscriptionLoading(false);
      });

    return () => { active = false; };
  }, [handleRequestError, logged, sessionReady, user?.role]);

  const activeTabLabel = useMemo(() => ({
    dashboard: 'Dashboard',
    professionals: 'Profissionais',
    services: 'Serviços',
    schedule: 'Agenda',
    appointments: 'Consultas',
    settings: 'Configurações',
  }[tab] || 'Dashboard'), [tab]);
  const pageDescription = {
    dashboard: 'Uma visão clara para cuidar de cada atendimento.',
    professionals: 'Profissionais, horários de trabalho e bloqueios da clínica.',
    services: 'Organize os serviços e suas associações com profissionais.',
    schedule: 'Consulte a disponibilidade e organize novos atendimentos.',
    appointments: 'Acompanhe, atualize e reagende as consultas da clínica.',
    settings: 'Preferências de fuso horário e agendamento público.',
  }[tab] || '';

  const handleChange = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const navigateTo = (nextTab) => {
    navigate(nextTab === 'dashboard' ? '/clinic/dashboard' : `/clinic/${nextTab}`);
    setMobileMenuOpen(false);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setPageError('');

    try {
      const payload = await apiRequest('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      if (payload?.data?.requiresClinicSelection) {
        if (
          typeof payload.data.selectionToken !== 'string' ||
          !Array.isArray(payload.data.clinics) ||
          payload.data.clinics.length < 2
        ) {
          throw new Error('A resposta de autenticação não contém uma seleção válida.');
        }
        setClinicSelection({
          selectionToken: payload.data.selectionToken,
          clinics: payload.data.clinics,
        });
        setForm((previous) => ({ ...previous, password: '' }));
        return;
      }
      const token = payload?.data?.token;
      if (!token) throw new Error('A resposta de autenticação não contém uma sessão válida.');

      sessionGeneration.current += 1;
      localStorage.setItem('clinic_token', token);
      setUser(payload.data.user || null);
      const timezone = payload.data.user?.clinic_timezone || 'UTC';
      setSelectedDate(clinicToday(timezone));
      setManagementDate(clinicToday(timezone));
      setLogged(true);
      setSessionReady(true);
      navigate('/clinic/dashboard', { replace: true });
      try {
        await loadDashboard(token);
      } catch (requestError) {
        handleRequestError(requestError, 'Sessão iniciada, mas não foi possível carregar os dados.');
      }
    } catch (requestError) {
      setError(requestError?.message || 'Não foi possível entrar. Verifique os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleClinicSelection = async (clinicId) => {
    if (!clinicSelection) return;
    setLoading(true);
    setError('');
    setPageError('');

    try {
      const payload = await apiRequest('/auth/login/select-clinic', null, {
        method: 'POST',
        body: JSON.stringify({
          selectionToken: clinicSelection.selectionToken,
          clinicId,
        }),
      });
      const token = payload?.data?.token;
      if (!token) throw new Error('A resposta de autenticação não contém uma sessão válida.');

      setClinicSelection(null);
      sessionGeneration.current += 1;
      localStorage.setItem('clinic_token', token);
      setUser(payload.data.user || null);
      const timezone = payload.data.user?.clinic_timezone || 'UTC';
      setSelectedDate(clinicToday(timezone));
      setManagementDate(clinicToday(timezone));
      setLogged(true);
      setSessionReady(true);
      navigate('/clinic/dashboard', { replace: true });
      try {
        await loadDashboard(token);
      } catch (requestError) {
        handleRequestError(requestError, 'Sessão iniciada, mas não foi possível carregar os dados.');
      }
    } catch (requestError) {
      setError(requestError?.message || 'Não foi possível entrar. Verifique os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const reloadData = async () => {
    const token = localStorage.getItem('clinic_token');
    if (!token) return;
    setPageError('');
    try {
      await loadDashboard(token);
    } catch (requestError) {
      handleRequestError(requestError);
    }
  };

  const beginReschedule = (appointment) => {
    setReschedulingAppointment(appointment);
    setAppointmentMode('reschedule');
    setSelectedProfessionalId(appointment.professional_id || '');
    setSelectedPatientId(appointment.patient_id || '');
    setSelectedSpecialtyId(appointment.specialty_id || '');
    setSelectedServiceId(appointment.service_id || '');
    setSelectedDate(clinicDateAt(appointment.scheduled_start, clinicTimezone) || clinicToday(clinicTimezone));
    setSelectedSlot('');
    setNotes(appointment.notes || '');
    navigateTo('schedule');
    setPageError('');
    setSuccess('');
  };

  const handleSettingsSubmit = async (event) => {
    event.preventDefault();
    const timezone = timezoneDraft.trim();
    if (!isValidIanaTimeZone(timezone)) {
      setPageError('Informe um identificador IANA válido, por exemplo America/Sao_Paulo.');
      return;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }

    setSettingsBusy(true);
    setPageError('');
    setSuccess('');
    try {
      const payload = await apiRequest('/settings', token, {
        method: 'POST',
        body: JSON.stringify({ timezone, publicSlug: publicSlugDraft.trim() }),
      });
      const savedTimezone = payload?.data?.timezone;
      if (!savedTimezone) throw new Error('A API não confirmou o fuso horário salvo.');
      setUser((current) => current ? { ...current, clinic_timezone: savedTimezone } : current);
      setTimezoneDraft(savedTimezone);
      setPublicSlugDraft(payload?.data?.public_slug || '');
      setSelectedDate(clinicToday(savedTimezone));
      setManagementDate(clinicToday(savedTimezone));
      setBlockForm((current) => ({ ...current, startDatetime: '', endDatetime: '' }));
      setSuccess('Configurações da clínica atualizadas.');
    } catch (requestError) {
      handleRequestError(requestError, 'Não foi possível atualizar o fuso horário da clínica.');
    } finally {
      setSettingsBusy(false);
    }
  };

  const selectMode = (mode) => {
    setAppointmentMode(mode);
    setReschedulingAppointment(null);
    if (mode === 'create') setSelectedServiceId('');
    setSelectedSlot('');
    setPageError('');
    setSuccess('');
  };

  const editService = (service) => {
    setServiceForm({
      id: service.id,
      name: service.name,
      description: service.description || '',
      durationMinutes: String(service.duration_minutes),
      price: String(service.price),
      professionalIds: service.professional_ids || [],
    });
    setPageError('');
    setSuccess('');
  };

  const resetServiceForm = () => {
    setServiceForm({
      id: '',
      name: '',
      description: '',
      durationMinutes: '30',
      price: '0',
      professionalIds: [],
    });
  };

  const handleServiceSubmit = async (event) => {
    event.preventDefault();
    if (serviceBusy) return;
    const durationMinutes = Number(serviceForm.durationMinutes);
    const price = Number(serviceForm.price);
    if (
      !serviceForm.name.trim() ||
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1440 ||
      !MONEY_INPUT_PATTERN.test(serviceForm.price) ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 99_999_999.99
    ) {
      setPageError('Informe nome, duração entre 1 e 1440 minutos e preço com até duas casas decimais.');
      return;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }
    setServiceBusy(true);
    setPageError('');
    setSuccess('');
    try {
      const body = {
        name: serviceForm.name.trim(),
        description: serviceForm.description.trim() || null,
        durationMinutes,
        price,
        professionalIds: serviceForm.professionalIds,
      };
      await apiRequest(
        serviceForm.id ? `/services/${encodeURIComponent(serviceForm.id)}` : '/services',
        token,
        {
          method: serviceForm.id ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        }
      );
      setSuccess(serviceForm.id ? 'Serviço atualizado.' : 'Serviço cadastrado.');
      resetServiceForm();
      await loadDashboard(token);
    } catch (requestError) {
      handleRequestError(requestError, 'Não foi possível salvar o serviço.');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleServiceStatus = async (service) => {
    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }
    setServiceBusy(true);
    setPageError('');
    setSuccess('');
    try {
      await apiRequest(`/services/${encodeURIComponent(service.id)}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !service.is_active }),
      });
      setSuccess(service.is_active ? 'Serviço desativado.' : 'Serviço ativado.');
      await loadDashboard(token);
    } catch (requestError) {
      handleRequestError(requestError, 'Não foi possível alterar o status do serviço.');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleScheduleSubmit = async (event) => {
    event.preventDefault();
    const weekday = Number(scheduleForm.weekday);
    const durationMinutes = Number(scheduleForm.durationMinutes);
    const breakDurationMinutes = Number(scheduleForm.breakDurationMinutes);
    if (
      !selectedProfessionalId ||
      !scheduleForm.durationMinutes ||
      !scheduleForm.breakDurationMinutes ||
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7 ||
      !scheduleForm.startTime ||
      !scheduleForm.endTime ||
      scheduleForm.startTime >= scheduleForm.endTime ||
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      !Number.isSafeInteger(breakDurationMinutes) ||
      breakDurationMinutes < 0
    ) {
      setPageError('Informe um expediente crescente, duração positiva e intervalo igual ou maior que zero.');
      return;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }

    setScheduleBusy(true);
    setPageError('');
    setSuccess('');
    try {
      await apiRequest(`/schedules/professionals/${encodeURIComponent(selectedProfessionalId)}`, token, {
        method: 'POST',
        body: JSON.stringify({
          weekday,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
          durationMinutes,
          breakDurationMinutes,
        }),
      });
      setSuccess('Horário de trabalho cadastrado.');
      setScheduleForm((current) => ({ ...current, startTime: '', endTime: '' }));
      await loadProfessionalManagement(token, selectedProfessionalId, managementDate);
      await refreshAvailability(token, selectedProfessionalId, selectedDate, selectedServiceId);
    } catch (requestError) {
      if (requestError?.status === 409) {
        setPageError('Esse horário de trabalho já está cadastrado para o profissional.');
      } else {
        handleRequestError(requestError, 'Não foi possível cadastrar o horário de trabalho.');
      }
    } finally {
      setScheduleBusy(false);
    }
  };

  const handleBlockSubmit = async (event) => {
    event.preventDefault();
    const startDatetime = clinicDateTimeToIso(blockForm.startDatetime, clinicTimezone);
    const endDatetime = clinicDateTimeToIso(blockForm.endDatetime, clinicTimezone);
    if (
      !selectedProfessionalId ||
      !BLOCK_TYPES.some((type) => type.value === blockForm.blockType) ||
      !startDatetime ||
      !endDatetime ||
      Date.parse(startDatetime) >= Date.parse(endDatetime)
    ) {
      setPageError('Informe tipo e horários locais válidos e não ambíguos; o término deve ser posterior ao início.');
      return;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }

    setBlockBusy(true);
    setPageError('');
    setSuccess('');
    try {
      await apiRequest(
        `/schedules/professionals/${encodeURIComponent(selectedProfessionalId)}/blocks`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            blockType: blockForm.blockType,
            startDatetime,
            endDatetime,
            reason: blockForm.reason.trim() || null,
          }),
        }
      );
      setSuccess('Bloqueio cadastrado.');
      setBlockForm((current) => ({ ...current, startDatetime: '', endDatetime: '', reason: '' }));
      await loadProfessionalManagement(token, selectedProfessionalId, managementDate);
      await refreshAvailability(token, selectedProfessionalId, selectedDate, selectedServiceId);
    } catch (requestError) {
      if (requestError?.status === 409) {
        setPageError('Não foi possível cadastrar o bloqueio: existe conflito com um agendamento ativo.');
      } else {
        handleRequestError(requestError, 'Não foi possível cadastrar o bloqueio.');
      }
    } finally {
      setBlockBusy(false);
    }
  };

  const handleAppointmentSubmit = async (event) => {
    event.preventDefault();
    if (!selectedSlot || appointmentBusy) return;
    const slot = availability.find((item) => item.scheduledStart === selectedSlot);
    if (!slot) {
      setPageError('Esse horário não está mais na lista de disponíveis. Atualize a disponibilidade e selecione outro.');
      return;
    }

    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }

    setAppointmentBusy(true);
    setPageError('');
    setSuccess('');
    try {
      const body = appointmentMode === 'reschedule'
        ? {
            professionalId: selectedProfessionalId,
            specialtyId: selectedSpecialtyId || undefined,
            serviceId: selectedServiceId || undefined,
            scheduledStart: slot.scheduledStart,
            scheduledEnd: slot.scheduledEnd,
          }
        : {
            patientId: selectedPatientId,
            professionalId: selectedProfessionalId,
            specialtyId: selectedSpecialtyId || undefined,
            serviceId: selectedServiceId,
            scheduledStart: slot.scheduledStart,
            scheduledEnd: slot.scheduledEnd,
            notes: notes || undefined,
          };
      const endpoint = appointmentMode === 'reschedule'
        ? `/appointments/${encodeURIComponent(reschedulingAppointment.id)}/reschedule`
        : '/appointments';

      await apiRequest(endpoint, token, {
        method: appointmentMode === 'reschedule' ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setSuccess(appointmentMode === 'reschedule' ? 'Agendamento reagendado com sucesso.' : 'Agendamento criado com sucesso.');
      setSelectedSlot('');
      if (appointmentMode === 'reschedule') {
        setAppointmentMode('create');
        setReschedulingAppointment(null);
        setSelectedServiceId('');
      } else {
        setNotes('');
      }
      await loadDashboard(token);
      await refreshAvailability(
        token,
        selectedProfessionalId,
        selectedDate,
        selectedServiceId,
        appointmentMode === 'reschedule' ? reschedulingAppointment?.id : undefined
      );
      navigateTo('appointments');
    } catch (requestError) {
      if (requestError?.status === 409) {
        setPageError('Esse horário acabou de ser ocupado. A disponibilidade foi atualizada; selecione outro horário.');
        setSelectedSlot('');
        try {
          await refreshAvailability(
            token,
            selectedProfessionalId,
            selectedDate,
            selectedServiceId,
            appointmentMode === 'reschedule' ? reschedulingAppointment?.id : undefined
          );
        } catch (refreshError) {
          handleRequestError(refreshError, 'Não foi possível atualizar a disponibilidade.');
        }
      } else {
        handleRequestError(requestError, 'Não foi possível salvar o agendamento.');
      }
    } finally {
      setAppointmentBusy(false);
    }
  };

  const handleCancel = async (appointment) => {
    if (!window.confirm('Deseja cancelar este agendamento?')) return;
    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }

    setAppointmentBusy(true);
    setPageError('');
    setSuccess('');
    try {
      await apiRequest(`/appointments/${encodeURIComponent(appointment.id)}/cancel`, token, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      setSuccess('Agendamento cancelado.');
      await loadDashboard(token);
      if (selectedProfessionalId) {
        await refreshAvailability(token, selectedProfessionalId, selectedDate, selectedServiceId);
      }
    } catch (requestError) {
      handleRequestError(requestError, 'Não foi possível cancelar o agendamento.');
    } finally {
      setAppointmentBusy(false);
    }
  };

  const handleNotesUpdate = async (appointmentId) => {
    const token = localStorage.getItem('clinic_token');
    if (!token) {
      endSession();
      return;
    }
    setNotesBusy(true);
    setPageError('');
    try {
      await apiRequest(`/appointments/${encodeURIComponent(appointmentId)}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ notes: noteDraft }),
      });
      setEditingNoteId('');
      setSuccess('Observação atualizada.');
      await loadDashboard(token);
    } catch (requestError) {
      handleRequestError(requestError, 'Não foi possível atualizar a observação.');
    } finally {
      setNotesBusy(false);
    }
  };

  const activeProfessionals = dashboard.professionals.filter((item) => item.status === 'active');
  const activePatients = dashboard.patients.filter((item) => item.status === 'active');
  const selectableServices = dashboard.services.filter((item) => item.is_active);
  const rescheduleServiceOption = reschedulingAppointment?.service_id
    ? [dashboard.services.find((item) => item.id === reschedulingAppointment.service_id) || {
        id: reschedulingAppointment.service_id,
        name: reschedulingAppointment.service_name_snapshot || 'Serviço do agendamento',
        duration_minutes: reschedulingAppointment.service_duration_snapshot,
        price: reschedulingAppointment.service_price_snapshot,
        professional_ids: [reschedulingAppointment.professional_id],
      }]
    : [];
  const appointmentServiceOptions = appointmentMode === 'reschedule'
    ? rescheduleServiceOption
    : selectableServices;
  const availableProfessionals = activeProfessionals.filter((professional) =>
    !selectedServiceId || appointmentServiceOptions.some((service) =>
      service.id === selectedServiceId && (service.professional_ids || []).includes(professional.id)
    )
  );
  const selectedProfessional = dashboard.professionals.find((item) => item.id === selectedProfessionalId);
  const matchingSpecialties = selectedProfessional?.specialty_id
    ? dashboard.specialties.filter((item) => item.id === selectedProfessional.specialty_id && item.status === 'active')
    : [];
  const canManageAppointments = ['admin', 'reception', 'patient'].includes(user?.role);
  const canManageProfessionalSchedule = ['admin', 'reception'].includes(user?.role);
  const canViewProfessionalSchedule = ['admin', 'reception', 'professional'].includes(user?.role);
  const displayAppointments = dashboard.appointments;
  const dashboardStats = [
    { label: 'Consultas hoje', value: String(displayAppointments.filter((item) => clinicDateAt(item.scheduled_start, clinicTimezone) === clinicToday(clinicTimezone)).length) },
    { label: 'Próximas', value: String(displayAppointments.filter((item) => new Date(item.scheduled_start) >= new Date() && item.status !== 'cancelled').length) },
    { label: 'Profissionais', value: String(dashboard.professionals.length) },
    { label: 'Status', value: user?.role || '—' },
  ];

  if (!sessionReady) {
    return <main className="auth-screen"><p>Carregando sessão...</p></main>;
  }

  if (!logged) {
    return (
      <div className="auth-screen">
        <div className="auth-toolbar"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <div className="auth-card">
          {window.location.pathname.replace(/\/+$/, '') === '/login' ? (
            <a className="auth-back-link" href="/">← Voltar ao site</a>
          ) : null}
          <div className="auth-brand">
            <img className="brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" />
          </div>
          <p className="eyebrow">Sistema de agendamento</p>
          <h1>Entrar</h1>
          <p className="muted-text auth-description">Acesse sua conta para continuar.</p>
          {clinicSelection ? (
            <section className="auth-clinic-selection" aria-labelledby="clinic-selection-heading">
              <h2 id="clinic-selection-heading">Escolha a clínica</h2>
              <p className="muted-text auth-description">Sua conta tem acesso a mais de uma clínica.</p>
              <div className="auth-form">
                {clinicSelection.clinics.map((clinic) => (
                  <button
                    type="button"
                    className="auth-clinic-choice"
                    key={clinic.clinicId}
                    onClick={() => handleClinicSelection(clinic.clinicId)}
                    disabled={loading}
                  >
                    {clinic.name} · {clinic.clinicId.slice(-4)}
                  </button>
                ))}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setClinicSelection(null);
                    setError('');
                  }}
                  disabled={loading}
                >
                  Voltar ao login
                </button>
              </div>
              {error ? <p className="error-text" role="alert">{error}</p> : null}
            </section>
          ) : (
            <form className="auth-form" onSubmit={handleLogin}>
              <label>
                E-mail
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => handleChange('email', event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => handleChange('password', event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error ? <p className="error-text" role="alert">{error}</p> : null}
              <button type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      {mobileMenuOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Fechar menu"
        />
      ) : null}
      <aside ref={sidebarRef} id="main-navigation" className={`sidebar${mobileMenuOpen ? ' sidebar-open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src="/noa-connect-logo.png" alt="NOA CONNECT" />
          <button
            type="button"
            className="sidebar-close"
            ref={sidebarCloseRef}
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="nav" aria-label="Navegação principal">
          <button type="button" className={`nav-link${tab === 'dashboard' ? ' active' : ''}`} onClick={() => navigateTo('dashboard')} aria-current={tab === 'dashboard' ? 'page' : undefined}>
            <Icon name="dashboard" /><span>Dashboard</span>
          </button>
          <button type="button" className={`nav-link${tab === 'schedule' ? ' active' : ''}`} onClick={() => navigateTo('schedule')} aria-current={tab === 'schedule' ? 'page' : undefined}>
            <Icon name="schedule" /><span>Agenda</span>
          </button>
          <button type="button" className={`nav-link${tab === 'appointments' ? ' active' : ''}`} onClick={() => navigateTo('appointments')} aria-current={tab === 'appointments' ? 'page' : undefined}>
            <Icon name="appointments" /><span>Consultas</span>
          </button>
          <button type="button" className={`nav-link${tab === 'professionals' ? ' active' : ''}`} onClick={() => navigateTo('professionals')} aria-current={tab === 'professionals' ? 'page' : undefined}>
            <Icon name="professionals" /><span>Profissionais</span>
          </button>
          {['admin', 'reception'].includes(user?.role) ? (
            <button type="button" className={`nav-link${tab === 'services' ? ' active' : ''}`} onClick={() => navigateTo('services')} aria-current={tab === 'services' ? 'page' : undefined}>
              <Icon name="services" /><span>Serviços</span>
            </button>
          ) : null}
          {user?.role === 'admin' ? (
            <button type="button" className={`nav-link${tab === 'settings' ? ' active' : ''}`} onClick={() => navigateTo('settings')} aria-current={tab === 'settings' ? 'page' : undefined}>
              <Icon name="settings" /><span>Configurações</span>
            </button>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <span className="user-avatar" aria-hidden="true">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</span>
          <span className="sidebar-user">
            <strong>{user?.name || 'Usuário'}</strong>
            <small>{user?.role || '—'}</small>
          </span>
          <button type="button" className="logout-button" onClick={handleLogout} disabled={loggingOut} aria-label={loggingOut ? 'Encerrando sessão' : 'Sair'}>
            <Icon name="close" />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu-toggle"
            ref={mobileMenuButtonRef}
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="main-navigation"
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb" aria-label="Localização">
            <span>Clínica</span><span className="breadcrumb-separator" aria-hidden="true">›</span>
            <strong>{activeTabLabel}</strong>
          </div>
          <div className="topbar-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <div className="user-box">
              <span className="user-avatar" aria-hidden="true">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</span>
              <span className="user-details">
                <strong>{user?.name || 'Usuário'}</strong>
                <small>{user?.role || '—'} · {clinicTimezone}</small>
              </span>
            </div>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <p className="eyebrow">Painel administrativo</p>
            <h1>{tab === 'dashboard' ? `Bom dia, ${user?.name?.split(' ')[0] || 'bem-vindo(a)'}` : activeTabLabel}</h1>
            <p className="page-description">{pageDescription}</p>
          </div>
        </section>

        {pageError ? <p className="error-text page-message" role="alert">{pageError}</p> : null}
        {success ? <p className="success-text page-message" role="status">{success}</p> : null}

        {tab === 'settings' && user?.role === 'admin' ? (
          <section className="panel">
            <h3>Configurações públicas da clínica</h3>
            <p className="muted-text">
              Use um identificador IANA, por exemplo <code>America/Sao_Paulo</code> ou <code>Europe/Lisbon</code>.
              O horário operacional não depende do fuso do navegador.
            </p>
            <form className="appointment-form" onSubmit={handleSettingsSubmit}>
              <label>
                Fuso horário IANA
                <input
                  type="text"
                  value={timezoneDraft}
                  onChange={(event) => setTimezoneDraft(event.target.value)}
                  placeholder="America/Sao_Paulo"
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Identificador do link público
                <input
                  type="text"
                  value={publicSlugDraft}
                  onChange={(event) => setPublicSlugDraft(event.target.value.toLowerCase())}
                  placeholder="minha-clinica"
                  maxLength="63"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  autoComplete="off"
                />
              </label>
              <p className="muted-text form-wide">
                {publicSlugDraft.trim()
                  ? <>Link público: <a href={`/booking/${encodeURIComponent(publicSlugDraft.trim())}`} target="_blank" rel="noreferrer">{`${window.location.origin}/booking/${publicSlugDraft.trim()}`}</a></>
                  : 'Deixe o identificador vazio para desativar o agendamento público.'}
              </p>
              <p className="muted-text form-wide">
                Horários locais inexistentes ou repetidos durante mudanças de horário de verão não são aceitos.
              </p>
              <button type="submit" className="form-wide" disabled={settingsBusy || settingsLoading}>
                {settingsLoading ? 'Carregando...' : settingsBusy ? 'Salvando...' : 'Salvar configurações'}
              </button>
            </form>
          </section>
        ) : null}

        {tab === 'dashboard' && (
          <>
            <section className="stats-grid">
              {dashboardStats.map((item) => (
                <article key={item.label} className="stat-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </section>

            {user?.role === 'admin' ? (
              <section className="panel subscription-summary" aria-labelledby="subscription-summary-heading">
                <div className="panel-heading">
                  <div>
                    <h3 id="subscription-summary-heading">Plano da clínica</h3>
                    {subscriptionLoading ? (
                      <p className="muted-text" role="status">Carregando assinatura...</p>
                    ) : subscription ? (
                      <p className="muted-text">
                        {subscription.planName} · {subscription.billingCycleLabel} · {subscription.status}
                      </p>
                    ) : (
                      <p className="muted-text">Nenhuma assinatura cadastrada para esta clínica.</p>
                    )}
                  </div>
                  <a className="secondary-button" href="/planos">Ver planos</a>
                </div>
                {subscription?.limits ? (
                  <ul className="subscription-limit-list">
                    {Object.entries(subscription.limits).map(([resource, limit]) => (
                      <li key={resource}>
                        <span>{resource}</span>
                        <strong>{limit === null ? 'Ilimitado' : limit}</strong>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-heading">
                <h3>Próximas consultas</h3>
                <button type="button" className="secondary-button" onClick={reloadData}>Atualizar</button>
              </div>
              {displayAppointments.length ? (
                <div className="table-scroll" tabIndex={0} aria-label="Tabela de próximas consultas">
                  <table>
                    <thead>
                      <tr><th>Paciente</th><th>Profissional</th><th>Serviço</th><th>Especialidade</th><th>Horário</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {displayAppointments.map((item) => (
                        <tr key={item.id}>
                          <td>{item.patient_name || 'Paciente'}</td>
                          <td>{item.professional_name || 'Profissional'}</td>
                          <td>
                            {item.service_name_snapshot || '—'}
                            {item.service_name_snapshot ? (
                              <small className="muted-text">
                                <br />
                                {Number(item.service_price_snapshot).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                {' — '}{item.service_duration_snapshot} min
                              </small>
                            ) : null}
                          </td>
                          <td>{item.specialty_name || '—'}</td>
                          <td>{formatDateTime(item.scheduled_start, clinicTimezone)}</td>
                          <td><span className={appointmentStatusClass(item.status)}>{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted-text">Nenhum agendamento encontrado.</p>}
            </section>
          </>
        )}

        {tab === 'professionals' && (
          <>
            <section className="panel">
              <h3>Profissionais</h3>
              {dashboard.professionals.length ? (
                <div className="table-scroll" tabIndex={0} aria-label="Tabela de profissionais">
                  <table>
                    <thead><tr><th>Nome</th><th>Especialidade</th><th>Status</th></tr></thead>
                    <tbody>
                      {dashboard.professionals.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.specialty_name || 'Sem especialidade'}</td>
                          <td><span className="badge muted">{item.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted-text">Nenhum profissional encontrado.</p>}
            </section>

            {canViewProfessionalSchedule ? (
              <section className="panel professional-management">
                <div className="panel-heading">
                  <h3>Horários de trabalho e bloqueios</h3>
                  {managementLoading ? <span className="muted-text">Atualizando...</span> : null}
                </div>
                <div className="professional-management-controls">
                  <label>
                    Profissional
                    <select
                      value={selectedProfessionalId}
                      onChange={(event) => {
                        setSelectedProfessionalId(event.target.value);
                        setWorkSchedules([]);
                        setProfessionalBlocks([]);
                        setBlocksLoadMessage('');
                      }}
                    >
                      <option value="">Selecione um profissional</option>
                      {dashboard.professionals.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Data dos bloqueios
                    <input
                      type="date"
                      value={managementDate}
                      onChange={(event) => setManagementDate(event.target.value)}
                    />
                  </label>
                </div>

                {selectedProfessionalId ? (
                  <>
                    <section className="management-subsection">
                      <h4>Horários de trabalho</h4>
                      {managementLoading && workSchedules.length === 0 ? (
                        <p className="muted-text">Carregando horários...</p>
                      ) : workSchedules.length ? (
                        <ul className="professional-schedule-list">
                          {WEEKDAYS.map((day) => {
                            const daySchedules = workSchedules.filter((item) => Number(item.weekday) === day.value);
                            if (daySchedules.length === 0) return null;
                            return (
                              <li key={day.value}>
                                <strong>{day.label}</strong>
                                <div className="professional-schedule-intervals">
                                  {daySchedules.map((item) => (
                                    <span key={item.id}>
                                      {String(item.start_time).slice(0, 5)} — {String(item.end_time).slice(0, 5)}
                                      {' '}({item.duration_minutes} min; intervalo {item.break_duration_minutes} min)
                                      {' '}<span className="badge muted">{item.status}</span>
                                    </span>
                                  ))}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="muted-text">Nenhum horário de trabalho cadastrado.</p>
                      )}

                      {canManageProfessionalSchedule ? (
                        <form className="appointment-form management-form" onSubmit={handleScheduleSubmit}>
                          <label>
                            Dia da semana
                            <select
                              value={scheduleForm.weekday}
                              onChange={(event) => setScheduleForm((current) => ({ ...current, weekday: event.target.value }))}
                              required
                            >
                              {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                            </select>
                          </label>
                          <label>
                            Horário inicial
                            <input
                              type="time"
                              value={scheduleForm.startTime}
                              onChange={(event) => setScheduleForm((current) => ({ ...current, startTime: event.target.value }))}
                              required
                            />
                          </label>
                          <label>
                            Horário final
                            <input
                              type="time"
                              value={scheduleForm.endTime}
                              onChange={(event) => setScheduleForm((current) => ({ ...current, endTime: event.target.value }))}
                              required
                            />
                          </label>
                          <label>
                            Duração do atendimento (min)
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={scheduleForm.durationMinutes}
                              onChange={(event) => setScheduleForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                              required
                            />
                          </label>
                          <label>
                            Intervalo entre slots (min)
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={scheduleForm.breakDurationMinutes}
                              onChange={(event) => setScheduleForm((current) => ({ ...current, breakDurationMinutes: event.target.value }))}
                              required
                            />
                          </label>
                          <button type="submit" className="form-wide" disabled={scheduleBusy}>
                            {scheduleBusy ? 'Salvando...' : 'Cadastrar horário'}
                          </button>
                        </form>
                      ) : null}
                    </section>

                    <section className="management-subsection">
                      <h4>Bloqueios ativos em {managementDate}</h4>
                      {blocksLoadMessage ? (
                        <p className="muted-text" role="status">{blocksLoadMessage}</p>
                      ) : managementLoading && professionalBlocks.length === 0 ? (
                        <p className="muted-text">Carregando bloqueios...</p>
                      ) : professionalBlocks.length ? (
                        <ul className="professional-schedule-list">
                          {professionalBlocks.map((item) => (
                            <li key={item.id}>
                              <strong>{BLOCK_TYPES.find((type) => type.value === item.block_type)?.label || item.block_type}</strong>
                              <span>
                                {formatClinicDateTime(item.start_datetime, clinicTimezone)} — {formatClinicDateTime(item.end_datetime, clinicTimezone)}
                              </span>
                              {item.reason ? <span className="muted-text">{item.reason}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted-text">Nenhum bloqueio ativo para esta data.</p>
                      )}

                      {canManageProfessionalSchedule ? (
                        <form className="appointment-form management-form" onSubmit={handleBlockSubmit}>
                          <label>
                            Tipo de bloqueio
                            <select
                              value={blockForm.blockType}
                              onChange={(event) => setBlockForm((current) => ({ ...current, blockType: event.target.value }))}
                              required
                            >
                              {BLOCK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                            </select>
                          </label>
                          <label>
                            Início (fuso da clínica)
                            <input
                              type="datetime-local"
                              value={blockForm.startDatetime}
                              onChange={(event) => setBlockForm((current) => ({ ...current, startDatetime: event.target.value }))}
                              required
                            />
                          </label>
                          <label>
                            Fim (fuso da clínica)
                            <input
                              type="datetime-local"
                              value={blockForm.endDatetime}
                              onChange={(event) => setBlockForm((current) => ({ ...current, endDatetime: event.target.value }))}
                              required
                            />
                          </label>
                          <label className="form-wide">
                            Motivo
                            <textarea
                              value={blockForm.reason}
                              onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))}
                              rows="2"
                            />
                          </label>
                          <p className="muted-text form-wide">Horários inexistentes ou repetidos por mudança de horário de verão são rejeitados.</p>
                          <button type="submit" className="form-wide" disabled={blockBusy}>
                            {blockBusy ? 'Salvando...' : 'Cadastrar bloqueio'}
                          </button>
                        </form>
                      ) : null}
                    </section>
                  </>
                ) : (
                  <p className="muted-text">Selecione um profissional para consultar a agenda.</p>
                )}
              </section>
            ) : null}
          </>
        )}

        {tab === 'services' && ['admin', 'reception'].includes(user?.role) ? (
          <section className="panel">
            <div className="panel-heading">
              <h3>Catálogo de serviços</h3>
              <button type="button" className="secondary-button" onClick={reloadData}>Atualizar</button>
            </div>
            <form className="appointment-form management-form" onSubmit={handleServiceSubmit}>
              <label>
                Nome
                <input
                  value={serviceForm.name}
                  onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))}
                  maxLength="200"
                  required
                />
              </label>
              <label>
                Duração (minutos)
                <input
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  value={serviceForm.durationMinutes}
                  onChange={(event) => setServiceForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                  required
                />
              </label>
              <label>
                Preço
                <input
                  type="number"
                  min="0"
                  max="99999999.99"
                  step="0.01"
                  value={serviceForm.price}
                  onChange={(event) => setServiceForm((current) => ({ ...current, price: event.target.value }))}
                  required
                />
              </label>
              <label>
                Profissionais
                <select
                  multiple
                  value={serviceForm.professionalIds}
                  onChange={(event) => setServiceForm((current) => ({
                    ...current,
                    professionalIds: Array.from(event.target.selectedOptions, (option) => option.value),
                  }))}
                >
                  {activeProfessionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="form-wide">
                Descrição
                <textarea
                  value={serviceForm.description}
                  onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))}
                  maxLength="2000"
                  rows="2"
                />
              </label>
              <div className="form-wide appointment-actions">
                <button type="submit" disabled={serviceBusy}>
                  {serviceBusy ? 'Salvando...' : serviceForm.id ? 'Salvar alterações' : 'Cadastrar serviço'}
                </button>
                {serviceForm.id ? (
                  <button type="button" className="secondary-button" onClick={resetServiceForm}>Cancelar edição</button>
                ) : null}
              </div>
            </form>
            {dashboard.services.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Serviço</th><th>Duração</th><th>Preço</th><th>Profissionais</th><th>Status</th><th>Ações</th></tr>
                  </thead>
                  <tbody>
                    {dashboard.services.map((service) => (
                      <tr key={service.id}>
                        <td>{service.name}{service.description ? <small className="muted-text"><br />{service.description}</small> : null}</td>
                        <td>{service.duration_minutes} min</td>
                        <td>{Number(service.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                        <td>{(service.professional_ids || [])
                          .map((id) => dashboard.professionals.find((professional) => professional.id === id)?.name)
                          .filter(Boolean)
                          .join(', ') || '—'}</td>
                        <td><span className="badge muted">{service.is_active ? 'Ativo' : 'Inativo'}</span></td>
                        <td>
                          <div className="appointment-actions">
                            <button type="button" className="secondary-button" onClick={() => editService(service)}>Editar</button>
                            <button type="button" className={service.is_active ? 'danger-button' : 'secondary-button'} disabled={serviceBusy} onClick={() => handleServiceStatus(service)}>
                              {service.is_active ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted-text">Nenhum serviço cadastrado.</p>}
          </section>
        ) : null}

        {tab === 'schedule' && (
          <>
            <section className="panel">
              <div className="panel-heading">
                <h3>{appointmentMode === 'reschedule' ? 'Reagendar consulta' : 'Novo agendamento'}</h3>
                {appointmentMode === 'reschedule' ? (
                  <button type="button" className="secondary-button" onClick={() => selectMode('create')}>Cancelar reagendamento</button>
                ) : null}
              </div>
              {canManageAppointments ? (
                <form className="appointment-form" onSubmit={handleAppointmentSubmit}>
                  {appointmentMode === 'reschedule' && reschedulingAppointment ? (
                    <p className="muted-text">
                      Reagendando consulta de {reschedulingAppointment.patient_name || 'Paciente'}.
                    </p>
                  ) : null}
                  <label>
                    Serviço
                    <select
                      value={selectedServiceId}
                      onChange={(event) => {
                        setSelectedServiceId(event.target.value);
                        if (appointmentMode === 'create') setSelectedProfessionalId('');
                        setSelectedSlot('');
                      }}
                      required={appointmentMode === 'create' || Boolean(reschedulingAppointment?.service_id)}
                      disabled={appointmentMode === 'reschedule'}
                    >
                      <option value="">{appointmentMode === 'reschedule' && !reschedulingAppointment?.service_id
                        ? 'Agendamento legado sem serviço'
                        : 'Selecione um serviço'}</option>
                      {appointmentServiceOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {item.duration_minutes} min — {Number(item.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Profissional
                    <select
                      value={selectedProfessionalId}
                      onChange={(event) => {
                        setSelectedProfessionalId(event.target.value);
                        setSelectedSpecialtyId('');
                        setSelectedSlot('');
                      }}
                      required
                    >
                      <option value="">Selecione um profissional</option>
                      {availableProfessionals.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Data
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(event) => {
                        setSelectedDate(event.target.value);
                        setSelectedSlot('');
                      }}
                      required
                    />
                  </label>
                  <label>
                    Especialidade
                    <select value={selectedSpecialtyId} onChange={(event) => setSelectedSpecialtyId(event.target.value)}>
                      <option value="">Usar especialidade do profissional</option>
                      {matchingSpecialties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <div className="form-wide">
                    <div className="panel-heading">
                      <h3>Horários disponíveis</h3>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={availabilityLoading || !selectedProfessionalId || (appointmentMode === 'create' && !selectedServiceId)}
                        onClick={() => refreshAvailability(
                          localStorage.getItem('clinic_token'),
                          selectedProfessionalId,
                          selectedDate,
                          selectedServiceId,
                          appointmentMode === 'reschedule' ? reschedulingAppointment?.id : undefined
                        )
                          .catch((requestError) => handleRequestError(requestError, 'Não foi possível atualizar a disponibilidade.'))}
                      >
                        {availabilityLoading ? 'Atualizando...' : 'Atualizar horários'}
                      </button>
                    </div>
                    {availabilityLoading ? <p className="muted-text">Carregando horários...</p> : null}
                    {!availabilityLoading && availability.length === 0 ? (
                      <p className="muted-text">Não há horários disponíveis para os critérios selecionados.</p>
                    ) : null}
                    <div className="slot-grid">
                      {availability.map((slot) => (
                        <button
                          type="button"
                          key={slot.scheduledStart}
                          className={`slot-button${selectedSlot === slot.scheduledStart ? ' selected' : ''}`}
                          onClick={() => setSelectedSlot(slot.scheduledStart)}
                        >
                          {formatTime(slot.scheduledStart, clinicTimezone)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {appointmentMode === 'create' ? (
                    <label>
                      Paciente
                      <select value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)} required>
                        <option value="">Selecione um paciente</option>
                        {activePatients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {appointmentMode === 'create' ? (
                    <label className="form-wide">
                      Observações
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="3" />
                    </label>
                  ) : null}

                  <button
                    type="submit"
                    className="form-wide"
                    disabled={!selectedSlot || !selectedProfessionalId || (appointmentMode === 'create' && !selectedPatientId) || appointmentBusy}
                  >
                    {appointmentBusy
                      ? (appointmentMode === 'reschedule' ? 'Reagendando...' : 'Salvando...')
                      : (appointmentMode === 'reschedule' ? 'Confirmar reagendamento' : 'Confirmar agendamento')}
                  </button>
                </form>
              ) : (
                <p className="muted-text">Seu perfil não pode criar ou reagendar consultas.</p>
              )}
            </section>
          </>
        )}

        {tab === 'appointments' && (
          <section className="panel">
            <div className="panel-heading">
              <h3>Consultas</h3>
              <button type="button" className="secondary-button" onClick={reloadData}>Atualizar</button>
            </div>
            {displayAppointments.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Paciente</th><th>Profissional</th><th>Serviço</th><th>Especialidade</th><th>Horário</th><th>Status</th><th>Ações</th></tr>
                  </thead>
                  <tbody>
                    {displayAppointments.map((item) => (
                      <tr key={item.id}>
                        <td>{item.patient_name || 'Paciente'}</td>
                        <td>{item.professional_name || 'Profissional'}</td>
                        <td>
                          {item.service_name_snapshot || '—'}
                          {item.service_name_snapshot ? (
                            <small className="muted-text">
                              <br />
                              {Number(item.service_price_snapshot).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              {' — '}{item.service_duration_snapshot} min
                            </small>
                          ) : null}
                        </td>
                        <td>{item.specialty_name || '—'}</td>
                        <td>{formatDateTime(item.scheduled_start, clinicTimezone)}</td>
                        <td><span className={appointmentStatusClass(item.status)}>{item.status}</span></td>
                        <td>
                          <div className="appointment-actions">
                            {['admin', 'reception'].includes(user?.role) ? (
                              <button type="button" className="secondary-button" onClick={() => {
                                setEditingNoteId(item.id);
                                setNoteDraft(item.notes || '');
                              }}>Editar observação</button>
                            ) : null}
                            {canManageAppointments && item.status !== 'cancelled' ? (
                              <>
                                <button type="button" className="secondary-button" onClick={() => beginReschedule(item)}>Reagendar</button>
                                <button type="button" className="danger-button" disabled={appointmentBusy} onClick={() => handleCancel(item)}>Cancelar</button>
                              </>
                            ) : null}
                          </div>
                          {editingNoteId === item.id ? (
                            <div className="note-editor">
                              <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows="2" />
                              <button type="button" disabled={notesBusy} onClick={() => handleNotesUpdate(item.id)}>
                                {notesBusy ? 'Salvando...' : 'Salvar observação'}
                              </button>
                              <button type="button" className="secondary-button" onClick={() => setEditingNoteId('')}>Fechar</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted-text">Nenhum agendamento encontrado.</p>}
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return <ClinicApp />;
}
