'use strict';

const ACTION_TOKEN_PATTERN = /\b(?:create|make|add|build|delete|remove|destroy|kick|ban|timeout|mute|unmute|purge|send|lock|unlock|set|assign|move|clone|rename|edit|change|update|pin|unpin|setup|configure|save|dm|clear|give|grant|revoke|post|start|stop|end|invite|react|deafen|undeafen|enable|disable)\b/gi;
const CHAIN_TOKEN_PATTERN = /\b(?:and then|then|after|afterwards|next|also|plus|before)\b/gi;
const REFERENCE_PATTERN = /\b(?:it|them|that|those|new role|new channel|that role|that user|this user|same)\b/i;
const CONTINUE_FAILURE = 'continue';
const STOP_FAILURE = 'stop';

function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function stableStringify(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    const parts = keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(',')}}`;
}

function normalizeThinkingMode(value) {
    const raw = String(value || 'auto').trim().toLowerCase();
    if (raw === 'always' || raw === 'off') return raw;
    return 'auto';
}

function estimateRequestedSteps(userInput = '') {
    const input = String(userInput || '');
    const actionMatches = input.match(ACTION_TOKEN_PATTERN) || [];
    const chainMatches = input.match(CHAIN_TOKEN_PATTERN) || [];
    const actionCount = actionMatches.length;
    const chainCount = chainMatches.length;
    if (actionCount === 0 && chainCount === 0) return 0;
    return Math.max(actionCount, chainCount + 1, 1);
}

function detectThinkingComplexity(userInput = '', minSteps = 2) {
    const estimatedSteps = estimateRequestedSteps(userInput);
    const hasCrossStepReferences = REFERENCE_PATTERN.test(String(userInput || ''));
    return {
        estimatedSteps,
        hasCrossStepReferences,
        complex: estimatedSteps >= Math.max(1, Number(minSteps) || 2) || hasCrossStepReferences
    };
}

function shouldUseThinkingMode({
    mode = 'auto',
    userInput = '',
    toolChoice = 'none',
    availableToolsCount = 0,
    minSteps = 2
} = {}) {
    const normalizedMode = normalizeThinkingMode(mode);
    if (toolChoice === 'none') return false;
    if (!Number.isFinite(availableToolsCount) || availableToolsCount <= 0) return false;
    if (normalizedMode === 'off') return false;
    if (normalizedMode === 'always') return true;
    return detectThinkingComplexity(userInput, minSteps).complex;
}

function normalizeFailureMode(value) {
    const raw = String(value || STOP_FAILURE).trim().toLowerCase();
    if (raw === CONTINUE_FAILURE) return CONTINUE_FAILURE;
    return STOP_FAILURE;
}

function normalizePrechecks(raw, stepId, allowedTools, errors) {
    if (raw === undefined || raw === null) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const prechecks = [];
    for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (!isPlainObject(item)) {
            errors.push(`Step "${stepId}" precheck #${i + 1} must be an object.`);
            continue;
        }
        const tool = typeof item.tool === 'string' ? item.tool.trim() : '';
        if (!tool) {
            errors.push(`Step "${stepId}" precheck #${i + 1} is missing a tool name.`);
            continue;
        }
        if (allowedTools && !allowedTools.has(tool)) {
            errors.push(`Step "${stepId}" precheck "${tool}" is not allowed for this request.`);
            continue;
        }
        const args = item.args === undefined ? {} : item.args;
        if (!isPlainObject(args)) {
            errors.push(`Step "${stepId}" precheck "${tool}" args must be an object.`);
            continue;
        }
        prechecks.push({ tool, args });
    }
    return prechecks;
}

