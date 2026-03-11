import json
import sqlite3
import re
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

# ==========================================
# 1. Standard Agent Tool Schemas (Pydantic V2)
# Designed for frameworks like joyagent-jdgenie
# ==========================================

class PatientState(BaseModel):
    patient_id: str = Field(..., description="Unique patient identifier")
    drug_name: str = Field(..., description="Target drug name")
    current_dose_mg: int = Field(..., description="Current prescribed dose in mg")
    egfr_value: float = Field(..., description="Latest eGFR lab result (Renal function)")
    emotion: Optional[str] = Field("neutral", description="MERaLiON detected tone/emotion (e.g. anxious, frustrated, neutral)")

class ClinicalSafetyCheckSchema(BaseModel):
     patient_state: PatientState = Field(..., description="The full state of the patient including vitals and target drug")

class RAGRetrieveGuidanceSchema(BaseModel):
    query: str = Field(..., description="The user's query regarding their medication or lifestyle")
    emotion: Optional[str] = Field("neutral", description="MERaLiON detected emotion to retrieve empathetic responses")
    top_k: Optional[int] = Field(2, description="Number of results to retrieve")

class ClinicianRedFlag(BaseModel):
    patient_id: str
    drug_name: str
    flag_type: str
    description: str
    action_taken: str

# ==========================================
# 2. ADK-Ready Tool Classes (with standardized `.schema()` output)
# ==========================================

