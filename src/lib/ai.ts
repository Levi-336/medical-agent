// 确保文件顶部有这个标记
"use server";

import OpenAI from 'openai';
import { ZhipuAI } from 'zhipuai'; // 引入智谱 SDK

// ==========================================
// 1. 客户端初始化 (双管齐下)
// ==========================================

// 初始化 Cloudflare 代理的客户端
const seaLionClient = new OpenAI({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  // 注意这里的 URL 拼接了你的账户 ID
  baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
});


// 智谱客户端：专职算向量、查知识库
const zhipuClient = new ZhipuAI({
  apiKey: process.env.ZHIPU_API_KEY,
});


/**
 * 通用API调用重试函数，处理速率限制
 */
async function withRetry<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3
): Promise<T> {
  const baseDelay = 2000; // 2秒基础延迟

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      // 如果是速率限制错误且还有重试次数
      if (error?.status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // 指数退避
        console.log(`Rate limit hit (attempt ${attempt + 1}), waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // 其他错误或重试次数用完，抛出错误
      throw error;
    }
  }
  
  throw new Error('Max retries exceeded');
}

export async function getMeralionUploadUrl(fileName: string, fileSize: number, contentType: string) {
  try {
    const response = await fetch(`${process.env.MERALION_BASE_URL}/upload-url`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.MERALION_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: fileName,
        contentType: contentType,
        filesize: fileSize
      })
    });
    
    if (!response.ok) {
      console.error(`MERA API request failed: ${response.status} ${response.statusText}`);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.status.code !== 200) {
      console.error(`MERA 获取上传链接失败: ${data.status.message}`);
      throw new Error(`获取上传链接失败: ${data.status.message}`);
    }
    
    return {
      url: data.response.url,
      fileKey: data.response.key 
    };
  } catch (error) {
    console.error('MERA 上传 URL 获取失败:', error);
    throw error;
  }
}

/**
 * 步骤 3: 触发 MERaLion 语音转文字
 */
export async function transcribeAudioWithMeralion(fileKey: string) {
  try {
    const response = await fetch(`${process.env.MERALION_BASE_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.MERALION_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: fileKey }) 
    });
    
    if (!response.ok) {
      console.error(`MERA 转录 API request failed: ${response.status} ${response.statusText}`);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.status.code !== 200) {
      console.error(`MERA 语音转写失败: ${data.status.message}`);
      throw new Error(`语音转写失败: ${data.status.message}`);
    }
    
    return data.response.text; 
  } catch (error) {
    console.error('MERA 语音转写失败:', error);
    throw error;
  }
}

// ==========================================
// 2. 向量生成模块 (交还给智谱)
// ==========================================