function validateExecutionPlan(plan, { allowedTools = null, maxSteps = 6 } = {}) {
    if (!isPlainObject(plan)) {
        return { ok: false, error: 'Execution plan must be a JSON object.' };
    }

    const stepsRaw = plan.steps;
    if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
        return { ok: false, error: 'Execution plan requires a non-empty "steps" array.' };
    }
    if (stepsRaw.length > maxSteps) {
        return { ok: false, error: `Execution plan exceeds max steps (${maxSteps}).` };
    }

    const normalized = [];
    const ids = new Set();
    const errors = [];

    for (let i = 0; i < stepsRaw.length; i += 1) {
        const step = stepsRaw[i];
        if (!isPlainObject(step)) {
            errors.push(`Step #${i + 1} must be an object.`);
            continue;
        }

        const fallbackId = `step_${i + 1}`;
        const id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : fallbackId;
        if (ids.has(id)) {
            errors.push(`Duplicate step id "${id}".`);
            continue;
        }
        ids.add(id);

        const tool = typeof step.tool === 'string' ? step.tool.trim() : '';
        if (!tool) {
            errors.push(`Step "${id}" is missing a valid tool name.`);
            continue;
        }
        if (allowedTools && !allowedTools.has(tool)) {
            errors.push(`Step "${id}" tool "${tool}" is not allowed for this request.`);
            continue;
        }

        const args = step.args === undefined ? {} : step.args;
        if (!isPlainObject(args)) {
            errors.push(`Step "${id}" args must be an object.`);
            continue;
        }

        const dependsOnRaw = step.dependsOn;
        const dependsOn = dependsOnRaw === undefined
            ? []
            : Array.isArray(dependsOnRaw)
                ? dependsOnRaw.map(v => String(v || '').trim()).filter(Boolean)
                : null;
        if (!dependsOn) {
            errors.push(`Step "${id}" dependsOn must be an array of step IDs.`);
            continue;
        }

        const prechecks = normalizePrechecks(step.precheck, id, allowedTools, errors);
        normalized.push({
            id,
            tool,
            args,
            dependsOn,
            prechecks,
            onFailure: normalizeFailureMode(step.onFailure)
        });
    }

    if (errors.length > 0) {
        return { ok: false, error: errors.join(' ') };
    }

    for (const step of normalized) {
        for (const dep of step.dependsOn) {
            if (!ids.has(dep)) {
                return { ok: false, error: `Step "${step.id}" depends on unknown step "${dep}".` };
            }
            if (dep === step.id) {
                return { ok: false, error: `Step "${step.id}" cannot depend on itself.` };
            }
        }
    }

    const graph = new Map(normalized.map(step => [step.id, step.dependsOn]));
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
        if (visited.has(id)) return false;
        if (visiting.has(id)) return true;
        visiting.add(id);
        for (const dep of graph.get(id) || []) {
            if (hasCycle(dep)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    for (const step of normalized) {
        if (hasCycle(step.id)) {
            return { ok: false, error: 'Execution plan contains circular dependencies.' };
        }
    }

    return {
        ok: true,
        plan: {
            goal: typeof plan.goal === 'string' ? plan.goal : '',
            mode: 'sequential',
            steps: normalized
        }
    };
}

function getPathValue(obj, pathSegments) {
    let current = obj;
    for (const part of pathSegments) {
        if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
        current = current[part];
        if (current === undefined) return undefined;
    }
    return current;
}

function resolveTemplateToken(token, stepResults) {
    if (typeof token !== 'string' || !token.startsWith('$step.')) {
        return { resolved: true, value: token };
    }
    const parts = token.split('.');
    if (parts.length < 3) return { resolved: false, value: undefined };
    const stepId = parts[1];
    const path = parts.slice(2);
    const source = stepResults.get(stepId);
    if (source === undefined) return { resolved: false, value: undefined };
    const value = getPathValue(source, path);
    if (value === undefined) return { resolved: false, value: undefined };
    return { resolved: true, value };
}

function resolveTemplates(value, stepResults, missingRefs) {
    if (typeof value === 'string') {
        const resolved = resolveTemplateToken(value, stepResults);
        if (!resolved.resolved) missingRefs.push(value);
        return resolved.value;
    }
    if (Array.isArray(value)) {
        return value.map(item => resolveTemplates(item, stepResults, missingRefs));
    }
    if (isPlainObject(value)) {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            out[key] = resolveTemplates(val, stepResults, missingRefs);
        }
        return out;
    }
    return value;
}

function resolveArgsTemplates(args, stepResults) {
    const missingRefs = [];
    const resolved = resolveTemplates(args || {}, stepResults, missingRefs);
    return { resolved, missingRefs };
}

function isToolFailure(result) {
    return !!(result && typeof result === 'object' && result.error);
}

