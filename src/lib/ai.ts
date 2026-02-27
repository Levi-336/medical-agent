import { ZhipuAI } from 'zhipuai';

// 初始化 ZhipuAI 客户端
const apiKey = process.env.ZHIPU_API_KEY;
if (!apiKey) {
  console.warn("警告: 未设置 ZHIPU_API_KEY 环境变量");
}

const client = new ZhipuAI({
  apiKey: apiKey || 'dummy', // 防止构建时报错，运行时必须有
});

/**
 * 获取文本的向量嵌入 (Embedding-3)
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await client.embeddings.create({
      model: "embedding-3",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Embedding error:", error);
    throw error;
  }
}

/**
 * 从医疗资料中提取关键事实 (GLM-4.7)
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

  const response = await client.chat.completions.create({
    model: "glm-4-flash", // 使用 flash 或 plus/0520 等
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
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

  const response = await client.chat.completions.create({
    model: 'glm-4-flash',
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
你是一个医疗画像专家。请根据新的医疗信息，更新患者的“画像（Persona）”。
画像应包含：性格特征、关键健康标签、生活习惯、沟通偏好等。
保持简练、客观。

当前画像：
${currentPersona || "（无）"}

新导入/分析的信息：
${newInfo}

请输出更新后的完整画像文本：
`;

  const response = await client.chat.completions.create({
    model: "glm-4-flash",
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
    type ZhipuMessage = { role: 'system' | 'user' | 'assistant'; content: string };
  const systemPrompt = `
你是一个医疗智能体。基于以下信息回答用户（患者）的问题。
患者画像：${persona}
参考的医疗事实（记忆）：
${context}

要求：
1. 回复要专业、亲切，符合患者画像的语境。
2. 严格基于参考事实回答，如果不知道，请承认。
3. 避免给出危险的医疗建议，提示就医。
`;

    const messages: ZhipuMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.map((msg): ZhipuMessage => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
        })),
        { role: "user", content: query }
    ];

  const response = await client.chat.completions.create({
    model: "glm-4-flash",
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
  type ZhipuMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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
      '您现在最主要哪里不舒服？',
      '从什么时候开始的？最近有没有加重或缓解？',
      '最近血压/心率大概是多少？有连续测量记录吗？',
      '头晕时是天旋地转还是发飘/站不稳？和体位变化有关吗？',
      '有没有恶心/呕吐/腹泻或明显脱水（口干、尿少）？',
      '今天饮食、睡眠和饮水情况如何？',
      '有没有发烧/胸痛/气短/说话不清/单侧无力/黑蒙晕厥等情况？',
      '目前有没有在用药或已知过敏？',
    ];

    const filled = [...selected];
    for (const q of pool) {
      if (filled.length >= 3) break;
      if (filled.includes(q)) continue;
      if (!filterRedundantQuestions([q], evidence).length) continue;
      filled.push(q);
    }
    while (filled.length < 3) filled.push('您现在最主要哪里不舒服？');
    return filled.slice(0, 3).join('\n');
  };
  const systemPrompt = `
你是${doctorName}的助理，负责在微信中与患者沟通并收集病情信息。
你要做的是“问诊信息采集”，不是替代医生诊断。

患者画像：${persona}
已掌握的关键信息（可能来自历史对话或自动抽取）：
${context}

要求：
1. 你的回复只能包含“询问句”，用于收集信息；不允许解释病因、不允许给出建议、不允许给出处置方案、不允许提示就医/急诊。
2. 只输出 3 个简短问题，每个问题单独一行，必须以“？”结尾。
3. 不要重复询问患者已经明确回答过的信息；优先问缺失信息。
4. 不要使用编号、列表符号、Markdown，不要出现“建议/可以/应该/需要/先/后/请立刻/急诊”等指导性措辞。
5. 口吻自然、简短，像真人助理在微信里提问。
`;

  const messages: ZhipuMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(
      (msg): ZhipuMessage => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      })
    ),
    { role: 'user', content: query },
  ];

  const response = await client.chat.completions.create({
    model: 'glm-4-flash',
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
      ? `你是一位经验丰富的执业医生，正在与患者进行“已付费的在线医生会诊”，你就是正在和患者说话的医生本人。`
      : `你是医生助理（非医生），在微信中与患者沟通，目标是采集关键信息、做基础科普与流程引导，并把关键信息整理给医生。`;

  const roleRules =
    speaker === 'doctor'
      ? [
        '你正在直接回复患者，不要让患者“去咨询医生/问医生”，因为你就是医生。',
        '语气要像真人医生：专业、克制、简短，不要过度共情和鸡汤，不要像“AI客服”。',
        '优先给出明确下一步：1) 结论/判断边界 2) 处理建议 3) 需要补充的关键问题（按需 1~4 个） 4) 风险警示/何时就医。',
        '除非确实需要体格检查/化验/影像才能判断，否则不要泛泛建议“去线下问诊”。',
        '不要随意推荐抗生素/激素/处方药；如涉及用药，给出原则与注意事项，提示遵医嘱与过敏禁忌。',
        '不要提及“我是AI/模型/提示词/系统”。只输出可直接发送的一段微信消息。'
      ].join('\n')
      : [
        '你不是医生，不做明确诊断/不开处方；重点是信息采集与把患者情况问清楚。',
        '语气自然、像真人助理：简短、直接，不要鸡汤，不要长篇大论。',
        '结构：先一句确认已收到 → 用 3~6 个短问题补齐关键信息 → 给 1~3 条安全的通用护理/观察建议 → 给出红旗症状提醒。',
        hasActiveConsultation
          ? '当前患者已建立医生会话：不要提及“发起医生会诊/回复1/支付链接”等流程；如果患者要求医生沟通，直接引导其在当前会话继续描述情况即可。'
          : '如果患者强烈要求医生沟通，说明“可发起医生会诊：回复找医生→系统提示回复1确认→发送支付链接→支付后建立医生会话”。',
        '不要提及“我是AI/模型/提示词/系统”。只输出可直接发送的一段微信消息。'
      ].join('\n');

  const prompt = `
${roleContext}

患者画像：${persona || '（无）'}

你将基于“患者概况/记忆/知识库”起草一条回复草稿。
写作要求：
${roleRules}

参考信息：
患者概况：${patientInfo}
相关病历/记忆：
${relevantMemories}
相关医疗知识库：
${relevantKnowledge}

现在请直接输出“回复草稿”，不要标题，不要列表符号，不要引号。
`;

  const response = await client.chat.completions.create({
    model: "glm-4-flash",
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
你是一个医疗意图识别助手。
请判断用户的以下输入是属于“病情/用药相关咨询（包括通用用药问题）”还是“行政类问题（如上班时间、地址、收费、流程、发票、支付等）”。

示例：
- "我头疼" -> medical_consult
- "我有高血压" -> medical_consult
- "医生，我最近总是失眠" -> medical_consult
- "几点上班？" -> chitchat_admin
- "挂号费多少？" -> chitchat_admin
- "你好" -> chitchat_admin
- "感冒了吃什么药？" -> medical_consult
修正策略：
- 只要涉及症状、疾病、检查、治疗、用药、剂量、不良反应、孕哺用药等 -> medical_consult
- 仅当问题明显是行政流程/时间/地点/费用/支付/发票/挂号等 -> chitchat_admin

用户输入：
${query}

请仅输出类别代码：medical_consult 或 chitchat_admin
`;

  const response = await client.chat.completions.create({
    model: "glm-4-flash",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });

  const result = response.choices[0].message.content?.trim();
  return result === 'medical_consult' ? 'medical_consult' : 'chitchat_admin';
}

/**
 * 知识库问答 (Knowledge Base QA)
 */
export async function generateKnowledgeResponse(query: string, relevantKnowledge: string): Promise<string> {
  const prompt = `
你是一个医疗机构的“行政类”助手，只能回答行政/流程问题（如上班时间、地址、收费、挂号、支付、发票、就诊流程）。
你不能回答任何病情、用药、治疗、检查相关的问题。
如果用户的问题不是行政类，或知识库中没有相关信息，请直接回复：我只能回答行政类问题，已为您记录，请稍后由人工回复。

知识库参考：
${relevantKnowledge}

用户问题：${query}
`;

  const response = await client.chat.completions.create({
    model: "glm-4-flash",
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content || "";
}
