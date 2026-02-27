import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { markDoctorConsultationPaidByToken } from '@/app/actions';
 
export const dynamic = 'force-dynamic';
 
function getSafeOrigin(req: NextRequest): string {
  const origin = req.nextUrl.origin;
  if (req.nextUrl.hostname === '0.0.0.0') {
    return origin.replace('0.0.0.0', 'localhost');
  }
  return origin;
}
 
export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const result = await markDoctorConsultationPaidByToken(token);
  const origin = getSafeOrigin(req);
 
  const patientId = result.success && 'patientId' in result ? result.patientId : undefined;
  if (!result.success || !patientId) {
    return NextResponse.redirect(new URL('/patient?pay=failed', origin));
  }
 
  revalidatePath('/doctor');
  revalidatePath('/assistant');
  revalidatePath('/patient');
 
  const ts = Date.now();
  return NextResponse.redirect(new URL(`/patient/chat/${encodeURIComponent(patientId)}?paid=1&t=${ts}`, origin));
}
