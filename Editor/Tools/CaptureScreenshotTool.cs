using System;
using System.IO;
using System.Threading.Tasks;
using McpUnity.Unity;
using UnityEngine;
using UnityEditor;
using Newtonsoft.Json.Linq;

namespace McpUnity.Tools
{
    /// <summary>
    /// Tool for capturing screenshots of the Unity Scene View with optional overlays and metadata
    /// </summary>
    public class CaptureScreenshotTool : McpToolBase
    {
        public CaptureScreenshotTool()
        {
            Name = "capture_screenshot";
            Description = "Captures a screenshot of the Unity Scene View with optional gizmos, labels, and debug information";
            IsAsync = true; // Screenshots need to run on the main Unity thread
        }

        /// <summary>
        /// Execute the screenshot capture tool asynchronously on the Unity main thread
        /// </summary>
        /// <param name="parameters">Tool parameters as a JObject</param>
        /// <param name="tcs">TaskCompletionSource to set the result or exception of the execution</param>
        public override void ExecuteAsync(JObject parameters, TaskCompletionSource<JObject> tcs)
        {
            // Schedule execution on the Unity main thread
            EditorApplication.delayCall += () =>
            {
                try
                {
                    // Extract parameters with defaults
                    string mode = parameters["mode"]?.ToObject<string>()?.ToLower() ?? "basic";
                    bool withGizmos = parameters["withGizmos"]?.ToObject<bool>() ?? true;
                    bool withLabels = parameters["withLabels"]?.ToObject<bool>() ?? false;
                    string resolution = parameters["resolution"]?.ToObject<string>()?.ToLower() ?? "1080p";

                    // Get resolution dimensions
                    int width = 1920, height = 1080;
                    switch (resolution)
                    {
                        case "1440p":
                            width = 2560; height = 1440;
                            break;
                        case "4k":
                            width = 3840; height = 2160;
                            break;
                        default:
                            width = 1920; height = 1080;
                            break;
                    }

                    // Capture the screenshot
                    var result = CaptureSceneViewScreenshot(mode, withGizmos, withLabels, width, height);

                    tcs.TrySetResult(result);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[MCP Screenshot] Error capturing screenshot: {e.Message}");
                    var errorResponse = McpUnitySocketHandler.CreateErrorResponse(
                        $"Exception during screenshot capture: {e.Message}",
                        "capture_exception"
                    );
                    tcs.TrySetResult(errorResponse);
                }
            };
        }

        /// <summary>
        /// Captures a screenshot of the current Scene View
        /// </summary>
        private JObject CaptureSceneViewScreenshot(string mode, bool withGizmos, bool withLabels, int width, int height)
        {
            var sceneView = SceneView.lastActiveSceneView;
            if (sceneView == null)
            {
                sceneView = EditorWindow.GetWindow<SceneView>();
            }

            if (sceneView == null)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    "No Scene View available for screenshot capture",
                    "no_scene_view"
                );
            }

            try
            {
                // Ensure directory exists
                string screenshotDir = Path.Combine(Application.dataPath, "..", "Temp", "MCPScreenshots");
                if (!Directory.Exists(screenshotDir))
                {
                    Directory.CreateDirectory(screenshotDir);
                }

                // Generate filename
                string timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
                string filename = $"MCP_SceneView_{mode}_{timestamp}.png";
                string filePath = Path.Combine(screenshotDir, filename);

                // Get camera reference that will be used throughout
                var camera = sceneView.camera;

                // Apply mode settings
                bool currentGizmos = sceneView.drawGizmos;
                try
                {
                    // Set gizmos based on mode and parameters
                    switch (mode)
                    {
                        case "basic":
                            sceneView.drawGizmos = false;
                            break;
                        case "labels":
                        case "debug":
                            sceneView.drawGizmos = true;
                            break;
                        case "custom":
                            sceneView.drawGizmos = withGizmos;
                            break;
                    }

                    // Force repaint to apply gizmo changes
                    sceneView.Repaint();

                    if (camera == null)
                    {
                        return McpUnitySocketHandler.CreateErrorResponse(
                            "Scene View camera not available",
                            "no_camera"
                        );
                    }

                    // Create render texture
                    var renderTexture = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
                    var previousTarget = camera.targetTexture;
                    var previousActive = RenderTexture.active;

                    try
                    {
                        camera.targetTexture = renderTexture;
                        RenderTexture.active = renderTexture;

                        camera.Render();

                        var texture2D = new Texture2D(width, height, TextureFormat.RGB24, false);
                        texture2D.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                        texture2D.Apply();

                        var pngData = texture2D.EncodeToPNG();
                        File.WriteAllBytes(filePath, pngData);

                        UnityEngine.Object.DestroyImmediate(texture2D);

                        Debug.Log($"[MCP Screenshot] Successfully captured {mode} screenshot: {filePath}");
                    }
                    finally
                    {
                        camera.targetTexture = previousTarget;
                        RenderTexture.active = previousActive;
                        RenderTexture.ReleaseTemporary(renderTexture);
                    }
                }
                finally
                {
                    // Restore original gizmo state
                    sceneView.drawGizmos = currentGizmos;
                    sceneView.Repaint();
                }

                // Build response with basic metadata
                var response = new JObject
                {
                    ["success"] = true,
                    ["type"] = "screenshot",
                    ["filePath"] = filePath,
                    ["timestamp"] = timestamp,
                    ["resolution"] = $"{width}x{height}",
                    ["captureMethod"] = "Scene View",
                    ["captureType"] = $"MCP {mode} capture",
                    ["withGizmos"] = sceneView.drawGizmos,
                    ["withLabels"] = withLabels,
                    ["mode"] = mode
                };

                // Add basic scene context
                var context = new JObject
                {
                    ["sceneName"] = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name,
                    ["activeTool"] = UnityEditor.Tools.current.ToString(),
                    ["cameraProjection"] = camera.orthographic ? "Orthographic" : "Perspective"
                };

                if (camera != null)
                {
                    context["cameraPosition"] = camera.transform.position.ToString();
                    context["cameraRotation"] = camera.transform.rotation.eulerAngles.ToString();
                }

                var selected = Selection.activeGameObject;
                if (selected != null)
                {
                    context["selectedObject"] = selected.name;
                }

                response["context"] = context;
                response["message"] = $"Screenshot captured successfully: {filePath}";

                return response;
            }
            catch (Exception e)
            {
                return McpUnitySocketHandler.CreateErrorResponse(
                    $"Failed to capture screenshot: {e.Message}",
                    "capture_failed"
                );
            }
        }
    }
}