'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ── Mock injection (MUST happen before importing tool-executor) ──

const mockStore = require('./mock-store');
const storePath = require.resolve('../src/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: mockStore };

const configPath = require.resolve('../config');
require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: {
        adminUserId: '888888888', maxToolRounds: 10,
        gemini: { apiKey: 'fake-gemini-key', models: ['gemini-2.0-flash'] },
        groq: { apiKey: '', models: ['llama-3.3-70b-versatile'] },
        maxConversationHistory: 15
    }
};

// Mock @google/generative-ai (needed by ai.js at import time)
const gaiPath = require.resolve('@google/generative-ai');
const originalGai = require('@google/generative-ai');
require.cache[gaiPath] = {
    id: gaiPath, filename: gaiPath, loaded: true,
    exports: { ...originalGai, GoogleGenerativeAI: class { getGenerativeModel() { return {}; } } }
};

// Now import (gets mocked store + config)
const { executeTool, getUserTier, TOOL_TIERS, _resetRateLimits } = require('../src/tool-executor');
const { selectToolsForMessage, detectToolChoice } = require('../src/ai');
const { createMockEnvironment, createMessage } = require('./mock-discord');

// ── Helpers ──

let env;
function resetEnv() {
    env = createMockEnvironment();
    mockStore.clear();
    _resetRateLimits();
}

function msg(member) { return createMessage(env, member || env.members.admin); }

// ═══════════════════════════════════════════════════════════════
// Permission System
// ═══════════════════════════════════════════════════════════════

describe('Permission System', () => {
    beforeEach(resetEnv);

    test('Owner gets tier 3 (admin)', () => {
        assert.strictEqual(getUserTier(env.members.owner, env.guild.id), 3);
    });

    test('Discord Administrator gets tier 3', () => {
        assert.strictEqual(getUserTier(env.members.admin, env.guild.id), 3);
    });

    test('Global adminUserId gets tier 3', () => {
        // admin member ID matches config.adminUserId = '888888888'
        assert.strictEqual(getUserTier(env.members.admin, env.guild.id), 3);
    });

    test('botAdmins config gets tier 3', () => {
        mockStore.write(`guild-${env.guild.id}.json`, { botAdmins: ['600000000'] });
        assert.strictEqual(getUserTier(env.members.user, env.guild.id), 3);
    });

    test('KickMembers perm gets tier 2', () => {
        assert.strictEqual(getUserTier(env.members.mod, env.guild.id), 2);
    });

    test('botMods config gets tier 2', () => {
        mockStore.write(`guild-${env.guild.id}.json`, { botMods: ['600000000'] });
        assert.strictEqual(getUserTier(env.members.user, env.guild.id), 2);
    });

    test('Regular user gets tier 1', () => {
        assert.strictEqual(getUserTier(env.members.user, env.guild.id), 1);
    });

    test('Tier 1 blocked from tier 2 tool', async () => {
        const result = await executeTool('createChannel', { name: 'test', type: 'text' }, msg(env.members.user));
        assert(result.error);
        assert(result.error.includes('Insufficient'));
    });

    test('Tier 1 blocked from tier 3 tool', async () => {
        const result = await executeTool('kickMember', { user: 'Owner' }, msg(env.members.user));
        assert(result.error);
        assert(result.error.includes('Insufficient'));
    });

    test('Tier 2 blocked from tier 3 tool', async () => {
        const result = await executeTool('deleteChannel', { channel: 'general' }, msg(env.members.mod));
        assert(result.error);
        assert(result.error.includes('Insufficient'));
    });
});

// ═══════════════════════════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════════════════════════

describe('Error Handling', () => {
    beforeEach(resetEnv);

    test('Unknown tool returns error', async () => {
        const result = await executeTool('nonExistentTool', {}, msg());
        assert(result.error);
        assert(result.error.includes('Unknown tool'));
    });

    test('No guild context returns error', async () => {
        const result = await executeTool('createChannel', { name: 'test' }, { guild: null });
        assert(result.error);
        assert(result.error.includes('server context'));
    });
});

// ═══════════════════════════════════════════════════════════════
// Channel Management (14 tools)
// ═══════════════════════════════════════════════════════════════

