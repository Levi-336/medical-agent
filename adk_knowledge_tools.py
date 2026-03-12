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

    def run(self, query: str, patient_context: Optional[Dict[str, str]] = None, emotion: str = "neutral", top_k: int = 2) -> List[Dict[str, Any]]:
        """
        Standard execution entry point. 
        Implements Metadata Filtering (Pre-filtering) followed by semantic scoring.
        """
        filtered_chunks = self.chunks
        
        # 1. Metadata Pre-filtering (The "Filter 99%" Logic)
        if patient_context:
            target_drug = patient_context.get("drug_name")
            target_disease = patient_context.get("disease_type")
            
            # Use tags to filter out irrelevant documents before semantic search
            if target_drug or target_disease:
                filtered_chunks = [
                    c for c in self.chunks 
                    if (not target_drug or c['metadata'].get('target_drug') == target_drug or c['metadata'].get('target_drug') == "Any")
                    and (not target_disease or c['metadata'].get('disease_type') == target_disease or c['metadata'].get('disease_type') == "General_Chronic")
                ]

        # 2. Semantic & Emotional Scoring on the remaining subset
        scored = []
        keywords = ["miss", "forget", "plan", "diet", "anxious", "sad", "side effect", "work", "empty"]
        for c in filtered_chunks:
            score = 0
            for kw in keywords:
                if kw in query.lower() and kw in c['content'].lower():
                    score += 5
                
            meta = c.get('metadata', {})
            # Empathy Boost via MERaLiON emotion detect
            if meta.get('emotion_target') == emotion:
                score += 20  # High weight for emotional alignment
            
            # Action Intent Matching
            if ("missed" in query.lower() or "forgot" in query.lower()) and meta.get('action') == "schedule_tomorrow_reminder":
                score += 15
            if "plan" in query.lower() and meta.get('action') == "generate_7_day_plan":
                score += 15
                
            scored.append((score, c))
            
        scored.sort(key=lambda x: x[0], reverse=True)
        
        # Return content WITH Citations (Source)
        return [{
            "content": res[1]['content'], 
            "metadata": res[1].get('metadata', {}),
            "citation": res[1]['metadata'].get('source', 'Clinical Guidelines')
        } for res in scored[:top_k]]

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

        # [LAYER 1: Hard-Rule Rule Engine Interceptor]
        # Bypasses LLM entirely to check safety against SQL database
        print(f"\n🛡️ [Relational Logic Interceptor]: Checking Hard Rules for {patient.drug_name}")
        safety_res = self.safety_tool.run(patient)
        
        if safety_res["status"] == "danger":
            print(f"🚨 [HARD INTERCEPT]: RxNorm/SNOMED Safety Violation Detected!")
            print(f" -> Output to Patient: Please stop medication immediately. A priority red flag has been routed to your SingHealth clinician.")
            return

        # [LAYER 2: Fine-grained RAG with Metadata Filtering]
        # Pass patient tags (drug/disease) to filter irrelevant docs first
        print(f"\n🔍 [Enhanced RAG]: Filtering by Tags (Drug: {patient.drug_name}) & Retrieving Guideline Chunks...")
        context_filter = {"drug_name": patient.drug_name, "disease_type": "T2_Diabetes" if "Metformin" in patient.drug_name else None}
        docs = self.rag_tool.run(user_query, patient_context=context_filter, emotion=patient.emotion)
        
        # [LAYER 3: Response Synthesis with Structured Citations]
        print("\n📝 [SEA-LION Synthesis Engine]: Formatting final empathetic response with citations...")
        final_answer = ""
        citations = []
        for d in docs:
            print(f"   -> Retained Segment from: {d['citation']}")
            final_answer += d['content'] + " "
            citations.append(f"[{d['citation']}]")
            
            if d['metadata'].get('action') == "schedule_tomorrow_reminder":
                self.action_queue.append("API_CALL: Schedule Medication Alarm (SG Time)")
            if d['metadata'].get('action') == "generate_7_day_plan":
                self.action_queue.append("API_CALL: Generate 7-Day Low-GI Diet Plan (Hawker Friendly)")

        # Simulated response formatting (Agent usually does this)
        final_output_text = f"{final_answer.strip()}\n\nSources: {', '.join(list(set(citations)))}"
        print(f"\n🗣️ [Empathetic Output to Patient]:\n{final_output_text}")
        
        if self.action_queue:
            print("\n⚡ [System Actions Triggered]:")
            for act in self.action_queue:
                print(f"  -> {act}")
            self.action_queue.clear()

if __name__ == "__main__":
    orchestrator = SEALionOrchestrator()

    # --- Demo 1: MERaLiON picks up frustration (Singapore Localized) ---
    p1 = PatientState(patient_id="SG-P001", drug_name="Metformin", current_dose_mg=500, egfr_value=90.0, emotion="frustrated")
    orchestrator.execute_agent_turn(p1, "I've been working so hard to avoid sugar, but my readings are still high! It's so hard to control when eating out in Singapore Hawker Centres!")

    # --- Demo 2: Standard Hard Safety Block ---
    p2 = PatientState(patient_id="SG-P002", drug_name="Atorvastatin", current_dose_mg=120, egfr_value=60.0, emotion="neutral")
    orchestrator.execute_agent_turn(p2, "My doctor prescribed Atorvastatin. I took a few extra pills yesterday to lower my cholesterol faster. Is that okay?")
    
    # --- Demo 3: Clinician Summary View ---
    print("\n🩺 [Clinician Dashboard] Fetching pending alerts for SG-P002...")
    print(json.dumps(orchestrator.safety_tool.get_clinician_summary("SG-P002"), indent=2))
