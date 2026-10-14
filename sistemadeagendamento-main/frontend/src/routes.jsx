import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import App from './App.jsx';
import CommercialSite from './CommercialSite.jsx';
import PlatformAdmin from './PlatformAdmin.jsx';
import PublicBooking from './PublicBooking.jsx';

function PublicBookingRoute() {
  const { clinicSlug } = useParams();
  return <PublicBooking clinicSlug={clinicSlug} />;
}

function Home() {
  return <CommercialSite />;
}

export default function ApplicationRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/planos" element={<CommercialSite />} />
      <Route path="/recursos" element={<CommercialSite />} />
      <Route path="/sobre" element={<CommercialSite />} />
      <Route path="/contato" element={<CommercialSite />} />
      <Route element={<App />}>
        <Route path="/login" element={null} />
        <Route path="/clinic/*" element={null} />
      </Route>
      <Route path="/booking/:clinicSlug" element={<PublicBookingRoute />} />
      <Route path="/platform-admin/*" element={<PlatformAdmin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