export async function getEmbedding(text: string) {
  try {
    // 这里使用 zhipuClient，并指定智谱专属的 embedding-3 模型
    const response = await zhipuClient.embeddings.create({
      model: "embedding-3", 
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("智谱向量生成失败:", error);
    // 如果智谱报错，返回 null 也能保证系统不崩溃，直接跳过知识库进行纯聊天
    return null; 
  }
}

/**
 * 从医疗资料中提取关键事实 ()
 * 返回事实列表（字符串数组）
 */
export async function extractFacts(textData: string): Promise<string[]> {
  const prompt = `
你是一个专业的医疗数据分析助手。
任务：从以下医疗资料中提取关键事实（包括但不限于诊断、用药、过敏史、手术史、主要症状、生活习惯等）。
要求：
1. 将提取的内容拆分为独立的、简短的陈述句。
2. 忽略无关的客套话或格式字符。
3. 直接返回结果，每行一条事实，不要包含序号或Markdown列表符号。

资料内容：
${textData}
`;

  const response = await withRetry(async () => {
    return await seaLionClient.chat.completions.create({
      model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it", 
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });
  });

  const content = response.choices[0].message.content || "";
  return parseFactList(content);
}

export async function extractKeywords(
  textData: string,
  source: 'patient' | 'doctor' | 'ai' | 'import'
): Promise<string[]> {
  const prompt = `
你是医疗信息结构化抽取助手。
任务：从文本中抽取“可写入患者知识库/RAG”的关键词与要点，避免保存完整聊天原文。

输出要求：
1. 只输出关键词/要点，每行一条，不要序号，不要 Markdown。
2. 尽量短（优先短语），必要时用“字段=值”的形式。
3. 仅保留与患者有关的信息：症状/持续时间/程度/体温/检查结果/既往史/过敏史/用药史/生活习惯/性格偏好/爱好/就医行为/医生建议等。
4. 忽略寒暄、重复、无信息量的句子。
5. 如果没有可抽取内容，返回空。

消息来源：${source}
文本：
${textData}
`;

  const response = await seaLionClient.chat.completions.create({
    model: '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const content = response.choices[0].message.content || '';
  return parseFactList(content);
}

// 修正：上面的 filter 可能太激进，如果 LLM 输出 "- xxx"，这里应该去掉 "-" 而不是丢弃整行
// 重写处理逻辑
function parseFactList(content: string): string[] {
  return content.split('\n')
    .map(line => line.replace(/^[\d\.\-\*•\s]+/, '').trim()) // 去除行首的数字、点、横杠等
    .filter(line => line.length > 0);
}


/**
 * 更新患者画像 (Persona)
 */
export async function updatePersona(currentPersona: string, newInfo: string): Promise<string> {
  const prompt = `
You are a medical persona specialist. Update the patient persona based on the new medical information.
The persona should include communication style, important health tags, lifestyle patterns, and other stable traits.
Keep it concise and objective.

Current persona:
${currentPersona || "(none)"}

New imported or analyzed information:
${newInfo}

Output the full updated persona text:
`;

  const response = await seaLionClient.chat.completions.create({
    model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
  });

  return response.choices[0].message.content || currentPersona;
}

/**
 * 生成回复 (RAG)
 */
export async function generateRAGResponse(
  query: string,
  context: string,
  persona: string,
    history: Array<{ role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string }> = []
): Promise<string> {
    type Message = { role: 'system' | 'user' | 'assistant'; content: string };
  const systemPrompt = `
You are a medical assistant. Answer the patient based on the following information.
Patient persona: ${persona}
Relevant medical facts and memories:
${context}

Requirements:
1. Make the reply professional and kind, and consistent with the patient's persona.
2. Base the answer strictly on the reference facts. If you do not know, say so.
3. Avoid unsafe medical advice and recommend care appropriately when needed.
`;

    const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...history.map((msg): Message => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        })),
        { role: "user", content: query }
    ];

  const response = await seaLionClient.chat.completions.create({
    model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
        messages,
  });

  return response.choices[0].message.content || "";
}

export async function generateDoctorAssistantIntakeResponse(
  doctorName: string,
  query: string,
  context: string,
  persona: string,
  history: Array<{ role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string }> = []
): Promise<string> {
  type Message = { role: 'system' | 'user' | 'assistant'; content: string };

  const detectAnsweredSignals = (evidence: string) => {
    const e = evidence.replace(/\s+/g, '');
    const yes = (re: RegExp) => re.test(e);
    const no = (re: RegExp) => re.test(e);
    return {
      feverNo: no(/没(有)?发(烧|热)|无发(烧|热)|不发(烧|热)|体温(正常|不高)|无热/),
      chestPainNo: no(/没(有)?(胸痛|胸闷)|无(胸痛|胸闷)|不(胸痛|胸闷)/),
      sobNo: no(/没(有)?(气短|气促|喘|呼吸困难)|无(气短|气促|喘|呼吸困难)|不(气短|气促|喘)/),
      neuroNo: no(/没(有)?(说话不清|口齿不清|单侧无力|偏瘫|嘴歪|麻木)|无(说话不清|口齿不清|单侧无力|偏瘫|嘴歪|麻木)/),
      syncopeNo: no(/没(有)?(晕厥|黑蒙|昏厥)|无(晕厥|黑蒙|昏厥)/),
      medsNone: yes(/(目前|现在|暂时)?(还)?没(有)?(服用|吃)(降压药|降糖药|药)|未(服药|用药)/),
      allergyNone: yes(/没(有)?(过敏|药物过敏)|无(过敏|药物过敏)/),
    };
  };

  const isQuestionAbout = (q: string, keys: RegExp[]) => keys.some((r) => r.test(q));

  const filterRedundantQuestions = (questions: string[], evidence: string) => {
    const s = detectAnsweredSignals(evidence);
    return questions.filter((q) => {
      if (s.feverNo && isQuestionAbout(q, [/发烧|发热|体温/])) return false;
      if (s.chestPainNo && isQuestionAbout(q, [/胸痛|胸闷/])) return false;
      if (s.sobNo && isQuestionAbout(q, [/气短|气促|呼吸困难|喘/])) return false;
      if (s.neuroNo && isQuestionAbout(q, [/说话不清|口齿不清|单侧无力|偏瘫|嘴歪|麻木/])) return false;
      if (s.syncopeNo && isQuestionAbout(q, [/晕厥|黑蒙|昏厥/])) return false;
      if (s.medsNone && isQuestionAbout(q, [/在用(什么|哪些)?药|目前(有没有)?用药|服药|降压药|降糖药|二甲双胍|胰岛素/])) return false;
      if (s.allergyNone && isQuestionAbout(q, [/过敏|药物过敏/])) return false;
      return true;
    });
  };

  const normalizeQuestions = (raw: string) => {
    const normalized = raw
      .replace(/\r\n/g, '\n')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+[.、]\s*/gm, '')
      .trim();

    const lines = normalized
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.endsWith('?') ? s.slice(0, -1) + '？' : s));

    return lines.filter((s) => s.endsWith('？'));
  };

  const pickThreeQuestions = (raw: string, evidence: string) => {
    const qs = filterRedundantQuestions(normalizeQuestions(raw), evidence);
    const selected = qs.slice(0, 3);
    if (selected.length === 3) return selected.join('\n');

    const pool = [
      'What is bothering you most right now?',
      'When did it start? Has it recently improved or worsened?',
      'What have your recent blood pressure and heart rate readings been? Do you have a continuous record?',
      'When you feel dizzy, does the room spin, or do you feel lightheaded or unsteady? Is it related to position changes?',
      'Do you have nausea, vomiting, diarrhea, or clear signs of dehydration such as dry mouth or reduced urination?',
      'How have your meals, sleep, and fluid intake been today?',
      'Have you had fever, chest pain, shortness of breath, slurred speech, one-sided weakness, or blackout/fainting?',
      'Are you currently taking any medications, or do you have any known allergies?',
    ];

    const filled = [...selected];
    for (const q of pool) {
      if (filled.length >= 3) break;
      if (filled.includes(q)) continue;
      if (!filterRedundantQuestions([q], evidence).length) continue;
      filled.push(q);
    }
    while (filled.length < 3) filled.push('What is bothering you most right now?');
    return filled.slice(0, 3).join('\n');
  };
  const systemPrompt = `
You are ${doctorName}'s assistant and your role is to collect clinical intake information from the patient in a WeChat-style chat.
You are gathering information, not replacing the doctor's diagnosis.

Patient persona: ${persona}
Known key information (possibly from prior chat or extracted notes):
${context}

Requirements:
1. Your reply may contain questions only. Do not explain causes, give advice, propose management, or direct the patient to urgent care.
2. Output exactly 3 short questions, one per line, and each must end with a question mark.
3. Do not repeat information the patient has already clearly answered. Prioritize missing information.
4. Do not use numbering, bullets, or Markdown. Avoid directive language such as should, need to, first, then, or go to the ER.
5. Keep the tone natural and brief, like a real assistant asking questions in chat.
`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(
      (msg): Message => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      })
    ),
    { role: 'user', content: query },
  ];

  const response = await seaLionClient.chat.completions.create({
    model: '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
    messages,
    temperature: 0.4,
  });

  const evidence = [context, persona, ...history.map((h) => h.content), query].filter(Boolean).join('\n');
  return pickThreeQuestions(response.choices[0].message.content || '', evidence);
}

