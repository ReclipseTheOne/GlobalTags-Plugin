/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { showNotice } from "@api/Notices";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

// Define Tag interfaces
interface TagSchema {
    name: string;
    message: string;
    owner: string;
    owner_id: string;
    key: string;
}

interface TagResponse {
    name: string;
    message: string;
    owner_id: string;
}

interface DeleteTagSchema {
    key: string;
}

interface ApiResponse {
    success: boolean;
    data?: TagResponse;
    error?: string;
}

const logger = new Logger("GlobalTags");

async function fetchTag(tagName: string): Promise<TagResponse | undefined> {
    try {
        // Check cache first
        if (settings.store.tagsCache.has(tagName)) {
            return settings.store.tagsCache.get(tagName);
        }

        const response = await fetch(`${settings.store.serverUrl}/tags/${tagName}`);
        if (!response.ok) {
            return undefined;
        }

        const data = await response.json();
        settings.store.tagsCache.set(tagName, data);
        return data;
    } catch (error) {
        logger.error(`Failed to fetch tag "${tagName}":`, error);
        return undefined;
    }
}

async function fetchTags(userId?: string): Promise<TagResponse[]> {
    try {
        const response = await fetch(`${settings.store.serverUrl}/tags`);
        if (!response.ok) {
            return [];
        }

        const tags = await response.json();

        // If userId is provided, filter tags by owner
        if (userId) {
            return tags.filter(tag => tag.owner_id === userId);
        }

        return tags;
    } catch (error) {
        logger.error("Failed to fetch tags:", error);
        return [];
    }
}

async function deleteTag(tagName: string): Promise<ApiResponse> {
    try {
        const response = await fetch(`${settings.store.serverUrl}/tags/${tagName}`, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                key: settings.store.serverKey
            } as DeleteTagSchema)
        });

        const data = await response.json();
        if (data.success) {
            // Clear cache for this tag
            settings.store.tagsCache.delete(tagName);
        }
        return data;
    } catch (err) {
        logger.error(`Failed to delete tag "${tagName}":`, err);
        return { success: false, error: String(err) };
    }
}

async function createTag(tag: TagSchema): Promise<ApiResponse> {
    try {
        const response = await fetch(`${settings.store.serverUrl}/tags`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ...tag,
                key: settings.store.serverKey
            })
        });

        const data = await response.json();
        if (data.success) {
            // Clear cache for this tag
            settings.store.tagsCache.delete(tag.name);
        }
        return data;
    } catch (err) {
        logger.error(`Failed to create tag "${tag.name}":`, err);
        return { success: false, error: String(err) };
    }
}

// Plugin settings
const settings = definePluginSettings({
    serverUrl: {
        type: OptionType.STRING,
        description: "Server URL for the tags API",
        default: "http://127.0.0.1:8000"
    },
    serverKey: {
        type: OptionType.STRING,
        description: "Authentication key for the tags API",
        default: ""
    },
    promptUrl: {
        type: OptionType.STRING,
        description: "Ollama server URL for prompting",
        default: "http://127.0.0.1:8001"
    },
    enableInlinePrefix: {
        type: OptionType.BOOLEAN,
        description: "Enable inline tag usage with gt!",
        default: true
    },
    tagsCache: {
        type: OptionType.CUSTOM,
        default: new Map<string, TagResponse>()
    }
});