describe('Channel Management', () => {
    beforeEach(resetEnv);

    test('createChannel — text', async () => {
        const result = await executeTool('createChannel', { name: 'new-channel', type: 'text' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'new-channel');
        assert(result.channelId);
    });

    test('createChannel — voice', async () => {
        const result = await executeTool('createChannel', { name: 'new-voice', type: 'voice' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('createChannel — category', async () => {
        const result = await executeTool('createChannel', { name: 'New Category', type: 'category' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('createChannel — forum', async () => {
        const result = await executeTool('createChannel', { name: 'feedback', type: 'forum' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('createChannel — with parent category', async () => {
        const result = await executeTool('createChannel', { name: 'sub-channel', type: 'text', category: 'Text Channels' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('deleteChannel — success', async () => {
        const result = await executeTool('deleteChannel', { channel: 'announcements' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.deleted, 'announcements');
    });

    test('deleteChannel — not found', async () => {
        const result = await executeTool('deleteChannel', { channel: 'nonexistent' }, msg());
        assert(result.error);
        assert(result.error.includes('not found'));
    });

    test('renameChannel — success', async () => {
        const result = await executeTool('renameChannel', { channel: 'general', newName: 'main-chat' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.oldName, 'general');
        assert.strictEqual(result.newName, 'main-chat');
    });

    test('setChannelTopic — success', async () => {
        const result = await executeTool('setChannelTopic', { channel: 'general', topic: 'Welcome to the server' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('createThread — success', async () => {
        const result = await executeTool('createThread', { channel: 'general', name: 'Discussion' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'Discussion');
    });

    test('deleteThread — success', async () => {
        // Create a thread first
        await executeTool('createThread', { channel: 'general', name: 'temp-thread' }, msg());
        const thread = env.guild.channels.cache.find(c => c.name === 'temp-thread');
        assert(thread, 'Thread should exist');
        const result = await executeTool('deleteThread', { thread: 'temp-thread' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setSlowmode — success', async () => {
        const result = await executeTool('setSlowmode', { channel: 'general', seconds: '10' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.seconds, 10);
    });

    test('lockChannel — success', async () => {
        const result = await executeTool('lockChannel', { channel: 'general' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.locked, 'general');
    });

    test('unlockChannel — success', async () => {
        const result = await executeTool('unlockChannel', { channel: 'general' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.unlocked, 'general');
    });

    test('moveChannel — success', async () => {
        const result = await executeTool('moveChannel', { channel: 'general', category: 'Text Channels' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('cloneChannel — success', async () => {
        const result = await executeTool('cloneChannel', { channel: 'general' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.original, 'general');
    });

    test('setChannelNSFW — success', async () => {
        const result = await executeTool('setChannelNSFW', { channel: 'general', nsfw: true }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setVoiceUserLimit — success', async () => {
        const result = await executeTool('setVoiceUserLimit', { channel: 'voice-chat', limit: '10' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.userLimit, 10);
    });

    test('setVoiceUserLimit — non-voice channel', async () => {
        const result = await executeTool('setVoiceUserLimit', { channel: 'general', limit: '10' }, msg());
        assert(result.error);
        assert(result.error.includes('not a voice channel'));
    });

    test('listChannels — returns channels', async () => {
        const result = await executeTool('listChannels', {}, msg());
        assert(result.channels);
        assert(result.channels.length >= 4);
    });
});

// ═══════════════════════════════════════════════════════════════
// Permission Overwrites (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Permission Overwrites', () => {
    beforeEach(resetEnv);

    test('setChannelPermission — with role', async () => {
        const result = await executeTool('setChannelPermission', {
            channel: 'general', target: 'Member', allow: 'SendMessages', deny: 'ManageMessages'
        }, msg());
        assert.strictEqual(result.success, true);
    });

    test('removeChannelPermission — success', async () => {
        const result = await executeTool('removeChannelPermission', { channel: 'general', target: 'Member' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('listChannelPermissions — returns list', async () => {
        const result = await executeTool('listChannelPermissions', { channel: 'general' }, msg());
        assert(result.permissions !== undefined);
    });
});

// ═══════════════════════════════════════════════════════════════
// Emoji Management (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Emoji Management', () => {
    beforeEach(resetEnv);

    test('addEmoji — success', async () => {
        const result = await executeTool('addEmoji', { name: 'test_emoji', url: 'https://example.com/emoji.png' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.emoji, 'test_emoji');
    });

    test('removeEmoji — success', async () => {
        await executeTool('addEmoji', { name: 'to_remove', url: 'https://example.com/emoji.png' }, msg());
        const result = await executeTool('removeEmoji', { name: 'to_remove' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('removeEmoji — not found', async () => {
        const result = await executeTool('removeEmoji', { name: 'nonexistent' }, msg());
        assert(result.error);
    });

    test('listEmojis — returns emojis', async () => {
        await executeTool('addEmoji', { name: 'smile', url: 'https://example.com/smile.png' }, msg());
        const result = await executeTool('listEmojis', {}, msg());
        assert.strictEqual(result.count, 1);
        assert.strictEqual(result.emojis[0].name, 'smile');
    });
});

// ═══════════════════════════════════════════════════════════════
// Role Management (6 tools)
// ═══════════════════════════════════════════════════════════════

describe('Role Management', () => {
    beforeEach(resetEnv);

    test('createRole — success', async () => {
        const result = await executeTool('createRole', { name: 'NewRole' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'NewRole');
    });

    test('deleteRole — success', async () => {
        const result = await executeTool('deleteRole', { role: 'Member' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.deleted, 'Member');
    });

    test('deleteRole — not found', async () => {
        const result = await executeTool('deleteRole', { role: 'NoSuchRole' }, msg());
        assert(result.error);
    });

    test('assignRole — success', async () => {
        const result = await executeTool('assignRole', { user: 'RegularUser', role: 'Member' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('removeRole — success', async () => {
        const result = await executeTool('removeRole', { user: 'RegularUser', role: 'Member' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('editRole — success', async () => {
        const result = await executeTool('editRole', { role: 'Member', newName: 'Citizen' }, msg());
        assert.strictEqual(result.success, true);
        assert(result.updated.includes('name'));
    });

    test('listRoles — returns roles', async () => {
        const result = await executeTool('listRoles', {}, msg());
        assert(result.roles);
        assert(result.roles.length >= 3); // Admin, Mod, Member (excluding @everyone)
    });
});

// ═══════════════════════════════════════════════════════════════
// Member Moderation (7 tools)
// ═══════════════════════════════════════════════════════════════

describe('Member Moderation', () => {
    beforeEach(resetEnv);

    test('kickMember — success', async () => {
        const result = await executeTool('kickMember', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.kicked, 'RegularUser');
    });

    test('kickMember — not found', async () => {
        const result = await executeTool('kickMember', { user: 'GhostUser' }, msg());
        assert(result.error);
        assert(result.error.includes('not found'));
    });

    test('banMember — success', async () => {
        const result = await executeTool('banMember', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.banned, 'RegularUser');
    });

    test('timeoutMember — 5m', async () => {
        const result = await executeTool('timeoutMember', { user: 'RegularUser', duration: '5m' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.duration, '5m');
    });

    test('timeoutMember — invalid duration', async () => {
        const result = await executeTool('timeoutMember', { user: 'RegularUser', duration: 'abc' }, msg());
        assert(result.error);
        assert(result.error.includes('Invalid duration'));
    });

    test('untimeoutMember — success', async () => {
        const result = await executeTool('untimeoutMember', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.timeout, 'removed');
    });

    test('unbanMember — success', async () => {
        // Add a ban first
        env.guild._bans.set('600000000', { user: { id: '600000000', username: 'RegularUser' }, reason: 'Test ban' });
        const result = await executeTool('unbanMember', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('unbanMember — not banned', async () => {
        const result = await executeTool('unbanMember', { user: 'NobodyBanned' }, msg());
        assert(result.error);
        assert(result.error.includes('not found'));
    });

    test('setNickname — set', async () => {
        const result = await executeTool('setNickname', { user: 'RegularUser', nickname: 'CoolName' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setNickname — clear', async () => {
        const result = await executeTool('setNickname', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.nickname, '(cleared)');
    });

    test('listBans — returns bans', async () => {
        env.guild._bans.set('111', { user: { id: '111', username: 'Banned1' }, reason: 'spam' });
        const result = await executeTool('listBans', {}, msg());
        assert.strictEqual(result.count, 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Message Management (7 tools)
// ═══════════════════════════════════════════════════════════════

describe('Message Management', () => {
    beforeEach(resetEnv);

    test('sendMessage — success', async () => {
        const result = await executeTool('sendMessage', { channel: 'general', content: 'Hello' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.sent, true);
    });

    test('sendMessage — channel not found', async () => {
        const result = await executeTool('sendMessage', { channel: 'nonexistent', content: 'Hello' }, msg());
        assert(result.error);
    });

    test('sendMessage — non-text channel', async () => {
        const result = await executeTool('sendMessage', { channel: 'voice-chat', content: 'Hello' }, msg());
        assert(result.error);
        assert(result.error.includes('not a text channel'));
    });

    test('purgeMessages — success', async () => {
        const result = await executeTool('purgeMessages', { count: '5' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('pinMessage — success', async () => {
        const result = await executeTool('pinMessage', { messageId: 'msg-001' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('unpinMessage — success', async () => {
        const result = await executeTool('unpinMessage', { messageId: 'msg-001' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('readMessages — default channel', async () => {
        const result = await executeTool('readMessages', {}, msg());
        assert(result.messages);
        assert(result.messages.length >= 1);
    });

    test('readMessages — specific channel', async () => {
        const result = await executeTool('readMessages', { channel: 'general', count: '2' }, msg());
        assert(result.channel);
        assert(result.messages);
    });

    test('fetchMessage — success', async () => {
        const result = await executeTool('fetchMessage', { messageId: 'msg-001' }, msg());
        assert.strictEqual(result.id, 'msg-001');
        assert.strictEqual(result.author, 'Owner');
    });

    test('fetchMessage — not found', async () => {
        const result = await executeTool('fetchMessage', { messageId: 'nonexistent' }, msg());
        assert(result.error);
    });

    test('editMessage — success (bot message)', async () => {
        const result = await executeTool('editMessage', {
            channel: 'general', messageId: 'msg-002', content: 'Updated content'
        }, msg());
        assert.strictEqual(result.success, true);
    });

    test('editMessage — not bot message', async () => {
        const result = await executeTool('editMessage', {
            channel: 'general', messageId: 'msg-001', content: 'Hijack attempt'
        }, msg());
        assert(result.error);
        assert(result.error.includes('only edit messages sent by me'));
    });
});

// ═══════════════════════════════════════════════════════════════
// Rich Messages (5 tools)
// ═══════════════════════════════════════════════════════════════

describe('Rich Messages', () => {
    beforeEach(resetEnv);

    test('sendEmbed — full embed', async () => {
        const result = await executeTool('sendEmbed', {
            channel: 'general', title: 'Test', description: 'A test embed',
            color: '#ff0000', footer: 'Footer text'
        }, msg());
        assert.strictEqual(result.success, true);
    });

    test('sendEmbed — minimal', async () => {
        const result = await executeTool('sendEmbed', { channel: 'general', title: 'Just a title' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('replyToMessage — success', async () => {
        const result = await executeTool('replyToMessage', {
            channel: 'general', messageId: 'msg-001', content: 'Reply here'
        }, msg());
        assert.strictEqual(result.success, true);
    });

    test('addReaction — unicode emoji', async () => {
        const result = await executeTool('addReaction', { messageId: 'msg-001', emoji: '🔥' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('createPoll — success', async () => {
        const result = await executeTool('createPoll', {
            question: 'Best language?', options: 'JavaScript,Python,Rust'
        }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.options.length, 3);
    });

    test('createPoll — too few options', async () => {
        const result = await executeTool('createPoll', {
            question: 'Only one?', options: 'JavaScript'
        }, msg());
        assert(result.error);
        assert(result.error.includes('at least 2'));
    });

    test('dmUser — success', async () => {
        const result = await executeTool('dmUser', { user: 'RegularUser', content: 'Hello from Ultron' }, msg());
        assert.strictEqual(result.success, true);
    });
});

// ═══════════════════════════════════════════════════════════════
// Guild Settings (9 tools)
// ═══════════════════════════════════════════════════════════════

describe('Guild Settings', () => {
    beforeEach(resetEnv);

    test('updateServerName — success', async () => {
        const result = await executeTool('updateServerName', { name: 'New Name' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'New Name');
    });

    test('updateServerIcon — success', async () => {
        const result = await executeTool('updateServerIcon', { url: 'https://example.com/icon.png' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setVerificationLevel — success', async () => {
        const result = await executeTool('setVerificationLevel', { level: 'high' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setVerificationLevel — invalid', async () => {
        const result = await executeTool('setVerificationLevel', { level: 'extreme' }, msg());
        assert(result.error);
    });

    test('setSystemChannel — success', async () => {
        const result = await executeTool('setSystemChannel', { channel: 'general' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setRulesChannel — success', async () => {
        const result = await executeTool('setRulesChannel', { channel: 'announcements' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setAFKChannel — voice channel', async () => {
        const result = await executeTool('setAFKChannel', { channel: 'voice-chat' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setAFKChannel — non-voice channel', async () => {
        const result = await executeTool('setAFKChannel', { channel: 'general' }, msg());
        assert(result.error);
        assert(result.error.includes('not a voice channel'));
    });

    test('setDefaultNotifications — mentions', async () => {
        const result = await executeTool('setDefaultNotifications', { level: 'mentions' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setServerBanner — success (boost tier 2)', async () => {
        const result = await executeTool('setServerBanner', { url: 'https://example.com/banner.png' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('setServerBanner — low boost tier', async () => {
        env.guild.premiumTier = 1;
        const result = await executeTool('setServerBanner', { url: 'https://example.com/banner.png' }, msg());
        assert(result.error);
        assert(result.error.includes('boost level'));
    });

    test('getServerInfo — returns full info', async () => {
        const result = await executeTool('getServerInfo', {}, msg());
        assert.strictEqual(result.name, 'Test Guild');
        assert.strictEqual(result.memberCount, 100);
        assert(result.channelCount >= 4);
        assert(result.owner);
        assert(result.createdAt);
    });
});

// ═══════════════════════════════════════════════════════════════
// Invites (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Invites', () => {
    beforeEach(resetEnv);

    test('createInvite — success', async () => {
        const result = await executeTool('createInvite', {}, msg());
        assert.strictEqual(result.success, true);
        assert(result.url);
        assert(result.code);
    });

    test('deleteInvite — success', async () => {
        env.guild._invites.set('ABC123', {
            code: 'ABC123', url: 'https://discord.gg/ABC123', uses: 0, maxUses: 10,
            inviter: { username: 'Owner' }, channel: { name: 'general' },
            async delete() { env.guild._invites.delete('ABC123'); }
        });
        const result = await executeTool('deleteInvite', { code: 'ABC123' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('deleteInvite — not found', async () => {
        const result = await executeTool('deleteInvite', { code: 'NOPE' }, msg());
        assert(result.error);
    });

    test('listInvites — returns invites', async () => {
        env.guild._invites.set('XYZ', {
            code: 'XYZ', url: 'https://discord.gg/XYZ', uses: 5, maxUses: 0,
            inviter: { username: 'Admin' }, channel: { name: 'general' }
        });
        const result = await executeTool('listInvites', {}, msg());
        assert.strictEqual(result.invites.length, 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Audit Log (1 tool)
// ═══════════════════════════════════════════════════════════════

describe('Audit Log', () => {
    beforeEach(resetEnv);

    test('getAuditLog — returns entries', async () => {
        const result = await executeTool('getAuditLog', { limit: '5' }, msg());
        assert(result.entries !== undefined);
    });
});

// ═══════════════════════════════════════════════════════════════
// Auto-Moderation (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Auto-Moderation', () => {
    beforeEach(resetEnv);

    test('createAutomodRule — keyword', async () => {
        const result = await executeTool('createAutomodRule', {
            name: 'No Spam', triggerType: 'keyword', keywords: 'spam,buy now'
        }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'No Spam');
    });

    test('createAutomodRule — invalid type', async () => {
        const result = await executeTool('createAutomodRule', { name: 'Bad', triggerType: 'invalid' }, msg());
        assert(result.error);
    });

    test('deleteAutomodRule — success', async () => {
        const created = await executeTool('createAutomodRule', {
            name: 'TempRule', triggerType: 'spam'
        }, msg());
        const result = await executeTool('deleteAutomodRule', { ruleId: 'TempRule' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('listAutomodRules — returns rules', async () => {
        await executeTool('createAutomodRule', { name: 'Rule1', triggerType: 'spam' }, msg());
        const result = await executeTool('listAutomodRules', {}, msg());
        assert(result.rules.length >= 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Webhooks (4 tools)
// ═══════════════════════════════════════════════════════════════

describe('Webhooks', () => {
    beforeEach(resetEnv);

    test('createWebhook — success', async () => {
        const result = await executeTool('createWebhook', { channel: 'general', name: 'TestHook' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'TestHook');
    });

    test('deleteWebhook — success', async () => {
        env.guild._webhooks.set('wh-1', {
            id: 'wh-1', name: 'OldHook', channel: { name: 'general' }, owner: { username: 'Admin' },
            async delete() { env.guild._webhooks.delete('wh-1'); },
            async send() {}
        });
        const result = await executeTool('deleteWebhook', { webhookId: 'wh-1' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('sendWebhookMessage — success', async () => {
        env.guild._webhooks.set('wh-2', {
            id: 'wh-2', name: 'MsgHook', channel: { name: 'general' }, owner: { username: 'Admin' },
            async delete() {}, async send() {}
        });
        const result = await executeTool('sendWebhookMessage', { webhookId: 'wh-2', content: 'Hello via webhook' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.sent, true);
    });

    test('listWebhooks — returns webhooks', async () => {
        env.guild._webhooks.set('wh-3', {
            id: 'wh-3', name: 'ListedHook', channel: { name: 'general' }, owner: { username: 'Admin' }
        });
        const result = await executeTool('listWebhooks', {}, msg());
        assert.strictEqual(result.webhooks.length, 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Scheduled Events (4 tools)
// ═══════════════════════════════════════════════════════════════

describe('Scheduled Events', () => {
    beforeEach(resetEnv);

    test('createScheduledEvent — external', async () => {
        const result = await executeTool('createScheduledEvent', {
            name: 'Game Night', startTime: '2025-12-01T20:00:00Z', location: 'Voice Chat'
        }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'Game Night');
    });

    test('createScheduledEvent — invalid time', async () => {
        const result = await executeTool('createScheduledEvent', { name: 'Bad', startTime: 'not-a-date' }, msg());
        assert(result.error);
        assert(result.error.includes('Invalid'));
    });

    test('editScheduledEvent — success', async () => {
        await executeTool('createScheduledEvent', { name: 'EditMe', startTime: '2025-12-01T20:00:00Z' }, msg());
        const result = await executeTool('editScheduledEvent', { name: 'EditMe', newName: 'Edited Event' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('deleteScheduledEvent — success', async () => {
        await executeTool('createScheduledEvent', { name: 'DeleteMe', startTime: '2025-12-01T20:00:00Z' }, msg());
        const result = await executeTool('deleteScheduledEvent', { name: 'DeleteMe' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('listScheduledEvents — returns events', async () => {
        await executeTool('createScheduledEvent', { name: 'Listed Event', startTime: '2025-12-01T20:00:00Z' }, msg());
        const result = await executeTool('listScheduledEvents', {}, msg());
        assert(result.events.length >= 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Documents (5 tools)
// ═══════════════════════════════════════════════════════════════

describe('Documents', () => {
    beforeEach(resetEnv);

    test('createDocument — success', async () => {
        const result = await executeTool('createDocument', { name: 'rules', content: 'Be nice' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.name, 'rules');
    });

    test('createDocument — duplicate', async () => {
        await executeTool('createDocument', { name: 'rules', content: 'v1' }, msg());
        const result = await executeTool('createDocument', { name: 'rules', content: 'v2' }, msg());
        assert(result.error);
        assert(result.error.includes('already exists'));
    });

    test('editDocument — success', async () => {
        await executeTool('createDocument', { name: 'faq', content: 'old' }, msg());
        const result = await executeTool('editDocument', { name: 'faq', content: 'new content' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('editDocument — not found', async () => {
        const result = await executeTool('editDocument', { name: 'nonexistent', content: 'x' }, msg());
        assert(result.error);
    });

    test('deleteDocument — success', async () => {
        await executeTool('createDocument', { name: 'temp', content: 'x' }, msg());
        const result = await executeTool('deleteDocument', { name: 'temp' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('getDocument — success', async () => {
        await executeTool('createDocument', { name: 'readme', content: 'Read me!' }, msg());
        const result = await executeTool('getDocument', { name: 'readme' }, msg());
        assert.strictEqual(result.name, 'readme');
        assert.strictEqual(result.content, 'Read me!');
    });

    test('getDocument — not found', async () => {
        const result = await executeTool('getDocument', { name: 'missing' }, msg());
        assert(result.error);
    });

    test('listDocuments — returns docs', async () => {
        await executeTool('createDocument', { name: 'doc1', content: 'a' }, msg());
        await executeTool('createDocument', { name: 'doc2', content: 'bb' }, msg());
        const result = await executeTool('listDocuments', {}, msg());
        assert.strictEqual(result.documents.length, 2);
    });
});

// ═══════════════════════════════════════════════════════════════
// Memory (4 tools)
// ═══════════════════════════════════════════════════════════════

describe('Memory', () => {
    beforeEach(resetEnv);

    test('saveMemory — success', async () => {
        const result = await executeTool('saveMemory', { key: 'color', value: 'red' }, msg());
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.key, 'color');
    });

    test('getMemory — success', async () => {
        await executeTool('saveMemory', { key: 'name', value: 'Ultron' }, msg());
        const result = await executeTool('getMemory', { key: 'name' }, msg());
        assert.strictEqual(result.value, 'Ultron');
    });

    test('getMemory — not found', async () => {
        const result = await executeTool('getMemory', { key: 'missing' }, msg());
        assert(result.error);
    });

    test('listMemories — returns memories', async () => {
        await executeTool('saveMemory', { key: 'a', value: '1' }, msg());
        await executeTool('saveMemory', { key: 'b', value: '2' }, msg());
        const result = await executeTool('listMemories', {}, msg());
        assert.strictEqual(result.memories.length, 2);
    });

    test('deleteMemory — success', async () => {
        await executeTool('saveMemory', { key: 'temp', value: 'x' }, msg());
        const result = await executeTool('deleteMemory', { key: 'temp' }, msg());
        assert.strictEqual(result.success, true);
        const check = await executeTool('getMemory', { key: 'temp' }, msg());
        assert(check.error);
    });
});

// ═══════════════════════════════════════════════════════════════
// Member Info (1 tool)
// ═══════════════════════════════════════════════════════════════

describe('Member Info', () => {
    beforeEach(resetEnv);

    test('getMemberInfo — returns details', async () => {
        const result = await executeTool('getMemberInfo', { user: 'RegularUser' }, msg());
        assert.strictEqual(result.username, 'RegularUser');
        assert.strictEqual(result.isOwner, false);
        assert.strictEqual(result.tier, 'everyone');
    });

    test('getMemberInfo — owner', async () => {
        const result = await executeTool('getMemberInfo', { user: 'Owner' }, msg());
        assert.strictEqual(result.isOwner, true);
        assert.strictEqual(result.tier, 'admin');
    });
});

// ═══════════════════════════════════════════════════════════════
// Reaction Roles (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Reaction Roles', () => {
    beforeEach(resetEnv);

    test('setupReactionRole — success', async () => {
        const result = await executeTool('setupReactionRole', {
            channel: 'general', messageId: 'msg-001', emoji: '👍', role: 'Member'
        }, msg());
        assert.strictEqual(result.success, true);
        // Verify stored in guild config
        const config = mockStore.read(`guild-${env.guild.id}.json`, {});
        assert.strictEqual(config.reactionRoles.length, 1);
    });

    test('removeReactionRole — success', async () => {
        await executeTool('setupReactionRole', {
            channel: 'general', messageId: 'msg-001', emoji: '👍', role: 'Member'
        }, msg());
        const result = await executeTool('removeReactionRole', { messageId: 'msg-001', emoji: '👍' }, msg());
        assert.strictEqual(result.success, true);
    });

    test('listReactionRoles — returns list', async () => {
        await executeTool('setupReactionRole', {
            channel: 'general', messageId: 'msg-001', emoji: '🔥', role: 'Admin'
        }, msg());
        const result = await executeTool('listReactionRoles', {}, msg());
        assert.strictEqual(result.count, 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Welcome/Goodbye/AutoRole (3 tools)
// ═══════════════════════════════════════════════════════════════

describe('Welcome/Goodbye/AutoRole', () => {
    beforeEach(resetEnv);

    test('setWelcomeChannel — success', async () => {
        const result = await executeTool('setWelcomeChannel', {
            channel: 'general', message: 'Welcome {user} to {server}!'
        }, msg());
        assert.strictEqual(result.success, true);
        const config = mockStore.read(`guild-${env.guild.id}.json`, {});
        assert.strictEqual(config.welcomeChannel, '111111111');
    });

    test('setGoodbyeChannel — success', async () => {
        const result = await executeTool('setGoodbyeChannel', {
            channel: 'announcements', message: '{user} has left {server}.'
        }, msg());
        assert.strictEqual(result.success, true);
        const config = mockStore.read(`guild-${env.guild.id}.json`, {});
        assert.strictEqual(config.goodbyeChannel, '222222222');
    });

    test('setAutoRole — add', async () => {
        const result = await executeTool('setAutoRole', { role: 'Member', action: 'add' }, msg());
        assert.strictEqual(result.success, true);
        const config = mockStore.read(`guild-${env.guild.id}.json`, {});
        assert(config.autoRoles.includes('777777777'));
    });

    test('setAutoRole — remove', async () => {
        await executeTool('setAutoRole', { role: 'Member', action: 'add' }, msg());
        const result = await executeTool('setAutoRole', { role: 'Member', action: 'remove' }, msg());
        assert.strictEqual(result.success, true);
        const config = mockStore.read(`guild-${env.guild.id}.json`, {});
        assert(!config.autoRoles.includes('777777777'));
    });
});

// ═══════════════════════════════════════════════════════════════
// Dynamic Tool Selection
// ═══════════════════════════════════════════════════════════════

describe('Dynamic Tool Selection', () => {
    test('includes channel tools for "create a channel"', () => {
        const tools = selectToolsForMessage('create a channel called general', 3);
        const names = tools.map(t => t.name);
        assert(names.includes('createChannel'), 'should include createChannel');
        assert(names.includes('deleteChannel'), 'should include deleteChannel');
    });

    test('includes moderation tools for "kick that user"', () => {
        const tools = selectToolsForMessage('kick that user', 3);
        const names = tools.map(t => t.name);
        assert(names.includes('kickMember'), 'should include kickMember');
        assert(names.includes('banMember'), 'should include banMember');
    });

    test('tier 1 user sees only info tools for query', () => {
        const tools = selectToolsForMessage('what channels are there', 1);
        const names = tools.map(t => t.name);
        // All info tools are tier 1
        assert(names.includes('listChannels'), 'should include listChannels');
        assert(names.includes('getServerInfo'), 'should include getServerInfo');
        // Should NOT include tier 2+ tools
        assert(!names.includes('createChannel'), 'should not include createChannel for tier 1');
        assert(!names.includes('kickMember'), 'should not include kickMember for tier 1');
    });

    test('always includes base tools', () => {
        const tools = selectToolsForMessage('hello ultron', 3);
        const names = tools.map(t => t.name);
        assert(names.includes('getServerInfo'), 'should include getServerInfo');
        assert(names.includes('getMemberInfo'), 'should include getMemberInfo');
        assert(names.includes('readMessages'), 'should include readMessages');
        assert(names.includes('sendMessage'), 'should include sendMessage');
    });

    test('includes document tools for "doc" keyword', () => {
        const tools = selectToolsForMessage('create a document for rules', 3);
        const names = tools.map(t => t.name);
        assert(names.includes('createDocument'), 'should include createDocument');
        assert(names.includes('getDocument'), 'should include getDocument');
    });

    test('includes role tools for "assign role"', () => {
        const tools = selectToolsForMessage('assign role Admin to that user', 3);
        const names = tools.map(t => t.name);
        assert(names.includes('assignRole'), 'should include assignRole');
        assert(names.includes('createRole'), 'should include createRole');
    });

    test('returns fewer tools than total declarations', () => {
        const tools = selectToolsForMessage('create a channel', 3);
        const { toolDeclarations } = require('../src/tools');
        assert(tools.length < toolDeclarations.length, `${tools.length} should be less than ${toolDeclarations.length}`);
    });
});

// ═══════════════════════════════════════════════════════════════
// Tool Choice Detection
// ═══════════════════════════════════════════════════════════════

describe('Tool Choice Detection', () => {
    test('action keyword → required', () => {
        assert.strictEqual(detectToolChoice('create a text channel'), 'required');
    });

    test('action keyword "kick" → required', () => {
        assert.strictEqual(detectToolChoice('kick @user for spam'), 'required');
    });

    test('query keyword → auto', () => {
        assert.strictEqual(detectToolChoice('what roles are in the server'), 'auto');
    });

    test('generic greeting → auto', () => {
        assert.strictEqual(detectToolChoice('hello ultron'), 'auto');
    });

    test('mixed action+query → auto', () => {
        // "what" (query) + "create" (action) → auto since query is present
        assert.strictEqual(detectToolChoice('what happens if I create a channel'), 'auto');
    });

    test('pure action "delete the channel" → required', () => {
        assert.strictEqual(detectToolChoice('delete the channel'), 'required');
    });
});

// ═══════════════════════════════════════════════════════════════
//  VOICE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

describe('Voice Management', () => {
    test('moveToVoice — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        // Put user in a voice channel first
        env.members.user.voice.channel = env.channels.voice;
        const result = await executeTool('moveToVoice', { user: 'RegularUser', channel: 'voice-chat' }, msg);
        assert.strictEqual(result.success, true);
    });

    test('moveToVoice — not in voice', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('moveToVoice', { user: 'RegularUser', channel: 'voice-chat' }, msg);
        assert.ok(result.error.includes('not in a voice channel'));
    });

    test('moveToVoice — not a voice channel', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        env.members.user.voice.channel = env.channels.voice;
        const result = await executeTool('moveToVoice', { user: 'RegularUser', channel: 'general' }, msg);
        assert.ok(result.error.includes('not a voice channel'));
    });

    test('disconnectFromVoice — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        env.members.user.voice.channel = env.channels.voice;
        const result = await executeTool('disconnectFromVoice', { user: 'RegularUser' }, msg);
        assert.strictEqual(result.success, true);
    });

    test('disconnectFromVoice — not in voice', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('disconnectFromVoice', { user: 'RegularUser' }, msg);
        assert.ok(result.error.includes('not in a voice channel'));
    });

    test('voiceMute — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        env.members.user.voice.channel = env.channels.voice;
        const result = await executeTool('voiceMute', { user: 'RegularUser', mute: true }, msg);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.muted, true);
    });

    test('voiceDeafen — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        env.members.user.voice.channel = env.channels.voice;
        const result = await executeTool('voiceDeafen', { user: 'RegularUser', deafen: true }, msg);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.deafened, true);
    });
});

// ═══════════════════════════════════════════════════════════════
//  THREAD MANAGEMENT (archive/unarchive/addMember)
// ═══════════════════════════════════════════════════════════════

describe('Thread Management (Extended)', () => {
    test('archiveThread — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        // Create a thread first
        const thread = await env.channels.general.threads.create({ name: 'test-thread' });
        const result = await executeTool('archiveThread', { thread: 'test-thread' }, msg);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.archived, true);
    });

    test('archiveThread — not found', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('archiveThread', { thread: 'no-such-thread' }, msg);
        assert.ok(result.error.includes('not found'));
    });

    test('unarchiveThread — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const thread = await env.channels.general.threads.create({ name: 'archived-thread' });
        thread._archived = true;
        const result = await executeTool('unarchiveThread', { thread: 'archived-thread' }, msg);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.archived, false);
    });

    test('addThreadMember — success', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const thread = await env.channels.general.threads.create({ name: 'member-thread' });
        const result = await executeTool('addThreadMember', { thread: 'member-thread', user: 'RegularUser' }, msg);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.user, 'RegularUser');
    });

    test('addThreadMember — thread not found', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('addThreadMember', { thread: 'ghost-thread', user: 'RegularUser' }, msg);
        assert.ok(result.error.includes('not found'));
    });
});

// ═══════════════════════════════════════════════════════════════
//  TIMEOUT VALIDATION
// ═══════════════════════════════════════════════════════════════

describe('Timeout Validation', () => {
    test('timeout > 28 days rejected', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('timeoutMember', { user: 'RegularUser', duration: '30d' }, msg);
        assert.ok(result.error.includes('cannot exceed 28 days'));
    });

    test('timeout 28d accepted', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('timeoutMember', { user: 'RegularUser', duration: '28d' }, msg);
        assert.strictEqual(result.success, true);
    });
});

// ═══════════════════════════════════════════════════════════════
//  LIST PAGINATION
// ═══════════════════════════════════════════════════════════════

describe('List Pagination', () => {
    test('listChannels — returns total and showing', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('listChannels', {}, msg);
        assert.ok(result.total !== undefined);
        assert.ok(result.showing !== undefined);
        assert.ok(result.showing <= 50); // default limit
    });

    test('listRoles — returns total and showing', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('listRoles', {}, msg);
        assert.ok(result.total !== undefined);
        assert.ok(result.showing !== undefined);
    });

    test('listChannels — respects limit', async () => {
        const env = createMockEnvironment();
        const msg = createMessage(env, env.members.admin);
        const result = await executeTool('listChannels', { limit: 2 }, msg);
        assert.ok(result.showing <= 2);
    });
});

// ═══════════════════════════════════════════════════════════════
// Forum Channel Tools
// ═══════════════════════════════════════════════════════════════

describe('Forum Channel Tools', () => {
    beforeEach(resetEnv);

    test('createForumPost — success', async () => {
        const result = await executeTool('createForumPost', {
            channel: 'forum-chat', title: 'Test Post', content: 'Post content here'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.channel, 'forum-chat');
    });

    test('createForumPost — not a forum channel', async () => {
        const result = await executeTool('createForumPost', {
            channel: 'general', title: 'Test', content: 'text'
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('not a forum'));
    });

    test('listForumPosts — success', async () => {
        // Create a post first
        await executeTool('createForumPost', {
            channel: 'forum-chat', title: 'Post1', content: 'content'
        }, msg());
        const result = await executeTool('listForumPosts', { channel: 'forum-chat' }, msg());
        assert.ok(result.posts);
        assert.ok(result.total >= 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Stage Channel Tools
// ═══════════════════════════════════════════════════════════════

describe('Stage Channel Tools', () => {
    beforeEach(resetEnv);

    test('createStageInstance — success', async () => {
        const result = await executeTool('createStageInstance', {
            channel: 'stage-talk', topic: 'AMA Session'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.topic, 'AMA Session');
    });

    test('createStageInstance — not a stage channel', async () => {
        const result = await executeTool('createStageInstance', {
            channel: 'general', topic: 'test'
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('not a stage'));
    });

    test('endStageInstance — success', async () => {
        await executeTool('createStageInstance', {
            channel: 'stage-talk', topic: 'AMA Session'
        }, msg());
        const stageChannel = env.guild.channels.cache.get('555555551');
        stageChannel.stageInstance.delete = async () => { stageChannel.stageInstance = null; };
        const result = await executeTool('endStageInstance', { channel: 'stage-talk' }, msg());
        assert.ok(result.success);
    });

    test('endStageInstance — no active stage', async () => {
        const result = await executeTool('endStageInstance', { channel: 'stage-talk' }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('No active stage'));
    });
});

// ═══════════════════════════════════════════════════════════════
// Sticker Management
// ═══════════════════════════════════════════════════════════════

describe('Sticker Management', () => {
    beforeEach(resetEnv);

    test('addSticker — success', async () => {
        const result = await executeTool('addSticker', {
            name: 'cool', url: 'https://example.com/sticker.png', tags: 'thumbsup'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.name, 'cool');
    });

    test('removeSticker — success', async () => {
        await executeTool('addSticker', {
            name: 'cool', url: 'https://example.com/sticker.png', tags: 'thumbsup'
        }, msg());
        const result = await executeTool('removeSticker', { name: 'cool' }, msg());
        assert.ok(result.success);
    });

    test('removeSticker — not found', async () => {
        const result = await executeTool('removeSticker', { name: 'nonexistent' }, msg());
        assert.ok(result.error);
    });

    test('listStickers — returns list', async () => {
        await executeTool('addSticker', {
            name: 'stickerA', url: 'https://example.com/a.png', tags: 'wave'
        }, msg());
        const result = await executeTool('listStickers', {}, msg());
        assert.ok(result.stickers);
        assert.ok(result.total >= 1);
    });
});

// ═══════════════════════════════════════════════════════════════
// Temp Ban
// ═══════════════════════════════════════════════════════════════

describe('Temp Ban', () => {
    beforeEach(resetEnv);

    test('tempBan — success', async () => {
        const result = await executeTool('tempBan', {
            user: 'RegularUser', duration: '1h', reason: 'Testing'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.duration, '1h');
        assert.strictEqual(result.autoUnban, true);
    });

    test('tempBan — invalid duration', async () => {
        const result = await executeTool('tempBan', {
            user: 'RegularUser', duration: 'forever'
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('Invalid duration'));
    });

    test('tempBan — exceeds 30 days', async () => {
        const result = await executeTool('tempBan', {
            user: 'RegularUser', duration: '31d'
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('30 days'));
    });

    test('tempBan — user not found', async () => {
        const result = await executeTool('tempBan', {
            user: 'Ghost', duration: '1h'
        }, msg());
        assert.ok(result.error);
    });
});

// ═══════════════════════════════════════════════════════════════
// Bulk Role Assignment
// ═══════════════════════════════════════════════════════════════

describe('Bulk Role Assignment', () => {
    beforeEach(resetEnv);

    test('bulkAssignRole — success', async () => {
        const result = await executeTool('bulkAssignRole', {
            role: 'Member', users: 'RegularUser, ModUser'
        }, msg());
        assert.ok(result.success);
        assert.ok(result.assigned.length >= 1);
    });

    test('bulkAssignRole — role not found', async () => {
        const result = await executeTool('bulkAssignRole', {
            role: 'NonexistentRole', users: 'RegularUser'
        }, msg());
        assert.ok(result.error);
    });

    test('bulkAssignRole — no users', async () => {
        const result = await executeTool('bulkAssignRole', {
            role: 'Member', users: ''
        }, msg());
        assert.ok(result.error);
    });
});

// ═══════════════════════════════════════════════════════════════
// Voice Configuration
// ═══════════════════════════════════════════════════════════════

describe('Voice Configuration', () => {
    beforeEach(resetEnv);

    test('setVoiceBitrate — success', async () => {
        const result = await executeTool('setVoiceBitrate', {
            channel: 'voice-chat', bitrate: 96000
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.bitrate, 96000);
    });

    test('setVoiceBitrate — not a voice channel', async () => {
        const result = await executeTool('setVoiceBitrate', {
            channel: 'general', bitrate: 96000
        }, msg());
        assert.ok(result.error);
    });

    test('setVoiceBitrate — out of range', async () => {
        const result = await executeTool('setVoiceBitrate', {
            channel: 'voice-chat', bitrate: 999999
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('8000'));
    });

    test('setVoiceRegion — success', async () => {
        const result = await executeTool('setVoiceRegion', {
            channel: 'voice-chat', region: 'us-east'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.region, 'us-east');
    });

    test('setVoiceRegion — automatic', async () => {
        const result = await executeTool('setVoiceRegion', {
            channel: 'voice-chat', region: 'automatic'
        }, msg());
        assert.ok(result.success);
        assert.strictEqual(result.region, 'automatic');
    });
});

// ═══════════════════════════════════════════════════════════════
// Audit Log By Action
// ═══════════════════════════════════════════════════════════════

describe('Audit Log By Action', () => {
    beforeEach(resetEnv);

    test('getAuditLogByAction — returns entries', async () => {
        const result = await executeTool('getAuditLogByAction', {
            actionType: 'MemberBanAdd', limit: 5
        }, msg());
        assert.ok(result.entries);
    });

    test('getAuditLogByAction — unknown action', async () => {
        const result = await executeTool('getAuditLogByAction', {
            actionType: 'FakeAction'
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('Unknown action type'));
    });
});

// ═══════════════════════════════════════════════════════════════
// List Threads
// ═══════════════════════════════════════════════════════════════

describe('List Threads', () => {
    beforeEach(resetEnv);

    test('listThreads — all server threads', async () => {
        const result = await executeTool('listThreads', {}, msg());
        assert.ok(result.threads);
        assert.strictEqual(typeof result.total, 'number');
    });

    test('listThreads — specific channel', async () => {
        const result = await executeTool('listThreads', { channel: 'general' }, msg());
        assert.ok(result.threads);
    });

    test('listThreads — channel not found', async () => {
        const result = await executeTool('listThreads', { channel: 'nonexistent' }, msg());
        assert.ok(result.error);
    });
});

// ═══════════════════════════════════════════════════════════════
// Reliability — Size Limits
// ═══════════════════════════════════════════════════════════════

describe('Size Limits', () => {
    beforeEach(resetEnv);

    test('saveMemory — rejects >4000 chars', async () => {
        const result = await executeTool('saveMemory', {
            key: 'huge', value: 'x'.repeat(4001)
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('4000'));
    });

    test('createDocument — rejects >50000 chars', async () => {
        const result = await executeTool('createDocument', {
            name: 'hugedoc', content: 'x'.repeat(50001)
        }, msg());
        assert.ok(result.error);
        assert.ok(result.error.includes('50000'));
    });
});
