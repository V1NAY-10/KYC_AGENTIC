import { BaseAgent } from './base/BaseAgent.js';
import { ConversationAgent } from './ConversationAgent.js';
import { IdentityAgent } from './IdentityAgent.js';
import { FraudAgent } from './FraudAgent.js';
import { CreditAgent } from './CreditAgent.js';
import { DocumentAgent } from './DocumentAgent.js';
import { ComplianceAgent } from './ComplianceAgent.js';
import { DecisionAgent } from './DecisionAgent.js';
import Session from '../models/Session.model.js';
import { detectPromptInjection } from '../middleware/promptInjectionGuard.js';
import { generateInterviewSummary } from '../services/ai/interviewSummary.service.js';
import { withSessionLock } from '../utils/sessionLock.js';
import { redactAadhaar } from '../utils/govtIdParser.js';

const MOVE_ON_PREFIX = {
  en: "No problem — we'll verify that from your documents later. ",
  hi: 'कोई बात नहीं — हम इसे बाद में आपके दस्तावेज़ों से सत्यापित कर लेंगे। ',
};
const SYSTEM_TROUBLE_PREFIX = {
  en: "Sorry, I'm having a little trouble on my side. ",
  hi: 'क्षमा करें, मेरी तरफ़ थोड़ी तकनीकी दिक्कत है। ',
};

