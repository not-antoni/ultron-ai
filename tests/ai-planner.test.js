'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

const {
    normalizeThinkingMode,
    estimateRequestedSteps,
    detectThinkingComplexity,
    shouldUseThinkingMode,
    validateExecutionPlan,
    resolveArgsTemplates,
    executePlannedSteps,
    makeExecutionSummary
} = require('../src/ai-planner');

describe('AI Planner Modes', () => {
    test('normalizes thinking mode', () => {
        assert.strictEqual(normalizeThinkingMode('always'), 'always');
        assert.strictEqual(normalizeThinkingMode('off'), 'off');
        assert.strictEqual(normalizeThinkingMode('AUTO'), 'auto');
        assert.strictEqual(normalizeThinkingMode('weird'), 'auto');
    });

    test('detects complex chained requests', () => {
        assert.strictEqual(estimateRequestedSteps('hello there'), 0);
        const complexity = detectThinkingComplexity('create a role then set it green and assign it to @user', 2);
        assert(complexity.complex);
        assert(complexity.estimatedSteps >= 2);
        assert.strictEqual(
            shouldUseThinkingMode({
                mode: 'auto',
                userInput: 'create a role then set it green and assign it to @user',
                toolChoice: 'required',
                availableToolsCount: 5,
                minSteps: 2
            }),
            true
        );
    });
});

describe('AI Planner Validation', () => {
    test('accepts valid dependency plan', () => {
        const plan = {
            goal: 'setup role',
            steps: [
                { id: 'step_1', tool: 'createRole', args: { name: 'Green' } },
                { id: 'step_2', tool: 'assignRole', args: { user: '@user', role: '$step.step_1.name' }, dependsOn: ['step_1'] }
            ]
        };
        const allowedTools = new Set(['createRole', 'assignRole', 'getMemberInfo']);
        const validated = validateExecutionPlan(plan, { allowedTools, maxSteps: 6 });
        assert.strictEqual(validated.ok, true);
        assert.strictEqual(validated.plan.steps.length, 2);
    });

    test('rejects unknown tools and cycles', () => {
        const unknownToolPlan = {
            steps: [{ id: 'a', tool: 'unknownTool', args: {} }]
        };
        const a = validateExecutionPlan(unknownToolPlan, { allowedTools: new Set(['createRole']), maxSteps: 6 });
        assert.strictEqual(a.ok, false);

        const cyclicPlan = {
            steps: [
                { id: 'a', tool: 'createRole', args: {}, dependsOn: ['b'] },
                { id: 'b', tool: 'assignRole', args: {}, dependsOn: ['a'] }
            ]
        };
        const b = validateExecutionPlan(cyclicPlan, { allowedTools: new Set(['createRole', 'assignRole']), maxSteps: 6 });
        assert.strictEqual(b.ok, false);
        assert(/circular/i.test(b.error));
    });
});

describe('AI Planner Execution', () => {
    test('resolves dependency templates across steps', async () => {
        const plan = {
            goal: 'create and assign',
            mode: 'sequential',
            steps: [
                { id: 'step_1', tool: 'createRole', args: { name: 'RaidGreen' }, dependsOn: [], prechecks: [], onFailure: 'stop' },
                { id: 'step_2', tool: 'editRole', args: { role: '$step.step_1.roleId', color: '#00ff00' }, dependsOn: ['step_1'], prechecks: [], onFailure: 'stop' },
                { id: 'step_3', tool: 'assignRole', args: { user: '@user', role: '$step.step_1.name' }, dependsOn: ['step_1'], prechecks: [], onFailure: 'stop' }
            ]
        };

        const calls = [];
        const report = await executePlannedSteps(plan, {
            preflightEnabled: false,
            repeatGuard: 3,
            executeToolCall: async (tool, args) => {
                calls.push({ tool, args });
                if (tool === 'createRole') return { success: true, roleId: 'role-1', name: args.name };
                if (tool === 'editRole') {
                    assert.strictEqual(args.role, 'role-1');
                    return { success: true, updated: ['color'] };
                }
                if (tool === 'assignRole') {
                    assert.strictEqual(args.role, 'RaidGreen');
                    return { success: true, user: '@user' };
                }
                return { error: 'unexpected tool' };
            }
        });

        assert.strictEqual(report.failed.length, 0);
        assert.strictEqual(report.completed.length, 3);
        assert.strictEqual(calls.length, 3);
    });

    test('stops on failure and skips dependent steps', async () => {
        const plan = {
            goal: 'stop on fail',
            mode: 'sequential',
            steps: [
                { id: 'step_1', tool: 'createRole', args: { name: 'x' }, dependsOn: [], prechecks: [], onFailure: 'stop' },
                { id: 'step_2', tool: 'assignRole', args: { user: '@u', role: 'x' }, dependsOn: ['step_1'], prechecks: [], onFailure: 'stop' }
            ]
        };

        const report = await executePlannedSteps(plan, {
            preflightEnabled: false,
            stopOnFailure: true,
            executeToolCall: async () => ({ error: 'create failed' })
        });

        assert.strictEqual(report.completed.length, 0);
        assert.strictEqual(report.failed.length, 1);
        assert.strictEqual(report.skipped.length, 1);
        const summary = makeExecutionSummary(report);
        assert(summary.includes('Stopped at'));
    });

    test('executes explicit prechecks before main step', async () => {
        const plan = {
            goal: 'precheck flow',
            mode: 'sequential',
            steps: [
                {
                    id: 'step_1',
                    tool: 'assignRole',
                    args: { user: '@u', role: 'Green' },
                    dependsOn: [],
                    prechecks: [{ tool: 'getMemberInfo', args: { user: '@u' } }],
                    onFailure: 'stop'
                }
            ]
        };

        const order = [];
        const report = await executePlannedSteps(plan, {
            preflightEnabled: true,
            executeToolCall: async (tool) => {
                order.push(tool);
                if (tool === 'getMemberInfo') return { success: true, user: '@u' };
                return { success: true };
            }
        });

        assert.strictEqual(report.failed.length, 0);
        assert.deepStrictEqual(order, ['getMemberInfo', 'assignRole']);
        assert.strictEqual(report.toolLog[0].phase, 'precheck');
        assert.strictEqual(report.toolLog[1].phase, 'execute');
    });

    test('blocks repeated calls after guard threshold', async () => {
        const plan = {
            goal: 'repeat guard',
            mode: 'sequential',
            steps: [
                { id: 'step_1', tool: 'listRoles', args: {}, dependsOn: [], prechecks: [], onFailure: 'continue' },
                { id: 'step_2', tool: 'listRoles', args: {}, dependsOn: [], prechecks: [], onFailure: 'stop' }
            ]
        };

        const report = await executePlannedSteps(plan, {
            preflightEnabled: false,
            repeatGuard: 1,
            executeToolCall: async () => ({ success: true, roles: [] })
        });

        assert.strictEqual(report.completed.length, 1);
        assert.strictEqual(report.failed.length, 1);
        assert(/Repeated tool call blocked/i.test(report.failed[0].error));
    });
});

describe('AI Planner Template Resolver', () => {
    test('reports missing references', () => {
        const stepResults = new Map([['step_1', { id: 'abc' }]]);
        const { resolved, missingRefs } = resolveArgsTemplates({
            roleId: '$step.step_1.id',
            missing: '$step.step_2.name'
        }, stepResults);
        assert.strictEqual(resolved.roleId, 'abc');
        assert.strictEqual(resolved.missing, undefined);
        assert.deepStrictEqual(missingRefs, ['$step.step_2.name']);
    });
});
