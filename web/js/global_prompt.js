import { app } from "../../../scripts/app.js";

let globalPositivePrompt = "";
let globalNegativePrompt = "";

app.registerExtension({
    name: "geniusewzq.GlobalPrompt",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "KSampler" || nodeData.name === "KSamplerAdvanced") {
            const originalInputTypes = nodeType.INPUT_TYPES;
            
            const newInputTypes = () => {
                const types = originalInputTypes();
                
                if (types.required) {
                    for (const key of Object.keys(types.required)) {
                        if (key === "prompt" || key === "正面条件") {
                            if (!types.optional) types.optional = {};
                            types.optional[key] = types.required[key];
                            delete types.required[key];
                        }
                        if (key === "negative" || key === "负面条件") {
                            if (!types.optional) types.optional = {};
                            types.optional[key] = types.required[key];
                            delete types.required[key];
                        }
                    }
                }
                
                return types;
            };
            
            nodeType.INPUT_TYPES = newInputTypes;
        }

        if (nodeData.name === "GlobalPositivePrompt") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                if (onExecuted) onExecuted.apply(this, arguments);
                globalPositivePrompt = this.widgets[0]?.value || "";
                console.log("[GlobalPrompt] Positive prompt updated:", globalPositivePrompt);
            };
        }

        if (nodeData.name === "GlobalNegativePrompt") {
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                if (onExecuted) onExecuted.apply(this, arguments);
                globalNegativePrompt = this.widgets[0]?.value || "";
                console.log("[GlobalPrompt] Negative prompt updated:", globalNegativePrompt);
            };
        }
    },

    async nodeCreated(node) {
        if (node.type === "GlobalPositivePrompt" || node.type === "GlobalNegativePrompt") {
            const widget = node.widgets?.[0];
            if (widget) {
                const originalCallback = widget.callback;
                widget.callback = function(value) {
                    if (originalCallback) originalCallback.apply(this, arguments);
                    if (node.type === "GlobalPositivePrompt") {
                        globalPositivePrompt = String(value || "").trim();
                        console.log("[GlobalPrompt] Positive prompt changed:", globalPositivePrompt);
                    } else {
                        globalNegativePrompt = String(value || "").trim();
                        console.log("[GlobalPrompt] Negative prompt changed:", globalNegativePrompt);
                    }
                };
            }
        }
    },

    async setup() {
        const originalQueuePrompt = app.queuePrompt;
        app.queuePrompt = async function (prompt) {
            console.log("[GlobalPrompt] Queueing prompt, global prompts:", {
                positive: globalPositivePrompt,
                negative: globalNegativePrompt
            });
            
            for (const nodeId in prompt) {
                const node = prompt[nodeId];
                if (node.class_type === "KSampler" || node.class_type === "KSamplerAdvanced") {
                    console.log("[GlobalPrompt] Found KSampler node:", nodeId);
                    
                    if (globalPositivePrompt) {
                        let promptKey = "prompt";
                        if (node.inputs["正面条件"] !== undefined && node.inputs["prompt"] === undefined) {
                            promptKey = "正面条件";
                        }
                        const currentPrompt = typeof node.inputs[promptKey] === "string" ? node.inputs[promptKey] : "";
                        const newPrompt = globalPositivePrompt + (currentPrompt ? ", " + currentPrompt : "");
                        node.inputs[promptKey] = newPrompt;
                        console.log("[GlobalPrompt] Injected positive prompt:", newPrompt);
                    }
                    
                    if (globalNegativePrompt) {
                        let negativeKey = "negative";
                        if (node.inputs["负面条件"] !== undefined && node.inputs["negative"] === undefined) {
                            negativeKey = "负面条件";
                        }
                        const currentNegative = typeof node.inputs[negativeKey] === "string" ? node.inputs[negativeKey] : "";
                        const newNegative = globalNegativePrompt + (currentNegative ? ", " + currentNegative : "");
                        node.inputs[negativeKey] = newNegative;
                        console.log("[GlobalPrompt] Injected negative prompt:", newNegative);
                    }
                }
            }
            
            return originalQueuePrompt.apply(this, arguments);
        };
    }
});