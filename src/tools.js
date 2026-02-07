const { SchemaType } = require('@google/generative-ai');

const toolDeclarations = [
    // ── Channel Management ──

    {
        name: 'createChannel',
        description: 'Create a new text, voice, or category channel in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Channel name' },
                type: { type: SchemaType.STRING, description: 'Channel type', enum: ['text', 'voice', 'category', 'forum', 'announcement'] },
                topic: { type: SchemaType.STRING, description: 'Channel topic (text channels only)' },
                category: { type: SchemaType.STRING, description: 'Name of the category to place this channel in' }
            },
            required: ['name', 'type']
        }
    },
    {
        name: 'deleteChannel',
        description: 'Delete a channel from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID to delete' }
            },
            required: ['channel']
        }
    },
    {
        name: 'renameChannel',
        description: 'Rename a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Current channel name or ID' },
                newName: { type: SchemaType.STRING, description: 'New channel name' }
            },
            required: ['channel', 'newName']
        }
    },
    {
        name: 'setChannelTopic',
        description: 'Set or change a text channel topic',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                topic: { type: SchemaType.STRING, description: 'New topic text' }
            },
            required: ['channel', 'topic']
        }
    },
    {
        name: 'createThread',
        description: 'Create a thread in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID to create thread in' },
                name: { type: SchemaType.STRING, description: 'Thread name' },
                message: { type: SchemaType.STRING, description: 'Initial message in the thread' }
            },
            required: ['channel', 'name']
        }
    },
    {
        name: 'deleteThread',
        description: 'Delete/archive a thread',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                thread: { type: SchemaType.STRING, description: 'Thread name or ID' }
            },
            required: ['thread']
        }
    },
    {
        name: 'setSlowmode',
        description: 'Set slowmode delay on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' },
                seconds: { type: SchemaType.NUMBER, description: 'Slowmode delay in seconds (0 to disable)' }
            },
            required: ['seconds']
        }
    },
    {
        name: 'lockChannel',
        description: 'Lock a channel so @everyone cannot send messages',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' }
            }
        }
    },
    {
        name: 'unlockChannel',
        description: 'Unlock a channel so @everyone can send messages again',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' }
            }
        }
    },

    // ── Permission Overwrites ──

    {
        name: 'setChannelPermission',
        description: 'Set per-role or per-user permission overwrites on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                target: { type: SchemaType.STRING, description: 'Role name or username to set permissions for' },
                allow: { type: SchemaType.STRING, description: 'Comma-separated permissions to allow (e.g. "SendMessages,ViewChannel")' },
                deny: { type: SchemaType.STRING, description: 'Comma-separated permissions to deny (e.g. "SendMessages,AttachFiles")' }
            },
            required: ['channel', 'target']
        }
    },
    {
        name: 'removeChannelPermission',
        description: 'Remove all permission overwrites for a role or user on a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                target: { type: SchemaType.STRING, description: 'Role name or username to remove overwrites for' }
            },
            required: ['channel', 'target']
        }
    },
    {
        name: 'listChannelPermissions',
        description: 'List all permission overwrites on a channel',
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
        description: 'Add a custom emoji to the server from an image URL',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Emoji name (alphanumeric and underscores)' },
                url: { type: SchemaType.STRING, description: 'Image URL for the emoji' }
            },
            required: ['name', 'url']
        }
    },
    {
        name: 'removeEmoji',
        description: 'Remove a custom emoji from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Emoji name to remove' }
            },
            required: ['name']
        }
    },

    // ── Role Management ──

    {
        name: 'createRole',
        description: 'Create a new role in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Role name' },
                color: { type: SchemaType.STRING, description: 'Hex color code (e.g. #ff0000)' },
                mentionable: { type: SchemaType.BOOLEAN, description: 'Whether the role is mentionable' }
            },
            required: ['name']
        }
    },
    {
        name: 'deleteRole',
        description: 'Delete a role from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name to delete' }
            },
            required: ['role']
        }
    },
    {
        name: 'assignRole',
        description: 'Assign a role to a server member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                role: { type: SchemaType.STRING, description: 'Role name to assign' }
            },
            required: ['user', 'role']
        }
    },
    {
        name: 'removeRole',
        description: 'Remove a role from a server member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                role: { type: SchemaType.STRING, description: 'Role name to remove' }
            },
            required: ['user', 'role']
        }
    },

    {
        name: 'editRole',
        description: 'Edit an existing role (change name, color, mentionable, hoist)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Current role name or ID' },
                newName: { type: SchemaType.STRING, description: 'New role name' },
                color: { type: SchemaType.STRING, description: 'New hex color code (e.g. #ff0000)' },
                mentionable: { type: SchemaType.BOOLEAN, description: 'Whether the role should be mentionable' },
                hoist: { type: SchemaType.BOOLEAN, description: 'Whether the role should be displayed separately' }
            },
            required: ['role']
        }
    },

    // ── Member Moderation ──

    {
        name: 'kickMember',
        description: 'Kick a member from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                reason: { type: SchemaType.STRING, description: 'Reason for kicking' }
            },
            required: ['user']
        }
    },
    {
        name: 'banMember',
        description: 'Ban a member from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                reason: { type: SchemaType.STRING, description: 'Reason for banning' }
            },
            required: ['user']
        }
    },
    {
        name: 'timeoutMember',
        description: 'Timeout (mute) a member for a duration',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                duration: { type: SchemaType.STRING, description: 'Duration like "5m", "1h", "1d"' },
                reason: { type: SchemaType.STRING, description: 'Reason for timeout' }
            },
            required: ['user', 'duration']
        }
    },
    {
        name: 'untimeoutMember',
        description: 'Remove a timeout from a member, restoring their ability to speak',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' }
            },
            required: ['user']
        }
    },
    {
        name: 'unbanMember',
        description: 'Unban a previously banned user from the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username or user ID of the banned user' },
                reason: { type: SchemaType.STRING, description: 'Reason for unbanning' }
            },
            required: ['user']
        }
    },
    {
        name: 'setNickname',
        description: 'Set or clear a member nickname in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                nickname: { type: SchemaType.STRING, description: 'New nickname (leave empty to clear)' }
            },
            required: ['user']
        }
    },

    // ── Message Management ──

    {
        name: 'sendMessage',
        description: 'Send a message to a specific channel. Supports mentions: use <@USER_ID> to ping a user, <@&ROLE_ID> to ping a role, <#CHANNEL_ID> to link a channel. You can also use @everyone or @here.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID to send the message in' },
                content: { type: SchemaType.STRING, description: 'Message content to send. Use <@USER_ID> to mention/ping users.' }
            },
            required: ['channel', 'content']
        }
    },
    {
        name: 'purgeMessages',
        description: 'Bulk delete recent messages in the current channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                count: { type: SchemaType.NUMBER, description: 'Number of messages to delete (1-100)' }
            },
            required: ['count']
        }
    },
    {
        name: 'pinMessage',
        description: 'Pin a message by its ID in the current channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID to pin' }
            },
            required: ['messageId']
        }
    },
    {
        name: 'unpinMessage',
        description: 'Unpin a message by its ID',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID to unpin' }
            },
            required: ['messageId']
        }
    },

    // ── Guild Settings ──

    {
        name: 'updateServerName',
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
        description: 'Change the server icon from an image URL',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'Image URL for the new server icon' }
            },
            required: ['url']
        }
    },
    {
        name: 'setVerificationLevel',
        description: 'Set the server verification level',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                level: { type: SchemaType.STRING, description: 'Verification level', enum: ['none', 'low', 'medium', 'high', 'very_high'] }
            },
            required: ['level']
        }
    },
    {
        name: 'setSystemChannel',
        description: 'Set the system messages channel (welcome messages, boosts)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID for system messages' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setRulesChannel',
        description: 'Set the rules/community guidelines channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID for rules' }
            },
            required: ['channel']
        }
    },

    // ── Invite Management ──

    {
        name: 'createInvite',
        description: 'Create a server invite link',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' },
                maxUses: { type: SchemaType.NUMBER, description: 'Max number of uses (0 = unlimited)' },
                maxAge: { type: SchemaType.NUMBER, description: 'Max age in seconds (0 = never expires)' }
            }
        }
    },
    {
        name: 'deleteInvite',
        description: 'Revoke/delete a server invite by its code',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                code: { type: SchemaType.STRING, description: 'Invite code to revoke' }
            },
            required: ['code']
        }
    },
    {
        name: 'listInvites',
        description: 'List all active server invites',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Audit Log ──

    {
        name: 'getAuditLog',
        description: 'View recent audit log entries for the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.NUMBER, description: 'Number of entries to fetch (1-25, default 10)' },
                user: { type: SchemaType.STRING, description: 'Filter by username or user ID' }
            }
        }
    },

    // ── Auto-Moderation Rules ──

    {
        name: 'createAutomodRule',
        description: 'Create a native Discord auto-moderation rule',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Rule name' },
                triggerType: { type: SchemaType.STRING, description: 'Trigger type', enum: ['keyword', 'spam', 'keyword_preset', 'mention_spam'] },
                keywords: { type: SchemaType.STRING, description: 'Comma-separated keywords to filter (for keyword trigger)' },
                regexPatterns: { type: SchemaType.STRING, description: 'Comma-separated regex patterns (for keyword trigger)' },
                actions: { type: SchemaType.STRING, description: 'Action to take: block (default), timeout, or alert', enum: ['block', 'timeout', 'alert'] },
                alertChannel: { type: SchemaType.STRING, description: 'Channel for alert messages (if action is alert)' }
            },
            required: ['name', 'triggerType']
        }
    },
    {
        name: 'deleteAutomodRule',
        description: 'Delete an auto-moderation rule',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ruleId: { type: SchemaType.STRING, description: 'Rule ID or name to delete' }
            },
            required: ['ruleId']
        }
    },
    {
        name: 'listAutomodRules',
        description: 'List all auto-moderation rules in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Webhooks ──

    {
        name: 'createWebhook',
        description: 'Create a webhook in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                name: { type: SchemaType.STRING, description: 'Webhook name' },
                avatar: { type: SchemaType.STRING, description: 'Avatar image URL for the webhook' }
            },
            required: ['channel', 'name']
        }
    },
    {
        name: 'deleteWebhook',
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
        description: 'Send a message through a webhook',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                webhookId: { type: SchemaType.STRING, description: 'Webhook ID or name' },
                content: { type: SchemaType.STRING, description: 'Message content to send' }
            },
            required: ['webhookId', 'content']
        }
    },
    {
        name: 'listWebhooks',
        description: 'List all webhooks in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Scheduled Events ──

    {
        name: 'createScheduledEvent',
        description: 'Create a scheduled event in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Event name' },
                startTime: { type: SchemaType.STRING, description: 'Start time in ISO format (e.g. 2025-12-31T20:00:00Z)' },
                endTime: { type: SchemaType.STRING, description: 'End time in ISO format (optional)' },
                description: { type: SchemaType.STRING, description: 'Event description' },
                channel: { type: SchemaType.STRING, description: 'Voice/stage channel name (makes it a voice event)' },
                location: { type: SchemaType.STRING, description: 'External location (for non-voice events)' }
            },
            required: ['name', 'startTime']
        }
    },
    {
        name: 'editScheduledEvent',
        description: 'Modify a scheduled event',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Current event name or ID' },
                newName: { type: SchemaType.STRING, description: 'New event name' },
                description: { type: SchemaType.STRING, description: 'New description' },
                startTime: { type: SchemaType.STRING, description: 'New start time in ISO format' },
                endTime: { type: SchemaType.STRING, description: 'New end time in ISO format' }
            },
            required: ['name']
        }
    },
    {
        name: 'deleteScheduledEvent',
        description: 'Cancel/delete a scheduled event',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Event name or ID to delete' }
            },
            required: ['name']
        }
    },
    {
        name: 'listScheduledEvents',
        description: 'List all scheduled events in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Documents ──

    {
        name: 'createDocument',
        description: 'Create a named document (rules, guides, FAQs, notes) stored in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name (e.g. "server-rules", "faq")' },
                content: { type: SchemaType.STRING, description: 'Document content text' }
            },
            required: ['name', 'content']
        }
    },
    {
        name: 'editDocument',
        description: 'Replace the content of an existing document',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name to edit' },
                content: { type: SchemaType.STRING, description: 'New content to replace with' }
            },
            required: ['name', 'content']
        }
    },
    {
        name: 'deleteDocument',
        description: 'Delete a document permanently',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name to delete' }
            },
            required: ['name']
        }
    },
    {
        name: 'getDocument',
        description: 'Read/retrieve a document by name',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Document name to read' }
            },
            required: ['name']
        }
    },
    {
        name: 'listDocuments',
        description: 'List all documents stored in this server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Memory ──

    {
        name: 'saveMemory',
        description: 'Save a piece of information to server memory (key-value). Use to remember things about the server or users.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key (e.g. "movie-night", "user:123:nickname")' },
                value: { type: SchemaType.STRING, description: 'Value to remember' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'getMemory',
        description: 'Recall a stored memory by key',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key to look up' }
            },
            required: ['key']
        }
    },
    {
        name: 'listMemories',
        description: 'List all stored memories for this server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'deleteMemory',
        description: 'Delete a stored memory by key',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                key: { type: SchemaType.STRING, description: 'Memory key to delete' }
            },
            required: ['key']
        }
    },

    // ── Info Queries ──

    {
        name: 'getServerInfo',
        description: 'Get information about the current server (member count, channels, roles, etc.)',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'getMemberInfo',
        description: 'Get information about a specific server member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' }
            },
            required: ['user']
        }
    },
    {
        name: 'listChannels',
        description: 'List all channels in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'listRoles',
        description: 'List all roles in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Message Reading ──

    {
        name: 'readMessages',
        description: 'Fetch the most recent messages from a channel. Use this to see what people have been saying.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' },
                count: { type: SchemaType.NUMBER, description: 'Number of messages to fetch (1-25, default 10)' }
            }
        }
    },
    {
        name: 'fetchMessage',
        description: 'Fetch a single message by its ID from a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID to fetch' }
            },
            required: ['messageId']
        }
    },

    // ── Rich Messages ──

    {
        name: 'sendEmbed',
        description: 'Send a rich embed message to a channel. Use for announcements, rules, formatted info.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                title: { type: SchemaType.STRING, description: 'Embed title' },
                description: { type: SchemaType.STRING, description: 'Embed body text' },
                color: { type: SchemaType.STRING, description: 'Hex color code (e.g. #ff0000)' },
                fields: { type: SchemaType.STRING, description: 'JSON array of {name, value} objects for embed fields' },
                footer: { type: SchemaType.STRING, description: 'Footer text' },
                image: { type: SchemaType.STRING, description: 'Image URL to display' },
                thumbnail: { type: SchemaType.STRING, description: 'Thumbnail URL' }
            },
            required: ['channel']
        }
    },
    {
        name: 'replyToMessage',
        description: 'Reply to a specific message by ID in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID to reply to' },
                content: { type: SchemaType.STRING, description: 'Reply content' }
            },
            required: ['channel', 'messageId', 'content']
        }
    },
    {
        name: 'editMessage',
        description: 'Edit a message previously sent by the bot',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                messageId: { type: SchemaType.STRING, description: 'Message ID to edit' },
                content: { type: SchemaType.STRING, description: 'New message content' }
            },
            required: ['channel', 'messageId', 'content']
        }
    },
    {
        name: 'addReaction',
        description: 'Add an emoji reaction to a message',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' },
                messageId: { type: SchemaType.STRING, description: 'Message ID to react to' },
                emoji: { type: SchemaType.STRING, description: 'Emoji to react with (unicode emoji or custom emoji name)' }
            },
            required: ['messageId', 'emoji']
        }
    },
    {
        name: 'createPoll',
        description: 'Create a Discord poll in a channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID (defaults to current)' },
                question: { type: SchemaType.STRING, description: 'Poll question' },
                options: { type: SchemaType.STRING, description: 'Comma-separated list of poll options' },
                duration: { type: SchemaType.NUMBER, description: 'Poll duration in hours (1-168, default 24)' }
            },
            required: ['question', 'options']
        }
    },

    // ── Direct Messages ──

    {
        name: 'dmUser',
        description: 'Send a direct message to a server member',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user: { type: SchemaType.STRING, description: 'Username, display name, or user ID' },
                content: { type: SchemaType.STRING, description: 'Message content to send' }
            },
            required: ['user', 'content']
        }
    },

    // ── Additional Channel Management ──

    {
        name: 'moveChannel',
        description: 'Move a channel to a different category',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID to move' },
                category: { type: SchemaType.STRING, description: 'Target category name or ID' }
            },
            required: ['channel', 'category']
        }
    },
    {
        name: 'cloneChannel',
        description: 'Clone a channel with its permissions',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID to clone' },
                newName: { type: SchemaType.STRING, description: 'Name for the cloned channel (optional)' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setChannelNSFW',
        description: 'Set or remove the NSFW flag on a text channel',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID' },
                nsfw: { type: SchemaType.BOOLEAN, description: 'Whether the channel should be NSFW' }
            },
            required: ['channel', 'nsfw']
        }
    },
    {
        name: 'setVoiceUserLimit',
        description: 'Set the maximum number of users in a voice channel (0 = unlimited)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel name or ID' },
                limit: { type: SchemaType.NUMBER, description: 'Max users (0 for unlimited)' }
            },
            required: ['channel', 'limit']
        }
    },

    // ── Additional Info Queries ──

    {
        name: 'listEmojis',
        description: 'List all custom emojis in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },
    {
        name: 'listBans',
        description: 'List all banned users in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Reaction Roles ──

    {
        name: 'setupReactionRole',
        description: 'Set up a reaction role: when users react to a message with a specific emoji, they get a role',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID containing the message' },
                messageId: { type: SchemaType.STRING, description: 'Message ID to add the reaction role to' },
                emoji: { type: SchemaType.STRING, description: 'Emoji for the reaction (unicode or custom emoji name)' },
                role: { type: SchemaType.STRING, description: 'Role name or ID to assign when reacted' }
            },
            required: ['channel', 'messageId', 'emoji', 'role']
        }
    },
    {
        name: 'removeReactionRole',
        description: 'Remove a reaction role from a message',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                messageId: { type: SchemaType.STRING, description: 'Message ID to remove the reaction role from' },
                emoji: { type: SchemaType.STRING, description: 'Emoji of the reaction role to remove' }
            },
            required: ['messageId']
        }
    },
    {
        name: 'listReactionRoles',
        description: 'List all configured reaction roles in the server',
        parameters: { type: SchemaType.OBJECT, properties: {} }
    },

    // ── Welcome/Goodbye/AutoRole Config ──

    {
        name: 'setWelcomeChannel',
        description: 'Set the welcome channel and message for new members. Template vars: {user} {server} {memberCount}',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID for welcome messages' },
                message: { type: SchemaType.STRING, description: 'Welcome message template. Use {user} for mention, {server} for server name, {memberCount} for count.' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setGoodbyeChannel',
        description: 'Set the goodbye channel and message for leaving members. Template vars: {user} {server} {memberCount}',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Channel name or ID for goodbye messages' },
                message: { type: SchemaType.STRING, description: 'Goodbye message template. Use {user} for name, {server} for server name.' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setAutoRole',
        description: 'Add or remove a role from the auto-assign-on-join list',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                role: { type: SchemaType.STRING, description: 'Role name or ID' },
                action: { type: SchemaType.STRING, description: 'Whether to add or remove the role', enum: ['add', 'remove'] }
            },
            required: ['role', 'action']
        }
    },

    // ── Server Settings (extended) ──

    {
        name: 'setAFKChannel',
        description: 'Set the server AFK voice channel and timeout',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                channel: { type: SchemaType.STRING, description: 'Voice channel name or ID for AFK' },
                timeout: { type: SchemaType.NUMBER, description: 'AFK timeout in seconds (60, 300, 900, 1800, 3600)' }
            },
            required: ['channel']
        }
    },
    {
        name: 'setDefaultNotifications',
        description: 'Set the server default notification level',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                level: { type: SchemaType.STRING, description: 'Notification level', enum: ['all', 'mentions'] }
            },
            required: ['level']
        }
    },
    {
        name: 'setServerBanner',
        description: 'Set the server banner image (requires boost level 2+)',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: { type: SchemaType.STRING, description: 'Image URL for the banner' }
            },
            required: ['url']
        }
    }
];

module.exports = { toolDeclarations };
