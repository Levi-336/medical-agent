'use server';

import { db } from '@/lib/db';
import { extractKeywords, getEmbedding, updatePersona, generateRAGResponse, generateDoctorCopilotSuggestion, classifyIntent, generateKnowledgeResponse, generateDoctorAssistantIntakeResponse } from '@/lib/ai';
import { cosineSimilarity, generateId } from '@/lib/utils'; // 使用 utils 中的 generateId 或 nanoid
import { revalidatePath } from 'next/cache';

// 定义类型
export interface Patient {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  condition: string | null;
  persona: string | null;
  created_at: string;
}

export interface PatientWithConsultStatus extends Patient {
  hasActiveConsultation: boolean;
}

export interface Memory {
  id: number;
  patient_id: string;
  content: string;
  embedding: number[]; // 数据库存的是 string，这里解析后是 array
  source: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  patient_id: string;
  role: 'user' | 'ai' | 'assistant' | 'doctor';
  content: string;
  created_at: string;
}

export interface DoctorConsultation {
  id: number;
  patient_id: string;
  status: 'pending' | 'paid' | 'ended';
  fee_cents: number;
  token: string;
  trigger: 'ai' | 'manual';
  created_at: string;
  paid_at: string | null;
  ended_at: string | null;
}

export interface KnowledgeItem {
    id: number;
    content: string;
    category: string;
    created_at: string;
}

export interface PatientChatSummary {
  patient: Patient;
  last_content: string | null;
  last_created_at: string | null;
  unread_count: number;
}

export interface LastDialogueMessage {
  content: string;
  created_at: string;
}

const doctorName = process.env.NEXT_PUBLIC_DOCTOR_NAME || process.env.DOCTOR_NAME || 'Dr. Zhang';
let legacyDialogueCleaned = false;

function cleanupLegacyDialogueMemoriesOnce() {
  if (legacyDialogueCleaned) return;
  try {
    db.prepare("DELETE FROM memories WHERE source = 'dialogue'").run();
  } catch {}
  legacyDialogueCleaned = true;
}

async function safeGetEmbedding(text: string): Promise<number[] | null> {
  try {
    return await getEmbedding(text);
  } catch {
    return null;
  }
}

async function safeExtractKeywords(text: string, source: 'patient' | 'doctor' | 'ai' | 'import'): Promise<string[]> {
  try {
    const facts = await extractKeywords(text, source);
    return facts
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .filter((f) => f.length <= 80);
  } catch {
    return [];
  }
}

function buildDoctorAssistantIntro(): string {
  return [
    `Hello, I am ${doctorName}'s assistant. I’ll first help document your situation clearly so the doctor can review it faster.`,
    'What is bothering you most right now?',
    'When did it start?',
    'Do you have fever, cough, pain, or any other symptoms?',
  ].join('\n');
}

function isMedicalRelatedText(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /药|用药|剂量|副作用|不良反应|过敏|症状|疼|痛|发烧|发热|咳嗽|头晕|腹泻|呕吐|心慌|胸闷|气短|呼吸困难|血压|血糖|心率|感染|炎|高血压|糖尿病|感冒|怀孕|哺乳|诊断|治疗|检查|化验|CT|核磁|B超/.test(t);
}

function ensurePatientAiStateRow(patientId: string) {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return;
  db.prepare(
    `INSERT OR IGNORE INTO patient_ai_state (patient_id, medical_inquiry_count) VALUES (?, 0)`
  ).run(patientId);
}

function getMedicalInquiryCount(patientId: string): number {
  ensurePatientAiStateRow(patientId);
  const row = db
    .prepare('SELECT medical_inquiry_count FROM patient_ai_state WHERE patient_id = ?')
    .get(patientId) as { medical_inquiry_count: number } | undefined;
  if (!row) return 0;
  if (row.medical_inquiry_count > 0) return row.medical_inquiry_count;

  const recent = db
    .prepare("SELECT content FROM chat_messages WHERE patient_id = ? AND role = 'ai' ORDER BY id ASC LIMIT 20")
    .all(patientId) as { content: string }[];

  const estimated = recent.reduce((acc, r) => {
    const c = r.content.trim();
    if (!c) return acc;
    if (c.includes('医生会诊') || c.includes('支付') || c.includes('确认接入')) return acc;
    if (c.includes('上班') || c.includes('营业') || c.includes('地址') || c.includes('挂号') || c.includes('发票') || c.includes('支付')) return acc;
    if (c.includes('助理') && (c.includes('请') || c.includes('麻烦') || c.includes('补充'))) return acc + 1;
    return acc;
  }, 0);

  const nextCount = Math.min(3, estimated);
  if (nextCount > 0) {
    db.prepare('UPDATE patient_ai_state SET medical_inquiry_count = ?, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?').run(nextCount, patientId);
  }
  return nextCount;
}

function incrementMedicalInquiryCount(patientId: string) {
  ensurePatientAiStateRow(patientId);
  db.prepare(
    'UPDATE patient_ai_state SET medical_inquiry_count = medical_inquiry_count + 1, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?'
  ).run(patientId);
}

function insertChatMessage(patientId: string, role: 'user' | 'ai' | 'assistant' | 'doctor', content: string): number {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return 0;
  const stmt = db.prepare('INSERT INTO chat_messages (patient_id, role, content) VALUES (?, ?, ?)');
  const info = stmt.run(patientId, role, content);
  return Number(info.lastInsertRowid);
}

function buildDoctorPayLink(token: string): string {
  return `/patient/pay/${encodeURIComponent(token)}`;
}

function generateToken(): string {
  return generateId();
}

function detectDoctorRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return (
    t.includes('找医生') ||
    t.includes('要医生') ||
    t.includes('转医生') ||
    t.includes('必须医生') ||
    t.includes('非要医生') ||
    t.includes('一定要医生') ||
    t.includes('医生亲自') ||
    t.includes('真人医生') ||
    t.includes('联系医生') ||
    t.includes('找专家') ||
    t.includes('找主治')
  );
}

function detectMedicationOrTreatmentAdviceRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /推荐.*药|开什么药|开药|处方|药方|剂量|怎么吃药|怎么用药|用药方案|治疗方案|怎么治|如何治疗|需要吃药吗|降压药|降糖药|胰岛素|二甲双胍/.test(
    t
  );
}

export async function startDoctorConsultation(
  patientId: string,
  trigger: 'ai' | 'manual' = 'manual',
  feeCents: number = 1999
): Promise<{ token: string; payLink: string; status: 'pending' | 'paid' }> {
  cleanupLegacyDialogueMemoriesOnce();
  const existing = db
    .prepare("SELECT id, token, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1")
    .get(patientId) as { id: number; token: string; status: 'pending' | 'paid' } | undefined;
  if (existing) {
    return { token: existing.token, payLink: buildDoctorPayLink(existing.token), status: existing.status };
  }

  const token = generateToken();
  db.prepare('INSERT INTO doctor_consultations (patient_id, status, fee_cents, token, trigger) VALUES (?, ?, ?, ?, ?)').run(
    patientId,
    'pending',
    feeCents,
    token,
    trigger
  );

  revalidatePath('/doctor');
  return { token, payLink: buildDoctorPayLink(token), status: 'pending' };
}

export async function markDoctorConsultationPaidByToken(token: string) {
  cleanupLegacyDialogueMemoriesOnce();
  const row = db
    .prepare('SELECT id, patient_id, status, fee_cents FROM doctor_consultations WHERE token = ? LIMIT 1')
    .get(token) as { id: number; patient_id: string; status: string; fee_cents: number } | undefined;
  if (!row) return { success: false, reason: 'not_found' as const };
  const existsPatient = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(row.patient_id);
  if (!existsPatient) {
    db.prepare('DELETE FROM doctor_consultations WHERE id = ?').run(row.id);
    return { success: false, reason: 'not_found' as const };
  }

  if (row.status === 'paid') return { success: true, patientId: row.patient_id, alreadyPaid: true as const };
  if (row.status === 'ended') return { success: false, reason: 'ended' as const };

  db.prepare("UPDATE doctor_consultations SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(row.id);
  insertChatMessage(row.patient_id, 'ai', `Payment received. You have been connected to the doctor consultation.`);
  await storeKeywordsToMemories(row.patient_id, 'ai', 'Doctor consultation paid');

  return { success: true, patientId: row.patient_id, alreadyPaid: false as const };
}

export async function getPaidDoctorConsultPatients(): Promise<Array<{ consultation: DoctorConsultation; patient: Patient }>> {
  type PaidDoctorConsultRow = {
    c_id: number;
    c_patient_id: string;
    c_status: DoctorConsultation['status'];
    c_fee_cents: number;
    c_token: string;
    c_trigger: DoctorConsultation['trigger'];
    c_created_at: string;
    c_paid_at: string | null;
    c_ended_at: string | null;
    p_id: string;
    p_name: string;
    p_age: number | null;
    p_gender: string | null;
    p_condition: string | null;
    p_persona: string | null;
    p_created_at: string;
  };
  const rows = db
    .prepare(
      `
      SELECT
        c.id as c_id,
        c.patient_id as c_patient_id,
        c.status as c_status,
        c.fee_cents as c_fee_cents,
        c.token as c_token,
        c.trigger as c_trigger,
        c.created_at as c_created_at,
        c.paid_at as c_paid_at,
        c.ended_at as c_ended_at,
        p.id as p_id,
        p.name as p_name,
        p.age as p_age,
        p.gender as p_gender,
        p.condition as p_condition,
        p.persona as p_persona,
        p.created_at as p_created_at
      FROM doctor_consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE c.status = 'paid'
      ORDER BY c.paid_at DESC, c.id DESC
    `
    )
    .all() as PaidDoctorConsultRow[];

  return rows.map((r) => ({
    consultation: {
      id: r.c_id,
      patient_id: r.c_patient_id,
      status: r.c_status,
      fee_cents: r.c_fee_cents,
      token: r.c_token,
      trigger: r.c_trigger,
      created_at: r.c_created_at,
      paid_at: r.c_paid_at,
      ended_at: r.c_ended_at,
    },
    patient: {
      id: r.p_id,
      name: r.p_name,
      age: r.p_age,
      gender: r.p_gender,
      condition: r.p_condition,
      persona: r.p_persona,
      created_at: r.p_created_at,
    },
  }));
}

export async function endDoctorConsultation(consultationId: number) {
  const row = db
    .prepare('SELECT patient_id, status FROM doctor_consultations WHERE id = ? LIMIT 1')
    .get(consultationId) as { patient_id: string; status: string } | undefined;

  if (!row) return { success: false };
  if (row.status === 'ended') return { success: true };

  db.prepare("UPDATE doctor_consultations SET status = 'ended', ended_at = datetime('now','localtime') WHERE id = ?").run(
    consultationId
  );
  insertChatMessage(
    row.patient_id,
    'ai',
    [
      'This doctor consultation has ended. Thank you for your trust.',
      'If you would like to continue consulting or add more records, you can start another consultation.',
      '',
      'Risk notice: this message was generated by AI for general health communication only and cannot replace an in-person visit or examination.',
      'If your symptoms worsen or you develop persistent high fever, breathing difficulty, chest pain, confusion, or severe allergy, seek urgent care immediately.',
    ].join('\n')
  );
  await storeKeywordsToMemories(row.patient_id, 'ai', 'Doctor consultation ended');
  revalidatePath('/doctor');
  return { success: true };
}

async function ensurePatientIntroMessage(patientId: string) {
  cleanupLegacyDialogueMemoriesOnce();
  const existing = db
    .prepare("SELECT 1 FROM chat_messages WHERE patient_id = ? AND role = 'ai' ORDER BY id ASC LIMIT 1")
    .get(patientId);
  if (existing) return;

  const content = buildDoctorAssistantIntro();
  insertChatMessage(patientId, 'ai', content);
  ensurePatientAiStateRow(patientId);
  db.prepare('UPDATE patient_ai_state SET medical_inquiry_count = 1, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?').run(patientId);
}

async function storeKeywordsToMemories(
  patientId: string,
  source: 'patient' | 'doctor' | 'ai' | 'import',
  text: string
) {
  const existsPatient = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!existsPatient) return;
  const facts = await safeExtractKeywords(text, source);
  const uniq = Array.from(new Set(facts)).slice(0, 12);
  if (uniq.length === 0) return;

  const existsStmt = db.prepare('SELECT 1 FROM memories WHERE patient_id = ? AND source = ? AND content = ? LIMIT 1');
  const insertStmt = db.prepare('INSERT INTO memories (patient_id, content, embedding, source) VALUES (?, ?, ?, ?)');

  const items: Array<{ fact: string; embedding: number[] | null }> = [];
  for (const fact of uniq) {
    const exists = existsStmt.get(patientId, source, fact);
    if (exists) continue;
    const vec = await safeGetEmbedding(fact);
    items.push({ fact, embedding: vec });
  }

  if (items.length === 0) return;

  db.transaction(() => {
    for (const item of items) {
      insertStmt.run(patientId, item.fact, item.embedding ? JSON.stringify(item.embedding) : null, source);
    }
  })();
}