/**
 * 医生辅助 (Doctor Copilot) - 生成回复草稿
 */
export async function generateDoctorCopilotSuggestion(
  patientInfo: string,
  persona: string,
  relevantMemories: string,
  relevantKnowledge: string = "",
  speaker: 'assistant' | 'doctor' = 'assistant',
  hasActiveConsultation: boolean = false
): Promise<string> {
  const roleContext =
    speaker === 'doctor'
      ? `You are an experienced licensed physician conducting a paid online consultation. You are the doctor speaking directly with the patient.`
      : `You are a doctor's assistant, not a physician. You are chatting with the patient to collect key information, provide basic education, and guide the care flow before handing key points to the doctor.`;

  const roleRules =
    speaker === 'doctor'
      ? [
        'You are replying directly to the patient. Do not tell the patient to ask the doctor, because you are the doctor.',
        'Sound like a real doctor: professional, restrained, and concise. Avoid excessive empathy, cliches, or customer-service phrasing.',
        'Prioritize a clear next step: 1) conclusion or boundary of assessment 2) practical advice 3) only the essential follow-up questions if needed 4) risk warning and when to seek care.',
        'Do not broadly tell the patient to go offline for care unless physical exam, testing, or imaging is truly necessary.',
        'Do not casually recommend antibiotics, steroids, or prescription medicines. If medication comes up, provide principles and precautions and mention allergy or clinician guidance when relevant.',
        'Do not mention AI, models, prompts, or systems. Output only a message that can be sent directly to the patient.'
      ].join('\n')
      : [
        'You are not a doctor. Do not make definitive diagnoses or write prescriptions. Focus on gathering information and clarifying the patient’s situation.',
        'Keep the tone natural and human: brief, direct, and not overly wordy.',
        'Structure: first acknowledge the message, then ask 3 to 6 short questions to fill key gaps, then give 1 to 3 safe and general observation or self-care suggestions, then remind the patient about red-flag symptoms.',
        hasActiveConsultation
          ? 'This patient already has an active doctor consultation. Do not mention starting consultation flow, replying with 1, or payment links. If the patient asks for the doctor, tell them to continue describing the situation in the current chat.'
          : 'If the patient strongly requests the doctor, explain the consultation flow briefly: ask for the doctor, receive the system confirmation step, then payment creates the doctor consultation.',
        'Do not mention AI, models, prompts, or systems. Output only a message that can be sent directly to the patient.'
      ].join('\n');

  const prompt = `
${roleContext}

Patient persona: ${persona || '(none)'}

Draft a reply based on the patient overview, memories, and knowledge base.
Writing requirements:
${roleRules}

Reference information:
Patient overview: ${patientInfo}
Related history and memories:
${relevantMemories}
Relevant medical knowledge:
${relevantKnowledge}

Now output the reply draft directly. Do not add a title, bullet points, or quotation marks.
`;

  const response = await seaLionClient.chat.completions.create({
    model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
  });

  return response.choices[0].message.content || "";
}

