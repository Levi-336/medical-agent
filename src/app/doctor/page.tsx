import { getPaidDoctorConsultPatients } from '@/app/actions';
import DoctorPortal from '@/components/doctor/DoctorPortal';

export const dynamic = 'force-dynamic'; // Ensure we always fetch latest data

export default async function DoctorPage() {
  const items = await getPaidDoctorConsultPatients();
  return <DoctorPortal initialItems={items} />;
}