function getRelevantPatientFacts(patientId: string, queryVec: number[] | null): string {
  const rows = db
    .prepare("SELECT content, embedding, source, created_at FROM memories WHERE patient_id = ? AND source != 'dialogue' ORDER BY created_at DESC LIMIT 300")
    .all(patientId) as Array<{ content: string; embedding: string | null; source: string; created_at: string }>;

  if (!queryVec) {
    return rows.slice(0, 8).map((r) => r.content).join('\n');
  }

  const scored = rows
    .map((r) => {
      if (!r.embedding) return null;
      try {
        const emb = JSON.parse(r.embedding) as number[];
        return { content: r.content, score: cosineSimilarity(queryVec, emb) };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ content: string; score: number }>;

  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((s) => s.score > 0.35).slice(0, 8).map((s) => s.content);
  return filtered.join('\n');
}

// Action: 获取所有患者
export async function getPatients(): Promise<Patient[]> {
  try {
    const stmt = db.prepare('SELECT * FROM patients ORDER BY created_at DESC');
    const result = stmt.all() as Patient[];
    return result;
  } catch (error) {
    console.error("Failed to get patients:", error);
    return [];
  }
}

export async function getPatientsWithConsultStatus(): Promise<PatientWithConsultStatus[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        p.*,
        EXISTS(
          SELECT 1
          FROM doctor_consultations c
          WHERE c.patient_id = p.id
            AND c.status = 'paid'
            AND c.ended_at IS NULL
          LIMIT 1
        ) AS has_active_consultation
      FROM patients p
      ORDER BY p.created_at DESC
    `);
    const rows = stmt.all() as Array<Patient & { has_active_consultation: 0 | 1 }>;
    return rows.map((r) => ({
      ...r,
      hasActiveConsultation: Boolean(r.has_active_consultation),
    }));
  } catch (error) {
    console.error("Failed to get patients with consult status:", error);
    return [];
  }
}

// Action: 获取患者最近一条对话消息（用于消息列表预览）
export async function getLastDialogueMessage(patientId: string): Promise<LastDialogueMessage | null> {
  const stmt = db.prepare(
    'SELECT content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const row = stmt.get(patientId) as { content: string; created_at: string } | undefined;
  return row ?? null;
}

// Action: 获取患者消息列表（用于“微信样式”的会话列表）
export async function getPatientChatList(): Promise<PatientChatSummary[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        p.*,
        m.content AS last_content,
        m.created_at AS last_created_at
      FROM patients p
      LEFT JOIN chat_messages m
        ON m.id = (
          SELECT id
          FROM chat_messages
          WHERE patient_id = p.id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        )
      ORDER BY p.created_at DESC
    `);

    const rows = stmt.all() as (Patient & { last_content: string | null; last_created_at: string | null })[];
    return rows.map((r) => ({
      patient: {
        id: r.id,
        name: r.name,
        age: r.age,
        gender: r.gender,
        condition: r.condition,
        persona: r.persona,
        created_at: r.created_at,
      },
      last_content: r.last_content ?? null,
      last_created_at: r.last_created_at ?? null,
      unread_count: 0,
    }));
  } catch (error) {
    console.error("Failed to get patient chat list:", error);
    return [];
  }
}

// Action: 获取单个患者
export async function getPatient(id: string): Promise<Patient | undefined> {
  const stmt = db.prepare('SELECT * FROM patients WHERE id = ?');
  return stmt.get(id) as Patient | undefined;
}

export async function getPatientWithConsultStatus(id: string): Promise<PatientWithConsultStatus | undefined> {
  const stmt = db.prepare(`
    SELECT
      p.*,
      EXISTS(
        SELECT 1
        FROM doctor_consultations c
        WHERE c.patient_id = p.id
          AND c.status = 'paid'
          AND c.ended_at IS NULL
        LIMIT 1
      ) AS has_active_consultation
    FROM patients p
    WHERE p.id = ?
    LIMIT 1
  `);
  const row = stmt.get(id) as (Patient & { has_active_consultation: 0 | 1 }) | undefined;
  if (!row) return undefined;
  return { ...row, hasActiveConsultation: Boolean(row.has_active_consultation) };
}