/**
 * PlannerAgent — The brain of the agentic KYC system.
 *
 * Implements the O-R-P-A-E-U-R loop:
 *   OBSERVE  → Read working memory + recent conversation
 *   REASON   → Deterministic goal selection (probe field first, then next missing requirement)
 *   PLAN     → Which agents to run, in what order (sync vs async)
 *   ACT      → Execute agents
 *   EVALUATE → Did we get what we needed? Any new signals?
 *   UPDATE   → Write new values to working memory + mirror to MongoDB + save trace
 *   REPLAN   → If extraction failed → probe (max N attempts, then move on); if missing fields → keep going
 *
 * Design notes:
 *   ✓ One LLM round-trip for extraction + one for the next question per turn —
 *     goal selection is rule-based, which is faster and fully auditable
 *   ✓ Skips volunteered info: if user says "I earn 50k at TCS", skips BOTH questions
 *   ✓ Never dead-ends: after maxAttemptsPerField unusable answers the field is
 *     flagged for officer review and the interview moves on
 *   ✓ govtId requirement is met by EITHER a PAN or an Aadhaar number
 *   ✓ Async fraud: FraudAgent runs in background, never blocks user response
 *   ✓ Early credit signals: CreditAgent quick-assesses as soon as income + loan amount exist
 *   ✓ Injection defense: ALL transcripts screened before reaching any LLM
 *   ✓ Callers serialize turns per session (utils/sessionLock.js)
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
    const wm = await this.workingMemory.update(sessionId, { lastAgentAction: 'greeting_sent' });

    return {
      question:     greeting,
      state:        'AGENTIC',
      stateLabel:   'Full Name',
      currentField: wm.missingFields[0] || 'fullName',
      progress:     this._progress(wm),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUBLIC: Process one user turn (main loop)
  // ════════════════════════════════════════════════════════════════════════════
  async processTurn({ sessionId, transcript, session, socket, io }) {
    const turnStart = Date.now();
    const policy    = this.semanticMemory.getInterviewPolicy();

    // ── OBSERVE ───────────────────────────────────────────────────────────────
    let wm = await this.workingMemory.get(sessionId);
    if (!wm) {
      // Redis entry missing (expired/flushed) — rebuild from the MongoDB mirror
      wm = await this.workingMemory.init(sessionId, {
        language:         session.language,
        loanType:         session.loanType,
        geoData:          session.geoData || {},
        uploadedDocTypes: (session.documents || []).map(d => d.docType),
        collectedFields:  this._mapToObject(session.collectedAnswers),
        confidenceMap:    this._mapToObject(session.collectedConfidence),
      });
      this.log('warn', 'Working memory rebuilt from MongoDB', { sessionId, collected: Object.keys(wm.collectedFields).length });
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
        question:     lastMsg?.text || 'Could you please repeat that?',
        state:        'AGENTIC',
        stateLabel:   'Please repeat',
        isReprompt:   true,
        currentField: wm.missingFields[0] || null,
        progress:     this._progress(wm),
      };
    }

    const recentTurns = await this.episodicMemory.getRecentTurns(sessionId, 6);
    wm = await this.workingMemory.update(sessionId, { turnCount: (wm.turnCount || 0) + 1 });

    this.log('info', '── OBSERVE ──', {
      sessionId, turn: wm.turnCount,
      missing: wm.missingFields.length,
      probeField: wm.probeField, probeCount: wm.probeCount,
      fraud: wm.fraudScore,
    });

    // ── REASON (deterministic) ────────────────────────────────────────────────
    const targetField = this._chooseTarget(wm);

    if (!targetField) {
      return this._handleDocumentAndClose(session, sessionId, wm, io, transcript);
    }

    this.log('info', '── REASON ──', { sessionId, targetField });

    // ── ACT (synchronous: extraction) ─────────────────────────────────────────
    const hadIncomeAndLoan = Boolean(wm.collectedFields.monthlyIncome && wm.collectedFields.loanAmount);
    const extraction = await this.identityAgent.run({
      transcript,
      targetField,
      collectedFields: wm.collectedFields,
      language:        wm.language,
      sessionId,
    });

    // ── EVALUATE ──────────────────────────────────────────────────────────────
    const extractedField    = extraction.extractedField || targetField;
    const systemError       = extraction.probeReason === 'Could not process your response' && extraction.confidence === 0;
    const extractionSuccess = extraction.extractedValue !== null &&
                              extraction.confidence >= 0.60       &&
                              extraction.isValid;

    // ── UPDATE MEMORY (primary field) ─────────────────────────────────────────
    let gaveUp = false;
    if (extractionSuccess) {
      wm = await this.workingMemory.setField(sessionId, extractedField, extraction.extractedValue, extraction.confidence);
    } else if (!systemError) {
      // An LLM outage is not the user's fault — only real unusable answers count
      wm = await this.workingMemory.recordFailedAttempt(sessionId, targetField);

      if (wm.probeCount >= policy.maxAttemptsPerField) {
        gaveUp = true;
        if (extraction.extractedValue !== null && extraction.isValid) {
          // Usable but low confidence — keep it, the review page flags it
          wm = await this.workingMemory.setField(sessionId, extractedField, extraction.extractedValue, extraction.confidence);
        } else {
          wm = await this.workingMemory.skipField(sessionId, targetField, extraction.probeReason || extraction.validationNote || 'No usable answer');
        }
        this.log('warn', 'Max attempts reached — moving on', { sessionId, targetField, attempts: policy.maxAttemptsPerField });
      }
    }

    // UPDATE MEMORY (bonus fields volunteered in same answer)
    for (const extra of (extraction.allExtracted || [])) {
      const requirement = this.semanticMemory.getRequirementFor(extra.field);
      if (wm.collectedFields[extra.field] || !wm.missingFields.includes(requirement)) continue;
      wm = await this.workingMemory.setField(sessionId, extra.field, extra.value, extra.confidence);
      this.log('info', 'Bonus field captured', { sessionId, field: extra.field, confidence: extra.confidence });
    }

    // ── ACT ASYNC: FraudAgent (fire and forget) ───────────────────────────────
    // Only when a fraud-relevant fact lands (geo vs address, income plausibility, loan size)
    const capturedNow   = [extractionSuccess ? extractedField : null, ...(extraction.allExtracted || []).map(e => e.field)];
    const runFraudAsync = capturedNow.some(f => policy.fraudTriggerFields.includes(f));
    if (runFraudAsync) {
      this._runFraudAsync(sessionId, wm, redactAadhaar(transcript), session.geoData).catch(err =>
        this.log('error', 'Async FraudAgent crashed', { sessionId, error: err.message })
      );
    }

    // ── ACT: Quick credit check as soon as income + loan amount exist ─────────
    if (!hadIncomeAndLoan && wm.collectedFields.monthlyIncome && wm.collectedFields.loanAmount) {
      const quickCheck = this.creditAgent.quickAssess(wm.collectedFields);
      if (quickCheck.hasIssues) {
        for (const flag of quickCheck.earlyFlags) {
          wm = (await this.workingMemory.addFraudSignal(sessionId, { ...flag, weight: 10 })) || wm;
        }
        this.log('warn', 'Early credit flags detected', { sessionId, flags: quickCheck.earlyFlags });
      }
    }

    // ── REPLAN: everything collected → close ──────────────────────────────────
    if (wm.missingFields.length === 0) {
      return this._handleDocumentAndClose(session, sessionId, wm, io, transcript);
    }

    // ── DECIDE NEXT QUESTION ──────────────────────────────────────────────────
    const reAsk     = !extractionSuccess && !gaveUp && wm.missingFields.includes(targetField);
    const nextField = reAsk ? targetField : wm.missingFields[0];

    const convResult = await this.conversationAgent.run({
      targetField:      nextField,
      collectedFields:  wm.collectedFields,
      language:         wm.language,
      recentTurns,
      probeReason:      reAsk ? (extraction.probeReason || extraction.validationNote || 'The answer was unclear') : null,
      uploadedDocTypes: wm.uploadedDocTypes || [],
      sessionId,
    });

    const lang = wm.language === 'hi' ? 'hi' : 'en';
    const question = (gaveUp ? MOVE_ON_PREFIX[lang] : systemError ? SYSTEM_TROUBLE_PREFIX[lang] : '') + convResult.question;

    // ── UPDATE: persist transcript + mirror collected state (one write) ───────
    await this._persistTurn(sessionId, wm, transcript, question);

    // Decision trace is audit-only — never delay the user's reply for it
    this.decisionMemory.saveTrace(sessionId, {
      turn:             wm.turnCount,
      plannerReasoning: reAsk ? `re-ask ${targetField} (attempt ${wm.probeCount + 1})` : gaveUp ? `gave up on ${targetField}` : `next: ${nextField}`,
      agentsInvoked:    ['IdentityAgent', 'ConversationAgent', runFraudAsync ? 'FraudAgent(async)' : null].filter(Boolean),
      fieldsExtracted:  new Map([[extractedField, extraction.extractedValue]]),
      confidenceScores: new Map([[extractedField, extraction.confidence]]),
      activeGoal:       targetField,
      nextGoal:         nextField,
      workingMemorySnapshot: {
        collectedCount: Object.keys(wm.collectedFields).length,
        missingCount:   wm.missingFields.length,
        skipped:        (wm.skippedFields || []).map(s => s.field),
        fraudScore:     wm.fraudScore,
        turnCount:      wm.turnCount,
      },
    }).catch(() => {});

    const durationMs = Date.now() - turnStart;
    this.log('info', '── TURN COMPLETE ──', { sessionId, durationMs, nextField, probed: reAsk, gaveUp });

    return {
      question,
      state:          'AGENTIC',
      stateLabel:     this.semanticMemory.getFieldMeta(nextField)?.label || nextField,
      currentField:   nextField,
      progress:       this._progress(wm),
      extractedValue: extraction.extractedValue,
      confidence:     extraction.confidence,
      fraudSignals:   [],
      probeRequired:  reAsk,
      isReprompt:     reAsk,
      missingFields:  wm.missingFields,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: REASON — keep probing the current field, else next missing requirement
  // ════════════════════════════════════════════════════════════════════════════
  _chooseTarget(wm) {
    if (wm.probeField && wm.missingFields.includes(wm.probeField)) return wm.probeField;
    return wm.missingFields[0] || null;
  }

  _progress(wm) {
    const total = this.semanticMemory.getAllRequiredFieldKeys().length;
    return { completed: total - wm.missingFields.length, total, missing: wm.missingFields };
  }

  _mapToObject(value) {
    if (!value) return {};
    if (value instanceof Map) return Object.fromEntries(value);
    return { ...value };
  }

  async _persistTurn(sessionId, wm, userText, agentText) {
    const now = new Date();
    const turns = [];
    if (userText)  turns.push({ role: 'user',  text: redactAadhaar(userText), state: 'AGENTIC', timestamp: now });
    if (agentText) turns.push({ role: 'agent', text: agentText, state: 'AGENTIC', timestamp: new Date(now.getTime() + 1) });

    try {
      await Session.updateOne({ _id: sessionId }, {
        $push: { transcript: { $each: turns } },
        $set: {
          agentState:          'AGENTIC',
          collectedAnswers:    wm.collectedFields,
          collectedConfidence: wm.confidenceMap,
        },
      });
    } catch (err) {
      this.log('error', 'Failed to persist turn', { sessionId, error: err.message });
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

    // Write back under the session lock so it can't clobber a concurrent turn
    await withSessionLock(sessionId, async () => {
      const current = await this.workingMemory.get(sessionId);
      if (!current) return;
      await this.workingMemory.update(sessionId, {
        fraudScore:   Math.max(current.fraudScore || 0, fraudResult.fraudScore),
        fraudSignals: this._dedupeSignals([...(current.fraudSignals || []), ...fraudResult.signals]),
      });
    });

    if (fraudResult.riskLevel === 'high') {
      this.log('warn', '🚨 HIGH FRAUD RISK', { sessionId, score: fraudResult.fraudScore, recommendation: fraudResult.recommendation });
    }
  }

  _dedupeSignals(signals) {
    const seen = new Set();
    return signals.filter(s => {
      const key = `${s.type}|${s.field || ''}|${s.description || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Call completion — no document step (docs uploaded before the call)
  // ════════════════════════════════════════════════════════════════════════════
  async _handleDocumentAndClose(session, sessionId, wm, io, lastUserText) {
    // ── Compliance gate ───────────────────────────────────────────────────────
    const complianceResult = await this.complianceAgent.run({
      sessionId,
      collectedFields: wm.collectedFields,
      confidenceMap:   wm.confidenceMap,
      consentData:     session.consentData,
      fraudScore:      wm.fraudScore,
      skippedFields:   wm.skippedFields || [],
    });

    // If not compliant and there are still missing fields, keep asking
    if (!complianceResult.canProceed && wm.missingFields.length > 0) {
      this.log('warn', 'Compliance gate blocked — still missing fields', {
        sessionId, missing: complianceResult.missingRequirements.map(r => r.field),
      });
      const nextField  = wm.missingFields[0];
      const convResult = await this.conversationAgent.run({
        targetField:      nextField,
        collectedFields:  wm.collectedFields,
        language:         wm.language,
        uploadedDocTypes: wm.uploadedDocTypes || [],
        sessionId,
      });
      await this._persistTurn(sessionId, wm, lastUserText, convResult.question);
      return {
        question:     convResult.question,
        state:        'AGENTIC',
        stateLabel:   this.semanticMemory.getFieldMeta(nextField)?.label || nextField,
        currentField: nextField,
        progress:     this._progress(wm),
      };
    }

    // ── Build extracted fields for frontend review ────────────────────────────
    const skipped        = new Set((wm.skippedFields || []).map(s => s.field));
    const extractedFields = this.semanticMemory.getAllRequiredFieldKeys().flatMap(requirement => {
      const fieldKeys = this.semanticMemory.getSatisfyingFields(requirement);
      const isGroup   = fieldKeys.length > 1;
      const groupMet  = this.semanticMemory.isRequirementMet(requirement, wm.collectedFields);

      return fieldKeys.map(key => {
        const meta  = this.semanticMemory.getFieldMeta(key);
        const value = wm.collectedFields[key] ?? null;
        const conf  = wm.confidenceMap[key] || 0;
        // In a group (PAN | Aadhaar) an empty alternative is fine once the other is present
        const emptyButCovered = isGroup && value === null && groupMet;
        return {
          key,
          label:            meta.label,
          section:          meta.section,
          aiExtractedValue: value,
          finalValue:       value,
          confidence:       conf,
          isFlagged:        !emptyButCovered && (skipped.has(requirement) || conf < (meta.minConfidence || 0.75)),
          isEdited:         false,
          source:           'verbal',
          ...(isGroup ? { group: requirement } : {}),
        };
      });
    });

    // ── Closing message (spoken by Aria) ──────────────────────────────────────
    const firstName = wm.collectedFields.fullName
      ? String(wm.collectedFields.fullName).trim().split(/\s+/)[0]
      : null;

    const closingMessage = wm.language === 'hi'
      ? `बहुत बढ़िया${firstName ? `, ${firstName} जी` : ''}! आपके सभी विवरण दर्ज कर लिए गए हैं। आपका KYC साक्षात्कार पूरा हो गया है। आप अपना फॉर्म समीक्षा पृष्ठ पर देख सकते हैं। धन्यवाद!`
      : `Excellent${firstName ? `, ${firstName}` : ''}! All your details have been recorded. Your KYC interview is now complete. You can review and confirm your application on the next screen. Thank you!`;

    // ── Save session completion to MongoDB ────────────────────────────────────
    try {
      const now = new Date();
      const turns = [];
      if (lastUserText) turns.push({ role: 'user', text: redactAadhaar(lastUserText), state: 'AGENTIC', timestamp: now });
      turns.push({ role: 'agent', text: closingMessage, state: 'CALL_COMPLETE', timestamp: new Date(now.getTime() + 1) });

      await Session.updateOne({ _id: sessionId }, {
        $push: { transcript: { $each: turns } },
        $set: {
          status:              'completed',
          endTime:             now,
          agentState:          'CALL_COMPLETE',
          extractedAnswers:    extractedFields,
          collectedAnswers:    wm.collectedFields,
          collectedConfidence: wm.confidenceMap,
          skippedFields:       wm.skippedFields || [],
          complianceWarnings:  complianceResult.warnings,
          fraudScore:          wm.fraudScore || 0,
          fraudSignals:        (wm.fraudSignals || []).map(s => ({
            type: s.type, description: s.description, field: s.field,
            severity: ['low', 'medium', 'high'].includes(s.severity) ? s.severity : 'medium',
          })),
        },
      });
    } catch (err) {
      this.log('error', 'Failed to update session status', { sessionId, error: err.message });
    }

    // ── Save final trace ──────────────────────────────────────────────────────
    this.decisionMemory.saveTrace(sessionId, {
      turn:          wm.turnCount,
      agentsInvoked: ['ComplianceAgent'],
      activeGoal:    'compliance_check',
      nextGoal:      'final_decision',
      workingMemorySnapshot: {
        collectedCount: Object.keys(wm.collectedFields).length,
        missingCount:   0,
        skipped:        (wm.skippedFields || []).map(s => s.field),
        fraudScore:     wm.fraudScore,
        turnCount:      wm.turnCount,
      },
    }).catch(() => {});

    // Emit call:complete to frontend (user reviews extracted data on review page)
    io.to(sessionId).emit('call:complete', { sessionId, extractedFields });

    this.log('info', '✅ Call complete — user goes to review page', {
      sessionId, fields: extractedFields.length, skipped: (wm.skippedFields || []).length, fraud: wm.fraudScore,
    });

    // ── Generate interview summary async (non-blocking) ───────────────────────
    this._generateSummaryAsync(sessionId, session, wm).catch(err =>
      this.log('error', 'Interview summary generation failed', { sessionId, error: err.message })
    );

    return {
      question:     closingMessage,
      state:        'CALL_COMPLETE',
      stateLabel:   'Complete',
      isComplete:   true,
      currentField: null,
      progress:     this._progress(wm),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Generate interview summary async (fires after call:complete)
  // ════════════════════════════════════════════════════════════════════════════
  async _generateSummaryAsync(sessionId, session, wm) {
    const sessionDoc = await Session.findById(sessionId).select('transcript startTime geoData').lean();

    const turns = (sessionDoc?.transcript || []).map(t => ({
      role:      t.role,
      text:      t.text,
      timestamp: t.timestamp,
    }));

    const durationSeconds = sessionDoc?.startTime
      ? Math.round((Date.now() - new Date(sessionDoc.startTime).getTime()) / 1000)
      : 0;

    // Use real turn count from transcript if wm.turnCount is 0
    const turnCount = wm.turnCount > 0 ? wm.turnCount : turns.length;

    const summary = await generateInterviewSummary({
      transcript:      turns,
      collectedFields: wm.collectedFields,
      confidenceMap:   wm.confidenceMap || {},
      fraudSignals:    wm.fraudSignals  || [],
      fraudScore:      wm.fraudScore    || 0,
      geoData:         sessionDoc?.geoData || session.geoData || {},
      turnCount,
      durationSeconds,
      language:        wm.language || 'en',
    });

    await Session.findByIdAndUpdate(sessionId, { interviewSummary: summary });
    this.log('info', '📋 Interview summary saved', {
      sessionId,
      tone:   summary.overallTone,
      turns:  turnCount,
      duration: `${Math.round(durationSeconds / 60)}m`,
    });
  }
}
