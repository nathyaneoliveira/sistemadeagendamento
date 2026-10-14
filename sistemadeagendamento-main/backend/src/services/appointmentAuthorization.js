export function isAppointmentPatientOwner(userId, patientUserId) {
  return Boolean(userId && patientUserId && userId === patientUserId);
}

export function isResourceInClinic(clinicId, resourceClinicId) {
  return Boolean(clinicId && resourceClinicId && clinicId === resourceClinicId);
}

export function isAppointmentPatientAllowed({ role, userId, patientId, patient, clinicId }) {
  if (!patient || !isResourceInClinic(clinicId, patient.clinic_id)) {
    return false;
  }

  if (patient.status !== 'active') {
    return false;
  }

  if (role !== 'patient') {
    return true;
  }

  return patient.id === patientId && isAppointmentPatientOwner(userId, patient.user_id);
}

export function isAppointmentProfessionalAllowed({ clinicId, professional }) {
  return Boolean(
    professional &&
    isResourceInClinic(clinicId, professional.clinic_id) &&
    professional.status === 'active'
  );
}

export function isAppointmentSpecialtyAllowed({ clinicId, professionalSpecialtyId, specialty }) {
  return Boolean(
    specialty &&
    isResourceInClinic(clinicId, specialty.clinic_id) &&
    specialty.status === 'active' &&
    specialty.id === professionalSpecialtyId
  );
}