export async function resetPatientsAndSeedDemo() {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toSqliteLocal = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const addMinutes = (base: Date, deltaMinutes: number) => new Date(base.getTime() + deltaMinutes * 60_000);

  const insertPatient = db.prepare('INSERT INTO patients (id, name, age, gender, condition, persona, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertChat = db.prepare('INSERT INTO chat_messages (patient_id, role, content, created_at) VALUES (?, ?, ?, ?)');
  const insertMemory = db.prepare('INSERT INTO memories (patient_id, content, embedding, source, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertConsultation = db.prepare(
    'INSERT INTO doctor_consultations (patient_id, status, fee_cents, token, trigger, created_at, paid_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const makePatient = (name: string, age: number, gender: string, condition: string, persona: string, createdAt: Date) => {
    const id = generateId();
    insertPatient.run(id, name, age, gender, condition, persona, toSqliteLocal(createdAt));
    return id;
  };

  db.transaction(() => {
    db.prepare('DELETE FROM doctor_consultations').run();
    db.prepare('DELETE FROM chat_messages').run();
    db.prepare('DELETE FROM patient_ai_state').run();
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM patients').run();

    const t0 = addMinutes(now, -35);
    const pA = makePatient(
      'Liam Chen',
      28,
      'Male',
      'Cough and fever',
      'Communication preference: wants concise and clear guidance; worried about work disruption.\nHealth tags: recent fever and cough.\nRisk note: history of penicillin allergy.',
      addMinutes(t0, -2)
    );
    insertChat.run(pA, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t0));
    insertChat.run(pA, 'user', 'Hello doctor, I have had cough and fever for the last two days, and it feels worse at night.', toSqliteLocal(addMinutes(t0, 2)));
    insertChat.run(
      pA,
      'ai',
      [
        'Understood. To help the doctor assess this more quickly, let me clarify a few details:',
        'What was your highest temperature?',
        'How many days have you had fever?',
        'Is the cough dry, or are you coughing up phlegm?',
        'What color is the phlegm?',
        'Do you have chest tightness, shortness of breath, chest pain, or wheezing?',
        'Do you also have a runny nose, sore throat, or muscle aches?',
        'Have you recently been around anyone with a cold?',
        'What medications are you taking right now?',
        'Do you have any drug allergies?',
      ].join('\n'),
      toSqliteLocal(addMinutes(t0, 3))
    );
    insertChat.run(
      pA,
      'user',
      'Highest was 38.6°C, fever for two days. I have some yellow phlegm with the cough and a sore throat. No chest pain, just a little shortness of breath. I have not taken antibiotics, only some acetaminophen. I am allergic to penicillin.',
      toSqliteLocal(addMinutes(t0, 7))
    );
    insertMemory.run(pA, 'Chief concern=cough and fever for 2 days', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, 'Highest temperature=38.6°C', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, 'Cough=yellow phlegm', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, 'Associated symptoms=sore throat / mild shortness of breath', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, 'Medication=acetaminophen', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, 'Allergy history=penicillin', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertChat.run(
      pA,
      'assistant',
      [
        'Let me summarize this first: fever for 2 days with a highest temperature of 38.6°C, cough with yellow phlegm, sore throat, mild shortness of breath, penicillin allergy, and acetaminophen already taken.',
        'Could you add two more details?',
        'What is your oxygen saturation, if you have it?',
        'Is the shortness of breath worse with activity, or does it happen even at rest?',
      ].join('\n'),
      toSqliteLocal(addMinutes(t0, 9))
    );
    insertChat.run(pA, 'user', 'I want to speak with the doctor directly.', toSqliteLocal(addMinutes(t0, 12)));

    const tokenA = generateToken();
    insertConsultation.run(pA, 'pending', 1999, tokenA, 'ai', toSqliteLocal(addMinutes(t0, 12)), null, null);
    insertChat.run(
      pA,
      'ai',
      'A doctor consultation is ready for you (demo).\nPlease reply with 1 to confirm access. After confirmation, I will send the payment link.\n(Note: the doctor can only see and join the consultation after payment.)',
      toSqliteLocal(addMinutes(t0, 13))
    );

    const t1 = addMinutes(now, -25);
    const pB = makePatient(
      'Mia Wang',
      35,
      'Female',
      'Stomach pain and acid reflux',
      'Communication preference: wants to know whether it is serious first, then receive practical daily advice.\nHealth tags: upper abdominal discomfort, reflux worse at night.\nLifestyle note: may have an irregular schedule (needs confirmation).',
      addMinutes(t1, -2)
    );
    insertChat.run(pB, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t1));
    insertChat.run(pB, 'user', 'Recently I keep having stomach pain and acid reflux, and it feels worse at night.', toSqliteLocal(addMinutes(t1, 2)));
    insertMemory.run(pB, 'Chief concern=stomach pain / acid reflux', null, 'patient', toSqliteLocal(addMinutes(t1, 2)));
    insertMemory.run(pB, 'Pattern=worse at night', null, 'patient', toSqliteLocal(addMinutes(t1, 2)));
    insertChat.run(
      pB,
      'ai',
      [
        'Understood. Let me complete a few more details first:',
        'Is the stomach pain in the middle of the upper abdomen, or more to the left or right?',
        'Is the reflux or heartburn related to eating?',
        'Is it worse on an empty stomach?',
        'Do you have nausea or vomiting?',
        'Any black stool or blood in the stool?',
        'Have you had noticeable weight loss recently?',
        'Have you been staying up late recently?',
        'Do you drink alcohol?',
        'Have coffee or spicy foods increased recently?',
        'Are you taking any painkillers such as ibuprofen?',
        'Any history of gastritis, gastric ulcer, or H. pylori?',
      ].join('\n'),
      toSqliteLocal(addMinutes(t1, 3))
    );
    insertChat.run(
      pB,
      'assistant',
      'Before the doctor replies, you can do two things first: eat light meals in smaller portions and avoid eating within 3 hours of bedtime. If you develop black stool, vomit blood, worsening abdominal pain, or marked weight loss, please seek medical care promptly.',
      toSqliteLocal(addMinutes(t1, 6))
    );

    const t2 = addMinutes(now, -18);
    const pC = makePatient(
      'Jason Zhao',
      62,
      'Male',
      'Hypertension and diabetes',
      'Communication preference: wants a clear explanation of causes and what to do.\nHealth tags: hypertension, diabetes.\nRisk note: blood pressure fluctuation with dizziness, so red-flag symptoms must be checked.',
      addMinutes(t2, -2)
    );
    insertChat.run(pC, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t2));
    insertChat.run(pC, 'user', 'My blood pressure has been fluctuating recently, I feel dizzy at night, and my blood sugar has not been very stable either.', toSqliteLocal(addMinutes(t2, 2)));
    insertMemory.run(pC, 'Chronic conditions=hypertension / diabetes', null, 'import', toSqliteLocal(addMinutes(t2, 2)));
    insertMemory.run(pC, 'Recent issues=blood pressure fluctuation + nighttime dizziness + unstable blood sugar', null, 'patient', toSqliteLocal(addMinutes(t2, 2)));
    insertChat.run(
      pC,
      'ai',
      [
        'Understood. To help the doctor assess this more quickly, I need to ask a few key questions:',
        'What were the highest and lowest blood pressure readings in the past week?',
        'Were you seated and resting when you measured them?',
        'Does the dizziness feel like spinning, or more like lightheadedness?',
        'Any chest tightness, palpitations, or blurred vision?',
        'What blood pressure and diabetes medications are you currently taking?',
        'Any missed doses or self-adjusted doses?',
        'Has your salt intake changed recently?',
        'Has your alcohol intake changed recently?',
        'Any changes in sleep, mood, or activity level?',
        'Any numbness in your hands or feet?',
        'Any slurred speech?',
        'Any one-sided weakness or similar symptoms?',
      ].join('\n'),
      toSqliteLocal(addMinutes(t2, 3))
    );
    insertChat.run(
      pC,
      'assistant',
      'I will summarize this for the doctor first. Please do not worry for now. Over the next 3 days, record your blood pressure and blood sugar twice daily, morning and evening, and send me the blood pressure, heart rate, blood sugar, and whether you felt dizzy at that time.',
      toSqliteLocal(addMinutes(t2, 6))
    );
    insertChat.run(pC, 'user', 'I want to talk to the doctor.', toSqliteLocal(addMinutes(t2, 8)));

    const tokenC = generateToken();
    insertConsultation.run(pC, 'paid', 1999, tokenC, 'ai', toSqliteLocal(addMinutes(t2, 8)), toSqliteLocal(addMinutes(t2, 10)), null);
    insertChat.run(
      pC,
      'ai',
      'A doctor consultation is ready for you (demo).\nPlease reply with 1 to confirm access. After confirmation, I will send the payment link.\n(Note: the doctor can only see and join the consultation after payment.)',
      toSqliteLocal(addMinutes(t2, 9))
    );
    insertChat.run(pC, 'user', '1', toSqliteLocal(addMinutes(t2, 10)));
    insertChat.run(
      pC,
      'ai',
      `Doctor consultation confirmed. Please click the link to complete payment: /patient/pay/${encodeURIComponent(tokenC)} (demo: clicking the link marks it as paid).`,
      toSqliteLocal(addMinutes(t2, 10))
    );
    insertChat.run(pC, 'ai', 'Payment received. You have been connected to the doctor consultation.', toSqliteLocal(addMinutes(t2, 11)));
    insertChat.run(
      pC,
      'doctor',
      `Hello, I’m ${doctorName}. Let me confirm two things first:\n1) About what were your highest and lowest blood pressure readings in the last few days?\n2) When you feel dizzy now, do you have chest tightness, palpitations, slurred speech, or weakness on one side?`,
      toSqliteLocal(addMinutes(t2, 12))
    );
    insertChat.run(
      pC,
      'user',
      'Highest was 160/95 and lowest was 110/70. The dizziness feels more like lightheadedness, with occasional palpitations. No slurred speech and no one-sided weakness.',
      toSqliteLocal(addMinutes(t2, 14))
    );
    insertMemory.run(pC, 'Highest blood pressure=160/95', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, 'Lowest blood pressure=110/70', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, 'Dizziness=lightheadedness; associated=occasional palpitations', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, 'Denied=slurred speech / one-sided weakness', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertChat.run(
      pC,
      'doctor',
      'Understood. Given your hypertension and diabetes, common reasons for blood pressure fluctuation and dizziness include irregular medication timing, changes in salt intake or sleep, blood sugar fluctuation, dehydration, or orthostatic hypotension.\nFor now, please measure at the same times tonight and tomorrow morning: rest seated for 5 minutes, take two blood pressure readings and average them, and record your heart rate and fingertip blood sugar.\nIf you develop persistent chest pain, marked shortness of breath, blackout or fainting, slurred speech, or weakness on one side, seek urgent care immediately.\nWhat blood pressure and diabetes medications are you taking now, and what time do you take them each day?',
      toSqliteLocal(addMinutes(t2, 16))
    );
  })();

  revalidatePath('/');
  revalidatePath('/assistant');
  revalidatePath('/doctor');
  revalidatePath('/patient');
  return { success: true };
}

