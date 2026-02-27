import { getPatients } from '@/app/actions';
import PatientInbox from '@/components/patient/PatientInbox';

export const dynamic = 'force-dynamic';

export default async function PatientPage() {
  const patients = await getPatients();
  return <PatientInbox patients={patients} />;
}
