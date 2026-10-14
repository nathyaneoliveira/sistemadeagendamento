export function applyAppointmentServiceSnapshot(service, appointment) {
  return {
    ...service,
    name: appointment.service_name_snapshot,
    price: appointment.service_price_snapshot,
    duration_minutes: appointment.service_duration_snapshot,
  };
}