// Action: 创建患者
export async function createPatient(formData: FormData) {
  const name = formData.get('name') as string;
  const age = parseInt(formData.get('age') as string);
  const gender = formData.get('gender') as string;
  const condition = formData.get('condition') as string;
  
  const id = generateId(); // 或者 import { nanoid } from 'nanoid'; const id = nanoid();
  const initialPersona = 'Newly created patient. Detailed persona not available yet.';

  db.transaction(() => {
    db.prepare('INSERT INTO patients (id, name, age, gender, condition, persona) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      name,
      age,
      gender,
      condition,
      initialPersona
    );
  })();
  await ensurePatientIntroMessage(id);
  
  revalidatePath('/');
  return { success: true, id };
}

// Action: 更新患者信息
export async function updatePatient(id: string, formData: FormData) {
    const name = formData.get('name') as string;
    const age = parseInt(formData.get('age') as string);
    const gender = formData.get('gender') as string;
    const condition = formData.get('condition') as string;

    const stmt = db.prepare(`
        UPDATE patients 
        SET name = ?, age = ?, gender = ?, condition = ?
        WHERE id = ?
    `);

    stmt.run(name, age, gender, condition, id);
    revalidatePath('/');
    return { success: true };
}

// Action: 删除患者
export async function deletePatient(id: string) {
    db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    revalidatePath('/');
    return { success: true };
}

