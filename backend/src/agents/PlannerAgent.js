import { BaseAgent } from './base/BaseAgent.js';
import { ConversationAgent } from './ConversationAgent.js';
import { IdentityAgent } from './IdentityAgent.js';
import { FraudAgent } from './FraudAgent.js';
import { CreditAgent } from './CreditAgent.js';
import { DocumentAgent } from './DocumentAgent.js';
import { ComplianceAgent } from './ComplianceAgent.js';
import { DecisionAgent } from './DecisionAgent.js';
import { detectPromptInjection } from '../middleware/promptInjectionGuard.js';

/**
 * PlannerAgent — The brain of the agentic KYC system.
 *
 * Implements the O-R-P-A-E-U-R loop:
 *   OBSERVE  → Read working memory + recent conversation
 *   REASON   → LLM decides what to do next (or fast-path deterministic)
 *   PLAN     → Which agents to run, in what order (sync vs async)
 *   ACT      → Execute agents
 *   EVALUATE → Did we get what we needed? Any new signals?
 *   UPDATE   → Write new values to working memory + save trace
 *   REPLAN   → If extraction failed → probe; if missing fields → keep going
 *
 * Key differences vs. old fixed state machine:
 *   ✓ Dynamic ordering: asks for whatever field is most needed, not a hardcoded sequence
 *   ✓ Skips volunteered info: if user says "I earn 50k at TCS", skips BOTH questions
 *   ✓ Backtracking: re-asks any field if confidence is too low
 *   ✓ Async fraud: FraudAgent runs in background, never blocks user response
 *   ✓ Early credit signals: CreditAgent quick-assesses mid-call when enough data exists
 *   ✓ Injection defense: ALL transcripts screened before reaching any LLM
 */