export default definePlugin({
    name: "GlobalTags",
    description: "A tag system for storing and retrieving text snippets from a configured server\n\nHost your own GlobalTags Server: https://github.com/ReclipseTheOne/GlobalTags-Server",
    authors: [Devs.Reclipse],

    settings,

    async start() {
        if (!settings.store.serverUrl) {
            showNotice("GlobalTags plugin requires a server URL to be configured in settings.", "Close", () => null);
        }
        if (!settings.store.serverKey) {
            showNotice("GlobalTags plugin requires a server key to be configured in settings.", "Close", () => null);
        }
    },

    // Command handlers
    commands: [
        {
            name: "globaltags",
            description: "Manage global tags stored on a server",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "create",
                    description: "Create a new tag",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "tag_name",
                            description: "The name of the tag to create",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        },
                        {
                            name: "tag_message",
                            description: "The message content for this tag",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                },
                {
                    name: "delete",
                    description: "Delete one of your tags",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "tag_name",
                            description: "The name of the tag to delete",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                },
                {
                    name: "show",
                    description: "Show a tag's content",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "tag_name",
                            description: "The name of the tag to display",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                },
                {
                    name: "who",
                    description: "Check who owns a tag",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "tag_name",
                            description: "The name of the tag to check",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                },
                {
                    name: "list",
                    description: "List all tags from a user",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "user",
                            description: "User ID to list tags for",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        }
                    ]
                }
            ],

            async execute(args, ctx) {
                switch (args[0].name) {
                    case "create": {
                        const tagName = findOption(args[0].options, "tag_name", "");
                        const tagMessage = findOption(args[0].options, "tag_message", "");

                        // Check if tag already exists
                        const existingTag = await fetchTag(tagName);
                        if (existingTag && "owner_id" in existingTag) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `'${tagName}' already exists! <a:pop:1333844597352300564>`
                            });
                        }

                        // Create tag
                        const currentUser = UserStore.getCurrentUser();
                        const result = await createTag({
                            name: tagName,
                            message: tagMessage,
                            owner: currentUser.username,
                            owner_id: currentUser.id,
                            key: settings.store.serverKey
                        });

                        if (result.success) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `'${tagName}' created successfully! <a:pop:1333844597352300564>`
                            });
                        } else {
                            return sendBotMessage(ctx.channel.id, {
                                content: `Failed to create tag: ${result.error ?? "Unknown error"}`
                            });
                        }
                        break;
                    }

                    case "delete": {
                        const tagName = findOption(args[0].options, "tag_name", "");

                        // Check if tag exists
                        const existingTag = await fetchTag(tagName);
                        if (!existingTag || !("owner_id" in existingTag)) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `'${tagName}' does not exist! <a:pop:1333844597352300564>`
                            });
                        }

                        // Check ownership
                        if (existingTag.owner_id !== UserStore.getCurrentUser().id) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `Tag '${tagName}' is owned by <@${existingTag.owner_id}>! <a:pop:1333844597352300564>`
                            });
                        }

                        // Delete tag
                        const result = await deleteTag(tagName);
                        if (result.success) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `'${tagName}' deleted successfully! <a:pop:1333844597352300564>`
                            });
                        } else {
                            return sendBotMessage(ctx.channel.id, {
                                content: `Failed to delete tag: ${result.error ?? "Unknown error"}`
                            });
                        }
                        break;
                    }

                    case "show": {
                        const tagName = findOption(args[0].options, "tag_name", "");

                        // Fetch tag
                        const tag = await fetchTag(tagName);
                        if (!tag || !("owner_id" in tag)) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `${tagName} does not exist! <a:pop:1333844597352300564>`,
                                flags: 64
                            });
                        }

                        return {
                            content: tag.message
                        };
                        break;
                    }

                    case "who": {
                        const tagName = findOption(args[0].options, "tag_name", "");

                        // Fetch tag
                        const tag = await fetchTag(tagName);
                        if (!tag || !("owner_id" in tag)) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `${tagName} does not exist! <a:pop:1333844597352300564>`,
                                flags: 64
                            });
                        }

                        return sendBotMessage(ctx.channel.id, {
                            content: `${tagName} is owned by <@${tag.owner_id}>`,
                            flags: 64
                        });
                        break;
                    }

                    case "list": {
                        const userId = findOption(args[0].options, "user", "");

                        // Fetch tags for the user
                        const tags = await fetchTags(userId);

                        if (tags.length === 0) {
                            return sendBotMessage(ctx.channel.id, {
                                content: `No tags found for <@${userId}>`,
                                flags: 64
                            });
                        }

                        let tagList = "";
                        for (const tag of tags) {
                            tagList += `${tag.name}\n`;
                        }

                        return sendBotMessage(ctx.channel.id, {
                            content: tagList,
                            flags: 64
                        });
                        break;
                    }

                    default: {
                        return sendBotMessage(ctx.channel.id, {
                            content: "Invalid sub-command",
                            flags: 64
                        });
                    }
                }
            }
        },
        {
            name: "gt",
            description: "Fetches a tag with the provided name",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "tag_name",
                    description: "Tag Name",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args, ctx) => {
                const tagName = args.find(arg => arg.name === "tag_name")?.value as string;

                // Fetch tag
                const tag = await fetchTag(tagName);
                if (!tag || !("owner_id" in tag)) {
                    return sendBotMessage(ctx.channel.id, {
                        content: `${tagName} does not exist! <a:pop:1333844597352300564>`,
                        flags: 64
                    });
                }

                return {
                    content: tag.message
                };
            }
        }
    ],

    onMessage(e) {
        if (!settings.store.enableInlinePrefix) return;

        const { content, channelId } = e.message;
        if (!content.startsWith("gt!")) return;

        const tagName = content.slice(3).trim();
        if (!tagName) return;

        // Prevent the message from being sent
        e.preventDefault();

        // Fetch and send the tag
        fetchTag(tagName).then(tag => {
            if (!tag || !("owner_id" in tag)) {
                sendBotMessage(channelId, {
                    content: `${tagName} does not exist! <a:pop:1333844597352300564>`,
                    flags: 64
                });
            } else {
                sendBotMessage(channelId, {
                    content: tag.message
                });
            }
        });
    }
});
