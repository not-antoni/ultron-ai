const { SchemaType } = require('@google/generative-ai');

const toolDeclarations = [
    {
        name: 'createChannel',
        description: 'Create a new text, voice, or category channel in the server',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: 'Channel name' },
                type: { type: SchemaType.STRING, description: 'Channel type: text, voice, or category', enum: ['text', 'voice', 'category'] },
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
    }
];

module.exports = { toolDeclarations };