class MedicalSafetyTool:
    """
    Agent Tool for validating Hard Rules (Contraindications, Overdose)
    compatible with public datasets (RxNorm/SNOMED CT).
    """
    name = "clinical_safety_check"
    description = "MUST BE CALLED BEFORE RECOMMENDING ANY MEDICATION. Checks maximum dosage and vital contraindications (eGFR) against public medical databases."
    args_schema = ClinicalSafetyCheckSchema
    
    def __init__(self, db_path: str = "patient_rules.db"):
        self.db_path = db_path
        self.red_flags_log: List[ClinicianRedFlag] = []

    def load_rules(self, json_path: str):
        with open(json_path, 'r', encoding='utf-8') as f:
            rules = json.load(f)
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''CREATE TABLE IF NOT EXISTS hard_rules 
                         (drug_name TEXT PRIMARY KEY, rxcui TEXT, snomed_ct TEXT, max_daily_dosage TEXT, absolute_contraindications TEXT)''')
        for r in rules:
            cursor.execute("INSERT OR REPLACE INTO hard_rules (drug_name, rxcui, snomed_ct, max_daily_dosage, absolute_contraindications) VALUES (?, ?, ?, ?, ?)",
                           (r['drug_name'], r['drug_id']['rxcui'], r['drug_id']['snomed_ct_code'], r['max_daily_dosage'], json.dumps(r['absolute_contraindications'])))
        conn.commit()
        conn.close()

    def run(self, patient_state: PatientState) -> Dict[str, Any]:
        """ Standard execution entry point for Agent frameworks. """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT rxcui, snomed_ct, max_daily_dosage FROM hard_rules WHERE drug_name=?", (patient_state.drug_name,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return {"status": "pass", "msg": f"No hard limits found for {patient_state.drug_name}."}

        rxcui, snomed_ct, max_dos = row[0], row[1], row[2]
        max_val = int(re.search(r'\d+', max_dos).group()) if re.search(r'\d+', max_dos) else 99999
        alerts = []
        
        # Cross check using standardized limits
        if patient_state.current_dose_mg > max_val:
            alerts.append({"type": "OVERDOSE", "desc": f"[RxCUI:{rxcui}] Dose {patient_state.current_dose_mg}mg exceeds max limit of {max_val}mg"})
            
        if patient_state.egfr_value < 30.0:
            alerts.append({"type": "CONTRAINDICATION", "desc": f"[SNOMED:{snomed_ct}] eGFR {patient_state.egfr_value} < 30 triggers absolute contraindication."})

        if alerts:
            for a in alerts:
                self.red_flags_log.append(ClinicianRedFlag(
                    patient_id=patient_state.patient_id, drug_name=patient_state.drug_name,
                    flag_type=a["type"], description=a["desc"], action_taken="Interrupted Interaction (Sent to Clinician)"
                ))
            return {"status": "danger", "alerts": alerts}
            
        return {"status": "pass", "msg": "Safety check cleared."}

    def get_clinician_summary(self, patient_id: str) -> List[Dict]:
        return [f.model_dump() for f in self.red_flags_log if f.patient_id == patient_id]

class SoftKnowledgeRAGTool:
    """
    Agent Tool for RAG retrieval over localized clinical guidelines (MOH/HSA)
    and patient psychological support (MERaLiON aware).
    """
    name = "retrieve_patient_guidelines"
    description = "Retrieves soft knowledge (mechanisms, lifestyle, empathetic responses) based on user query and MERaLiON emotion."
    args_schema = RAGRetrieveGuidanceSchema
    
    def __init__(self, json_path: str = "medical_soft_kb.json"):
        with open(json_path, 'r', encoding='utf-8') as f:
            self.chunks = json.load(f)

    def run(self, query: str, emotion: str = "neutral", top_k: int = 2) -> List[Dict[str, Any]]:
        scored = []
        for c in self.chunks:
            score = 0
            for char in set(query):
                if char in c['content']: score += 1
                
            meta = c.get('metadata', {})
            # Empathy Boost via MERaLiON
            if meta.get('emotion_target') == emotion:
                score += 15
            # Semantic Intents
            if "忘" in query and meta.get('action') == "schedule_tomorrow_reminder":
                score += 10
            if "计划" in query and meta.get('action') == "generate_7_day_plan":
                score += 10
                
            scored.append((score, c))
            
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"content": res[1]['content'], "metadata": res[1].get('metadata', {})} for res in scored[:top_k]]

# ==========================================
# 3. SEA-LION Demonstration Orchestrator (Hackathon Runner)
# ==========================================

class SEALionOrchestrator:
    def __init__(self):
        self.safety_tool = MedicalSafetyTool()
        self.safety_tool.load_rules("medical_hard_rules.json")
        self.rag_tool = SoftKnowledgeRAGTool("medical_soft_kb.json")
        self.action_queue = []

    def execute_agent_turn(self, patient: PatientState, user_query: str):
        print(f"\n[{'='*60}]")
        print(f"🇸🇬 [Synapxe Demo Orchestrator] Process Turn for: {patient.patient_id}")
        print(f"🧠 MERaLiON Input Emotion => [{patient.emotion.upper()}]")
        print(f"💬 Query: '{user_query}'")

        # Generic Tool Call Interface Simulator
        print(f"\n⚙️ [Agent calls Tool]: {self.safety_tool.name} (Schema validated)")
        safety_res = self.safety_tool.run(patient)
        
        if safety_res["status"] == "danger":
            print(f"🚨 [HARD INTERCEPT]: RxNorm/SNOMED Safety Violation Detected!")
            print(f" -> Output to Patient: Please stop medication immediately. A priority yellow flag has been routed to your SingHealth clinician.")
            return

        print(f"\n⚙️ [Agent calls Tool]: {self.rag_tool.name} (Query: {user_query}, Emotion: {patient.emotion})")
        docs = self.rag_tool.run(user_query, patient.emotion)
        
        print("\n📝 [SEA-LION Synthesis Engine]: Formatting final empathetic response...")
        final_answer = ""
        for d in docs:
            print(f"   -> Read Source: {d['metadata'].get('source')} (Score Boosted)")
            final_answer += d['content'] + "\n"
            
            if d['metadata'].get('action') == "schedule_tomorrow_reminder":
                self.action_queue.append("API_CALL: Schedule Alarm for Tomorrow 08:00 AM (SG Time)")
            if d['metadata'].get('action') == "generate_7_day_plan":
                self.action_queue.append("API_CALL: Generate 7-Day Hawker Centre Low-GI Diet Plan")

        print(f"\n🗣️ [Empathetic Output to Patient]:\n{final_answer.strip()}")
        
        if self.action_queue:
            print("\n⚡ [System Actions Triggered]:")
            for act in self.action_queue:
                print(f"  -> {act}")
            self.action_queue.clear()

if __name__ == "__main__":
    orchestrator = SEALionOrchestrator()

    # --- Demo 1: MERaLiON picks up frustration (Singapore Localized) ---
    p1 = PatientState(patient_id="SG-P001", drug_name="Metformin", current_dose_mg=500, egfr_value=90.0, emotion="frustrated")
    orchestrator.execute_agent_turn(p1, "我已经很努力不吃甜食了，但血糖还是降不下来，气死我了！在新加坡外面吃东西太难控了！")

    # --- Demo 2: Standard Hard Safety Block ---
    p2 = PatientState(patient_id="SG-P002", drug_name="Atorvastatin", current_dose_mg=120, egfr_value=60.0, emotion="neutral")
    orchestrator.execute_agent_turn(p2, "医生开了阿托伐他汀，我昨天为了快点降脂多吃了几颗。可以吗？")
    
    # --- Demo 3: Clinician Summary View ---
    print("\n🩺 [Clinician Dashboard] Fetching pending alerts for SG-P002...")
    print(json.dumps(orchestrator.safety_tool.get_clinician_summary("SG-P002"), indent=2))
