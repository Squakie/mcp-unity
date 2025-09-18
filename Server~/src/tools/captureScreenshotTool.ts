import * as z from "zod";
import { Logger } from "../utils/logger.js";
import { McpUnity } from "../unity/mcpUnity.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpUnityError, ErrorType } from "../utils/errors.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Constants for the tool
const toolName = "capture_screenshot";
const toolDescription = "Captures a screenshot of the Unity Scene View with optional gizmos, labels, and debug information";
const paramsSchema = z.object({
  mode: z
    .enum(["basic", "labels", "debug", "custom"])
    .optional()
    .describe(
      "Screenshot capture mode: 'basic' (clean scene), 'labels' (with object labels), 'debug' (full debug info), 'custom' (use withGizmos/withLabels params). Default: 'basic'"
    ),
  withGizmos: z
    .boolean()
    .optional()
    .describe("Whether to include Unity gizmos in the screenshot (only used with 'custom' mode). Default: true"),
  withLabels: z
    .boolean()
    .optional()
    .describe("Whether to include object labels and annotations (only used with 'custom' mode). Default: false"),
  resolution: z
    .enum(["1080p", "1440p", "4K"])
    .optional()
    .describe("Screenshot resolution: '1080p' (1920x1080), '1440p' (2560x1440), '4K' (3840x2160). Default: '1080p'")
});

/**
 * Creates and registers the Capture Screenshot tool with the MCP server
 * This tool allows capturing Unity Scene View screenshots with comprehensive metadata
 *
 * @param server The MCP server instance to register with
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param logger The logger instance for diagnostic information
 */
export function registerCaptureScreenshotTool(
  server: McpServer,
  mcpUnity: McpUnity,
  logger: Logger
) {
  logger.info(`Registering tool: ${toolName}`);

  // Register this tool with the MCP server
  server.tool(
    toolName,
    toolDescription,
    paramsSchema.shape,
    async (params: z.infer<typeof paramsSchema>) => {
      try {
        logger.info(`Executing tool: ${toolName}`, params);
        const result = await toolHandler(mcpUnity, params);
        logger.info(`Tool execution successful: ${toolName}`);
        return result;
      } catch (error) {
        logger.error(`Tool execution failed: ${toolName}`, error);
        throw error;
      }
    }
  );
}

/**
 * Handles requests for Unity screenshot capture
 *
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param params The parameters for the tool
 * @returns A promise that resolves to the tool execution result
 * @throws McpUnityError if the request to Unity fails
 */
async function toolHandler(
  mcpUnity: McpUnity,
  params: z.infer<typeof paramsSchema>
): Promise<CallToolResult> {
  const {
    mode = "basic",
    withGizmos = true,
    withLabels = false,
    resolution = "1080p"
  } = params;

  // Send request to Unity using the capture_screenshot method
  const response = await mcpUnity.sendRequest({
    method: "capture_screenshot",
    params: {
      mode: mode,
      withGizmos: withGizmos,
      withLabels: withLabels,
      resolution: resolution
    },
  });

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || "Failed to capture screenshot from Unity"
    );
  }

  // Format the response for Claude Code
  const metadata = {
    success: response.success,
    filePath: response.filePath,
    timestamp: response.timestamp,
    resolution: response.resolution,
    captureMethod: response.captureMethod,
    captureType: response.captureType,
    withGizmos: response.withGizmos,
    withLabels: response.withLabels
  };

  // Build comprehensive response text
  let responseText = `Screenshot captured successfully!\n\n`;
  responseText += `📸 **Capture Details:**\n`;
  responseText += `   • File: ${response.filePath}\n`;
  responseText += `   • Mode: ${mode} (${response.captureType})\n`;
  responseText += `   • Resolution: ${response.resolution}\n`;
  responseText += `   • With Gizmos: ${response.withGizmos}\n`;
  responseText += `   • With Labels: ${response.withLabels}\n`;
  responseText += `   • Timestamp: ${response.timestamp}\n\n`;

  // Add context information if available
  if (response.context) {
    responseText += `🎯 **Scene Context:**\n`;
    responseText += `   • Scene: ${response.context.sceneName}\n`;
    responseText += `   • Camera: ${response.context.cameraProjection}\n`;
    responseText += `   • Position: ${response.context.cameraPosition}\n`;
    if (response.context.selectedObject) {
      responseText += `   • Selected: ${response.context.selectedObject}\n`;
    }
    responseText += `\n`;
  }

  // Add object analysis if available
  if (response.sceneObjectCount > 0) {
    responseText += `🎮 **Scene Objects:** ${response.sceneObjectCount} objects analyzed\n`;
    if (response.sceneObjects && response.sceneObjects.length > 0) {
      responseText += `   Key objects:\n`;
      response.sceneObjects.slice(0, 5).forEach((obj: any) => {
        responseText += `   • ${obj.name} (${obj.layer}) at ${obj.position}\n`;
      });
      if (response.sceneObjects.length > 5) {
        responseText += `   • ... and ${response.sceneObjects.length - 5} more objects\n`;
      }
    }
    responseText += `\n`;
  }

  // Add UI analysis if available
  if (response.uiElementCount > 0) {
    responseText += `🖥️ **UI Elements:** ${response.uiElementCount} UI components analyzed\n`;
    if (response.uiElements && response.uiElements.length > 0) {
      responseText += `   Key UI elements:\n`;
      response.uiElements.slice(0, 3).forEach((ui: any) => {
        responseText += `   • ${ui.name} at ${ui.position} (size: ${ui.size})\n`;
      });
      if (response.uiElements.length > 3) {
        responseText += `   • ... and ${response.uiElements.length - 3} more UI elements\n`;
      }
    }
    responseText += `\n`;
  }

  // Add scene health information if available
  if (response.sceneHealth) {
    const health = response.sceneHealth;
    responseText += `⚡ **Scene Health Analysis:**\n`;
    responseText += `   • Overall Score: ${health.overallScore.toFixed(1)}/100\n`;
    responseText += `   • Performance: ${health.estimatedFrameRate.toFixed(0)} FPS estimated\n`;
    responseText += `   • Draw Calls: ${health.drawCalls}\n`;
    responseText += `   • Memory: ${health.memoryEstimateMB.toFixed(1)} MB\n`;

    if (health.criticalIssues > 0 || health.warnings > 0 || health.performanceIssues > 0) {
      responseText += `   • Issues: ${health.criticalIssues} critical, ${health.warnings} warnings, ${health.performanceIssues} performance\n`;
    }

    if (health.recommendations && health.recommendations.length > 0) {
      responseText += `   • Recommendations:\n`;
      health.recommendations.slice(0, 3).forEach((rec: string) => {
        responseText += `     - ${rec}\n`;
      });
    }
    responseText += `\n`;
  }

  responseText += `✅ Screenshot is ready for analysis and documentation purposes.`;

  return {
    content: [
      {
        type: "text",
        text: responseText,
      },
    ],
    isError: false,
  };
}