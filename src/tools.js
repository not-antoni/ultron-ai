const { SchemaType } = require('@google/generative-ai');

const toolDeclarations = [
    // ── Channel Management ──

    {
        name: 'createChannel',
        category: 'channel',
        description: 'Create a channel (text/voice/category/forum/announcement)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Channel name' },
                type: { type: SchemaType.STRING, description: 'Channel type', enum: ['text', 'voice', 'category', 'forum', 'announcement'] },
                topic: { type: SchemaType.STRING, description: 'Channel topic (text only)' },
                category: { type: SchemaType.STRING, description: 'Parent category name' }
            },
            required: ['name', 'type']
        }
    },
    {
        name: 'deleteChannel',
        category: 'channel',
        description: 'Delete a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: ['channel']
        }
    },
    {
        name: 'renameChannel',
        category: 'channel',
        description: 'Rename a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Current channel name or ID' },
                newName: { type: SchemaType.STRING, description: 'New name' }
            },
            required: ['channel', 'newName']
        }
    },
    {
        name: 'setChannelTopic',
        category: 'channel',
        description: 'Set a channel topic',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                topic: { type: SchemaType.STRING, description: 'New topic' }
            },
            required: ['channel', 'topic']
        }
    },
    {
        name: 'createThread',
        category: 'channel',
        description: 'Create a thread in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                name: { type: SchemaType.STRING, description: 'Thread name' },
                message: { type: SchemaType.STRING, description: 'Initial message' }
            },
            required: ['channel', 'name']
        }
    },
    {
        name: 'deleteThread',
        category: 'channel',
        description: 'Delete a thread',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                thread: { type: SchemaType.STRING, description: 'Thread name or ID' }
            },
            required: ['thread']
        }
    },
    {
        name: 'archiveThread',
        category: 'channel',
        description: 'Archive a thread',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                thread: { type: SchemaType.STRING, description: 'Thread name or ID' }
            },
            required: ['thread']
        }
    },
    {
        name: 'unarchiveThread',
        category: 'channel',
        description: 'Unarchive a thread',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                thread: { type: SchemaType.STRING, description: 'Thread name or ID' }
            },
            required: ['thread']
        }
    },
    {
        name: 'addThreadMember',
        category: 'channel',
        description: 'Add a member to a thread',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                thread: { type: SchemaType.STRING, description: 'Thread name or ID' },
                user: { type: SchemaType.STRING, description: 'Username or user ID' }
            },
            required: ['thread', 'user']
        }
    },
    {
        name: 'setSlowmode',
        category: 'channel',
        description: 'Set slowmode delay (0 to disable)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                seconds: { type: SchemaType.NUMBER, description: 'Delay in seconds (0=off)' }
            },
            required: ['seconds']
        }
    },
    {
        name: 'lockChannel',
        category: 'channel',
        description: 'Lock a channel (prevent @everyone from sending)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: []
        }
    },
    {
        name: 'unlockChannel',
        category: 'channel',
        description: 'Unlock a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: []
        }
    },

    // ── Permission Overwrites ──

    {
        name: 'setChannelPermission',
        category: 'permission',
        description: 'Set per-role or per-user permission overwrites on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                target: { type: SchemaType.STRING, description: 'Role or user to set perms for' },
                allow: { type: SchemaType.STRING, description: 'Comma-separated perms to allow' },
                deny: { type: SchemaType.STRING, description: 'Comma-separated perms to deny' }
            },
            required: ['channel', 'target']
        }
    },
    {
        name: 'removeChannelPermission',
        category: 'permission',
        description: 'Remove permission overwrites for a role/user on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                target: { type: SchemaType.STRING, description: 'Role or user' }
            },
            required: ['channel', 'target']
        }
    },
    {
        name: 'listChannelPermissions',
        category: 'info',
        description: 'List permission overwrites on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: ['channel']
        }
    },

    // ── Emoji Management ──

    {
        name: 'addEmoji',
        category: 'config',
        description: 'Add a custom emoji from an image URL',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Emoji name' },
                url: { type: SchemaType.STRING, description: 'Image URL' }
            },
            required: ['name', 'url']
        }
    },
    {
        name: 'removeEmoji',
        category: 'config',
        description: 'Remove a custom emoji',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Emoji name' }
            },
            required: ['name']
        }
    },

    // ── Role Management ──

    {
        name: 'createRole',
        category: 'role',
        description: 'Create a new role',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Role name' },
                color: { type: SchemaType.STRING, description: 'Hex color (e.g. #ff0000)' },
                mentionable: { type: SchemaType.BOOLEAN, description: 'Mentionable?' }
            },
            required: ['name']
        }
    },
    {
        name: 'deleteRole',
        category: 'role',
        description: 'Delete a role',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name' }
            },
            required: ['role']
        }
    },
    {
        name: 'assignRole',
        category: 'role',
        description: 'Assign a role to a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                role: { type: SchemaType.STRING, description: 'Role name' }
            },
            required: ['user', 'role']
        }
    },
    {
        name: 'removeRole',
        category: 'role',
        description: 'Remove a role from a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                role: { type: SchemaType.STRING, description: 'Role name' }
            },
            required: ['user', 'role']
        }
    },
    {
        name: 'editRole',
        category: 'role',
        description: 'Edit a role (name, color, mentionable, hoist)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name or ID' },
                newName: { type: SchemaType.STRING, description: 'New name' },
                color: { type: SchemaType.STRING, description: 'New hex color' },
                mentionable: { type: SchemaType.BOOLEAN, description: 'Mentionable?' },
                hoist: { type: SchemaType.BOOLEAN, description: 'Display separately?' }
            },
            required: ['role']
        }
    },

    // ── Member Moderation ──

    {
        name: 'kickMember',
        category: 'moderation',
        description: 'Kick a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                reason: { type: SchemaType.STRING, description: 'Reason' }
            },
            required: ['user']
        }
    },
    {
        name: 'banMember',
        category: 'moderation',
        description: 'Ban a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                reason: { type: SchemaType.STRING, description: 'Reason' }
            },
            required: ['user']
        }
    },
    {
        name: 'timeoutMember',
        category: 'moderation',
        description: 'Timeout (mute) a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                duration: { type: SchemaType.STRING, description: 'Duration (5m, 1h, 1d)' },
                reason: { type: SchemaType.STRING, description: 'Reason' }
            },
            required: ['user', 'duration']
        }
    },
    {
        name: 'untimeoutMember',
        category: 'moderation',
        description: 'Remove a timeout from a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' }
            },
            required: ['user']
        }
    },
    {
        name: 'unbanMember',
        category: 'moderation',
        description: 'Unban a user',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                reason: { type: SchemaType.STRING, description: 'Reason' }
            },
            required: ['user']
        }
    },
    {
        name: 'setNickname',
        category: 'moderation',
        description: 'Set or clear a member nickname',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                nickname: { type: SchemaType.STRING, description: 'New nickname (empty to clear)' }
            },
            required: ['user']
        }
    },

    // ── Voice Management ──

    {
        name: 'moveToVoice',
        category: 'moderation',
        description: 'Move a member to a different voice channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                channel: { type: SchemaType.STRING, description: 'Target voice channel name or ID' }
            },
            required: ['user', 'channel']
        }
    },
    {
        name: 'disconnectFromVoice',
        category: 'moderation',
        description: 'Disconnect a member from voice',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' }
            },
            required: ['user']
        }
    },
    {
        name: 'voiceMute',
        category: 'moderation',
        description: 'Server-mute a member in voice',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                mute: { type: SchemaType.BOOLEAN, description: 'True to mute, false to unmute' }
            },
            required: ['user']
        }
    },
    {
        name: 'voiceDeafen',
        category: 'moderation',
        description: 'Server-deafen a member in voice',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                deafen: { type: SchemaType.BOOLEAN, description: 'True to deafen, false to undeafen' }
            },
            required: ['user']
        }
    },

    // ── Message Management ──

    {
        name: 'sendMessage',
        category: 'message',
        description: 'Send a message to a channel. Use <@USER_ID> for mentions.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                content: { type: SchemaType.STRING, description: 'Message content' }
            },
            required: ['channel', 'content']
        }
    },
    {
        name: 'purgeMessages',
        category: 'message',
        description: 'Bulk delete recent messages (1-100)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                count: { type: SchemaType.NUMBER, description: 'Number to delete (1-100)' }
            },
            required: ['count']
        }
    },
    {
        name: 'pinMessage',
        category: 'message',
        description: 'Pin a message by ID',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID' }
            },
            required: ['messageId']
        }
    },
    {
        name: 'unpinMessage',
        category: 'message',
        description: 'Unpin a message by ID',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID' }
            },
            required: ['messageId']
        }
    },

    // ── Guild Settings ──

    {
        name: 'updateServerName',
        category: 'guild',
        description: 'Change the server name',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'New server name' }
            },
            required: ['name']
        }
    },
    {
        name: 'updateServerIcon',
        category: 'guild',
        description: 'Change the server icon',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'Image URL' }
            },
            required: ['url']
        }
    },
    {
        name: 'setVerificationLevel',
        category: 'guild',
        description: 'Set server verification level',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                level: { type: SchemaType.STRING, description: 'Level', enum: ['none', 'low', 'medium', 'high', 'very_high'] }
            },
            required: ['level']
        }
    },
    {
        name: 'setSystemChannel',
        category: 'guild',
        description: 'Set the system messages channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setRulesChannel',
        category: 'guild',
        description: 'Set the rules channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' }
            },
            required: ['channel']
        }
    },

    // ── Invite Management ──

    {
        name: 'createInvite',
        category: 'config',
        description: 'Create a server invite link',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                maxUses: { type: SchemaType.NUMBER, description: 'Max uses (0=unlimited)' },
                maxAge: { type: SchemaType.NUMBER, description: 'Max age in seconds (0=never)' }
            },
            required: []
        }
    },
    {
        name: 'deleteInvite',
        category: 'config',
        description: 'Revoke an invite by code',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                code: { type: SchemaType.STRING, description: 'Invite code' }
            },
            required: ['code']
        }
    },
    {
        name: 'listInvites',
        category: 'info',
        description: 'List all active server invites',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Audit Log ──

    {
        name: 'getAuditLog',
        category: 'info',
        description: 'View recent audit log entries',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.NUMBER, description: 'Entries to fetch (1-25)' },
                user: { type: SchemaType.STRING, description: 'Filter by user' }
            },
            required: []
        }
    },

    // ── Auto-Moderation Rules ──

    {
        name: 'createAutomodRule',
        category: 'config',
        description: 'Create an auto-moderation rule',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Rule name' },
                triggerType: { type: SchemaType.STRING, description: 'Trigger', enum: ['keyword', 'spam', 'keyword_preset', 'mention_spam'] },
                keywords: { type: SchemaType.STRING, description: 'Comma-separated keywords' },
                regexPatterns: { type: SchemaType.STRING, description: 'Comma-separated regex' },
                actions: { type: SchemaType.STRING, description: 'Action', enum: ['block', 'timeout', 'alert'] },
                alertChannel: { type: SchemaType.STRING, description: 'Alert channel (if action=alert)' }
            },
            required: ['name', 'triggerType']
        }
    },
    {
        name: 'deleteAutomodRule',
        category: 'config',
        description: 'Delete an auto-moderation rule',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ruleId: { type: SchemaType.STRING, description: 'Rule ID or name' }
            },
            required: ['ruleId']
        }
    },
    {
        name: 'listAutomodRules',
        category: 'info',
        description: 'List all auto-moderation rules',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Webhooks ──

    {
        name: 'createWebhook',
        category: 'config',
        description: 'Create a webhook in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                name: { type: SchemaType.STRING, description: 'Webhook name' },
                avatar: { type: SchemaType.STRING, description: 'Avatar URL' }
            },
            required: ['channel', 'name']
        }
    },
    {
        name: 'deleteWebhook',
        category: 'config',
        description: 'Delete a webhook',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                webhookId: { type: SchemaType.STRING, description: 'Webhook ID or name' }
            },
            required: ['webhookId']
        }
    },
    {
        name: 'sendWebhookMessage',
        category: 'config',
        description: 'Send a message through a webhook',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                webhookId: { type: SchemaType.STRING, description: 'Webhook ID or name' },
                content: { type: SchemaType.STRING, description: 'Message content' }
            },
            required: ['webhookId', 'content']
        }
    },
    {
        name: 'listWebhooks',
        category: 'info',
        description: 'List all webhooks',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Scheduled Events ──

    {
        name: 'createScheduledEvent',
        category: 'config',
        description: 'Create a scheduled event',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Event name' },
                startTime: { type: SchemaType.STRING, description: 'Start time (ISO format)' },
                endTime: { type: SchemaType.STRING, description: 'End time (ISO format)' },
                description: { type: SchemaType.STRING, description: 'Description' },
                channel: { type: SchemaType.STRING, description: 'Voice channel (for voice events)' },
                location: { type: SchemaType.STRING, description: 'External location' }
            },
            required: ['name', 'startTime']
        }
    },
    {
        name: 'editScheduledEvent',
        category: 'config',
        description: 'Edit a scheduled event',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Event name or ID' },
                newName: { type: SchemaType.STRING, description: 'New name' },
                description: { type: SchemaType.STRING, description: 'New description' },
                startTime: { type: SchemaType.STRING, description: 'New start time' },
                endTime: { type: SchemaType.STRING, description: 'New end time' }
            },
            required: ['name']
        }
    },
    {
        name: 'deleteScheduledEvent',
        category: 'config',
        description: 'Delete a scheduled event',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Event name or ID' }
            },
            required: ['name']
        }
    },
    {
        name: 'listScheduledEvents',
        category: 'info',
        description: 'List all scheduled events',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Documents ──

    {
        name: 'createDocument',
        category: 'document',
        description: 'Create a named document (rules, guides, FAQs)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name' },
                content: { type: SchemaType.STRING, description: 'Content' }
            },
            required: ['name', 'content']
        }
    },
    {
        name: 'editDocument',
        category: 'document',
        description: 'Replace document content',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name' },
                content: { type: SchemaType.STRING, description: 'New content' }
            },
            required: ['name', 'content']
        }
    },
    {
        name: 'deleteDocument',
        category: 'document',
        description: 'Delete a document',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name' }
            },
            required: ['name']
        }
    },
    {
        name: 'getDocument',
        category: 'document',
        description: 'Read a document by name',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name' }
            },
            required: ['name']
        }
    },
    {
        name: 'listDocuments',
        category: 'info',
        description: 'List all documents',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Memory ──

    {
        name: 'saveMemory',
        category: 'memory',
        description: 'Save a key-value to server memory',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key' },
                value: { type: SchemaType.STRING, description: 'Value to remember' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'getMemory',
        category: 'memory',
        description: 'Recall a stored memory by key',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key' }
            },
            required: ['key']
        }
    },
    {
        name: 'listMemories',
        category: 'info',
        description: 'List all stored memories',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'deleteMemory',
        category: 'memory',
        description: 'Delete a memory by key',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key' }
            },
            required: ['key']
        }
    },

    // ── Info Queries ──

    {
        name: 'getServerInfo',
        category: 'info',
        description: 'Get server info (members, channels, roles, boosts)',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'getMemberInfo',
        category: 'info',
        description: 'Get info about a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' }
            },
            required: ['user']
        }
    },
    {
        name: 'listChannels',
        category: 'info',
        description: 'List channels (default 50, max 100)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.NUMBER, description: 'Max results (1-100, default 50)' }
            },
            required: []
        }
    },
    {
        name: 'listRoles',
        category: 'info',
        description: 'List roles (default 50, max 100)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.NUMBER, description: 'Max results (1-100, default 50)' }
            },
            required: []
        }
    },

    // ── Message Reading ──

    {
        name: 'readMessages',
        category: 'message',
        description: 'Fetch recent messages from a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                count: { type: SchemaType.NUMBER, description: 'Number to fetch (1-25)' }
            },
            required: []
        }
    },
    {
        name: 'fetchMessage',
        category: 'message',
        description: 'Fetch a single message by ID',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID' }
            },
            required: ['messageId']
        }
    },

    // ── Rich Messages ──

    {
        name: 'sendEmbed',
        category: 'message',
        description: 'Send a rich embed message',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                title: { type: SchemaType.STRING, description: 'Embed title' },
                description: { type: SchemaType.STRING, description: 'Embed body' },
                color: { type: SchemaType.STRING, description: 'Hex color' },
                fields: { type: SchemaType.STRING, description: 'JSON array of {name, value}' },
                footer: { type: SchemaType.STRING, description: 'Footer text' },
                image: { type: SchemaType.STRING, description: 'Image URL' },
                thumbnail: { type: SchemaType.STRING, description: 'Thumbnail URL' }
            },
            required: ['channel']
        }
    },
    {
        name: 'replyToMessage',
        category: 'message',
        description: 'Reply to a message by ID',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID' },
                content: { type: SchemaType.STRING, description: 'Reply content' }
            },
            required: ['channel', 'messageId', 'content']
        }
    },
    {
        name: 'editMessage',
        category: 'message',
        description: 'Edit a message sent by the bot',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID' },
                content: { type: SchemaType.STRING, description: 'New content' }
            },
            required: ['channel', 'messageId', 'content']
        }
    },
    {
        name: 'addReaction',
        category: 'message',
        description: 'Add a reaction to a message',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID' },
                emoji: { type: SchemaType.STRING, description: 'Emoji (unicode or custom name)' }
            },
            required: ['messageId', 'emoji']
        }
    },
    {
        name: 'createPoll',
        category: 'message',
        description: 'Create a poll in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                question: { type: SchemaType.STRING, description: 'Poll question' },
                options: { type: SchemaType.STRING, description: 'Comma-separated options' },
                duration: { type: SchemaType.NUMBER, description: 'Duration in hours (1-168)' }
            },
            required: ['question', 'options']
        }
    },

    // ── Direct Messages ──

    {
        name: 'dmUser',
        category: 'message',
        description: 'Send a DM to a member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                content: { type: SchemaType.STRING, description: 'Message content' }
            },
            required: ['user', 'content']
        }
    },

    // ── Additional Channel Management ──

    {
        name: 'moveChannel',
        category: 'channel',
        description: 'Move a channel to a category',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                category: { type: SchemaType.STRING, description: 'Target category' }
            },
            required: ['channel', 'category']
        }
    },
    {
        name: 'cloneChannel',
        category: 'channel',
        description: 'Clone a channel with its permissions',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel to clone' },
                newName: { type: SchemaType.STRING, description: 'Name for clone' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setChannelNSFW',
        category: 'channel',
        description: 'Set/remove NSFW flag on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                nsfw: { type: SchemaType.BOOLEAN, description: 'NSFW?' }
            },
            required: ['channel', 'nsfw']
        }
    },
    {
        name: 'setVoiceUserLimit',
        category: 'channel',
        description: 'Set max users in a voice channel (0=unlimited)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel' },
                limit: { type: SchemaType.NUMBER, description: 'Max users (0=unlimited)' }
            },
            required: ['channel', 'limit']
        }
    },

    // ── Additional Info Queries ──

    {
        name: 'listEmojis',
        category: 'info',
        description: 'List all custom emojis',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'listBans',
        category: 'info',
        description: 'List all banned users',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Reaction Roles ──

    {
        name: 'setupReactionRole',
        category: 'config',
        description: 'Set up a reaction role on a message',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID' },
                emoji: { type: SchemaType.STRING, description: 'Emoji' },
                role: { type: SchemaType.STRING, description: 'Role name or ID' }
            },
            required: ['channel', 'messageId', 'emoji', 'role']
        }
    },
    {
        name: 'removeReactionRole',
        category: 'config',
        description: 'Remove a reaction role',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID' },
                emoji: { type: SchemaType.STRING, description: 'Emoji to remove' }
            },
            required: ['messageId']
        }
    },
    {
        name: 'listReactionRoles',
        category: 'info',
        description: 'List all reaction roles',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Welcome/Goodbye/AutoRole Config ──

    {
        name: 'setWelcomeChannel',
        category: 'config',
        description: 'Set welcome channel and message. Vars: {user} {server} {memberCount}',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                message: { type: SchemaType.STRING, description: 'Welcome message template' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setGoodbyeChannel',
        category: 'config',
        description: 'Set goodbye channel and message. Vars: {user} {server} {memberCount}',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                message: { type: SchemaType.STRING, description: 'Goodbye message template' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setAutoRole',
        category: 'config',
        description: 'Add/remove a role from auto-assign on join',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name or ID' },
                action: { type: SchemaType.STRING, description: 'Add or remove', enum: ['add', 'remove'] }
            },
            required: ['role', 'action']
        }
    },

    // ── Server Settings (extended) ──

    {
        name: 'setAFKChannel',
        category: 'guild',
        description: 'Set AFK voice channel and timeout',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel' },
                timeout: { type: SchemaType.NUMBER, description: 'Timeout in seconds (60-3600)' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setDefaultNotifications',
        category: 'guild',
        description: 'Set default notification level',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                level: { type: SchemaType.STRING, description: 'Level', enum: ['all', 'mentions'] }
            },
            required: ['level']
        }
    },
    {
        name: 'setServerBanner',
        category: 'guild',
        description: 'Set server banner (boost level 2+ required)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'Image URL' }
            },
            required: ['url']
        }
    },

    // ── Forum Channel Tools ──

    {
        name: 'createForumPost',
        category: 'channel',
        description: 'Create a post in a forum channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Forum channel name or ID' },
                title: { type: SchemaType.STRING, description: 'Post title' },
                content: { type: SchemaType.STRING, description: 'Post content' }
            },
            required: ['channel', 'title', 'content']
        }
    },
    {
        name: 'listForumPosts',
        category: 'info',
        description: 'List active posts in a forum channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Forum channel name or ID' },
                limit: { type: SchemaType.NUMBER, description: 'Max posts to list (1-25)' }
            },
            required: ['channel']
        }
    },

    // ── Stage Channel Tools ──

    {
        name: 'createStageInstance',
        category: 'channel',
        description: 'Start a stage instance in a stage channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Stage channel name or ID' },
                topic: { type: SchemaType.STRING, description: 'Stage topic' }
            },
            required: ['channel', 'topic']
        }
    },
    {
        name: 'endStageInstance',
        category: 'channel',
        description: 'End an active stage instance',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Stage channel name or ID' }
            },
            required: ['channel']
        }
    },

    // ── Sticker Management ──

    {
        name: 'addSticker',
        category: 'config',
        description: 'Upload a sticker to the server from a URL',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Sticker name' },
                description: { type: SchemaType.STRING, description: 'Sticker description' },
                url: { type: SchemaType.STRING, description: 'Image URL (PNG or APNG)' },
                tags: { type: SchemaType.STRING, description: 'Related emoji name for search' }
            },
            required: ['name', 'url', 'tags']
        }
    },
    {
        name: 'removeSticker',
        category: 'config',
        description: 'Remove a sticker by name',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Sticker name' }
            },
            required: ['name']
        }
    },
    {
        name: 'listStickers',
        category: 'info',
        description: 'List all server stickers',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {}
        }
    },

    // ── Extended Moderation ──

    {
        name: 'tempBan',
        category: 'moderation',
        description: 'Ban a member for a specified duration then auto-unban',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID' },
                duration: { type: SchemaType.STRING, description: 'Duration (e.g. 1h, 6h, 1d, 7d)' },
                reason: { type: SchemaType.STRING, description: 'Reason for the ban' }
            },
            required: ['user', 'duration']
        }
    },

    // ── Bulk Operations ──

    {
        name: 'bulkAssignRole',
        category: 'role',
        description: 'Assign a role to multiple members at once',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name or ID' },
                users: { type: SchemaType.STRING, description: 'Comma-separated usernames or IDs' }
            },
            required: ['role', 'users']
        }
    },

    // ── Voice Configuration ──

    {
        name: 'setVoiceBitrate',
        category: 'channel',
        description: 'Set bitrate for a voice channel (8000-384000)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel name or ID' },
                bitrate: { type: SchemaType.NUMBER, description: 'Bitrate in bps (8000-384000)' }
            },
            required: ['channel', 'bitrate']
        }
    },
    {
        name: 'setVoiceRegion',
        category: 'channel',
        description: 'Set RTC region for a voice channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel name or ID' },
                region: { type: SchemaType.STRING, description: 'Region (automatic, us-east, us-central, us-south, us-west, europe, brazil, hongkong, india, japan, russia, singapore, southafrica, sydney)' }
            },
            required: ['channel']
        }
    },

    // ── Enhanced Info ──

    {
        name: 'getAuditLogByAction',
        category: 'info',
        description: 'Get audit log entries filtered by action type',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                actionType: { type: SchemaType.STRING, description: 'Action type (e.g. MemberBanAdd, ChannelCreate, RoleUpdate, MessageDelete)' },
                limit: { type: SchemaType.NUMBER, description: 'Entries to fetch (1-25)' }
            },
            required: ['actionType']
        }
    },
    {
        name: 'listThreads',
        category: 'info',
        description: 'List all active threads in the server or a specific channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel to list threads from (optional)' }
            },
            required: []
        }
    },
    {
        name: 'getToolAuditTrail',
        category: 'info',
        description: 'View the audit trail of tool executions in this server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.STRING, description: 'Max entries to return (default 25, max 50)' },
                toolName: { type: SchemaType.STRING, description: 'Filter by tool name (optional)' }
            },
            required: []
        }
    }
];

module.exports = { toolDeclarations };