/**
 * 意图识别 (Intent Classification)
 * 返回: 'medical_consult' | 'chitchat_admin'
 */
export async function classifyIntent(query: string): Promise<'medical_consult' | 'chitchat_admin'> {
  const prompt = `
You are a medical intent classification assistant.
Determine whether the user's input is a medical consultation about symptoms, treatment, or medication, or an administrative question about clinic operations.

Examples:
- "I have a headache" -> medical_consult
- "I have hypertension" -> medical_consult
- "Doctor, I have been having insomnia lately" -> medical_consult
- "What time do you open?" -> chitchat_admin
- "How much is the registration fee?" -> chitchat_admin
- "Hello" -> chitchat_admin
- "What medicine should I take for a cold?" -> medical_consult
Rule:
- If it involves symptoms, disease, testing, treatment, medication, dosage, adverse effects, or pregnancy/breastfeeding medication use -> medical_consult
- Only use chitchat_admin when the question is clearly about scheduling, address, cost, payment, invoice, registration, or clinic process

User input:
${query}

Output only the category code: medical_consult or chitchat_admin
`;

  const response = await withRetry(async () => {
    return await seaLionClient.chat.completions.create({
      model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });
  });

  const result = response.choices[0].message.content?.trim();
  return result === 'medical_consult' ? 'medical_consult' : 'chitchat_admin';
}

/**
 * 知识库问答 (Knowledge Base QA)
 */
export async function generateKnowledgeResponse(query: string, relevantKnowledge: string): Promise<string> {
  const prompt = `
You are an administrative assistant for a medical organization. You may answer only operational or process questions such as opening hours, address, fees, registration, payment, invoices, and visit flow.
You must not answer questions about symptoms, medication, treatment, or tests.
If the question is not administrative, or if the knowledge base does not contain the answer, reply exactly: I can only answer administrative questions. Your message has been recorded, and a staff member will follow up later.

Knowledge base reference:
${relevantKnowledge}

User question: ${query}
`;

  const response = await seaLionClient.chat.completions.create({
    model: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content || "";
}
