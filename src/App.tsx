import { Route, Routes } from 'react-router-dom';
import { CustomerPage } from './pages/CustomerPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { VendorPage } from './pages/VendorPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { AppI18nProvider } from './i18n/I18nProvider';

export default function App() {
  return <AppI18nProvider><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/vendor/:queueId" element={<VendorPage />} />
    <Route path="/q/:queueId" element={<CustomerPage />} />
    <Route path="/super-admin/*" element={<SuperAdminPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></AppI18nProvider>;
}