export class PlannerAgent extends BaseAgent {
  constructor() {
    super('PlannerAgent');

    // All specialized agents — instantiated once, reused across turns
    this.conversationAgent = new ConversationAgent();
    this.identityAgent     = new IdentityAgent();
    this.fraudAgent        = new FraudAgent();
    this.creditAgent       = new CreditAgent();
    this.documentAgent     = new DocumentAgent();
    this.complianceAgent   = new ComplianceAgent();
    this.decisionAgent     = new DecisionAgent();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUBLIC: Fresh session start — generate greeting
  // ════════════════════════════════════════════════════════════════════════════
  async greet(sessionId, language) {
    const greeting = language === 'hi'
      ? 'नमस्ते! मैं Aria हूँ, आपकी AI लोन सहायक। मैं आपसे कुछ प्रश्न पूछूँगी जो आपके KYC के लिए जरूरी हैं — इसमें लगभग 5 मिनट लगेंगे। चलिए शुरू करते हैं — क्या आप अपना पूरा नाम बता सकते हैं?'
      : "Hi! I'm Aria, your AI loan onboarding assistant. I'll guide you through a quick KYC process — it'll take about 5 minutes. Let's get started — could you please tell me your full name as it appears on your ID?";

    await this.episodicMemory.appendTurn(sessionId, 'agent', greeting, { state: 'GREETING' });
    await this.workingMemory.update(sessionId, { lastAgentAction: 'greeting_sent' });

    return {
      question:   greeting,
      state:      'AGENTIC',
      stateLabel: 'Full Name',
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUBLIC: Process one user turn (main loop)
  // ════════════════════════════════════════════════════════════════════════════
  async processTurn({ sessionId, transcript, session, socket, io }) {
    const turnStart = Date.now();

    // ── OBSERVE ───────────────────────────────────────────────────────────────
    let wm = await this.workingMemory.get(sessionId);
    if (!wm) {
      wm = await this.workingMemory.init(sessionId, {
        language: session.language,
        loanType: session.loanType,
        geoData:  session.geoData || {},
      });
    }

    // Prompt injection check — BEFORE any LLM call
    const injectionCheck = detectPromptInjection(transcript);
    if (!injectionCheck.safe) {
      await this.workingMemory.addFraudSignal(sessionId, {
        type:        injectionCheck.reason,
        description: injectionCheck.description,
        severity:    injectionCheck.severity,
        weight:      this.semanticMemory.getFraudWeight(injectionCheck.reason),
      });
      this.log('warn', 'Prompt injection detected — replaying last question', { sessionId, reason: injectionCheck.reason });

      const lastMsg = await this.episodicMemory.getLastAgentMessage(sessionId);
      return {
        question:   lastMsg?.text || 'Could you please repeat that?',
        state:      'AGENTIC',
        stateLabel: 'Please repeat',
        isReprompt: true,
      };
    }

    // Load recent context
    const recentTurns = await this.episodicMemory.getRecentTurns(sessionId, 6);
    wm = await this.workingMemory.update(sessionId, { turnCount: (wm.turnCount || 0) + 1 });

    this.log('info', '── OBSERVE ──', {
      sessionId, turn: wm.turnCount,
      activeGoal: wm.activeGoal,
      missing: wm.missingFields.length,
      fraud: wm.fraudScore,
    });

    // ── REASON ────────────────────────────────────────────────────────────────
    const plannerDecision = await this._reason(wm, transcript, recentTurns, sessionId);
    const targetField     = plannerDecision.targetField;

    this.log('info', '── REASON ──', {
      sessionId, targetField,
      agentsToRun: plannerDecision.agentsToRun,
      reasoning:   plannerDecision.reasoning,
    });

    // ── PLAN ──────────────────────────────────────────────────────────────────
    const runFraudAsync     = plannerDecision.agentsToRun.includes('fraud');
    const runCreditQuick    = plannerDecision.agentsToRun.includes('credit');
    const runDocumentVerify = plannerDecision.agentsToRun.includes('document') || wm.missingFields.length === 0;
    const shouldComplete    = plannerDecision.shouldComplete || (wm.missingFields.length === 0 && !runDocumentVerify);

    // ── ACT (synchronous: extraction + question generation) ───────────────────
    let extraction = { extractedValue: null, confidence: 0, isValid: true, allExtracted: [], probeRequired: false, probeReason: null };

    if (transcript && targetField) {
      extraction = await this.identityAgent.run({
        transcript,
        targetField,
        collectedFields: wm.collectedFields,
        language:        wm.language,
        sessionId,
      });
    }

    // ── EVALUATE: did extraction succeed? ────────────────────────────────────
    const extractionSuccess = extraction.extractedValue !== null &&
                              extraction.confidence >= 0.60       &&
                              extraction.isValid;
    const needsProbe = extraction.probeRequired || !extractionSuccess;

    // ── UPDATE MEMORY (primary field) ─────────────────────────────────────────
    if (extractionSuccess && targetField) {
      wm = await this.workingMemory.setField(
        sessionId, targetField, extraction.extractedValue, extraction.confidence
      );
    }

    // UPDATE MEMORY (bonus fields volunteered in same answer)
    for (const extra of (extraction.allExtracted || [])) {
      if (!wm.collectedFields[extra.field]) { // Only add if not already collected
        wm = await this.workingMemory.setField(sessionId, extra.field, extra.value, extra.confidence);
        this.log('info', 'Bonus field captured', { sessionId, field: extra.field, confidence: extra.confidence });
      }
    }

    // Re-read updated working memory
    wm = await this.workingMemory.get(sessionId);

    // ── ACT ASYNC: FraudAgent (fire and forget) ───────────────────────────────
    if (runFraudAsync) {
      this._runFraudAsync(sessionId, wm, transcript, session.geoData).catch(err =>
        this.log('error', 'Async FraudAgent crashed', { sessionId, error: err.message })
      );
    }

    // ── ACT: Quick credit check mid-call ─────────────────────────────────────
    if (runCreditQuick && wm.collectedFields.monthlyIncome && wm.collectedFields.loanAmount) {
      const quickCheck = this.creditAgent.quickAssess(wm.collectedFields);
      if (quickCheck.hasIssues) {
        for (const flag of quickCheck.earlyFlags) {
          await this.workingMemory.addFraudSignal(sessionId, { ...flag, weight: 10 });
        }
        this.log('warn', 'Early credit flags detected', { sessionId, flags: quickCheck.earlyFlags });
      }
    }

    // ── REPLAN: Document verify or all fields done ────────────────────────────
    if (wm.missingFields.length === 0 || runDocumentVerify) {
      return await this._handleDocumentAndClose(session, sessionId, wm, io, socket);
    }

    // ── DECIDE NEXT QUESTION ──────────────────────────────────────────────────
    const nextField = needsProbe ? targetField : wm.missingFields[0];

    if (!nextField) {
      return await this._handleDocumentAndClose(session, sessionId, wm, io, socket);
    }

    const convResult = await this.conversationAgent.run({
      targetField: nextField,
      collectedFields: wm.collectedFields,
      language: wm.language,
      recentTurns,
      probeReason: needsProbe ? (extraction.probeReason || extraction.validationNote) : null,
      sessionId,
    });

    // ── UPDATE: Save transcript turns ─────────────────────────────────────────
    await this.episodicMemory.appendTurn(sessionId, 'user',  transcript,          { state: 'AGENTIC' });
    await this.episodicMemory.appendTurn(sessionId, 'agent', convResult.question,  { state: 'AGENTIC' });

    // ── UPDATE: Save decision trace ───────────────────────────────────────────
    await this.decisionMemory.saveTrace(sessionId, {
      turn:             wm.turnCount,
      agentsInvoked:    ['IdentityAgent', 'ConversationAgent', runFraudAsync ? 'FraudAgent(async)' : null].filter(Boolean),
      fieldsExtracted:  targetField ? new Map([[targetField, extraction.extractedValue]]) : new Map(),
      confidenceScores: targetField ? new Map([[targetField, extraction.confidence]])     : new Map(),
      activeGoal:       wm.activeGoal,
      nextGoal:         nextField,
      workingMemorySnapshot: {
        collectedCount: Object.keys(wm.collectedFields).length,
        missingCount:   wm.missingFields.length,
        fraudScore:     wm.fraudScore,
        turnCount:      wm.turnCount,
      },
    });

    const durationMs = Date.now() - turnStart;
    this.log('info', '── TURN COMPLETE ──', { sessionId, durationMs, nextField, probed: needsProbe });

    return {
      question:       convResult.question,
      state:          'AGENTIC',
      stateLabel:     this.semanticMemory.getFieldMeta(nextField)?.label || nextField,
      extractedValue: extraction.extractedValue,
      confidence:     extraction.confidence,
      fraudSignals:   [],
      probeRequired:  needsProbe,
      missingFields:  wm.missingFields,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: REASON — LLM or fast-path decision on what to do next
  // ════════════════════════════════════════════════════════════════════════════
  async _reason(wm, transcript, recentTurns, sessionId) {
    // Fast-path: early turns just follow field order (saves LLM call + latency)
    if (wm.turnCount <= 2 || wm.missingFields.length > 8) {
      const targetField = wm.missingFields[0];
      return {
        targetField,
        agentsToRun: ['identity', 'conversation'],
        shouldComplete: false,
        reasoning: 'fast-path: early turn, sequential ordering',
      };
    }

    // Fast-path: no missing fields — go straight to close
    if (wm.missingFields.length === 0) {
      return {
        targetField: null,
        agentsToRun: [],
        shouldComplete: true,
        reasoning: 'fast-path: all fields collected, closing call',
      };
    }

    const collected = Object.keys(wm.collectedFields);
    const recentCtx = recentTurns.slice(-3).map(t => `${t.role}: ${t.text}`).join('\n');

    const systemPrompt = `You are the Planner for an AI loan KYC interview system.

CURRENT STATE:
- Turn number:     ${wm.turnCount}
- Collected fields (${collected.length}): ${JSON.stringify(collected)}
- Missing fields  (${wm.missingFields.length}): ${JSON.stringify(wm.missingFields)}
- Fraud score:    ${wm.fraudScore}/100
- Active goal:    ${wm.activeGoal}

USER'S LATEST ANSWER: "${transcript}"

RECENT CONVERSATION:
${recentCtx || '(early in conversation)'}

INSTRUCTIONS:
1. Pick the BEST next field to ask from the missing list (priority: identity > financial > loan)
2. Did the user volunteer data for ANY other missing field in this answer?
3. Should FraudAgent run async? (yes if fraud score > 20 or you detect a contradiction)
4. Should CreditAgent quick-check? (yes if both income AND loanAmount are now collected)
5. Is the call complete? (only if missingFields will be empty AFTER processing this turn)

Return ONLY valid JSON:
{
  "targetField": "fieldKey from missing list or null",
  "agentsToRun": ["identity","conversation"],
  "shouldComplete": false,
  "reasoning": "one sentence"
}

Valid agentsToRun values: "identity", "conversation", "fraud", "credit"

DO NOT include "document" — document upload is handled separately after the call.`;

    try {
      const result = await this.callLLM({
        systemPrompt,
        userMessage: `Plan turn ${wm.turnCount}`,
        json: true,
      });

      // Validate targetField is actually in missing list
      if (result.targetField && !wm.missingFields.includes(result.targetField)) {
        result.targetField = wm.missingFields[0];
      }

      return result;
    } catch (err) {
      this.log('warn', 'Planner REASON LLM failed — using deterministic fallback', { sessionId, error: err.message });
      return {
        targetField:    wm.missingFields[0] || null,
        agentsToRun:    ['identity', 'conversation'],
        shouldComplete: wm.missingFields.length === 0,
        reasoning:      'fallback: sequential field ordering',
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Async fraud runner (non-blocking)
  // ════════════════════════════════════════════════════════════════════════════
  async _runFraudAsync(sessionId, wm, transcript, geoData) {
    const fraudResult = await this.fraudAgent.run({
      sessionId,
      collectedFields: wm.collectedFields,
      transcript,
      geoData:         geoData || wm.geoData || {},
      language:        wm.language,
      existingSignals: wm.fraudSignals || [],
    });

    await this.workingMemory.update(sessionId, {
      fraudScore:  fraudResult.fraudScore,
      fraudSignals: fraudResult.signals,
    });

    if (fraudResult.riskLevel === 'high') {
      this.log('warn', '🚨 HIGH FRAUD RISK', { sessionId, score: fraudResult.fraudScore, recommendation: fraudResult.recommendation });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Call completion — no document step (docs uploaded on review page)
  // ════════════════════════════════════════════════════════════════════════════
  async _handleDocumentAndClose(session, sessionId, wm, io, socket) {
    // ── Compliance gate ───────────────────────────────────────────────────────
    const complianceResult = await this.complianceAgent.run({
      sessionId,
      collectedFields: wm.collectedFields,
      confidenceMap:   wm.confidenceMap,
      consentData:     session.consentData,
      fraudScore:      wm.fraudScore,
    });

    // If not compliant and there are still missing fields, keep asking
    if (!complianceResult.canProceed && wm.missingFields.length > 0) {
      this.log('warn', 'Compliance gate blocked — still missing fields', {
        sessionId, missing: complianceResult.missingRequirements.map(r => r.field),
      });
      const nextField  = wm.missingFields[0];
      const convResult = await this.conversationAgent.run({
        targetField:     nextField,
        collectedFields: wm.collectedFields,
        language:        wm.language,
        sessionId,
      });
      return {
        question:   convResult.question,
        state:      'AGENTIC',
        stateLabel: this.semanticMemory.getFieldMeta(nextField)?.label || nextField,
      };
    }

    // ── Build extracted fields for frontend review ────────────────────────────
    const allFieldKeys    = this.semanticMemory.getAllRequiredFieldKeys();
    const extractedFields = allFieldKeys.map(key => {
      const meta = this.semanticMemory.getFieldMeta(key);
      const conf = wm.confidenceMap[key] || 0;
      return {
        key,
        label:            meta.label,
        section:          meta.section,
        aiExtractedValue: wm.collectedFields[key] ?? null,
        finalValue:       wm.collectedFields[key] ?? null,
        confidence:       conf,
        isFlagged:        conf < (meta.minConfidence || 0.75),
        isEdited:         false,
        source:           'verbal',
      };
    });

    // ── Closing message (spoken by Aria) ──────────────────────────────────────
    const firstName = wm.collectedFields.fullName
      ? String(wm.collectedFields.fullName).split(' ')[0]
      : null;

    const closingMessage = wm.language === 'hi'
      ? `बहुत बढ़िया${firstName ? `, ${firstName} जी` : ''}! आपके सभी विवरण दर्ज कर लिए गए हैं। आपका KYC साक्षात्कार पूरा हो गया है। आप अपना फॉर्म समीक्षा पृष्ठ पर देख सकते हैं। धन्यवाद!`
      : `Excellent${firstName ? `, ${firstName}` : ''}! All your details have been recorded. Your KYC interview is now complete. You can review and confirm your application on the next screen. Thank you!`;

    // ── Save session completion to MongoDB ────────────────────────────────────
    try {
      const Session = (await import('../models/Session.model.js')).default;
      await Session.findByIdAndUpdate(sessionId, {
        status:           'completed',
        endTime:          new Date(),
        agentState:       'CALL_COMPLETE',
        extractedAnswers: extractedFields,
        collectedAnswers: new Map(Object.entries(wm.collectedFields)),
      });
    } catch (err) {
      this.log('error', 'Failed to update session status', { sessionId, error: err.message });
    }

    // ── Save final trace ──────────────────────────────────────────────────────
    await this.decisionMemory.saveTrace(sessionId, {
      turn:          wm.turnCount,
      agentsInvoked: ['ComplianceAgent'],
      activeGoal:    'compliance_check',
      nextGoal:      'final_decision',
      workingMemorySnapshot: {
        collectedCount: Object.keys(wm.collectedFields).length,
        missingCount:   0,
        fraudScore:     wm.fraudScore,
        turnCount:      wm.turnCount,
      },
    });

    // Emit call:complete to frontend (user reviews extracted data on review page)
    io.to(sessionId).emit('call:complete', { sessionId, extractedFields });

    this.log('info', '✅ Call complete — no document step, user goes to review page', {
      sessionId, fields: allFieldKeys.length, fraud: wm.fraudScore,
    });

    return {
      question:   closingMessage,
      state:      'CALL_COMPLETE',
      stateLabel: 'Complete',
      isComplete: true,
    };
  }
}