// Action: 导入并分析患者资料
export async function importPatientData(patientId: string, textData: string) {
  console.log(`[Import] 开始分析患者 ${patientId} 的资料...`);

  await storeKeywordsToMemories(patientId, 'import', textData);

  // 3. 更新画像
  const patient = db.prepare('SELECT persona FROM patients WHERE id = ?').get(patientId) as { persona: string | null } | undefined;
  const newPersona = await updatePersona(patient?.persona ?? '', textData); // 用原始文本更新画像，或者用事实列表更新
  
  db.prepare('UPDATE patients SET persona = ? WHERE id = ?').run(newPersona, patientId);
  console.log(`[Persona] 画像已更新。`);

  revalidatePath('/');
  return { success: true, newPersona };
}

// Action: 处理用户对话
type HistoryMessage = { role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string };
export async function processUserMessage(patientId: string, message: string, history: HistoryMessage[]) {
  try {
    console.log(`[processUserMessage] Processing for ${patientId}: ${message}`);
    const normalized = message.trim();

    insertChatMessage(patientId, 'user', message);

    const isDoctorConfirm =
      normalized === '1' ||
      normalized === '确认1' ||
      normalized === '确认 1' ||
      normalized.toLowerCase() === 'confirm1' ||
      normalized.toLowerCase() === 'confirm 1';

    if (isDoctorConfirm) {
      const existing = db
        .prepare(
          "SELECT id, token, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; token: string; status: 'pending' | 'paid' } | undefined;

      if (!existing) {
        const reply = 'No pending doctor consultation request was found to confirm. If you need a doctor consultation, please say that you want to speak with the doctor.';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', 'User sent 1 but no consultation request was found');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      if (existing.status === 'paid') {
        const reply = 'Your payment is already complete and the doctor consultation has been created. If you need to end or restart it, you can continue in this chat.';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', 'User sent 1 but consultation was already paid');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      const { payLink } = await startDoctorConsultation(patientId, 'ai');
      const payMsg = `Doctor consultation confirmed. Please click the link to complete payment: ${payLink} (demo: clicking the link marks it as paid).`;
      insertChatMessage(patientId, 'ai', payMsg);
      await storeKeywordsToMemories(patientId, 'ai', 'User confirmed doctor consultation and payment link was sent');
      return { response: payMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    await storeKeywordsToMemories(patientId, 'patient', message);

    if (detectDoctorRequest(message)) {
      const existing = db
        .prepare(
          "SELECT id, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; status: 'pending' | 'paid' } | undefined;

      if (existing?.status === 'paid') {
        const reply = 'Your payment is already complete and the doctor consultation has been created. Please continue describing your situation in this chat and the doctor will respond.';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', 'User requested doctor consultation but it was already paid');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      await startDoctorConsultation(patientId, 'ai');
      const confirmMsg =
        'A doctor consultation is ready for you (demo).\nPlease reply with 1 to confirm access. After confirmation, I will send the payment link.\n(Note: the doctor can only see and join the consultation after payment.)';
      insertChatMessage(patientId, 'ai', confirmMsg);
      await storeKeywordsToMemories(patientId, 'ai', 'User requested doctor consultation and is waiting to confirm with 1');
      return { response: confirmMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    if (detectMedicationOrTreatmentAdviceRequest(message)) {
      const existing = db
        .prepare(
          "SELECT id, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; status: 'pending' | 'paid' } | undefined;

      if (existing?.status === 'paid') {
        const reply = 'Your payment is already complete and the doctor consultation has been created. Please continue describing your situation in this chat and the doctor will respond.';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', 'User asked about medication or treatment but consultation was already paid');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      await startDoctorConsultation(patientId, 'ai');
      const confirmMsg =
        'Medication and treatment plans need to be confirmed by the doctor during a consultation (demo).\nPlease reply with 1 to confirm access to the doctor consultation. After confirmation, I will send the payment link.\n(Note: the doctor can only see and join the consultation after payment.)';
      insertChatMessage(patientId, 'ai', confirmMsg);
      await storeKeywordsToMemories(patientId, 'ai', 'User asked about medication or treatment and was guided to confirm a doctor consultation');
      return { response: confirmMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    // 1. 意图识别
    let intent: 'medical_consult' | 'chitchat_admin' = 'medical_consult';
    try {
      intent = await classifyIntent(message);
    } catch {
      intent = 'medical_consult';
    }
    if (intent === 'chitchat_admin' && isMedicalRelatedText(message)) {
      intent = 'medical_consult';
    }
    console.log(`[Intent] 用户消息: "${message}" -> 意图: ${intent}`);

    const queryVec = await safeGetEmbedding(message);

    try {
      const p = db.prepare('SELECT persona FROM patients WHERE id = ?').get(patientId) as { persona: string | null } | undefined;
      if (p) {
        const newPersona = await updatePersona(p.persona ?? '', message);
        db.prepare('UPDATE patients SET persona = ? WHERE id = ?').run(newPersona, patientId);
      }
    } catch {}

    // 分支逻辑
    if (intent === 'medical_consult') {
        const MAX_MEDICAL_INQUIRIES = 3;
        const inquiryCount = getMedicalInquiryCount(patientId);
        if (inquiryCount >= MAX_MEDICAL_INQUIRIES) {
          return { response: '', relatedFacts: '', intent: 'medical_consult' };
        }

        const patient = db
          .prepare('SELECT persona, age, gender, condition FROM patients WHERE id = ?')
          .get(patientId) as { persona: string | null; age: number | null; gender: string | null; condition: string | null } | undefined;
        const facts = getRelevantPatientFacts(patientId, queryVec);
        const context = [
          patient?.condition ? `Background: ${patient.condition}` : '',
          facts ? `Key facts:\n${facts}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        let response = '';
        try {
          response = await generateDoctorAssistantIntakeResponse(doctorName, message, context, patient?.persona || '', history);
        } catch {
          response = `What is bothering you most right now?\nWhen did it start? Has it been getting worse recently?\nAre you taking any medications right now, or do you have any known allergies?`;
        }

        insertChatMessage(patientId, 'ai', response);
        incrementMedicalInquiryCount(patientId);
        await storeKeywordsToMemories(patientId, 'ai', response);
        return { response, relatedFacts: context, intent: 'medical_consult' };
    } else {
        // 2b. 闲聊/行政：检索知识库并回复
      
      // 检索知识库
      const allKnowledge = db.prepare("SELECT content, embedding FROM knowledge_base WHERE category = 'admin'").all() as { content: string, embedding: string }[];
      
      const scoredKnowledge = queryVec
        ? allKnowledge.map(k => ({
            content: k.content,
            score: k.embedding ? cosineSimilarity(queryVec, JSON.parse(k.embedding)) : 0
        }))
        : allKnowledge.map(k => ({
            content: k.content,
            score: 0
        }));
      
      scoredKnowledge.sort((a, b) => b.score - a.score);
      // 阈值过滤，如果相关度太低也不回复？暂取 Top 3
      // 增加阈值过滤，防止无关匹配（例如 0.4）
      const filteredKnowledge = scoredKnowledge.filter(k => k.score > 0.4);
      const topKnowledge = filteredKnowledge.slice(0, 3).map(k => k.content).join('\n');
      
      // 生成回复
      const response = await generateKnowledgeResponse(message, topKnowledge);
        
        insertChatMessage(patientId, 'ai', response);
        await storeKeywordsToMemories(patientId, 'ai', response);
        
        return { response, relatedFacts: topKnowledge, intent: 'chitchat_admin' };
    }
  } catch (error: unknown) {
    console.error("[processUserMessage] Error:", error);
    const message = error instanceof Error ? error.message : '';
    // Return a fallback error to the client so they know something went wrong
    return { 
        response: "Sorry, the system cannot process your request right now. Please try again later.", 
        relatedFacts: "", 
        intent: 'error',
        error: message
    };
  }
}

// Action: 获取 Meralion 上传 URL
export async function getMeralionUploadUrl(fileName: string, fileSize: number, contentType: string) {
  // 必须传入 fileName, contentType, fileSize [cite: 854]
  const response = await fetch(`${process.env.MERALION_BASE_URL}/upload-url`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.MERALION_API_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: fileName,
      contentType: contentType, // 例如 "audio/wav" 或 "audio/webm" [cite: 485]
      filesize: fileSize
    })
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  // 官方建议始终保存返回的 key，后续步骤全靠它 [cite: 896]
  return {
    url: data.response.url,
    fileKey: data.response.key 
  };
}

// Action: 语音转文本（转录）接口
export async function transcribeAudioWithMeralion(fileKey: string) {
  const response = await fetch(`${process.env.MERALION_BASE_URL}/transcribe`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.MERALION_API_KEY!,
      'Content-Type': 'application/json'
    },
    // 将上一步获取的 fileKey 传给转录接口 [cite: 626]
    body: JSON.stringify({ key: fileKey }) 
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  // 返回转录好的纯文本 [cite: 650]
  return data.response.text; 
}

// Action: 添加知识库条目
export async function addKnowledge(content: string, category: string = 'general') {
    const embedding = await getEmbedding(content);
    
    const stmt = db.prepare(`
        INSERT INTO knowledge_base (content, embedding, category)
        VALUES (?, ?, ?)
    `);
    
    stmt.run(content, JSON.stringify(embedding), category);
    return { success: true };
}

// Action: 获取知识库列表
export async function getKnowledgeList() {
    const stmt = db.prepare('SELECT id, content, category, created_at FROM knowledge_base ORDER BY created_at DESC');
    return stmt.all() as KnowledgeItem[];
}

// Action: 导入知识库（批量）
export async function importKnowledge(textData: string) {
    // 简单按行分割
    const lines = textData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
        await addKnowledge(line, 'admin'); // 默认作为行政类导入
    }
    
    return { success: true, count: lines.length };
}

// Action: 更新知识库条目
export async function updateKnowledge(id: number, content: string) {
    // 需要重新计算 embedding
    const embedding = await getEmbedding(content);
    
    const stmt = db.prepare(`
        UPDATE knowledge_base 
        SET content = ?, embedding = ?
        WHERE id = ?
    `);
    
    stmt.run(content, JSON.stringify(embedding), id);
    return { success: true };
}

// Action: 删除知识库条目
export async function deleteKnowledge(id: number) {
    const stmt = db.prepare('DELETE FROM knowledge_base WHERE id = ?');
    stmt.run(id);
    return { success: true };
}

// Action: 获取聊天记录
export async function getChatHistory(patientId: string) {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return [] as ChatMessage[];
  await ensurePatientIntroMessage(patientId);
  const stmt = db.prepare('SELECT id, patient_id, role, content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY id ASC');
  return stmt.all(patientId) as ChatMessage[];
}

// Action: 获取单条消息的详细分析信息 (RAG 检索结果模拟)
export async function getMessageAnalysis(messageId: number, patientId: string) {
    const msg = db
      .prepare("SELECT content, role FROM chat_messages WHERE id = ? AND patient_id = ?")
      .get(messageId, patientId) as { content: string; role: ChatMessage['role'] } | undefined;
    if (!msg) return null;

    const queryVec = await safeGetEmbedding(msg.content);
    if (!queryVec) return null;
    
    // 1. Find similar memories (Self-RAG?) - or finding related facts for this message
    // Let's find related medical facts or previous dialogue
    // Exclude itself
    const allMemories = db
      .prepare('SELECT id, content, embedding, source, created_at FROM memories WHERE patient_id = ?')
      .all(patientId) as Array<{ id: number; content: string; embedding: string | null; source: string | null; created_at: string }>;
    
    const scored = allMemories.flatMap((m) => {
      if (!m.embedding) return [];
      try {
        return [
          {
            content: m.content,
            source: m.source ?? 'unknown',
            created_at: m.created_at,
            score: cosineSimilarity(queryVec, JSON.parse(m.embedding)),
          },
        ];
      } catch {
        return [];
      }
    });
    
    scored.sort((a, b) => b.score - a.score);
    const relatedMemories = scored.slice(0, 3);
    
    // 2. Find related Knowledge Base
    const allKnowledge = db
      .prepare("SELECT content, embedding, category FROM knowledge_base")
      .all() as Array<{ content: string; embedding: string | null; category: string | null }>;
    const scoredKb = allKnowledge.flatMap((k) => {
      if (!k.embedding) return [];
      try {
        return [
          {
            content: k.content,
            category: k.category ?? 'general',
            score: cosineSimilarity(queryVec, JSON.parse(k.embedding)),
          },
        ];
      } catch {
        return [];
      }
    });
    scoredKb.sort((a, b) => b.score - a.score);
    const relatedKnowledge = scoredKb.slice(0, 3);

    return {
        related_memories: relatedMemories,
        related_knowledge: relatedKnowledge
    };
}

// Action: 医生发送消息
export async function sendDoctorMessage(patientId: string, message: string) {
  insertChatMessage(patientId, 'assistant', message);
  await storeKeywordsToMemories(patientId, 'ai', message);
  
  // 可以选择是否在这里更新画像，通常医生的话也是重要信息
  // 这里简化，暂不自动更新画像，或者异步更新
  
  return { success: true };
}

export async function sendRealDoctorMessage(patientId: string, message: string) {
  insertChatMessage(patientId, 'doctor', message);
  await storeKeywordsToMemories(patientId, 'doctor', message);
  return { success: true };
}

// Action: 获取医生辅助建议
export async function getDoctorCopilot(patientId: string, speaker: 'assistant' | 'doctor' = 'assistant') {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Patient;
  const activeConsultation = db
    .prepare(
      "SELECT id FROM doctor_consultations WHERE patient_id = ? AND status = 'paid' AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(patientId) as { id: number } | undefined;
  const hasActiveConsultation = Boolean(activeConsultation);
  
  // 1. 检索最近的对话/记忆
  const memories = db
    .prepare('SELECT content, source, created_at FROM memories WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(patientId) as { content: string; source: string; created_at: string }[];
  const memoryText = memories
    .reverse()
    .map((m) => `${m.created_at} [${m.source}] ${m.content}`)
    .join('\n');

  // 2. 检索相关医疗知识库 (基于最后一条用户消息)
  let relevantKnowledge = "";
  const lastUser = db
    .prepare("SELECT content FROM chat_messages WHERE patient_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(patientId) as { content: string } | undefined;
  if (lastUser?.content) {
    const queryVec = await safeGetEmbedding(lastUser.content);
    if (queryVec) {
      const allKnowledge = db
        .prepare("SELECT content, embedding FROM knowledge_base WHERE category != 'admin'")
        .all() as { content: string; embedding: string }[];

      const scored = allKnowledge.map((k) => ({
        content: k.content,
        score: k.embedding ? cosineSimilarity(queryVec, JSON.parse(k.embedding)) : 0,
      }));

      scored.sort((a, b) => b.score - a.score);
      const filtered = scored.filter((k) => k.score > 0.4);
      relevantKnowledge = filtered.slice(0, 3).map((k) => k.content).join('\n');
    }
  }

  const suggestion = await generateDoctorCopilotSuggestion(
    [
      patient.name,
      patient.age != null ? `${patient.age} years old` : '',
      patient.condition ?? '',
    ]
      .filter(Boolean)
      .join('，'),
    patient.persona ?? '',
    memoryText,
    relevantKnowledge,
    speaker,
    hasActiveConsultation
  );

  return suggestion;
}

// Action: 获取患者的记忆列表（用于前端展示）
export async function getPatientMemories(patientId: string): Promise<Array<{ id: number; content: string; source: string | null; created_at: string }>> {
  const stmt = db.prepare(
    "SELECT id, content, source, created_at FROM memories WHERE patient_id = ? AND source != 'dialogue' ORDER BY created_at DESC LIMIT 50"
  );
  return stmt.all(patientId) as Array<{ id: number; content: string; source: string | null; created_at: string }>;
}