async function executePlannedSteps(plan, {
    executeToolCall,
    stopOnFailure = true,
    preflightEnabled = true,
    repeatGuard = 2,
    autoPreflightBuilder = null
} = {}) {
    if (typeof executeToolCall !== 'function') {
        throw new Error('executePlannedSteps requires executeToolCall function.');
    }

    const stepStates = new Map();
    const stepResults = new Map();
    const toolLog = [];
    const completed = [];
    const failed = [];
    const skipped = [];
    const repeatedCalls = new Map();
    const guard = Math.max(1, Number(repeatGuard) || 2);
    let halted = false;

    const callTool = async (stepId, phase, tool, args) => {
        const key = `${tool}:${stableStringify(args)}`;
        const seen = (repeatedCalls.get(key) || 0) + 1;
        repeatedCalls.set(key, seen);

        let result;
        if (seen > guard) {
            result = { error: `Repeated tool call blocked after ${guard} duplicate calls in this plan.` };
        } else {
            try {
                result = await executeToolCall(tool, args, { stepId, phase });
            } catch (err) {
                result = { error: err?.message || String(err) };
            }
        }
        toolLog.push({ stepId, phase, tool, args, result });
        return result;
    };

    for (const step of plan.steps) {
        if (halted) {
            stepStates.set(step.id, 'skipped');
            skipped.push({ id: step.id, tool: step.tool, reason: 'execution halted after prior failure' });
            continue;
        }

        const unmetDep = step.dependsOn.find(dep => stepStates.get(dep) !== 'success');
        if (unmetDep) {
            stepStates.set(step.id, 'skipped');
            skipped.push({ id: step.id, tool: step.tool, reason: `dependency "${unmetDep}" not successful` });
            continue;
        }

        const { resolved, missingRefs } = resolveArgsTemplates(step.args, stepResults);
        if (missingRefs.length > 0) {
            const error = `Unresolved step reference(s): ${missingRefs.join(', ')}`;
            stepStates.set(step.id, 'failed');
            const failure = { id: step.id, tool: step.tool, error, phase: 'resolve' };
            failed.push(failure);
            stepResults.set(step.id, { error });
            if (stopOnFailure || step.onFailure === STOP_FAILURE) halted = true;
            continue;
        }

        if (preflightEnabled) {
            const autoChecks = typeof autoPreflightBuilder === 'function'
                ? autoPreflightBuilder(step, resolved) || []
                : [];
            const checks = [...step.prechecks, ...autoChecks];
            for (const check of checks) {
                const checkResolved = resolveArgsTemplates(check.args, stepResults);
                if (checkResolved.missingRefs.length > 0) {
                    const error = `Unresolved precheck reference(s): ${checkResolved.missingRefs.join(', ')}`;
                    stepStates.set(step.id, 'failed');
                    const failure = { id: step.id, tool: step.tool, error, phase: 'precheck' };
                    failed.push(failure);
                    stepResults.set(step.id, { error });
                    if (stopOnFailure || step.onFailure === STOP_FAILURE) halted = true;
                    break;
                }
                const precheckResult = await callTool(step.id, 'precheck', check.tool, checkResolved.resolved);
                if (isToolFailure(precheckResult)) {
                    const error = `Precheck "${check.tool}" failed: ${precheckResult.error}`;
                    stepStates.set(step.id, 'failed');
                    const failure = { id: step.id, tool: step.tool, error, phase: 'precheck', precheckTool: check.tool };
                    failed.push(failure);
                    stepResults.set(step.id, { error });
                    if (stopOnFailure || step.onFailure === STOP_FAILURE) halted = true;
                    break;
                }
            }
            if (stepStates.get(step.id) === 'failed') continue;
        }

        const result = await callTool(step.id, 'execute', step.tool, resolved);
        if (isToolFailure(result)) {
            stepStates.set(step.id, 'failed');
            const failure = { id: step.id, tool: step.tool, error: result.error, phase: 'execute' };
            failed.push(failure);
            stepResults.set(step.id, result);
            if (stopOnFailure || step.onFailure === STOP_FAILURE) halted = true;
            continue;
        }

        stepStates.set(step.id, 'success');
        stepResults.set(step.id, result);
        completed.push({ id: step.id, tool: step.tool, result });
    }

    const firstFailure = failed.length > 0 ? failed[0] : null;
    return {
        totalSteps: plan.steps.length,
        completed,
        failed,
        skipped,
        halted,
        firstFailure,
        stepStates: Object.fromEntries(stepStates.entries()),
        stepResults: Object.fromEntries(stepResults.entries()),
        toolLog
    };
}

function summarizeSteps(list, limit = 3) {
    return list.slice(0, limit).map(step => `${step.id}:${step.tool}`).join(', ');
}

function makeExecutionSummary(report) {
    const completed = report.completed || [];
    const failed = report.failed || [];
    const skipped = report.skipped || [];
    const total = Number(report.totalSteps) || completed.length + failed.length + skipped.length;

    if (failed.length > 0) {
        const first = failed[0];
        let text = `Completed ${completed.length}/${total} step(s). Stopped at "${first.id}" (${first.tool}): ${first.error}.`;
        if (completed.length > 0) text += ` Successful: ${summarizeSteps(completed)}.`;
        if (skipped.length > 0) text += ` Skipped ${skipped.length} dependent step(s): ${summarizeSteps(skipped)}.`;
        return text;
    }

    if (completed.length === 0) {
        return 'No executable steps were completed.';
    }

    let text = `Completed ${completed.length}/${total} step(s) successfully.`;
    text += ` Steps: ${summarizeSteps(completed)}.`;
    if (skipped.length > 0) text += ` Skipped ${skipped.length} step(s): ${summarizeSteps(skipped)}.`;
    return text;
}

module.exports = {
    normalizeThinkingMode,
    estimateRequestedSteps,
    detectThinkingComplexity,
    shouldUseThinkingMode,
    validateExecutionPlan,
    resolveArgsTemplates,
    executePlannedSteps,
    makeExecutionSummary
};
