/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { showNotice } from "@api/Notices";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
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

const trimStr = (start: string, end: string, text: string): string => {
    const startIdx = text.indexOf(start);
    if (startIdx === -1) return text; // Start string not found, return original text

    const endIdx = text.indexOf(end, startIdx + start.length);
    if (endIdx === -1) return text; // End string not found, return original text

    return text.slice(0, startIdx) + text.slice(endIdx + end.length);
};

async function generateWithOllama(prompt: string): Promise<string | undefined> {
    try {
        // Check if Ollama URL is configured
        if (!settings.store.ollamaUrl) {
            logger.error("Ollama URL is not configured. Please set it in the plugin settings.");
            return undefined;
        }

        // Make sure the URL is properly formatted
        const url = settings.store.ollamaUrl.endsWith("/")
            ? `${settings.store.ollamaUrl}api/generate`
            : `${settings.store.ollamaUrl}/api/generate`;

        // Log the request for debugging
        logger.info(`Sending request to Ollama at: ${url}`);

        const requestBody = {
            model: settings.store.ollamaModel || "llama3", // Fallback to a default model
            prompt: prompt,
            stream: false
        };

        // Log request data
        logger.info(`Request body: ${JSON.stringify(requestBody)}`);

        // Create headers object
        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };

        // Add authorization if configured
        if (settings.store.ollamaKey) {
            headers["Authorization"] = `Bearer ${settings.store.ollamaKey}`;
        }

        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            logger.error(`Ollama API error: ${response.status} ${response.statusText}`);
            if (response.status === 404) {
                logger.error("API endpoint not found. Check your Ollama URL configuration.");
            } else if (response.status === 401 || response.status === 403) {
                logger.error("Authentication error. Check your API key.");
            }

            try {
                // Try to get more error details from the response
                const errorText = await response.text();
                logger.error(`Error details: ${errorText}`);
            } catch (e) {
                // Ignore error parsing the error
            }

            return undefined;
        }

        const data = await response.json();
        logger.info("Successfully received response from Ollama.");
        logger.info(`Response data: ${JSON.stringify(data)}`);

        if (!data.response) {
            logger.error("Ollama response doesn't contain expected 'response' field:", data);
            return "Received malformed response from Ollama. Check plugin logs for details.";
        }

        let message: string = data.response;
        message = trimStr("<think>", "</think>", message);

        return message;
    } catch (error) {
        logger.error("Failed to generate with Ollama:", error);
        return undefined;
    }
}

async function fetchTag(tagName: string): Promise<TagResponse | undefined> {
    try {
        // Check cache first
        if (settings.store.tagsCache.has(tagName)) {
            logger.info('Fetched tag from cache: ${tagName}');
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
    ollamaUrl: {
        type: OptionType.STRING,
        description: "Ollama server URL for prompting",
        default: "http://127.0.0.1:11434"
    },
    ollamaKey: {
        type: OptionType.STRING,
        description: "Authentication key for the Ollama API (if required)",
        default: ""
    },
    ollamaModel: {
        type: OptionType.STRING,
        description: "Ollama model to use for prompts",
        default: "deepseek-r1:7b"
    },
    tagsCache: {
        type: OptionType.CUSTOM,
        default: {} as Map<string, TagResponse>
    }
});

export default definePlugin({
    name: "GlobalTags",
    description: "A tag system for storing and retrieving text snippets from a configured server\n\nHost your own GlobalTags Server: https://github.com/ReclipseTheOne/GlobalTags-Server",
    authors: [Devs.Reclipse],

    settings,

    async start() {
        let canFetch: boolean = true;
        if (!settings.store.serverUrl) {
            showNotice("GlobalTags plugin requires a server URL to be configured in settings.", "Close", () => null);
            canFetch = false;
        }
        if (!settings.store.serverKey) {
            showNotice("GlobalTags plugin requires a server key to be configured in settings.", "Close", () => null);
            canFetch = false;
        }

        if (canFetch) {
            // Fetch all tags on startup
            const tags = await fetchTags();
            if (tags.length > 0) {
                tags.forEach(tag => {
                    settings.store.tagsCache.set(tag.name, tag);
                });
            }
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
                },
                {
                    name: "prompt",
                    description: "Prompt ollama",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                    options: [
                        {
                            name: "prompt",
                            description: "What to prompt ollama with",
                            type: ApplicationCommandOptionType.STRING,
                            required: true
                        },
                        {
                            name: "send",
                            description: "Send the response instantly after generation (if not, Clyde will send it to you)",
                            type: ApplicationCommandOptionType.BOOLEAN,
                            required: false
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

                    case "prompt": {
                        const prompt = findOption(args[0].options, "prompt", "");
                        const send = findOption(args[0].options, "send", false);

                        // Generate with Ollama
                        const response = await generateWithOllama(prompt);
                        if (!response) {
                            return sendBotMessage(ctx.channel.id, {
                                content: "Failed to generate with Ollama",
                                flags: 64
                            });
                        }

                        if (send) {
                            return sendMessage(ctx.channel.id, { content: response });
                        } else {
                            return sendBotMessage(ctx.channel.id, {
                                content: response,
                                flags: 64
                            });
                        }
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
    ]
});
